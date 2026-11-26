import { createHash } from 'node:crypto'

// Keep the original credential slot so existing installations retain their connection.
export const credential = 'dsh-agentapi/dallas'
export const endpoint = 'https://agent.sufy.com'
export const portal = 'https://portal.qiniu.com/agentapi'
export const models = {
  claudecode: ['anthropic/claude-opus-5.5[1m]', 'deepseek/deepseek-v4-pro-0813'],
  codex: ['coding-openai/gpt-6.1-sol', 'openai/gpt-6-astra'],
  native: ['deepseek/deepseek-v4.1-flash-1017', 'moonshotai/kimi-k3'],
}
export const runtimes = { native: 'Native', claudecode: 'Claude Code', codex: 'Codex' }
export const defaults = { runtime: 'native', model: models.native[0], agentId: '', environmentId: '' }
const source = 'deepseek-harness'
const system = '完成用户委派的独立任务，简明说明结果。可下载产物写入 /mnt/session/outputs/。代码改动以可审阅的 patch 或 diff 文件交付。'

// Apply the Session policy without enabling disabled tools or changing the shared Agent.
export function allowTools(tools) {
  const allow = { type: 'always_allow' }
  return tools.map(tool => {
    if (!tool.type?.startsWith('agent_toolset_') && tool.type !== 'mcp_toolset') return tool
    const result = { ...tool, default_config: { ...tool.default_config, permission_policy: allow } }
    if (tool.type === 'mcp_toolset') result.permission_policy = allow.type
    if (tool.configs) result.configs = tool.configs.map(config => ({ ...config, permission_policy: allow }))
    return result
  })
}

export class AgentAPI {
  constructor(key, fetcher = fetch) {
    this.key = key
    this.fetcher = fetcher
  }

  async request(path, { body, signal } = {}) {
    const multipart = body instanceof FormData
    const headers = { 'x-api-key': this.key }
    if (body && !multipart) headers['content-type'] = 'application/json'
    const timeout = AbortSignal.timeout(multipart ? 120000 : 30000)
    const response = await this.fetcher(endpoint + '/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: multipart ? body : JSON.stringify(body),
    })
    if (!response.ok) {
      const raw = (await response.text()).slice(0, 2000)
      let reason
      try { const data = JSON.parse(raw); reason = data.error?.message ?? data.message } catch {}
      const detail = String(reason || raw).replaceAll(this.key, '•••').slice(0, 250)
      const hint = { 401: '请在设置中检查 AgentAPI Key', 403: '请检查账号权限或所选资源', 404: '请检查所选资源是否仍然可用' }[response.status]
      throw Object.assign(new Error([response.status, hint, detail].filter(Boolean).join(' · ')), { status: response.status })
    }
    return response.json()
  }

  async listPage(path, { page, limit = 20 } = {}, signal) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100.')
    const query = new URLSearchParams({ limit: String(limit) })
    if (page) query.set('page', page)
    const result = await this.request(path + (path.includes('?') ? '&' : '?') + query, { signal })
    if (!Array.isArray(result.data)) throw new Error('AgentAPI returned an invalid list.')
    return result
  }

  async *pages(path, signal) {
    const seen = new Set()
    let page
    do {
      const result = await this.listPage(path, { limit: 100, page }, signal)
      yield result.data
      page = result.next_page
      if (page && seen.has(page)) throw new Error('AgentAPI 返回了重复分页游标')
      seen.add(page)
    } while (page)
  }

  async catalogPage(kind, options, signal) {
    const result = await this.listPage(kind, options, signal)
    const data = result.data.filter(row => !row.archived_at && row.status !== 'archived').map(row => {
      const item = { id: row.id, name: row.name }
      if (row.description) item.description = row.description
      if (kind === 'agents') {
        item.version = row.version
        item.runtime = row.runtime
        item.model = row.model?.id
      } else {
        item.type = row.config?.type
        item.status = row.status
        if (row.config?.networking?.type) item.networking = row.config.networking.type
      }
      // Host tool results must survive a lossless JSON round trip.
      return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined))
    })
    return { data, next_page: result.next_page ?? null }
  }

  async inventory(kind, signal) {
    const resources = []
    for await (const rows of this.pages(kind, signal)) {
      for (const row of rows) if (!row.archived_at && row.status !== 'archived') resources.push(row)
    }
    return resources
  }

  async resource(kind, id, signal) {
    const item = await this.request(kind + '/' + encodeURIComponent(id), { signal })
    if (item.status === 'archived' || item.archived_at) {
      throw Object.assign(new Error('所选资源已归档，请在高级设置中重新选择'), { code: 'archived' })
    }
    return item
  }

  async defaultResource(kind, config, signal) {
    const isAgent = kind === 'agents'
    const tag = isAgent ? 'agent-' + config.runtime : 'cloud'
    const metadata = { source, dsh_default: tag }
    for await (const rows of this.pages(kind, signal)) {
      const found = rows.find(row => row.metadata?.source === source && row.metadata.dsh_default === tag &&
        !row.archived_at && row.status !== 'archived' && (!isAgent || row.runtime === config.runtime))
      if (found) return found
    }
    const body = isAgent
      ? { name: 'DSH Agent · ' + runtimes[config.runtime], runtime: config.runtime, model: { id: config.model },
          description: 'DeepSeek Harness 会话委派助手', system, tools: allowTools([{ type: 'agent_toolset_20260401' }]), metadata }
      : { name: 'DSH Cloud', config: { type: 'cloud', networking: { type: 'unrestricted' } }, metadata }
    return this.request(kind, { body, signal })
  }

  send(sessionId, events, signal) {
    return this.request('sessions/' + encodeURIComponent(sessionId) + '/events', { body: { events }, signal })
  }

  async file(sessionId, file, signal) {
    const form = new FormData()
    form.append('scope_id', sessionId)
    form.append('file', file.blob, file.name)
    return this.request('files', { body: form, signal })
  }

  async outputs(sessionId, inputs, signal) {
    const result = []
    for await (const rows of this.pages('files?scope_id=' + encodeURIComponent(sessionId), signal)) {
      for (const row of rows) if (!inputs.includes(row.id)) result.push({ id: row.id, name: row.filename })
    }
    return result
  }
}

// Overlapping first dispatches share a provisioning operation, independent of caller cancellation.
export function resourceResolver(saved = {}, persist = async () => {}) {
  const pending = new Map()
  return async (api, kind, config, signal) => {
    const id = kind === 'agents' ? config.agentId : config.environmentId
    if (id) return api.resource(kind, id, signal)
    const account = createHash('sha256').update(endpoint + '\0' + api.key).digest('hex')
    const key = [account, kind, kind === 'agents' ? config.runtime : 'cloud'].join('/')
    if (!pending.has(key)) {
      const find = async () => {
        if (saved[key]) {
          try {
            const row = await api.resource(kind, saved[key])
            if (kind !== 'agents' || row.runtime === config.runtime) return row
          } catch (error) {
            if (error.status !== 404 && error.code !== 'archived') throw error
          }
        }
        const row = await api.defaultResource(kind, config)
        saved[key] = row.id
        await persist()
        return row
      }
      const promise = find().finally(() => pending.delete(key))
      pending.set(key, promise)
    }
    const resource = await pending.get(key)
    signal?.throwIfAborted()
    return resource
  }
}

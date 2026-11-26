import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { defaults, resourceResolver } from '../lib/agentapi.js'
import { selectedAttachments, inputFiles } from '../lib/inputs.js'
import { consume, executeCloud } from '../lib/run.js'

const signal = new AbortController().signal
const event = (seq, type, rest = {}) => ({ sequence_number: seq, type, id: String(seq), processed_at: '2026-11-26', ...rest })
const message = (text, kind = 'user') => ({ role: 'user', source: { kind }, content: [{ type: 'text', text }] })

test('only selected files from the current human message can be resolved', () => {
  const messages = [message('@/previous/secret'), message('@/work/orders.txt @"/work/my notes.txt"'),
    message('@/other/secret', 'runtime-context')]
  for (const name of ['orders.txt', '@/work/orders.txt', '/work/orders.txt']) {
    assert.deepEqual(selectedAttachments(messages, [name]), [{ type: 'path', path: '/work/orders.txt' }])
  }
  assert.equal(selectedAttachments(messages, ['my notes.txt'])[0].path, '/work/my notes.txt')
  assert.throws(() => selectedAttachments(messages, ['secret']))
  assert.throws(() => selectedAttachments([message('@/one/a.txt @/two/a.txt')], ['a.txt']), /重名/)
})

test('versioned repository input archives the commit from a nested cwd', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-test-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  await mkdir(join(cwd, 'sub'))
  await writeFile(join(cwd, 'tracked'), 'committed')
  git('add', 'tracked')
  git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture')
  const sha = git('rev-parse', 'HEAD')
  await writeFile(join(cwd, 'tracked'), 'local edit')
  const [file] = await inputFiles(null, [], sha, join(cwd, 'sub'), signal)
  await writeFile(join(cwd, file.name), Buffer.from(await file.blob.arrayBuffer()))
  assert.equal(execFileSync('unzip', ['-p', file.name, 'tracked'], { cwd, encoding: 'utf8' }), 'committed')
  assert.equal(await readFile(join(cwd, 'tracked'), 'utf8'), 'local edit')
})

test('first dispatch deduplicates concurrent creation and retries a failed resource', async () => {
  const resolve = resourceResolver()
  let calls = 0
  const api = { key: 'test', defaultResource: async () => {
    if (++calls === 1) throw Error('offline')
    return { id: 'env_example' }
  } }
  const get = () => resolve(api, 'environments', defaults, signal)
  await assert.rejects(get(), /offline/)
  assert.deepEqual(await Promise.all([get(), get()]), [{ id: 'env_example' }, { id: 'env_example' }])
  assert.equal(calls, 2)
})

test('a pending input and initial idle do not complete the task; Native interrupt is authoritative', () => {
  const task = { inputId: '2', status: 'running' }
  const idle = seq => event(seq, 'session.status_idle', { stop_reason: { type: 'end_turn' } })
  consume(task, [idle(1), event(2, 'user.message', { processed_at: null }), idle(3)])
  assert.equal(task.status, 'running')
  assert.equal(task.cursor, '1')
  consume(task, [event(2, 'user.message'), event(3, 'user.interrupt'), idle(4)])
  assert.equal(task.status, 'cancelled')
})

test('waiting for approval stays live until a later answer and end_turn', () => {
  const task = { status: 'running', inputId: '1' }
  consume(task, [event(1, 'user.message'), event(2, 'session.status_idle', { stop_reason: { type: 'requires_action' } })])
  assert.equal(task.status, 'waiting')
  consume(task, [event(3, 'session.status_running'), event(4, 'agent.message', { content: [{ type: 'text', text: 'done' }] }),
    event(5, 'session.status_idle', { stop_reason: { type: 'end_turn' } })])
  assert.equal(task.status, 'collecting')
  assert.equal(task.summary, 'done')
})

for (const explicit of [true, false]) {
  test('session ' + (explicit ? 'pins existing Agent without overrides' : 'uses agent_with_overrides for a selected model'), async () => {
    let ref
    const files = [{ id: 'file_result', name: 'report.txt' }]
    const api = {
      request: async (path, options) => {
        if (path === 'sessions') { ref = options.body.agent; return { id: 'ses_test' } }
        return { data: [event(1, 'user.message'), event(2, 'session.status_idle', { stop_reason: { type: 'end_turn' } })] }
      },
      send: async () => ({ data: [{ id: '1' }] }), outputs: async () => files,
    }
    const task = { id: 'local', title: 'test', inputFiles: [] }
    await executeCloud({ api, config: { ...defaults, agentId: explicit ? 'agt_test' : '' },
      resolve: async (_, kind) => kind === 'agents' ? { id: 'agt_test', version: 7, model: { id: 'original' } } : { id: 'env_test' },
      task, input: 'hello', files: [], changed: async () => {}, signal, wait: async () => {} })
    assert.deepEqual(ref, explicit ? { type: 'agent', id: 'agt_test', version: 7 } :
      { type: 'agent_with_overrides', id: 'agt_test', version: 7, model: { id: defaults.model } })
    assert.equal(task.status, 'completed')
    assert.deepEqual(task.files, files)
  })
}

test('explicit Session fields reach creation verbatim and the first message is sent separately', async () => {
  const { submitCloud } = await import('../lib/run.js')
  const sessionOptions = { agent: { type: 'agent_with_overrides', id: 'agt_catalog', version: 2,
    system: '', tools: [], mcp_servers: null, model: { id: 'custom-model' } }, environment_id: 'env_catalog',
    metadata: { case: 'fx' }, resources: [{ type: 'file', file_id: 'file_shared' }], vault_ids: ['vault_test'] }
  const task = { id: 'local', title: '云端 · FX', sessionTitle: 'FX', inputFiles: [] }
  let creates = 0
  const messages = []
  const api = {
    async request(path, { body }) {
      assert.equal(path, 'sessions')
      assert.deepEqual(body, { ...sessionOptions, title: 'FX' })
      creates++
      return { id: 'ses_test', agent: { name: 'Pinned', runtime: 'native', model: { id: 'custom-model' } },
        resources: [{ type: 'file', file_id: 'file_copy' }] }
    },
    async send(id, events) {
      assert.equal(id, 'ses_test')
      messages.push(events[0].input.parts[0].text)
      return { data: [{ id: 'msg-' + messages.length }] }
    },
  }
  for (const input of ['Audit the ledger.', 'Review the rounding.']) {
    await submitCloud({ api, task, sessionOptions, input, files: [], signal, changed: async () => {} })
  }
  assert.equal(creates, 1)
  assert.deepEqual(messages, ['Audit the ledger.', 'Review the rounding.'])
  assert.deepEqual(task.inputFiles, ['file_copy'])
  assert.equal(task.agent, 'Pinned')
  assert.equal(task.model, 'custom-model')
})

test('catalog pages expose compact reusable references and preserve server pagination', async () => {
  const { AgentAPI } = await import('../lib/agentapi.js')
  const api = new AgentAPI('test', async url => {
    assert.equal(new URL(url).searchParams.get('page'), 'a+b/c')
    assert.equal(new URL(url).searchParams.get('limit'), '2')
    const rows = url.includes('/agents?') ? [{ id: 'agt_a', name: 'Auditor', version: 4, runtime: 'native',
      model: { id: 'example' }, system: 'private instructions' }, { archived_at: 'yesterday' }]
      : [{ id: 'env_a', name: 'Lab', status: 'ready', config: { type: 'cloud', networking: { type: 'limited' } } }]
    return Response.json({ data: rows, next_page: 'opaque' })
  })
  const args = { page: 'a+b/c', limit: 2 }
  assert.deepEqual(await api.catalogPage('agents', args, signal), { data: [
    { id: 'agt_a', name: 'Auditor', version: 4, runtime: 'native', model: 'example' }], next_page: 'opaque' })
  assert.deepEqual((await api.catalogPage('environments', args, signal)).data, [
    { id: 'env_a', name: 'Lab', status: 'ready', type: 'cloud', networking: 'limited' }])
  await assert.rejects(api.catalogPage('agents', { limit: 0 }, signal), /limit/)
})

test('host GitHub credential is bound to github.com and never written back to the argument', async () => {
  const { repositoryCredentials } = await import('../lib/inputs.js')
  const repo = { type: 'github_repository', url: 'https://github.com/example/repo' }
  let reads = 0
  const credentials = { async resolve(name) {
    assert.equal(name, 'DSH_AGENTAPI_GITHUB_TOKEN')
    reads++
    return { value: 'test-token' }
  } }
  await assert.rejects(repositoryCredentials([{ ...repo, url: 'https://github.com.example.org/o/r' }], credentials))
  assert.equal(reads, 0)
  assert.equal((await repositoryCredentials([repo], credentials))[0].authorization_token, 'test-token')
  assert.equal(repo.authorization_token, undefined)
  assert.equal(reads, 1)
})

test('pinned Agent versions keep tool selection and get always_allow only in the delegated Session', async () => {
  const { submitCloud } = await import('../lib/run.js')
  const tools = [
    { type: 'agent_toolset_20260401', default_config: { enabled: false }, configs: [{ name: 'bash', enabled: true, permission_policy: { type: 'always_ask' } }] },
    { type: 'mcp_toolset', server_name: 'docs', permission_policy: 'always_ask', configs: [{ name: 'index', enabled: false }] },
    { type: 'custom', name: 'external' },
  ]
  const original = structuredClone(tools)
  let creation
  const api = { async request(path, opts) {
    if (path === 'agents/agt_ref?version=7') return { version: 7, tools }
    assert.equal(path, 'sessions')
    creation = opts.body.agent
    return { id: 'ses' }
  }, send: async () => ({ data: [{ id: 'msg' }] }) }
  await submitCloud({ api, task: { inputFiles: [] }, sessionOptions: { agent: { id: 'agt_ref', version: 7 }, environment_id: 'env' },
    input: 'task', files: [], changed: async () => {}, signal })
  assert.equal(creation.type, 'agent_with_overrides')
  assert.equal(creation.version, 7)
  assert.deepEqual(tools, original)
  for (const group of creation.tools.slice(0, 2)) {
    assert.equal(group.default_config.permission_policy.type, 'always_allow')
    assert.equal(group.configs[0].permission_policy.type, 'always_allow')
  }
  assert.equal(creation.tools[0].default_config.enabled, false)
  assert.equal(creation.tools[0].configs[0].enabled, true)
  assert.equal(creation.tools[1].permission_policy, 'always_allow')
  assert.equal(creation.tools[1].configs[0].enabled, false)
  assert.deepEqual(creation.tools[2], original[2])
})

// AgentAPI Session.usage and DSH use disjoint uncached-input, output and cache buckets.
const count = value => Number.isSafeInteger(value) && value >= 0
const fields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

export function sessionUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const writes = raw.cache_creation
  const counts = [raw.input_tokens, raw.output_tokens, raw.cache_read_input_tokens,
    writes?.ephemeral_5m_input_tokens, writes?.ephemeral_1h_input_tokens, raw.cache_creation_input_tokens]
  if (!counts.some(count) || counts.some(n => n != null && !count(n))) return null
  const usage = { inputTokens: counts[0] ?? 0, outputTokens: counts[1] ?? 0,
    cacheReadTokens: counts[2] ?? 0, cacheWriteTokens: counts[5] ?? ((counts[3] ?? 0) + (counts[4] ?? 0)) }
  usage.totalTokens = fields.reduce((sum, key) => sum + usage[key], 0)
  return count(usage.totalTokens) ? usage : null
}

export function turnUsage(before, after) {
  if (before === undefined || !after) return null
  const delta = {}
  for (const key of [...fields, 'totalTokens']) {
    delta[key] = after[key] - (before?.[key] ?? 0)
  }
  // AgentAPI can omit the cache-write breakdown on a later cumulative snapshot.
  // The meter cannot retract a previous bucket. Credit only net new cache tokens.
  const cacheGrowth = delta.cacheReadTokens + delta.cacheWriteTokens
  if (!count(cacheGrowth)) return null
  if (delta.cacheWriteTokens < 0) Object.assign(delta, { cacheReadTokens: cacheGrowth, cacheWriteTokens: 0 })
  if (delta.cacheReadTokens < 0) Object.assign(delta, { cacheWriteTokens: cacheGrowth, cacheReadTokens: 0 })
  return Object.values(delta).every(count) ? delta : null
}

const latestRead = new WeakMap()
export async function readUsage(api, task, signal) {
  const ticket = Symbol()
  latestRead.set(task, ticket)
  const session = await api.request('sessions/' + encodeURIComponent(task.sessionId), { signal })
  const usage = sessionUsage(session.usage)
  if (latestRead.get(task) === ticket) task.usage = usage
  return usage
}

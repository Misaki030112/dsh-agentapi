import test from 'node:test'
import assert from 'node:assert/strict'
import { readUsage, sessionUsage, turnUsage } from '../lib/usage.js'

test('unknown usage stays unknown and a reported zero stays zero', () => {
  for (const raw of [{}, undefined, { server_tool_use: {} }, { input_tokens: -1 }]) assert.equal(sessionUsage(raw), null)
  assert.equal(sessionUsage({ output_tokens: 0 }).totalTokens, 0)
})

test('charge cache creation once, with or without its lifetime breakdown', () => {
  const raw = { input_tokens: 2, output_tokens: 9, cache_read_input_tokens: 90,
    cache_creation: { ephemeral_5m_input_tokens: 6, ephemeral_1h_input_tokens: 4 } }
  for (const usage of [raw, { ...raw, cache_creation_input_tokens: 10 },
    { ...raw, cache_creation: undefined, cache_creation_input_tokens: 10 }]) {
    assert.equal(sessionUsage(usage).totalTokens, 111)
  }
})

test('completed and interrupted turns contribute only the confirmed increase', () => {
  const first = sessionUsage({ input_tokens: 4, output_tokens: 560, cache_read_input_tokens: 11676, cache_creation_input_tokens: 19110 })
  const second = sessionUsage({ input_tokens: 14, output_tokens: 1290, cache_read_input_tokens: 54850 })
  const interrupted = sessionUsage({ input_tokens: 28, output_tokens: 2131, cache_read_input_tokens: 114014 })
  const increments = [turnUsage(null, first), turnUsage(first, second), turnUsage(second, interrupted)]
  for (const usage of increments) {
    assert.equal(usage.totalTokens, usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens)
  }
  assert.equal(increments.at(-1).totalTokens, 60019)
  assert.equal(increments.reduce((n, u) => n + u.totalTokens, 0), interrupted.totalTokens)
  assert.equal(turnUsage(interrupted, interrupted).totalTokens, 0)
  assert.equal(turnUsage(undefined, interrupted), null)
  assert.equal(turnUsage(interrupted, null), null)
  assert.equal(turnUsage(interrupted, first), null)
})

test('an older catalog read cannot overwrite a later settlement', async () => {
  const task = { sessionId: 'ses_example' }
  const delayed = Promise.withResolvers()
  const older = readUsage({ request: () => delayed.promise }, task)
  await readUsage({ request: async () => ({ usage: { output_tokens: 10 } }) }, task)
  delayed.resolve({ usage: { output_tokens: 2 } })
  await older
  assert.equal(task.usage.totalTokens, 10)
})

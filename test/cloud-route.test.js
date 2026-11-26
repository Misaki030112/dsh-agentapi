import assert from 'node:assert/strict'
import test from 'node:test'
import { installCloudRoute } from '../lib/cloud-route.js'

test('explicit cloud handoff guards the active request and concludes only an accepted dispatch', async () => {
  const hooks = {}
  let guard, ended = 0
  const ctx = { on: (name, cb) => { hooks[name] = cb }, tools: { guard: cb => { guard = cb } } }
  const parent = { id: 'parent', session: {} }, other = { id: 'other', session: {} }
  const child = { id: '12345678-child', nativeChild: true, owner: parent.id, session: { header: { origin: 'subagent' } } }
  const delegate = installCloudRoute(ctx, { [child.id]: child }, async (_, reply) => {
    if (reply instanceof Error) throw reply
    return reply
  })
  const claim = (text, agent = parent, kind = 'user') => hooks['agent/inbox/claimed']({ agent,
    message: { source: { kind }, content: [{ type: 'text', text }] } })
  const check = (name, args = {}, agent = parent) => guard({ name, arguments: args, agent })
  const exec = { agent: parent, concludeTurn: () => { ended++ } }
  claim(' /cloud 核对这两套口径，返回差异和证据')
  for (const name of ['read', 'grep', 'glob', 'create_goal', 'subagent']) assert.match(check(name), /agentapi_delegate/)
  assert.match(check('bash', { command: 'git rev-parse HEAD && node audit.js' }), /agentapi_delegate/)
  assert.equal(check('bash', { command: 'git rev-parse HEAD' }), undefined)
  for (const name of ['agentapi_delegate', 'agentapi_list_agents', 'agentapi_list_environments', 'ask_user_question']) {
    assert.equal(check(name), undefined)
  }
  assert.equal(check('send_message', { agent: 'cloud-12345678' }), undefined)
  assert.match(check('send_message', { agent: 'local-child' }), /cloud/)
  claim('/cloud process this literal', child)
  assert.equal(check('read', {}, child), undefined)
  assert.equal(check('read', {}, other), undefined)
  await assert.rejects(delegate(exec, Error('activation failed')), /activation failed/)
  await delegate(exec, { accepted: false })
  assert.equal(ended, 0)
  await delegate(exec, { accepted: true })
  assert.equal(ended, 1)
  const followUp = { ...exec, name: 'send_message', arguments: { agent: 'cloud-12345678' } }
  assert.equal(hooks['tools/execute'](followUp, () => 'delivered'), 'delivered')
  assert.equal(ended, 2)
  hooks['session/event'](parent.session, { type: 'turn/end' })
  claim('/cloud quoted by the child', parent, 'subagent-settled')
  assert.equal(check('read'), undefined)
  await delegate(exec, { accepted: true })
  assert.equal(ended, 2)
  claim('/cloud first')
  claim('在主会话处理这个新问题')
  assert.equal(check('read'), undefined)
  for (const text of ['/cloudy', 'explain /cloud', '`/cloud task`']) {
    claim(text)
    assert.equal(check('read'), undefined)
  }
})

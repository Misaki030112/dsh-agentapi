// A slash route belongs to the input being consumed. An older /cloud message
// in history must not route the next ordinary turn or a child's completion notice.
const routingTools = new Set([
  'agentapi_delegate', 'agentapi_list_agents', 'agentapi_list_environments',
  'agentapi_status', 'agentapi_cancel', 'list_agents', 'ask_user_question', 'run_code',
])

export function installCloudRoute(ctx, tasks, dispatch) {
  const routed = new WeakSet()
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source?.kind !== 'user' || agent.session.header?.origin === 'subagent') return
    const first = message.content.find(part => part.type === 'text' && part.text.trim())
    if (/^\s*\/cloud(?:\s|$)/u.test(first?.text ?? '')) routed.add(agent.session)
    else routed.delete(agent.session)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') routed.delete(session)
  })

  // A model can request local tools in the same batch as its delegation.
  // DSH also checks this guard on individual calls inside the run_code transport.
  function toCloudChild(exec) {
    return exec.name === 'send_message' && Object.values(tasks).some(child =>
      child.nativeChild && child.owner === exec.agent.id &&
      (exec.arguments.agent === child.id || exec.arguments.agent === 'cloud-' + child.id.slice(0, 8)))
  }
  ctx.tools.guard(exec => {
    if (!routed.has(exec.agent?.session) || routingTools.has(exec.name)) return
    // The existing commit attachment accepts a full SHA; resolving HEAD is
    // input preparation for that option.
    if (exec.name === 'bash' && ['git rev-parse HEAD', 'git rev-parse --verify HEAD'].includes(exec.arguments.command?.trim())) return
    if (toCloudChild(exec)) return
    return 'The user selected /cloud. Use agentapi_delegate for the assignment, or send_message to its existing cloud child. Ask the user if required input is missing.'
  })
  ctx.on('tools/execute', (exec, next) => {
    // Desktop passes its ToolRunContext through the dispatch waterfall. DSH
    // carries the turn-ending marker only on a successful tool result.
    if (routed.has(exec.agent?.session) && toCloudChild(exec)) exec.concludeTurn()
    return next()
  })
  return async (exec, assignment) => {
    const receipt = await dispatch(exec.agent, assignment, exec.signal)
    if (receipt.accepted && routed.has(exec.agent.session)) exec.concludeTurn()
    return receipt
  }
}

const string = { type: 'string' }
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const array = items => ({ type: 'array', items })
const choice = (...values) => ({ type: 'string', enum: values })
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] })
const effort = choice('low', 'medium', 'high', 'xhigh', 'max')

const agent = {
  description: 'AgentAPI agent ID or Session agent reference. Omit to use plugin settings. An omitted version selects the latest version at creation.',
  oneOf: [string, object({
    id: { ...string, description: 'Agent ID from agentapi_list_agents.' },
    type: { ...choice('agent', 'agent_with_overrides'), description: 'Use agent_with_overrides to replace model, system, tools, mcp_servers or skills for this Session. Omitted fields inherit.' },
    version: { type: 'integer', description: 'Positive Agent version to pin.' },
    model: nullable({ oneOf: [string, object({
      id: string, effort: { oneOf: [effort, object({ type: effort }, ['type'])] },
      inference_geo: choice('us', 'global'), speed: choice('standard', 'fast'),
    }, ['id'])] }),
    system: nullable(string),
    tools: nullable(array({ type: 'object', description: 'AgentAPI tool definition, including its type and configuration.' })),
    mcp_servers: nullable(array(object({ type: { type: 'string', const: 'url' }, name: string, url: string }, ['name', 'url']))),
    skills: nullable(array(object({ type: choice('custom', 'anthropic'), skill_id: string, version: string }, ['type', 'skill_id']))),
  }, ['id'])],
}

const resource = { oneOf: [
  object({ type: { type: 'string', const: 'file' }, file_id: string, mount_path: string }, ['type', 'file_id']),
  object({ type: { type: 'string', const: 'github_repository' }, url: string,
    authorization_token: { ...string, description: 'Omit for github.com to use the host credential DSH_AGENTAPI_GITHUB_TOKEN. Keep raw tokens out of tool-call history.' },
    mount_path: string, checkout: { oneOf: [
      object({ type: { type: 'string', const: 'branch' }, name: string }, ['type', 'name']),
      object({ type: { type: 'string', const: 'commit' }, sha: string }, ['type', 'sha']),
    ] },
  }, ['type', 'url']),
  object({ type: { type: 'string', const: 'memory_store' }, memory_store_id: string,
    access: { ...choice('read_only', 'read_write'), description: 'Defaults to read_write.' }, instructions: string,
  }, ['type', 'memory_store_id']),
] }

export const delegateParameters = object({
  task: { ...string, description: 'First message to the child. Include the goal, relevant context, constraints and deliverable. The child starts with a separate conversation and workspace.' },
  agent,
  environment_id: { ...string, description: 'Environment ID from agentapi_list_environments. Omit to use plugin settings.' },
  title: { ...string, description: 'Session title in the user’s language. Defaults to a short excerpt of the task.' },
  metadata: { type: 'object', description: 'Up to 16 string key/value pairs. Omit to use DSH tracking metadata.' },
  resources: { ...array(resource), description: 'AgentAPI resources to mount at Session creation. For user-selected local files, use attachments.' },
  vault_ids: { ...array(string), description: 'IDs of AgentAPI vaults to attach to the Session.' },
  attachments: { ...array(string), description: 'Names or @paths of local files the user selected in the current message.' },
  commit: { ...string, description: 'Full Git commit SHA to upload as a ZIP from the current workspace.' },
}, ['task'])

export const pageParameters = object({
  page: { ...string, description: 'next_page from the previous response. Omit for the first page.' },
  limit: { type: 'integer', description: 'Results per page, 1–100. Defaults to 20.' },
})

const childId = { ...string, description: 'DSH child id returned by agentapi_delegate or agentapi_status.' }
export const statusParameters = object({ id: childId })
export const cancelParameters = object({ id: childId }, ['id'])

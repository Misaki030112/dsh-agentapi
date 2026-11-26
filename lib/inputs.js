import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, resolve } from 'node:path'
const git = promisify(execFile)
const limit = 32 * 1024 * 1024

export async function repositoryCredentials(resources, credentials) {
  const missing = resources.filter(r => r.type === 'github_repository' && !r.authorization_token)
  if (!missing.length) return resources
  for (const { url } of missing) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(url)) {
      throw new Error('The host GitHub credential requires an https://github.com/owner/repo URL.')
    }
  }
  const token = (await credentials.resolve('DSH_AGENTAPI_GITHUB_TOKEN'))?.value
  if (!token) throw new Error('Configure DSH_AGENTAPI_GITHUB_TOKEN for GitHub mounts, or use commit for a local checkout.')
  return resources.map(r => missing.includes(r) ? { ...r, authorization_token: token } : r)
}

export function selectedAttachments(messages, names = []) {
  if (!Array.isArray(names) || names.some(n => typeof n !== 'string' || !n)) throw new Error('附件名无效')
  // Only human-authored input can select a host file. Tool results, remote-agent
  // notices and earlier turns must not supply paths for a new user request.
  const message = messages.findLast(msg => msg.role === 'user' && msg.source?.kind === 'user')
  const parts = Array.isArray(message?.content) ? message.content : []
  return [...new Set(names.map(name => name.replace(/^@/, '')))].map(name => {
    const matches = new Map()
    for (const part of parts) {
      const ref = part.attachment
      if (ref && ['file', 'image'].includes(part.type) && [ref.name, ref.attachmentId].includes(name)) {
        matches.set(ref.attachmentId, part)
      }
      if (part.type !== 'text') continue
      for (const match of part.text.matchAll(/(?:^|\s)@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s"'<>]+))/gu)) {
        const path = match[1] || match[2] || match[3]
        if (path === name || basename(path) === name) matches.set(path, { type: 'path', path })
      }
      // Desktop inserts some paths containing spaces verbatim. Match a full
      // path supplied by the tool only if the exact mention is in the message.
      if (name.includes(' ') && /^(?:\/|\.\/)/.test(name)) {
        if (part.text.split('@' + name).some((tail, i) => i > 0 && (!tail || /^\s/.test(tail)))) {
          matches.set(name, { type: 'path', path: name })
        }
      }
    }
    if (matches.size > 1) throw new Error('附件重名，请使用消息中的完整路径：' + name)
    if (!matches.size) throw new Error('本条用户消息中找不到该附件，请重新选择文件：' + name)
    return matches.values().next().value
  })
}

export async function inputFiles(store, attachments, commit, cwd, signal) {
  const files = []
  for (const { type, attachment, path } of attachments) {
    if (type === 'path') {
      const file = await open(resolve(cwd, path), constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > limit) throw new Error('请选择 32 MiB 以内的常规文件')
        const chunks = []
        let total = 0
        for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
          total += chunk.length
          if (total > limit) throw new Error('附件超过 32 MiB')
          chunks.push(chunk)
        }
        files.push({ name: basename(path), blob: new Blob(chunks) })
      } finally { await file.close() }
      continue
    }
    if (attachment.bytes > limit) throw new Error('单个附件上限为 32 MiB')
    let chunks
    if (type === 'image') chunks = [(await store.readImage(attachment, signal)).data]
    else chunks = await Array.fromAsync(store.readFileStream(attachment, signal))
    files.push({ name: attachment.name || attachment.attachmentId, image: type === 'image',
      blob: new Blob(chunks, { type: attachment.mediaType || 'application/octet-stream' }) })
  }
  if (commit) {
    if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(commit)) throw new Error('需要当前工作区的完整 Git commit SHA')
    const options = { cwd, signal, timeout: 60000, maxBuffer: limit }
    const root = (await git('git', ['rev-parse', '--show-toplevel'], options)).stdout.trim()
    const actual = (await git('git', ['rev-parse', '--verify', commit + '^{commit}'], options)).stdout.trim()
    if (actual !== commit.toLowerCase()) throw new Error('该 SHA 不是 commit')
    // zip is built into Git. Archive from the root so a nested cwd cannot change the snapshot.
    const { stdout } = await git('git', ['archive', '--format=zip', actual], { ...options, cwd: root, encoding: 'buffer' })
    files.push({ name: 'source-' + actual + '.zip', blob: new Blob([stdout], { type: 'application/zip' }) })
  }
  return files
}

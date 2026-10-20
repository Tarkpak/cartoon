import { ref } from 'vue'

// Each browser window has its own session, even when it shares a local backend.
export const projectEditSessionId = globalThis.crypto?.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`

/** A reload may recover the old draft, but a copied tab must never write its keys. */
export function createProjectDraftSession(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let recoveryWindowId: string | undefined
  try {
    recoveryWindowId = storage?.getItem('workbench-collaboration-window') || undefined
    if (!recoveryWindowId) storage?.setItem('workbench-collaboration-window', id)
  } catch { /* Drafts still use this document's unique runtime ID. */ }
  const claimed = new Set<string>()
  return {
    windowId: id,
    recoveryKey(prefix: string, actorId: string, projectId: string) {
      const scope = JSON.stringify([prefix, actorId, projectId])
      if (claimed.has(scope)) return undefined
      claimed.add(scope)
      let source = recoveryWindowId
      try {
        // Update only when this account/project is opened, so visiting another
        // page and refreshing cannot break recovery for unopened projects.
        const pointer = `workbench-collaboration-recovery:${scope}`
        source = storage?.getItem(pointer) || source
        storage?.setItem(pointer, id)
      } catch { /* The original recovery source is still safe to copy once. */ }
      return source && source !== id ? `${prefix}${JSON.stringify([actorId, projectId, source])}` : undefined
    }
  }
}

export const projectDraftSession = (() => {
  try { return createProjectDraftSession(projectEditSessionId, sessionStorage) }
  catch { return createProjectDraftSession(projectEditSessionId) }
})()
export const projectLeaseLost = ref<{ projectId?: string, sequence: number }>({ sequence: 0 })

export function noteProjectLeaseLost(status: number, path: string, body?: unknown) {
  if (status !== 423 || path.includes('/edit-session') || /^\/api\/project\/[^/?]+\/collaboration(?:[?]|$)/u.test(path)) return
  let payload = body
  if (typeof body === 'string') {
    try { payload = JSON.parse(body) } catch { payload = null }
  }
  const projectIdFromPath = path.match(/^\/api\/project\/([^/?]+)/u)?.[1]
  const projectId = projectIdFromPath ? decodeURIComponent(projectIdFromPath)
    : (payload && typeof payload === 'object' && 'projectId' in payload && typeof payload.projectId === 'string' ? payload.projectId : undefined)
  if (projectId) projectLeaseLost.value = { projectId, sequence: projectLeaseLost.value.sequence + 1 }
}

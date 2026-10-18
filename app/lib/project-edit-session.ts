import { ref } from 'vue'

// Each browser window has its own session, even when it shares a local backend.
export const projectEditSessionId = globalThis.crypto?.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
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

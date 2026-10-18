import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { CollaborationLease, CollaborationResource } from '../../shared/types/project-collaboration'
import { ProjectCollaborationClient } from '~/lib/project-collaboration-client'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

export type CollaborationScope = Pick<CollaborationResource, 'type' | 'id'>

/** Resource leases are independent: losing one episode never freezes the project. */
export function useProjectCollaboration() {
  const client = shallowRef<ProjectCollaborationClient>()
  const error = ref('')
  const revision = ref(0)
  const recovery = shallowRef<unknown>()
  const leases = ref(new Map<string, CollaborationLease>())
  const scopes = new Map<string, CollaborationScope>()
  const leaseVersions = new Map<string, number>()
  const now = ref(Date.now())
  let projectId = ''
  let actorId = ''
  let sequence = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let ticking = false
  let releasing: Promise<unknown> = Promise.resolve()
  const keyOf = (scope: CollaborationScope) => JSON.stringify([scope.type, scope.id])
  const storageKey = () => `project-collaboration-draft:${JSON.stringify([actorId, projectId])}`
  const request = async <T>(id: string, body: Record<string, unknown>) => {
    const response = await $fetch<{ data: T }>(`/api/project/${encodeURIComponent(id)}/collaboration`, {
      method: 'POST', body, timeout: 30_000, retry: 0
    })
    return response.data
  }

  function backup() {
    if (!client.value || !projectId || recovery.value !== undefined) return
    if (client.value.hasUnsavedChanges) {
      sessionStorage.setItem(storageKey(), JSON.stringify(client.value.backup()))
    } else sessionStorage.removeItem(storageKey())
  }

  function canEdit(scope: CollaborationScope) {
    const lease = leases.value.get(keyOf(scope))
    return recovery.value === undefined && !!lease?.editable && (lease.expiresAt ?? 0) > now.value
  }

  async function tick() {
    if (ticking || !projectId) return
    ticking = true
    const version = sequence
    const id = projectId
    const active = client.value
    try {
      for (const [key, scope] of [...scopes]) {
        if (version !== sequence) return
        const leaseVersion = leaseVersions.get(key)
        try {
          const lease = await request<CollaborationLease>(id, { action: 'lease', leaseAction: 'heartbeat', ...scope })
          if (version !== sequence) return
          if (leaseVersion !== leaseVersions.get(key) || !scopes.has(key)) continue
          leases.value.set(key, lease)
          if (!lease.editable) {
            scopes.delete(key)
            backup()
            error.value = '部分对象的编辑权已失效，草稿已备份，请重新取得编辑权后保存。'
          }
        } catch (cause) {
          if (version !== sequence) return
          if (leaseVersion !== leaseVersions.get(key) || !scopes.has(key)) continue
          leases.value.delete(key)
          scopes.delete(key)
          backup()
          throw cause
        }
      }
      await active?.poll()
      if (version === sequence) revision.value++
    } catch (cause) {
      if (version === sequence) error.value = getDisplayErrorMessage(cause, '协作连接暂时中断')
    } finally { ticking = false }
  }

  async function release(scope: CollaborationScope) {
    const id = projectId
    const key = keyOf(scope)
    leaseVersions.set(key, (leaseVersions.get(key) ?? 0) + 1)
    leases.value.delete(key)
    scopes.delete(key)
    if (id) await request(id, { action: 'lease', leaseAction: 'release', ...scope })
  }

  async function close(preserveDrafts = true) {
    if (preserveDrafts) backup()
    sequence++
    if (timer) clearInterval(timer)
    timer = undefined
    const id = projectId
    const held = [...scopes.values()]
    projectId = ''
    actorId = ''
    scopes.clear()
    leaseVersions.clear()
    leases.value.clear()
    client.value = undefined
    recovery.value = undefined
    releasing = Promise.all([releasing, Promise.allSettled(held.map(scope => request(id, { action: 'lease', leaseAction: 'release', ...scope })))])
    await releasing
  }

  async function open(id: string, userId: string) {
    if (!userId) throw new Error('请先登录云端账号')
    const closing = close()
    const version = sequence
    await closing
    if (version !== sequence) return
    projectId = id
    actorId = userId
    const next = new ProjectCollaborationClient(body => request(id, body))
    await next.load()
    if (version !== sequence) return
    const saved = sessionStorage.getItem(storageKey())
    try { recovery.value = saved ? JSON.parse(saved) : undefined }
    catch {
      recovery.value = { unreadableBackup: saved }
      error.value = '窗口备份格式异常，请先导出备份，再选择放弃。'
    }
    client.value = next
    if (recovery.value === undefined) error.value = ''
    revision.value++
    let ticks = 0
    timer = setInterval(() => {
      now.value = Date.now()
      if (++ticks % 20 === 0) void tick()
    }, 1000)
  }

  function recover() {
    if (!client.value || recovery.value === undefined) return
    client.value.restore(recovery.value)
    recovery.value = undefined
    revision.value++
    backup()
  }

  function discardRecovery() {
    sessionStorage.removeItem(storageKey())
    recovery.value = undefined
  }

  async function acquire(scope: CollaborationScope, takeover = false) {
    const version = sequence
    const key = keyOf(scope)
    const leaseVersion = (leaseVersions.get(key) ?? 0) + 1
    leaseVersions.set(key, leaseVersion)
    const lease = await request<CollaborationLease>(projectId, { action: 'lease', leaseAction: takeover ? 'takeover' : 'acquire', ...scope })
    if (version !== sequence || leaseVersions.get(key) !== leaseVersion) return false
    leases.value.set(keyOf(scope), lease)
    if (lease.editable) scopes.set(keyOf(scope), scope)
    else scopes.delete(keyOf(scope))
    return lease.editable
  }

  async function save(selected: CollaborationScope[]) {
    if (!client.value) throw new Error('协作项目尚未加载')
    if (selected.some(scope => !canEdit(scope))) throw new Error('请先取得对应对象的编辑权')
    const active = client.value
    try { await active.save(selected) }
    finally { if (active === client.value) { backup(); revision.value++ } }
  }

  async function retrySave() {
    const active = client.value
    if (!active) return
    // After reload, the backend needs fresh scoped leases before resending an outbox item.
    for (const scope of active.backup().pending?.mutations ?? []) {
      if (!canEdit(scope)) {
        // A cached outbox operation may already have committed, even if another member now holds the lease.
        try { await acquire(scope) } catch { /* Still ask the backend to confirm the original operation. */ }
      }
    }
    try { await active.retrySave() }
    finally { if (active === client.value) { backup(); revision.value++ } }
  }

  onBeforeUnmount(() => {
    try { backup() } catch (cause) { error.value = getDisplayErrorMessage(cause, '草稿备份失败，请导出后再关闭') }
    void close(false)
  })
  return { client, error, revision, recovery, leases, open, close, acquire, release, canEdit, save, retrySave, backup, recover, discardRecovery, refresh: tick }
}

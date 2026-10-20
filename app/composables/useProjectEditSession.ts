import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { projectLeaseLost } from '~/lib/project-edit-session'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

export interface ProjectEditSessionState {
  editable: boolean
  collaboration?: boolean
  scopeConflict?: boolean
  pendingSave?: boolean
  syncStatus?: 'connecting' | 'synced' | 'editing' | 'saving' | 'offline'
  lastRemoteUpdate?: string
  presenceAvailable?: boolean
  onlineCount?: number
  collaborators?: Array<{ userId: string, displayName: string, activity: string, locked: boolean }>
  canTakeover: boolean
  holderName?: string
  expiresAt?: number | null
  reason?: string
  backupId?: string
}

export function useProjectEditSession(onLost: (projectId: string) => Promise<string | undefined>) {
  const editSession = ref<ProjectEditSessionState>({ editable: false, canTakeover: false, reason: '正在取得编辑权…' })
  const acquiring = ref(false)
  let activeId = ''
  let sequence = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let busy = false

  async function lose(reason: string) {
    if (!editSession.value.editable) return
    const version = sequence
    editSession.value = { ...editSession.value, editable: false, reason }
    try {
      const backupId = await onLost(activeId)
      if (backupId && version === sequence) editSession.value = { ...editSession.value, backupId }
    } catch {
      if (version === sequence) editSession.value.reason = `${reason}；自动备份暂时失败，未同步修改仍保留在当前页面，请勿关闭页面。`
    }
  }

  async function heartbeat() {
    if (!activeId || !editSession.value.editable || busy) return
    busy = true
    const id = activeId
    const version = sequence
    try {
      const response = await $fetch<{ data: ProjectEditSessionState }>(`/api/project/${encodeURIComponent(id)}/edit-session`, { method: 'POST', body: { action: 'heartbeat' } })
      if (version !== sequence) return
      if (!response.data.editable) {
        editSession.value.canTakeover = response.data.canTakeover
        editSession.value.holderName = response.data.holderName
        await lose('编辑权已被接管或已过期，已暂停修改和生成。')
      } else editSession.value = { ...editSession.value, ...response.data }
    } catch (cause) {
      if (version === sequence) await lose(getDisplayErrorMessage(cause, '与云端连接中断，已暂停修改和生成。'))
    } finally { busy = false }
  }

  async function releaseEditSession() {
    const id = activeId
    activeId = ''
    sequence++
    if (timer) clearInterval(timer)
    timer = undefined
    editSession.value.editable = false
    if (id) await $fetch(`/api/project/${encodeURIComponent(id)}/edit-session`, { method: 'POST', body: { action: 'release' } }).catch(() => {})
  }

  async function openEditSession(id: string, takeover = false) {
    const backupId = activeId === id ? editSession.value.backupId : undefined
    const version = ++sequence
    if (activeId && activeId !== id) {
      const previousId = activeId
      activeId = ''
      if (timer) clearInterval(timer)
      timer = undefined
      await $fetch(`/api/project/${encodeURIComponent(previousId)}/edit-session`, { method: 'POST', body: { action: 'release' } }).catch(() => {})
      if (version !== sequence) return
    }
    activeId = id
    acquiring.value = true
    editSession.value = { editable: false, canTakeover: false, reason: '正在同步并取得编辑权…', backupId }
    try {
      const response = await $fetch<{ data: ProjectEditSessionState }>(`/api/project/${encodeURIComponent(id)}/edit-session`, { method: 'POST', body: { action: takeover ? 'takeover' : 'acquire' } })
      if (version === sequence) editSession.value = { ...response.data, backupId }
    } catch (cause) {
      if (version === sequence) editSession.value = { editable: false, canTakeover: false, reason: getDisplayErrorMessage(cause, '无法连接云端，当前以只读模式打开。'), backupId }
    } finally {
      if (version === sequence) {
        acquiring.value = false
        if (timer) clearInterval(timer)
        let ticks = 0
        timer = setInterval(() => {
          if (editSession.value.editable && editSession.value.expiresAt && Date.now() >= editSession.value.expiresAt) void lose('编辑租约已过期，已暂停修改和生成。')
          if (++ticks % 30 === 0) void heartbeat()
        }, 1000)
      }
    }
  }

  watch(projectLeaseLost, event => { if (event.projectId === activeId) void lose('服务器拒绝了写入：项目编辑权已失效，本地修改已保留。') })
  if (getCurrentInstance()) onBeforeUnmount(() => { void releaseEditSession() })

  return { editSession, projectEditable: computed(() => editSession.value.editable), acquiring, openEditSession, releaseEditSession, heartbeat }
}

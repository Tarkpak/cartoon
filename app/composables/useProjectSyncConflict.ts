import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

export interface ProjectConflictBackup {
  backupId: string
  localUpdatedAt: string
  remoteUpdatedAt: string
  localSceneCount: number
  remoteSceneCount: number
}

export function useProjectSyncConflict() {
  const backup = ref<ProjectConflictBackup | null>(null)
  const loading = ref(false)
  const resolving = ref<'local' | 'remote' | null>(null)
  const error = ref('')
  let requestVersion = 0
  let activeProjectId = ''
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let renewing = false
  let heldProjectId = ''
  let pendingRelease: Promise<void> = Promise.resolve()

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }

  async function release(projectId: string) {
    await $fetch(`/api/project/${encodeURIComponent(projectId)}/edit-session`, {
      method: 'POST', body: { action: 'release' }, timeout: 15_000, retry: 0
    }).catch(() => {})
  }

  async function heartbeat(projectId: string, version: number) {
    if (renewing || version !== requestVersion) return
    renewing = true
    try {
      const response = await $fetch<{ data: { editable: boolean } }>(`/api/project/${encodeURIComponent(projectId)}/edit-session`, {
        method: 'POST', body: { action: 'heartbeat' }, timeout: 15_000, retry: 0
      })
      if (version === requestVersion && !response.data.editable) {
        stopHeartbeat()
        backup.value = null
        error.value = '编辑权已过期或被接管，请重新核对版本；已有备份仍保留。'
      }
    } catch (cause) {
      if (version === requestVersion) {
        stopHeartbeat()
        backup.value = null
        error.value = getDisplayErrorMessage(cause, '编辑权续期失败，请重新核对版本')
      }
    } finally {
      renewing = false
    }
  }

  function reset() {
    const id = heldProjectId
    heldProjectId = ''
    requestVersion++
    stopHeartbeat()
    activeProjectId = ''
    backup.value = null
    loading.value = false
    resolving.value = null
    error.value = ''
    if (id) pendingRelease = pendingRelease.then(() => release(id))
  }

  async function prepare(projectId: string) {
    if (resolving.value) return
    if (heldProjectId && heldProjectId !== projectId) {
      const previousId = heldProjectId
      heldProjectId = ''
      pendingRelease = pendingRelease.then(() => release(previousId))
    }
    stopHeartbeat()
    const version = ++requestVersion
    activeProjectId = projectId
    loading.value = true
    backup.value = null
    error.value = ''
    try {
      await pendingRelease
      if (version !== requestVersion) return
      const response = await $fetch<{ success: boolean, data: ProjectConflictBackup }>(
        `/api/project/${encodeURIComponent(projectId)}/sync-conflict/backup`, { method: 'POST', timeout: 150_000, retry: 0 }
      )
      if (version === requestVersion) {
        heldProjectId = projectId
        backup.value = response.data
        heartbeatTimer = setInterval(() => { void heartbeat(projectId, version) }, 20_000)
      } else if (activeProjectId !== projectId) {
        pendingRelease = pendingRelease.then(() => release(projectId))
      }
    } catch (cause) {
      if (version === requestVersion) error.value = getDisplayErrorMessage(cause, '读取版本和创建备份失败，请重试')
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function resolve(projectId: string, strategy: 'local' | 'remote'): Promise<boolean> {
    if (!backup.value || loading.value || resolving.value || projectId !== activeProjectId) return false
    resolving.value = strategy
    const version = requestVersion
    error.value = ''
    try {
      await $fetch(`/api/project/${encodeURIComponent(projectId)}/sync-conflict/resolve`, {
        method: 'POST', body: { strategy, backupId: backup.value.backupId }, timeout: 150_000, retry: 0
      })
      return version === requestVersion
    } catch (cause) {
      if (version === requestVersion) {
        backup.value = null
        error.value = `${getDisplayErrorMessage(cause, '处理失败，本地备份已保留')}。请重新核对云端状态后再操作。`
      }
      return false
    } finally {
      if (version === requestVersion) resolving.value = null
    }
  }

  if (getCurrentInstance()) onBeforeUnmount(reset)
  return { backup, loading, resolving, error, prepare, resolve, reset }
}

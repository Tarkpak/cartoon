import { ref } from 'vue'
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

  function reset() {
    requestVersion++
    activeProjectId = ''
    backup.value = null
    loading.value = false
    error.value = ''
  }

  async function prepare(projectId: string) {
    const version = ++requestVersion
    activeProjectId = projectId
    loading.value = true
    backup.value = null
    error.value = ''
    try {
      const response = await $fetch<{ success: boolean, data: ProjectConflictBackup }>(
        `/api/project/${encodeURIComponent(projectId)}/sync-conflict/backup`, { method: 'POST' }
      )
      if (version === requestVersion) backup.value = response.data
    } catch (cause) {
      if (version === requestVersion) error.value = getDisplayErrorMessage(cause, '读取版本和创建备份失败，请重试')
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function resolve(projectId: string, strategy: 'local' | 'remote'): Promise<boolean> {
    if (!backup.value || loading.value || resolving.value || projectId !== activeProjectId) return false
    resolving.value = strategy
    error.value = ''
    try {
      await $fetch(`/api/project/${encodeURIComponent(projectId)}/sync-conflict/resolve`, {
        method: 'POST', body: { strategy, backupId: backup.value.backupId }
      })
      return true
    } catch (cause) {
      error.value = getDisplayErrorMessage(cause, '处理失败，本地备份已保留')
      return false
    } finally {
      resolving.value = null
    }
  }

  return { backup, loading, resolving, error, prepare, resolve, reset }
}

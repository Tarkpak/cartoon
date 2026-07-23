import { computed, onMounted, ref } from 'vue'
import type { WorkflowCompletionNotificationOptions } from '#shared/types/workflow-models'
import {
  getBrowserNotificationStatus,
  refreshBrowserNotificationStatus,
  requestBrowserNotificationPermission,
  sendSystemNotificationTest,
  useGenerationCompletionNotification,
  type BrowserNotificationStatus
} from '@/composables/useGenerationCompletionNotification'

/**
 * 设置「通用」页的生成完成提醒（提示音 / 系统通知）逻辑。
 * 复用 useGenerationCompletionNotification 的共享状态与加载/写入工具，
 * 持久化走 POST /api/models/workflow（step=completion_notification）。
 */
export function useCompletionNotificationSettings() {
  const {
    completionNotificationOptions,
    loadCompletionNotificationOptions,
    setCompletionNotificationOptions
  } = useGenerationCompletionNotification()

  const saving = ref(false)
  const systemNotificationStatus = ref<BrowserNotificationStatus>(getBrowserNotificationStatus())
  const systemNotificationTesting = ref(false)
  const completionNotificationHint = ref('')
  let saveRevision = 0
  let pendingSaves = 0
  let saveQueue: Promise<void> = Promise.resolve()
  let persistedCompletionNotificationOptions = { ...completionNotificationOptions.value }

  const isDesktopRuntime = computed(() => {
    if (!import.meta.client) return false
    const runtime = window as Window & {
      __TAURI__?: unknown
      __TAURI_INTERNALS__?: unknown
    }
    return !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__
  })

  const systemNotificationSupported = computed(() => {
    return systemNotificationStatus.value.supported && systemNotificationStatus.value.secureContext
  })

  function toCheckedBoolean(value: unknown): boolean {
    return value === true
  }

  async function updateCompletionNotificationOptions(
    patch: Partial<WorkflowCompletionNotificationOptions>
  ) {
    const next = setCompletionNotificationOptions(patch)
    const revision = ++saveRevision
    pendingSaves += 1
    saving.value = true

    const save = async () => {
      try {
        const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
          method: 'POST',
          body: {
            step: 'completion_notification',
            modelOptions: next
          }
        })

        if (!response.success) {
          throw new Error('生成完成提醒配置保存失败')
        }
        persistedCompletionNotificationOptions = { ...next }
      } catch (error) {
        console.error('[useCompletionNotificationSettings] 更新生成完成提醒配置失败:', error)
        if (revision === saveRevision) {
          setCompletionNotificationOptions(persistedCompletionNotificationOptions)
        }
      } finally {
        pendingSaves -= 1
        saving.value = pendingSaves > 0
      }
    }

    saveQueue = saveQueue.then(save, save)
    await saveQueue
  }

  async function refreshSystemNotificationStatus() {
    systemNotificationStatus.value = await refreshBrowserNotificationStatus()
  }

  function resolveSystemNotificationBlockedHint(status: BrowserNotificationStatus): string {
    const channelName = isDesktopRuntime.value ? '客户端' : '浏览器'

    if (!status.supported) {
      return `当前${channelName}不支持系统通知，无法申请权限。`
    }

    if (!status.secureContext) {
      return '系统通知只在 HTTPS 或 localhost 下可用，当前环境不能申请权限。'
    }

    if (status.permission === 'denied') {
      return isDesktopRuntime.value
        ? '客户端已拒绝系统通知，请在系统通知设置中手动开启。'
        : '浏览器已拒绝系统通知，请在地址栏的站点权限里手动开启。'
    }

    return '当前没有拿到系统通知权限，系统通知不会生效。'
  }

  const systemNotificationPermissionLabel = computed(() => {
    const status = systemNotificationStatus.value
    if (!status.supported) return isDesktopRuntime.value ? '当前客户端不支持' : '当前浏览器不支持'
    if (!status.secureContext) return '需要 HTTPS 或 localhost'
    if (status.permission === 'granted') return '已授权'
    if (status.permission === 'denied') return '已拒绝'
    return '未授权'
  })

  const systemNotificationDescription = computed(() => {
    const status = systemNotificationStatus.value
    if (!status.supported) {
      return isDesktopRuntime.value
        ? '当前客户端不支持系统通知，可使用提示音提醒。'
        : '当前浏览器不支持系统通知，可使用提示音提醒。'
    }

    if (!status.secureContext) {
      return '系统通知仅在 HTTPS 或 localhost 下可用，当前站点无法弹出授权。'
    }

    if (status.permission === 'denied') {
      return isDesktopRuntime.value
        ? '当前客户端已拒绝系统通知，需要先在系统通知设置中手动恢复。'
        : '当前浏览器已拒绝系统通知，需要先在站点权限中手动恢复。'
    }

    if (status.permission === 'granted') {
      return isDesktopRuntime.value
        ? '当前客户端已授权；任务完成后会弹出系统提醒。'
        : '当前浏览器已授权；保持页面打开或切到后台标签页时可弹出提醒。'
    }

    return isDesktopRuntime.value
      ? '当前客户端尚未授权；勾选或点击测试通知时会申请权限。'
      : '当前浏览器尚未授权；勾选或点击测试通知时会申请权限。'
  })

  function updateCompletionSound(value: unknown) {
    void updateCompletionNotificationOptions({
      sound: toCheckedBoolean(value)
    })
  }

  async function triggerSystemNotificationTest() {
    completionNotificationHint.value = ''
    systemNotificationTesting.value = true

    try {
      const result = await sendSystemNotificationTest()
      systemNotificationStatus.value = result.status
      const channelLabel = result.channel === 'desktop'
        ? '桌面通知'
        : result.channel === 'serviceWorker'
          ? 'Service Worker'
          : '页面通知'
      completionNotificationHint.value = result.sent
        ? `已通过${channelLabel}发送测试通知；如果没有看到弹窗，请检查${isDesktopRuntime.value ? '系统通知开关' : '浏览器站点权限和系统通知开关'}。`
        : resolveSystemNotificationBlockedHint(result.status)
      return result
    } finally {
      systemNotificationTesting.value = false
    }
  }

  async function reloadCompletionNotificationSettings() {
    completionNotificationHint.value = ''
    await loadCompletionNotificationOptions()
    persistedCompletionNotificationOptions = { ...completionNotificationOptions.value }
    await refreshSystemNotificationStatus()

    if (
      completionNotificationOptions.value.systemNotification
      && !systemNotificationStatus.value.canNotify
    ) {
      completionNotificationHint.value = resolveSystemNotificationBlockedHint(systemNotificationStatus.value)
    }
  }

  async function updateCompletionSystemNotification(value: unknown) {
    const enabled = toCheckedBoolean(value)
    completionNotificationHint.value = ''

    if (!enabled) {
      await updateCompletionNotificationOptions({ systemNotification: false })
      await refreshSystemNotificationStatus()
      return
    }

    const status = await requestBrowserNotificationPermission()
    systemNotificationStatus.value = status

    if (!status.canNotify) {
      completionNotificationHint.value = resolveSystemNotificationBlockedHint(status)
      await updateCompletionNotificationOptions({ systemNotification: false })
      return
    }

    await updateCompletionNotificationOptions({ systemNotification: true })
    await triggerSystemNotificationTest()
  }

  onMounted(() => {
    void reloadCompletionNotificationSettings()
  })

  return {
    completionNotificationOptions,
    saving,
    systemNotificationStatus,
    systemNotificationSupported,
    systemNotificationTesting,
    completionNotificationHint,
    systemNotificationPermissionLabel,
    systemNotificationDescription,
    isDesktopRuntime,
    updateCompletionSound,
    updateCompletionSystemNotification,
    triggerSystemNotificationTest
  }
}

import type { WorkflowCompletionNotificationOptions } from '#shared/types/workflow-models'

interface WorkflowModelOptionsResponse {
  success: boolean
  data?: {
    modelOptions?: {
      completion_notification?: WorkflowCompletionNotificationOptions
    }
  }
}

interface CompletionNoticePayload {
  title: string
  body?: string
}

const DEFAULT_COMPLETION_NOTIFICATION_OPTIONS: WorkflowCompletionNotificationOptions = {
  sound: true,
  systemNotification: false
}

const COMPLETION_NOTIFICATION_OPTIONS_STATE_KEY = 'workflow:completion-notification-options'
const COMPLETION_NOTIFICATION_OPTIONS_LOADED_STATE_KEY = 'workflow:completion-notification-options:loaded'

let completionAudioContext: AudioContext | null = null

function normalizeCompletionNotificationOptions(raw: unknown): WorkflowCompletionNotificationOptions {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_COMPLETION_NOTIFICATION_OPTIONS }
  }

  const source = raw as Record<string, unknown>
  return {
    sound: typeof source.sound === 'boolean'
      ? source.sound
      : DEFAULT_COMPLETION_NOTIFICATION_OPTIONS.sound,
    systemNotification: typeof source.systemNotification === 'boolean'
      ? source.systemNotification
      : DEFAULT_COMPLETION_NOTIFICATION_OPTIONS.systemNotification
  }
}

function playCompletionTone() {
  if (!import.meta.client) return

  try {
    const AudioContextConstructor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return

    if (!completionAudioContext) {
      completionAudioContext = new AudioContextConstructor()
    }

    const context = completionAudioContext
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }

    const startAt = context.currentTime + 0.01
    const notes = [880, 1174.66]

    notes.forEach((frequency, index) => {
      const noteStart = startAt + (index * 0.16)
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, noteStart)
      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(0.08, noteStart + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.12)

      oscillator.connect(gain)
      gain.connect(context.destination)

      oscillator.start(noteStart)
      oscillator.stop(noteStart + 0.14)
    })
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 播放提示音失败:', error)
  }
}

async function showSystemNotification(payload: CompletionNoticePayload) {
  if (!import.meta.client || !('Notification' in window)) return
  if (!payload.title.trim()) return

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }

  if (permission !== 'granted') return

  try {
    new Notification(payload.title, {
      body: payload.body,
      tag: 'asset_workbench_generation_complete'
    })
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 发送系统通知失败:', error)
  }
}

export function useGenerationCompletionNotification() {
  const completionNotificationOptions = useState<WorkflowCompletionNotificationOptions>(
    COMPLETION_NOTIFICATION_OPTIONS_STATE_KEY,
    () => ({ ...DEFAULT_COMPLETION_NOTIFICATION_OPTIONS })
  )
  const completionNotificationOptionsLoaded = useState<boolean>(
    COMPLETION_NOTIFICATION_OPTIONS_LOADED_STATE_KEY,
    () => false
  )

  async function loadCompletionNotificationOptions(force = false): Promise<WorkflowCompletionNotificationOptions> {
    if (!import.meta.client) {
      return completionNotificationOptions.value
    }

    if (completionNotificationOptionsLoaded.value && !force) {
      return completionNotificationOptions.value
    }

    try {
      const response = await $fetch<WorkflowModelOptionsResponse>('/api/models/workflow')
      const options = normalizeCompletionNotificationOptions(
        response?.data?.modelOptions?.completion_notification
      )
      completionNotificationOptions.value = options
      completionNotificationOptionsLoaded.value = true
      return options
    } catch (error) {
      console.error('[useGenerationCompletionNotification] 加载提醒配置失败:', error)
      completionNotificationOptions.value = { ...DEFAULT_COMPLETION_NOTIFICATION_OPTIONS }
      completionNotificationOptionsLoaded.value = true
      return completionNotificationOptions.value
    }
  }

  function setCompletionNotificationOptions(
    patch: Partial<WorkflowCompletionNotificationOptions>
  ): WorkflowCompletionNotificationOptions {
    const nextOptions = normalizeCompletionNotificationOptions({
      ...completionNotificationOptions.value,
      ...patch
    })
    completionNotificationOptions.value = nextOptions
    completionNotificationOptionsLoaded.value = true
    return nextOptions
  }

  async function notifyGenerationCompleted(payload: CompletionNoticePayload) {
    if (!import.meta.client) return

    if (!completionNotificationOptionsLoaded.value) {
      await loadCompletionNotificationOptions()
    }

    const options = completionNotificationOptions.value
    if (options.sound) {
      playCompletionTone()
    }

    if (options.systemNotification) {
      await showSystemNotification(payload)
    }
  }

  return {
    completionNotificationOptions,
    loadCompletionNotificationOptions,
    setCompletionNotificationOptions,
    notifyGenerationCompleted
  }
}

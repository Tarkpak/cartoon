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

export type BrowserNotificationPermissionState = NotificationPermission | 'unsupported' | 'insecure'
type SystemNotificationChannel = 'serviceWorker' | 'window'

export interface BrowserNotificationStatus {
  supported: boolean
  secureContext: boolean
  permission: BrowserNotificationPermissionState
  canNotify: boolean
  canPrompt: boolean
}

const DEFAULT_COMPLETION_NOTIFICATION_OPTIONS: WorkflowCompletionNotificationOptions = {
  sound: true,
  systemNotification: true
}

const COMPLETION_NOTIFICATION_OPTIONS_STATE_KEY = 'workflow:completion-notification-options'
const COMPLETION_NOTIFICATION_OPTIONS_LOADED_STATE_KEY = 'workflow:completion-notification-options:loaded'
const NOTIFICATION_SERVICE_WORKER_URL = '/notification-sw.js'
const NOTIFICATION_SERVICE_WORKER_SCOPE = '/__notification__/'

let completionAudioContext: AudioContext | null = null
let notificationServiceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
const activeWindowNotifications = new Set<Notification>()

function createBrowserNotificationStatus(
  permission: BrowserNotificationPermissionState,
  options: {
    supported: boolean
    secureContext: boolean
  }
): BrowserNotificationStatus {
  return {
    supported: options.supported,
    secureContext: options.secureContext,
    permission,
    canNotify: permission === 'granted',
    canPrompt: permission === 'default'
  }
}

export function getBrowserNotificationStatus(): BrowserNotificationStatus {
  if (!import.meta.client) {
    return createBrowserNotificationStatus('unsupported', {
      supported: false,
      secureContext: false
    })
  }

  const supported = 'Notification' in window
  const secureContext = window.isSecureContext

  if (!supported) {
    return createBrowserNotificationStatus('unsupported', {
      supported: false,
      secureContext
    })
  }

  if (!secureContext) {
    return createBrowserNotificationStatus('insecure', {
      supported: true,
      secureContext: false
    })
  }

  return createBrowserNotificationStatus(Notification.permission, {
    supported: true,
    secureContext: true
  })
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  const current = getBrowserNotificationStatus()
  if (!current.supported || !current.secureContext) {
    return current
  }

  let permission = current.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch (error) {
      console.warn('[useGenerationCompletionNotification] 申请系统通知权限失败:', error)
      permission = Notification.permission
    }
  }

  return createBrowserNotificationStatus(permission, {
    supported: true,
    secureContext: true
  })
}

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
    const notes = [784, 1046.5, 1318.51]

    notes.forEach((frequency, index) => {
      const noteStart = startAt + (index * 0.14)
      const primaryOscillator = context.createOscillator()
      const harmonicOscillator = context.createOscillator()
      const gain = context.createGain()

      primaryOscillator.type = 'triangle'
      harmonicOscillator.type = 'sine'
      primaryOscillator.frequency.setValueAtTime(frequency, noteStart)
      harmonicOscillator.frequency.setValueAtTime(frequency * 2, noteStart)

      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.12, noteStart + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.2)

      primaryOscillator.connect(gain)
      harmonicOscillator.connect(gain)
      gain.connect(context.destination)

      primaryOscillator.start(noteStart)
      harmonicOscillator.start(noteStart)
      primaryOscillator.stop(noteStart + 0.22)
      harmonicOscillator.stop(noteStart + 0.22)
    })
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 播放提示音失败:', error)
  }
}

function canUseNotificationServiceWorker(): boolean {
  return import.meta.client
    && window.isSecureContext
    && 'serviceWorker' in navigator
}

async function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorkerRegistration | null> {
  if (registration.active) {
    return registration
  }

  const worker = registration.installing || registration.waiting
  if (!worker) {
    return registration.active ? registration : null
  }
  const targetWorker = worker

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      resolve()
    }, 4000)

    function cleanup() {
      window.clearTimeout(timeoutId)
      targetWorker.removeEventListener('statechange', handleStateChange)
    }

    function handleStateChange() {
      if (targetWorker.state === 'activated') {
        cleanup()
        resolve()
        return
      }

      if (targetWorker.state === 'redundant') {
        cleanup()
        reject(new Error('通知 Service Worker 激活失败'))
      }
    }

    targetWorker.addEventListener('statechange', handleStateChange)
    handleStateChange()
  })

  return registration.active ? registration : null
}

async function getNotificationServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!canUseNotificationServiceWorker()) {
    return null
  }

  if (!notificationServiceWorkerRegistrationPromise) {
    notificationServiceWorkerRegistrationPromise = (async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          NOTIFICATION_SERVICE_WORKER_URL,
          { scope: NOTIFICATION_SERVICE_WORKER_SCOPE }
        )
        return await waitForServiceWorkerActivation(registration)
      } catch (error) {
        console.warn('[useGenerationCompletionNotification] 注册通知 Service Worker 失败:', error)
        notificationServiceWorkerRegistrationPromise = null
        return null
      }
    })()
  }

  return notificationServiceWorkerRegistrationPromise
}

function buildNotificationTargetUrl(): string {
  if (!import.meta.client) return '/'

  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}`
}

async function showSystemNotification(
  payload: CompletionNoticePayload,
  options: {
    tag?: string
    requireInteraction?: boolean
    renotify?: boolean
  } = {}
): Promise<{ sent: boolean, channel?: SystemNotificationChannel }> {
  const status = getBrowserNotificationStatus()
  if (!status.canNotify) return { sent: false }
  if (!payload.title.trim()) return { sent: false }

  const notificationOptions = {
    body: payload.body,
    tag: options.tag || 'asset_workbench_generation_complete',
    renotify: options.renotify,
    requireInteraction: options.requireInteraction,
    data: {
      url: buildNotificationTargetUrl()
    }
  }

  try {
    const registration = await getNotificationServiceWorkerRegistration()
    if (registration) {
      await registration.showNotification(payload.title, notificationOptions)
      return {
        sent: true,
        channel: 'serviceWorker'
      }
    }
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 通过 Service Worker 发送系统通知失败:', error)
  }

  try {
    const notification = new Notification(payload.title, notificationOptions)
    activeWindowNotifications.add(notification)
    const cleanup = () => {
      activeWindowNotifications.delete(notification)
    }
    notification.addEventListener('close', cleanup, { once: true })
    notification.addEventListener('error', cleanup, { once: true })
    notification.addEventListener('click', () => {
      window.focus()
      cleanup()
    }, { once: true })

    return {
      sent: true,
      channel: 'window'
    }
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 发送系统通知失败:', error)
    return {
      sent: false
    }
  }
}

export async function sendSystemNotificationTest(): Promise<{
  status: BrowserNotificationStatus
  sent: boolean
  channel?: SystemNotificationChannel
}> {
  const status = await requestBrowserNotificationPermission()
  if (!status.canNotify) {
    return {
      status,
      sent: false
    }
  }

  const result = await showSystemNotification(
    {
      title: '系统通知测试',
      body: '后续模型任务完成后，会在这里提醒你返回页面。'
    },
    {
      tag: `asset_workbench_generation_test_${Date.now()}`,
      requireInteraction: true,
      renotify: true
    }
  )

  return {
    status: getBrowserNotificationStatus(),
    sent: result.sent,
    channel: result.channel
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

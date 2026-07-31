import type { WorkflowCompletionNotificationOptions } from '#shared/types/workflow-models'
import { invoke } from '@tauri-apps/api/core'
import { sendNotification as sendTauriNotification } from '@tauri-apps/plugin-notification'

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
  type?: 'success' | 'error'
}

export type BrowserNotificationPermissionState = NotificationPermission | 'unsupported' | 'insecure'
type SystemNotificationChannel = 'desktop' | 'serviceWorker' | 'window'

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
const COMPLETION_TONE_UNLOCK_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
const NOTIFICATION_PERMISSION_WARMUP_EVENTS: Array<keyof WindowEventMap> = ['click', 'keydown']

let completionAudioContext: AudioContext | null = null
let completionToneUnlockListenerAttached = false
let completionToneVisibilityListenerAttached = false
let notificationPermissionWarmupListenerAttached = false
let notificationPermissionWarmupInFlight = false
let notificationServiceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
let completionNotificationOptionsLoadPromise: Promise<WorkflowCompletionNotificationOptions> | null = null
let completionNotificationOptionsMutationVersion = 0
let cachedDesktopNotificationPermission: NotificationPermission | null = null
let notificationSequence = 0
const activeWindowNotifications = new Set<Notification>()

function detectDesktopRuntime(): boolean {
  if (!import.meta.client) return false

  const runtime = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

  return !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__
}

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

  const desktopRuntime = detectDesktopRuntime()
  const browserNotificationSupported = 'Notification' in window
  const supported = desktopRuntime || browserNotificationSupported
  const secureContext = window.isSecureContext || desktopRuntime

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

  const permission = desktopRuntime
    ? cachedDesktopNotificationPermission || 'default'
    : Notification.permission

  return createBrowserNotificationStatus(permission, {
    supported: true,
    secureContext: true
  })
}

function createStatusFromCurrent(
  permission: NotificationPermission,
  current: BrowserNotificationStatus
): BrowserNotificationStatus {
  return createBrowserNotificationStatus(permission, {
    supported: current.supported,
    secureContext: current.secureContext
  })
}

async function resolveDesktopNotificationStatus(
  current: BrowserNotificationStatus
): Promise<BrowserNotificationStatus> {
  if (!detectDesktopRuntime() || !current.supported || !current.secureContext) {
    return current
  }

  try {
    const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted')
    const permission: NotificationPermission = granted === true
      ? 'granted'
      : granted === false
        ? 'denied'
        : 'default'
    cachedDesktopNotificationPermission = permission
    return createStatusFromCurrent(permission, current)
  } catch (error) {
    console.warn('[useGenerationCompletionNotification] 检查桌面系统通知权限失败:', error)
    return current
  }
}

export async function refreshBrowserNotificationStatus(): Promise<BrowserNotificationStatus> {
  const current = getBrowserNotificationStatus()
  return resolveDesktopNotificationStatus(current)
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  const current = getBrowserNotificationStatus()
  if (!current.secureContext) {
    return current
  }

  if (detectDesktopRuntime()) {
    let permission: NotificationPermission = cachedDesktopNotificationPermission || 'default'

    try {
      const status = await resolveDesktopNotificationStatus(current)
      permission = status.permission as NotificationPermission

      if (permission === 'default') {
        permission = await invoke<NotificationPermission>('plugin:notification|request_permission')
      }
    } catch (error) {
      console.warn('[useGenerationCompletionNotification] 申请桌面系统通知权限失败:', error)
      try {
        if (permission === 'default' && 'Notification' in window) {
          permission = await Notification.requestPermission()
        }
      } catch {
        permission = 'Notification' in window ? Notification.permission : permission
      }
    }

    cachedDesktopNotificationPermission = permission
    return createStatusFromCurrent(permission, current)
  }

  if (!current.supported) {
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

function resolveAudioContextConstructor() {
  if (!import.meta.client) return null

  return window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

function ensureCompletionAudioContext(): AudioContext | null {
  if (!import.meta.client) return null

  const AudioContextConstructor = resolveAudioContextConstructor()
  if (!AudioContextConstructor) return null

  if (!completionAudioContext || completionAudioContext.state === 'closed') {
    completionAudioContext = new AudioContextConstructor()
  }

  return completionAudioContext
}

function setupCompletionToneUnlockByUserGesture() {
  if (!import.meta.client) return
  if (completionToneUnlockListenerAttached) return

  completionToneUnlockListenerAttached = true

  const handleUserGesture = () => {
    const context = ensureCompletionAudioContext()
    if (!context || context.state === 'running') return

    void context.resume().catch(() => undefined)
  }

  for (const eventName of COMPLETION_TONE_UNLOCK_EVENTS) {
    window.addEventListener(eventName, handleUserGesture, { passive: true })
  }

  if (!completionToneVisibilityListenerAttached) {
    completionToneVisibilityListenerAttached = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const context = completionAudioContext
      if (context?.state === 'suspended') {
        void context.resume().catch(() => undefined)
      }
    })
  }
}

function createNotificationTag(type: 'success' | 'error'): string {
  notificationSequence += 1
  return `asset_workbench_generation_${type}_${Date.now()}_${notificationSequence}`
}

function resolveCompletionToneNotes(type: CompletionNoticePayload['type']): number[] {
  if (type === 'error') {
    return [659.25, 523.25, 392]
  }
  return [784, 1046.5, 1318.51]
}

async function playCompletionTone(type: CompletionNoticePayload['type']) {
  if (!import.meta.client) return

  try {
    setupCompletionToneUnlockByUserGesture()
    const context = ensureCompletionAudioContext()
    if (!context) return

    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined)
    }
    if (context.state !== 'running') {
      return
    }

    const startAt = context.currentTime + 0.01
    const notes = resolveCompletionToneNotes(type)

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
  const desktopRuntime = detectDesktopRuntime()
  const status = desktopRuntime
    ? await refreshBrowserNotificationStatus()
    : getBrowserNotificationStatus()
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

  if (desktopRuntime) {
    try {
      sendTauriNotification({
        title: payload.title,
        body: payload.body,
        group: options.tag,
        autoCancel: true,
        extra: {
          url: buildNotificationTargetUrl()
        }
      })
      return {
        sent: true,
        channel: 'desktop'
      }
    } catch (error) {
      console.warn('[useGenerationCompletionNotification] 发送桌面系统通知失败:', error)
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
    if (!('Notification' in window)) {
      return {
        sent: false
      }
    }

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
    status: await refreshBrowserNotificationStatus(),
    sent: result.sent,
    channel: result.channel
  }
}

export function useGenerationCompletionNotification() {
  setupCompletionToneUnlockByUserGesture()
  const { toast } = useToast()

  const completionNotificationOptions = useState<WorkflowCompletionNotificationOptions>(
    COMPLETION_NOTIFICATION_OPTIONS_STATE_KEY,
    () => ({ ...DEFAULT_COMPLETION_NOTIFICATION_OPTIONS })
  )
  const completionNotificationOptionsLoaded = useState<boolean>(
    COMPLETION_NOTIFICATION_OPTIONS_LOADED_STATE_KEY,
    () => false
  )

  function setupSystemNotificationPermissionWarmup() {
    if (!import.meta.client || notificationPermissionWarmupListenerAttached) return

    notificationPermissionWarmupListenerAttached = true
    const handleUserGesture = () => {
      if (
        notificationPermissionWarmupInFlight
        || !completionNotificationOptionsLoaded.value
        || !completionNotificationOptions.value.systemNotification
      ) {
        return
      }

      const status = getBrowserNotificationStatus()
      if (!status.canPrompt || !status.supported || !status.secureContext) return

      notificationPermissionWarmupInFlight = true
      void requestBrowserNotificationPermission()
        .catch(error => {
          console.warn('[useGenerationCompletionNotification] 预热系统通知权限失败:', error)
        })
        .finally(() => {
          notificationPermissionWarmupInFlight = false
        })
    }

    for (const eventName of NOTIFICATION_PERMISSION_WARMUP_EVENTS) {
      window.addEventListener(eventName, handleUserGesture, { passive: true })
    }
  }

  async function loadCompletionNotificationOptions(force = false): Promise<WorkflowCompletionNotificationOptions> {
    if (!import.meta.client) {
      return completionNotificationOptions.value
    }

    if (completionNotificationOptionsLoaded.value && !force) {
      return completionNotificationOptions.value
    }

    if (completionNotificationOptionsLoadPromise) {
      return completionNotificationOptionsLoadPromise
    }

    const mutationVersionAtStart = completionNotificationOptionsMutationVersion
    completionNotificationOptionsLoadPromise = (async () => {
      try {
        const response = await $fetch<WorkflowModelOptionsResponse>('/api/models/workflow')
        const options = normalizeCompletionNotificationOptions(
          response?.data?.modelOptions?.completion_notification
        )
        if (mutationVersionAtStart === completionNotificationOptionsMutationVersion) {
          completionNotificationOptions.value = options
          completionNotificationOptionsLoaded.value = true
        }
        return completionNotificationOptions.value
      } catch (error) {
        console.error('[useGenerationCompletionNotification] 加载提醒配置失败:', error)
        if (
          mutationVersionAtStart === completionNotificationOptionsMutationVersion
          && !completionNotificationOptionsLoaded.value
        ) {
          completionNotificationOptions.value = { ...DEFAULT_COMPLETION_NOTIFICATION_OPTIONS }
        }
        return completionNotificationOptions.value
      } finally {
        completionNotificationOptionsLoadPromise = null
      }
    })()

    return completionNotificationOptionsLoadPromise
  }

  function setCompletionNotificationOptions(
    patch: Partial<WorkflowCompletionNotificationOptions>
  ): WorkflowCompletionNotificationOptions {
    completionNotificationOptionsMutationVersion += 1
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
    const noticeType = payload.type === 'error' ? 'error' : 'success'
    const notificationsEnabled = options.sound || options.systemNotification

    if (notificationsEnabled) {
      const toastOptions = payload.body
        ? { description: payload.body }
        : undefined
      if (noticeType === 'error') {
        toast.error(payload.title, toastOptions)
      } else {
        toast.success(payload.title, toastOptions)
      }
    }

    if (options.sound) {
      await playCompletionTone(noticeType)
    }

    if (options.systemNotification) {
      const result = await showSystemNotification(payload, {
        tag: createNotificationTag(noticeType),
        requireInteraction: noticeType === 'error',
        renotify: noticeType === 'error'
      })
      if (!result.sent) {
        console.warn('[useGenerationCompletionNotification] 系统通知未发送，已使用应用内通知。')
      }
    }
  }

  async function notifyGenerationFailed(payload: {
    title: string
    body?: string
  }) {
    await notifyGenerationCompleted({
      ...payload,
      type: 'error'
    })
  }

  void loadCompletionNotificationOptions()
  setupSystemNotificationPermissionWarmup()

  return {
    completionNotificationOptions,
    loadCompletionNotificationOptions,
    setCompletionNotificationOptions,
    notifyGenerationCompleted,
    notifyGenerationFailed
  }
}

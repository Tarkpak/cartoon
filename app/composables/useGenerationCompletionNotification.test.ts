import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tauriPermissionGrantedMock = vi.fn(async () => false)
const tauriRequestPermissionMock = vi.fn(async () => 'default' as NotificationPermission)
const tauriSendNotificationMock = vi.fn()

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: tauriPermissionGrantedMock,
  requestPermission: tauriRequestPermissionMock,
  sendNotification: tauriSendNotificationMock
}))

class EventTargetMock {
  private listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const handler = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    const listeners = this.listeners.get(type) || new Set<EventListener>()
    listeners.add(handler)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type } as Event)
    }
  }
}

describe('useGenerationCompletionNotification', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('warms permission from a user gesture and keeps completion notifications distinct', async () => {
    const windowEvents = new EventTargetMock()
    const documentEvents = new EventTargetMock()
    const showNotification = vi.fn(async (
      _title: string,
      _options?: NotificationOptions
    ) => undefined)
    const requestPermission = vi.fn(async () => {
      NotificationMock.permission = 'granted'
      return 'granted' as NotificationPermission
    })

    class NotificationMock {
      static permission: NotificationPermission = 'default'
      static requestPermission = requestPermission
    }

    class AudioContextMock {
      state: AudioContextState = 'running'
    }

    const windowMock = Object.assign(windowEvents, {
      isSecureContext: true,
      Notification: NotificationMock,
      AudioContext: AudioContextMock,
      location: {
        pathname: '/asset-workbench',
        search: '?project=test',
        hash: ''
      },
      focus: vi.fn(),
      setTimeout,
      clearTimeout
    })
    const documentMock = Object.assign(documentEvents, {
      visibilityState: 'visible'
    })
    const registration = {
      active: {},
      installing: null,
      waiting: null,
      showNotification
    }

    vi.stubGlobal('window', windowMock)
    vi.stubGlobal('document', documentMock)
    vi.stubGlobal('Notification', NotificationMock)
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn(async () => registration)
      }
    })
    vi.stubGlobal('useState', (_key: string, init: () => unknown) => ref(init()))
    vi.stubGlobal('useToast', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn()
      }
    }))
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      success: true,
      data: {
        modelOptions: {
          completion_notification: {
            sound: false,
            systemNotification: true
          }
        }
      }
    })))

    const { useGenerationCompletionNotification } = await import('./useGenerationCompletionNotification')
    const notifications = useGenerationCompletionNotification()
    await notifications.loadCompletionNotificationOptions()

    await notifications.notifyGenerationCompleted({ title: '第一次完成' })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()

    windowEvents.dispatch('click')
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1))

    await notifications.notifyGenerationCompleted({ title: '第一次完成' })
    await notifications.notifyGenerationCompleted({ title: '第二次完成' })

    expect(showNotification).toHaveBeenCalledTimes(2)
    const firstOptions = showNotification.mock.calls[0]?.[1]
    const secondOptions = showNotification.mock.calls[1]?.[1]
    if (!firstOptions || !secondOptions) {
      throw new Error('通知参数缺失')
    }
    expect(firstOptions.tag).toMatch(/^asset_workbench_generation_success_/)
    expect(secondOptions.tag).toMatch(/^asset_workbench_generation_success_/)
    expect(secondOptions.tag).not.toBe(firstOptions.tag)
  })
})

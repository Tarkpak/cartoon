import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'default'),
  sendNotification: vi.fn()
}))

class EventTargetMock {
  addEventListener() {}
}

describe('useCompletionNotificationSettings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('serializes saves and rolls back to the last persisted options after consecutive failures', async () => {
    class NotificationMock {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    }

    class AudioContextMock {
      state: AudioContextState = 'running'
    }

    const state = new Map<string, ReturnType<typeof ref>>()
    const fetchRejectors: Array<(reason?: unknown) => void> = []
    const fetchMock = vi.fn((_url: string, options?: { method?: string }) => {
      if (!options?.method) {
        return Promise.resolve({
          success: true,
          data: {
            modelOptions: {
              completion_notification: {
                sound: true,
                systemNotification: true
              }
            }
          }
        })
      }
      return new Promise((_resolve, reject) => {
        fetchRejectors.push(reject)
      })
    })

    vi.stubGlobal('window', Object.assign(new EventTargetMock(), {
      isSecureContext: true,
      Notification: NotificationMock,
      AudioContext: AudioContextMock
    }))
    vi.stubGlobal('document', Object.assign(new EventTargetMock(), {
      visibilityState: 'visible'
    }))
    vi.stubGlobal('Notification', NotificationMock)
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
    vi.stubGlobal('useToast', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn()
      }
    }))
    vi.stubGlobal('$fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { useCompletionNotificationSettings } = await import('./useCompletionNotificationSettings')
    const settings = useCompletionNotificationSettings()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()

    settings.updateCompletionSound(false)
    const secondSave = settings.updateCompletionSystemNotification(false)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchRejectors[0]?.(new Error('first save failed'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    fetchRejectors[1]?.(new Error('second save failed'))
    await secondSave

    expect(settings.completionNotificationOptions.value).toEqual({
      sound: true,
      systemNotification: true
    })
    expect(settings.saving.value).toBe(false)
  })
})

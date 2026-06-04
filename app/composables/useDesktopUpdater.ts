import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { type DownloadEvent, type Update, check } from '@tauri-apps/plugin-updater'

export interface DesktopUpdateInfo {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

let pendingUpdate: Update | null = null

function detectDesktopRuntime(): boolean {
  if (!import.meta.client) return false

  const runtime = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

  return !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__
}

function normalizeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return '操作失败，请稍后重试。'
}

function toUpdateInfo(update: Update): DesktopUpdateInfo {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body
  }
}

async function closePendingUpdate() {
  if (!pendingUpdate) return

  try {
    await pendingUpdate.close()
  } catch {
    // The updater resource may already be consumed by install.
  } finally {
    pendingUpdate = null
  }
}

export function useDesktopUpdater() {
  const currentVersion = useState<string>('desktop-updater-current-version', () => '')
  const availableUpdate = useState<DesktopUpdateInfo | null>('desktop-updater-available-update', () => null)
  const checking = useState<boolean>('desktop-updater-checking', () => false)
  const installing = useState<boolean>('desktop-updater-installing', () => false)
  const downloadedBytes = useState<number>('desktop-updater-downloaded-bytes', () => 0)
  const totalBytes = useState<number | null>('desktop-updater-total-bytes', () => null)
  const error = useState<string>('desktop-updater-error', () => '')
  const statusMessage = useState<string>('desktop-updater-status-message', () => '')
  const lastCheckedAt = useState<string>('desktop-updater-last-checked-at', () => '')

  const isDesktopRuntime = computed(() => detectDesktopRuntime())
  const hasUpdate = computed(() => availableUpdate.value !== null)
  const downloadProgress = computed(() => {
    if (!totalBytes.value || totalBytes.value <= 0) return null
    return Math.min(100, Math.round((downloadedBytes.value / totalBytes.value) * 100))
  })

  async function loadDesktopAppVersion() {
    if (!isDesktopRuntime.value) return ''
    if (currentVersion.value) return currentVersion.value

    try {
      currentVersion.value = await getVersion()
    } catch (versionError) {
      error.value = normalizeError(versionError)
    }

    return currentVersion.value
  }

  async function checkDesktopUpdate() {
    if (!isDesktopRuntime.value) {
      statusMessage.value = '仅桌面客户端支持检查更新。'
      return null
    }

    checking.value = true
    error.value = ''
    statusMessage.value = ''
    downloadedBytes.value = 0
    totalBytes.value = null

    try {
      await loadDesktopAppVersion()
      await closePendingUpdate()

      const update = await check()
      lastCheckedAt.value = new Date().toISOString()

      if (!update) {
        availableUpdate.value = null
        statusMessage.value = '当前已是最新版本。'
        return null
      }

      pendingUpdate = update
      availableUpdate.value = toUpdateInfo(update)
      currentVersion.value = update.currentVersion
      statusMessage.value = `发现新版本 ${update.version}。`
      return availableUpdate.value
    } catch (checkError) {
      error.value = normalizeError(checkError)
      availableUpdate.value = null
      return null
    } finally {
      checking.value = false
    }
  }

  async function installDesktopUpdate() {
    if (!isDesktopRuntime.value || !pendingUpdate) return

    installing.value = true
    error.value = ''
    statusMessage.value = '正在下载更新...'
    downloadedBytes.value = 0
    totalBytes.value = null

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalBytes.value = event.data.contentLength ?? null
          downloadedBytes.value = 0
          return
        }

        if (event.event === 'Progress') {
          downloadedBytes.value += event.data.chunkLength
          return
        }

        statusMessage.value = '更新安装完成，正在重启应用...'
      })

      pendingUpdate = null
      await relaunch()
    } catch (installError) {
      error.value = normalizeError(installError)
    } finally {
      installing.value = false
    }
  }

  return {
    currentVersion,
    availableUpdate,
    checking,
    installing,
    downloadedBytes,
    totalBytes,
    error,
    statusMessage,
    lastCheckedAt,
    isDesktopRuntime,
    hasUpdate,
    downloadProgress,
    loadDesktopAppVersion,
    checkDesktopUpdate,
    installDesktopUpdate
  }
}

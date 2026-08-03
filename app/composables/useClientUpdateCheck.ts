import { isUpdateSnoozed, snoozeUpdate, UPDATE_SNOOZE_DURATION_MS } from '@/lib/update-snooze'

export interface ClientUpdateInfo {
  hasUpdate: boolean
  forceUpdate: boolean
  currentVersion: string
  latestVersion: string
  buildNumber: number
  downloadUrl: string
  sha256: string
  signature: string
  releaseNotes: string
  minSupportedVersion: string
  appKey: string
  platform: string
  arch: string
  channel: string
  publishedAt?: string | null
}

interface CloudUpdateCheckResponse {
  success: boolean
  data?: {
    deviceId?: string
    remote?: {
      success?: boolean
      skipped?: string
      data?: Partial<ClientUpdateInfo>
    }
  }
}

const UPDATE_SNOOZE_KEY = 'playlet:client-update-snooze'

function normalizeError(error: unknown) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return '检查更新失败'
}

function normalizeUpdateInfo(input: Partial<ClientUpdateInfo>): ClientUpdateInfo | null {
  if (!input.hasUpdate || !input.latestVersion) return null

  return {
    hasUpdate: true,
    forceUpdate: input.forceUpdate === true,
    currentVersion: input.currentVersion || '',
    latestVersion: input.latestVersion,
    buildNumber: Number(input.buildNumber || 0),
    downloadUrl: input.downloadUrl || '',
    sha256: input.sha256 || '',
    signature: input.signature || '',
    releaseNotes: input.releaseNotes || '',
    minSupportedVersion: input.minSupportedVersion || '',
    appKey: input.appKey || 'cartoon-desktop',
    platform: input.platform || '',
    arch: input.arch || '',
    channel: input.channel || 'stable',
    publishedAt: input.publishedAt || null
  }
}

export function useClientUpdateCheck() {
  const updateInfo = useState<ClientUpdateInfo | null>('client-update-info', () => null)
  const checking = useState<boolean>('client-update-checking', () => false)
  const error = useState<string>('client-update-error', () => '')
  const lastCheckedAt = useState<string>('client-update-last-checked-at', () => '')

  const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)

  async function checkForClientUpdate() {
    if (!import.meta.client) return null

    checking.value = true
    error.value = ''

    try {
      const response = await $fetch<CloudUpdateCheckResponse>('/api/cloud/update-check', {
        method: 'POST'
      })
      lastCheckedAt.value = new Date().toISOString()

      const remote = response.data?.remote
      const info = normalizeUpdateInfo(remote?.data || {})
      if (!remote?.success || !info) {
        updateInfo.value = null
        return null
      }

      if (!info.forceUpdate && isUpdateSnoozed(window.localStorage, UPDATE_SNOOZE_KEY, info.latestVersion)) {
        updateInfo.value = null
        return null
      }

      updateInfo.value = info
      return info
    } catch (checkError) {
      error.value = normalizeError(checkError)
      updateInfo.value = null
      return null
    } finally {
      checking.value = false
    }
  }

  function snoozeClientUpdate(duration = UPDATE_SNOOZE_DURATION_MS) {
    if (!import.meta.client || !updateInfo.value || updateInfo.value.forceUpdate) return
    snoozeUpdate(window.localStorage, UPDATE_SNOOZE_KEY, updateInfo.value.latestVersion, duration)
    updateInfo.value = null
  }

  function openClientUpdateDownload() {
    if (!import.meta.client || !updateInfo.value?.downloadUrl) return
    window.open(updateInfo.value.downloadUrl, '_blank', 'noopener,noreferrer')
  }

  return {
    updateInfo,
    checking,
    error,
    lastCheckedAt,
    hasUpdate,
    checkForClientUpdate,
    snoozeClientUpdate,
    openClientUpdateDownload
  }
}

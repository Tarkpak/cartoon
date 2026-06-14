import { getDb } from './db'

export type ClientVersionStatus = 'draft' | 'published' | 'disabled'

export interface ClientVersionRow {
  id: string
  app_key: string
  platform: string
  arch: string
  channel: string
  version: string
  build_number: number
  status: ClientVersionStatus
  download_url: string
  sha256: string
  signature: string
  release_notes: string
  force_update: number
  min_supported_version: string
  rollout_percent: number
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface ClientUpdateCheckInput {
  appKey: string
  currentVersion: string
  platform: string
  arch: string
  channel: string
  deviceId?: string
}

const UNIVERSAL_VALUES = new Set(['all', 'universal', '*'])

export function normalizeVersionText(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, 64) || fallback
}

export function normalizeClientTarget(value: unknown, fallback = 'all') {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 64)
  return normalized || fallback
}

export function toPublicClientVersion(row: ClientVersionRow) {
  return {
    id: row.id,
    appKey: row.app_key,
    platform: row.platform,
    arch: row.arch,
    channel: row.channel,
    version: row.version,
    buildNumber: row.build_number,
    status: row.status,
    downloadUrl: row.download_url,
    sha256: row.sha256,
    signature: row.signature,
    releaseNotes: row.release_notes,
    forceUpdate: Boolean(row.force_update),
    minSupportedVersion: row.min_supported_version,
    rolloutPercent: row.rollout_percent,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseVersionToken(value: string) {
  const cleaned = value.trim().replace(/^v/i, '')
  const [main = '', prerelease = ''] = cleaned.split('-', 2)
  const parts = main.split(/[.+_]/).map((part) => {
    const number = Number.parseInt(part.replace(/\D.*$/u, ''), 10)
    return Number.isFinite(number) ? number : 0
  })
  return {
    parts,
    prerelease
  }
}

export function compareClientVersions(left: string, right: string) {
  const a = parseVersionToken(left)
  const b = parseVersionToken(right)
  const length = Math.max(a.parts.length, b.parts.length, 3)

  for (let index = 0; index < length; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  if (a.prerelease && !b.prerelease) return -1
  if (!a.prerelease && b.prerelease) return 1
  return a.prerelease.localeCompare(b.prerelease)
}

export function isClientVersionLessThan(left: string, right: string) {
  if (!left.trim() || !right.trim()) return false
  return compareClientVersions(left, right) < 0
}

function deterministicPercent(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash % 100
}

function targetMatches(rowValue: string, requestValue: string) {
  const normalizedRow = normalizeClientTarget(rowValue)
  const normalizedRequest = normalizeClientTarget(requestValue)
  return normalizedRow === normalizedRequest || UNIVERSAL_VALUES.has(normalizedRow)
}

function rolloutAllows(row: ClientVersionRow, deviceId?: string) {
  const percent = Math.max(0, Math.min(100, Number(row.rollout_percent) || 0))
  if (percent >= 100) return true
  if (percent <= 0) return false
  const seed = `${row.id}:${deviceId || 'anonymous'}`
  return deterministicPercent(seed) < percent
}

export function selectLatestClientVersion(input: Omit<ClientUpdateCheckInput, 'currentVersion'>) {
  const appKey = normalizeClientTarget(input.appKey, 'cartoon-desktop')
  const channel = normalizeClientTarget(input.channel, 'stable')
  const platform = normalizeClientTarget(input.platform)
  const arch = normalizeClientTarget(input.arch)

  const rows = getDb()
    .prepare(`
      SELECT *
      FROM client_versions
      WHERE app_key = ?
        AND channel = ?
        AND status = 'published'
      ORDER BY published_at DESC, updated_at DESC
    `)
    .all(appKey, channel) as ClientVersionRow[]

  return rows
    .filter(row => targetMatches(row.platform, platform))
    .filter(row => targetMatches(row.arch, arch))
    .filter(row => rolloutAllows(row, input.deviceId))
    .sort((left, right) => {
      const versionDiff = compareClientVersions(right.version, left.version)
      if (versionDiff !== 0) return versionDiff
      return (right.build_number || 0) - (left.build_number || 0)
    })[0] || null
}

export function buildClientUpdateCheckResponse(input: ClientUpdateCheckInput) {
  const currentVersion = normalizeVersionText(input.currentVersion)
  const latest = selectLatestClientVersion(input)
  const base = {
    currentVersion,
    appKey: normalizeClientTarget(input.appKey, 'cartoon-desktop'),
    platform: normalizeClientTarget(input.platform),
    arch: normalizeClientTarget(input.arch),
    channel: normalizeClientTarget(input.channel, 'stable')
  }

  if (!latest) {
    return {
      ...base,
      hasUpdate: false,
      forceUpdate: false,
      latestVersion: '',
      buildNumber: 0,
      downloadUrl: '',
      sha256: '',
      signature: '',
      releaseNotes: '',
      minSupportedVersion: ''
    }
  }

  const versionBehind = !currentVersion || isClientVersionLessThan(currentVersion, latest.version)
  const belowMinimum = latest.min_supported_version
    ? !currentVersion || isClientVersionLessThan(currentVersion, latest.min_supported_version)
    : false
  const hasUpdate = versionBehind || belowMinimum

  return {
    ...base,
    hasUpdate,
    forceUpdate: hasUpdate && (Boolean(latest.force_update) || belowMinimum),
    latestVersion: latest.version,
    buildNumber: latest.build_number,
    downloadUrl: latest.download_url,
    sha256: latest.sha256,
    signature: latest.signature,
    releaseNotes: latest.release_notes,
    minSupportedVersion: latest.min_supported_version,
    publishedAt: latest.published_at
  }
}

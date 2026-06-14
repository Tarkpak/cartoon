import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { normalizeClientTarget, normalizeVersionText, toPublicClientVersion, type ClientVersionRow } from '../../../utils/client-versions'
import { getDb, nowIso } from '../../../utils/db'
import { optionalString } from '../../../utils/http'
import { listTosFiles } from '../../../utils/tos-files'
import { tosStorageClientConfig } from '../../../utils/tos-storage'

interface UpdaterManifest {
  version?: unknown
  notes?: unknown
  pub_date?: unknown
  platforms?: unknown
}

interface UpdaterPlatformInfo {
  url?: unknown
  signature?: unknown
  sha256?: unknown
  hash?: unknown
}

interface TosFileInfo {
  key: string
  url: string
  lastModified: string
  etag: string
}

interface VersionCandidate {
  appKey: string
  platform: string
  arch: string
  channel: string
  version: string
  downloadUrl: string
  sha256: string
  signature: string
  releaseNotes: string
  publishedAt: string | null
  priority: number
}

type TosStorageClientConfig = ReturnType<typeof tosStorageClientConfig>
type PublicUrlMode = 'object-key' | 'prefix-base'

interface ManifestFetchResult {
  manifest: UpdaterManifest | null
  sourceUrl: string
  mode: PublicUrlMode
  error?: string
}

const DEFAULT_APP_KEY = 'cartoon-desktop'
const DEFAULT_CHANNEL = 'stable'
const DEFAULT_MANIFEST_PATH = 'desktop-updater/latest.json'

function trimSlashes(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function normalizeObjectPath(value: string) {
  return trimSlashes(value)
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/')
}

function joinPath(...parts: string[]) {
  return parts
    .map(normalizeObjectPath)
    .filter(Boolean)
    .join('/')
}

function dirname(path: string) {
  const normalized = normalizeObjectPath(path)
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : ''
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/g, '')
}

function normalizeEndpoint(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/g, '')
  if (trimmed.startsWith('http://')) {
    return { endpoint: trimSlashes(trimmed.slice('http://'.length)), protocol: 'http' }
  }
  if (trimmed.startsWith('https://')) {
    return { endpoint: trimSlashes(trimmed.slice('https://'.length)), protocol: 'https' }
  }
  return { endpoint: trimSlashes(trimmed), protocol: 'https' }
}

function encodeObjectKey(key: string) {
  return normalizeObjectPath(key)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function joinUrl(baseUrl: string, path: string) {
  const encodedPath = encodeObjectKey(path)
  return encodedPath ? `${normalizeBaseUrl(baseUrl)}/${encodedPath}` : normalizeBaseUrl(baseUrl)
}

function stripConfiguredPrefix(config: TosStorageClientConfig, key: string) {
  const prefix = normalizeObjectPath(config.keyPrefix)
  const normalizedKey = normalizeObjectPath(key)
  if (!prefix) return normalizedKey
  if (normalizedKey === prefix) return ''
  return normalizedKey.startsWith(`${prefix}/`)
    ? normalizedKey.slice(prefix.length + 1)
    : normalizedKey
}

function buildPublicUrl(config: TosStorageClientConfig, key: string, mode: PublicUrlMode) {
  const publicBaseUrl = normalizeBaseUrl(config.publicBaseUrl)
  if (publicBaseUrl) {
    const path = mode === 'prefix-base'
      ? stripConfiguredPrefix(config, key)
      : normalizeObjectPath(key)
    return joinUrl(publicBaseUrl, path)
  }

  const { endpoint, protocol } = normalizeEndpoint(config.endpoint)
  const host = config.isCustomDomain ? endpoint : `${config.bucket}.${endpoint}`
  return joinUrl(`${protocol}://${host}`, key)
}

function safeSourceUrl(value: string, fallback: string) {
  return value.includes('X-Tos-Signature=') ? fallback : value || fallback
}

function manifestUrlCandidates(config: TosStorageClientConfig, manifestKey: string) {
  const candidates: Array<{ url: string, mode: PublicUrlMode }> = [
    { url: buildPublicUrl(config, manifestKey, 'object-key'), mode: 'object-key' }
  ]

  if (normalizeBaseUrl(config.publicBaseUrl) && normalizeObjectPath(config.keyPrefix)) {
    candidates.push({ url: buildPublicUrl(config, manifestKey, 'prefix-base'), mode: 'prefix-base' })
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false
    seen.add(candidate.url)
    return true
  })
}

function textValue(value: unknown, maxLength = 4096) {
  return optionalString(typeof value === 'string' ? value : '', maxLength)
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizePublishedAt(value: unknown) {
  const raw = textValue(value, 128)
  if (!raw) return null
  const time = Date.parse(raw)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function channelForVersion(version: string, fallback: string) {
  const lower = version.toLowerCase()
  if (lower.includes('alpha')) return 'alpha'
  if (lower.includes('beta') || lower.includes('rc')) return 'beta'
  return fallback
}

function normalizeManifestTarget(key: string) {
  const normalized = key.toLowerCase().replace(/-app$/u, '')
  const platform = normalized.startsWith('darwin-')
    ? 'macos'
    : normalized.startsWith('windows-')
      ? 'windows'
      : normalized.startsWith('linux-')
        ? 'linux'
        : ''

  const arch = normalized.includes('aarch64') || normalized.includes('arm64')
    ? 'aarch64'
    : normalized.includes('x86_64') || normalized.includes('x64') || normalized.includes('amd64')
      ? 'x86_64'
      : 'all'

  return { platform, arch }
}

function fileNameFromKey(key: string) {
  return normalizeObjectPath(key).split('/').pop() || key
}

function versionFromAssetName(name: string) {
  const match = name.match(/(?:^|[\s_-])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=$|[\s_-])/iu)
    || name.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/iu)
  return normalizeVersionText(match?.[1] || '')
}

function assetTarget(name: string) {
  const lower = name.toLowerCase()
  const platform = lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz')
    ? 'macos'
    : lower.endsWith('-setup.exe') || lower.endsWith('.msi') || lower.endsWith('.exe')
      ? 'windows'
      : lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.endsWith('.rpm')
        ? 'linux'
        : ''

  if (!platform) return { platform: '', arch: '' }

  const arch = /(aarch64|arm64|apple[-_ ]?silicon)/u.test(lower)
    ? 'aarch64'
    : /(x64|x86_64|amd64)/u.test(lower)
      ? 'x86_64'
      : platform === 'macos'
        ? 'aarch64'
        : 'x86_64'

  return { platform, arch }
}

function assetPriority(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.dmg')) return 90
  if (lower.endsWith('-setup.exe')) return 90
  if (lower.endsWith('.msi')) return 85
  if (lower.endsWith('.appimage')) return 85
  if (lower.endsWith('.exe')) return 80
  if (lower.endsWith('.deb') || lower.endsWith('.rpm')) return 75
  if (lower.endsWith('.app.tar.gz')) return 60
  return 10
}

function candidateKey(candidate: VersionCandidate) {
  return `${candidate.appKey}:${candidate.platform}:${candidate.arch}:${candidate.channel}:${candidate.version}`
}

function mergeCandidate(map: Map<string, VersionCandidate>, candidate: VersionCandidate) {
  const key = candidateKey(candidate)
  const previous = map.get(key)
  if (!previous) {
    map.set(key, candidate)
    return
  }

  if (candidate.priority > previous.priority) {
    map.set(key, {
      ...candidate,
      sha256: candidate.sha256 || previous.sha256,
      signature: candidate.signature || previous.signature,
      releaseNotes: candidate.releaseNotes || previous.releaseNotes,
      publishedAt: candidate.publishedAt || previous.publishedAt
    })
    return
  }

  previous.sha256 ||= candidate.sha256
  previous.signature ||= candidate.signature
  previous.releaseNotes ||= candidate.releaseNotes
  previous.publishedAt ||= candidate.publishedAt
}

async function fetchText(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`)
    }
    return text
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchManifest(candidates: Array<{ url: string, mode: PublicUrlMode }>): Promise<ManifestFetchResult> {
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const text = await fetchText(candidate.url)
      const manifest = JSON.parse(text) as UpdaterManifest
      return { manifest, sourceUrl: candidate.url, mode: candidate.mode }
    } catch (error) {
      errors.push(`${candidate.url} (${error instanceof Error ? error.message : 'failed'})`)
    }
  }
  return { manifest: null, sourceUrl: candidates[0]?.url || '', mode: 'object-key' as PublicUrlMode, error: errors.join('; ') }
}

async function listUpdaterFiles(prefix: string) {
  const files: TosFileInfo[] = []
  let continuationToken: string | undefined
  const normalizedPrefix = normalizeObjectPath(prefix)

  do {
    const response = await listTosFiles({
      prefix: normalizedPrefix,
      prefixProvided: true,
      delimiter: '',
      maxKeys: 1000,
      continuationToken
    })
    files.push(...response.files
      .filter(file => !normalizedPrefix || file.key === normalizedPrefix || file.key.startsWith(`${normalizedPrefix}/`))
      .map(file => ({
        key: file.key,
        url: file.url,
        lastModified: file.lastModified,
        etag: file.etag
      })))
    continuationToken = response.nextContinuationToken
  } while (continuationToken)

  return files
}

function candidatesFromManifest(input: {
  manifest: UpdaterManifest
  appKey: string
  channel: string
}) {
  const version = normalizeVersionText(textValue(input.manifest.version, 64))
  if (!version) return { candidates: [] as VersionCandidate[], skipped: 1 }

  const notes = textValue(input.manifest.notes, 20000)
  const publishedAt = normalizePublishedAt(input.manifest.pub_date)
  const channel = channelForVersion(version, input.channel)
  const platforms = objectValue(input.manifest.platforms)
  const candidates = new Map<string, VersionCandidate>()
  let skipped = 0

  for (const [platformKey, rawInfo] of Object.entries(platforms)) {
    const info = objectValue(rawInfo) as UpdaterPlatformInfo
    const target = normalizeManifestTarget(platformKey)
    const downloadUrl = textValue(info.url, 2048)
    if (!target.platform || !downloadUrl) {
      skipped += 1
      continue
    }

    mergeCandidate(candidates, {
      appKey: input.appKey,
      platform: target.platform,
      arch: target.arch,
      channel,
      version,
      downloadUrl,
      sha256: textValue(info.sha256 || info.hash, 256),
      signature: textValue(info.signature, 4096),
      releaseNotes: notes,
      publishedAt,
      priority: 50
    })
  }

  return { candidates: [...candidates.values()], skipped }
}

async function signatureForAsset(input: {
  file: TosFileInfo
  signatureFile?: TosFileInfo
}) {
  if (!input.signatureFile?.url) return ''
  try {
    return (await fetchText(input.signatureFile.url)).trim().slice(0, 4096)
  } catch {
    return ''
  }
}

async function candidatesFromFiles(input: {
  files: TosFileInfo[]
  config: TosStorageClientConfig
  appKey: string
  channel: string
  publicUrlMode: PublicUrlMode
  manifestVersion: string
  manifestNotes: string
  manifestPublishedAt: string | null
}) {
  const signatureFiles = new Map<string, TosFileInfo>()
  for (const file of input.files) {
    if (file.key.toLowerCase().endsWith('.sig')) {
      signatureFiles.set(file.key.slice(0, -4), file)
    }
  }

  const candidates: VersionCandidate[] = []
  let skipped = 0
  for (const file of input.files) {
    const name = fileNameFromKey(file.key)
    const lower = name.toLowerCase()
    if (lower.endsWith('.sig') || lower.endsWith('.json')) continue

    const target = assetTarget(name)
    const version = versionFromAssetName(name)
    if (!target.platform || !version) {
      skipped += 1
      continue
    }

    const signature = await signatureForAsset({
      file,
      signatureFile: signatureFiles.get(file.key)
    })
    const isManifestVersion = version === input.manifestVersion
    candidates.push({
      appKey: input.appKey,
      platform: target.platform,
      arch: target.arch,
      channel: channelForVersion(version, input.channel),
      version,
      downloadUrl: buildPublicUrl(input.config, file.key, input.publicUrlMode),
      sha256: '',
      signature,
      releaseNotes: isManifestVersion ? input.manifestNotes : '',
      publishedAt: isManifestVersion
        ? input.manifestPublishedAt
        : normalizePublishedAt(file.lastModified),
      priority: assetPriority(name)
    })
  }

  return { candidates, skipped }
}

function upsertCandidate(candidate: VersionCandidate) {
  const db = getDb()
  const timestamp = nowIso()
  const existing = db
    .prepare(`
      SELECT *
      FROM client_versions
      WHERE app_key = ?
        AND platform = ?
        AND arch = ?
        AND channel = ?
        AND version = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get(candidate.appKey, candidate.platform, candidate.arch, candidate.channel, candidate.version) as ClientVersionRow | undefined

  if (existing) {
    db.prepare(`
      UPDATE client_versions
      SET status = 'published',
          download_url = ?,
          sha256 = COALESCE(NULLIF(?, ''), sha256),
          signature = COALESCE(NULLIF(?, ''), signature),
          release_notes = COALESCE(NULLIF(?, ''), release_notes),
          published_at = COALESCE(?, published_at),
          updated_at = ?
      WHERE id = ?
    `).run(
      candidate.downloadUrl,
      candidate.sha256,
      candidate.signature,
      candidate.releaseNotes,
      candidate.publishedAt,
      timestamp,
      existing.id
    )
    return { type: 'updated' as const, id: existing.id }
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO client_versions
      (id, app_key, platform, arch, channel, version, build_number, status,
       download_url, sha256, signature, release_notes, force_update,
       min_supported_version, rollout_percent, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'published', ?, ?, ?, ?, 0, '', 100, ?, ?, ?)
  `).run(
    id,
    candidate.appKey,
    candidate.platform,
    candidate.arch,
    candidate.channel,
    candidate.version,
    candidate.downloadUrl,
    candidate.sha256,
    candidate.signature,
    candidate.releaseNotes,
    candidate.publishedAt,
    timestamp,
    timestamp
  )
  return { type: 'created' as const, id }
}

function assertStorageUsable(config: TosStorageClientConfig) {
  if (!config.enabled) {
    throw createError({ statusCode: 400, statusMessage: '请先在后台设置中启用云存储' })
  }
  const missing: string[] = []
  if (!config.endpoint) missing.push('Endpoint')
  if (!config.bucket) missing.push('Bucket')
  if (missing.length > 0) {
    throw createError({ statusCode: 400, statusMessage: `云存储配置不完整：${missing.join('、')}` })
  }
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    appKey?: string
    channel?: string
    manifestPath?: string
  }>(event)
  const config = tosStorageClientConfig()
  assertStorageUsable(config)

  const appKey = normalizeClientTarget(body.appKey, DEFAULT_APP_KEY)
  const channel = normalizeClientTarget(body.channel, DEFAULT_CHANNEL)
  const manifestPath = normalizeObjectPath(textValue(body.manifestPath, 2048) || DEFAULT_MANIFEST_PATH)
  const manifestKey = joinPath(config.keyPrefix, manifestPath)
  const manifestDir = dirname(manifestPath)
  const updaterPrefix = joinPath(config.keyPrefix, manifestDir)
  const manifestFetch = await fetchManifest(manifestUrlCandidates(config, manifestKey))

  let files: TosFileInfo[] = []
  let listError = ''
  try {
    files = await listUpdaterFiles(updaterPrefix)
  } catch (error) {
    listError = error instanceof Error ? error.message : '云存储目录扫描失败'
  }

  if (!manifestFetch.manifest && files.length > 0) {
    const manifestFile = files.find(file => normalizeObjectPath(file.key) === manifestKey)
    if (manifestFile?.url) {
      const fallback = await fetchManifest([{ url: manifestFile.url, mode: 'object-key' }])
      if (fallback.manifest) {
        manifestFetch.manifest = fallback.manifest
        manifestFetch.sourceUrl = buildPublicUrl(config, manifestKey, manifestFetch.mode)
        manifestFetch.mode = 'object-key'
      }
    }
  }

  const merged = new Map<string, VersionCandidate>()
  let skipped = 0
  let manifestVersion = ''
  let manifestNotes = ''
  let manifestPublishedAt: string | null = null

  if (manifestFetch.manifest) {
    manifestVersion = normalizeVersionText(textValue(manifestFetch.manifest.version, 64))
    manifestNotes = textValue(manifestFetch.manifest.notes, 20000)
    manifestPublishedAt = normalizePublishedAt(manifestFetch.manifest.pub_date)
    const fromManifest = candidatesFromManifest({ manifest: manifestFetch.manifest, appKey, channel })
    skipped += fromManifest.skipped
    for (const candidate of fromManifest.candidates) mergeCandidate(merged, candidate)
  } else if (manifestFetch.error && !files.length) {
    throw createError({
      statusCode: 502,
      statusMessage: `读取云端更新清单失败：${manifestFetch.error}${listError ? `；${listError}` : ''}`
    })
  }

  if (files.length > 0) {
    const fromFiles = await candidatesFromFiles({
      files,
      config,
      appKey,
      channel,
      publicUrlMode: manifestFetch.mode,
      manifestVersion,
      manifestNotes,
      manifestPublishedAt
    })
    skipped += fromFiles.skipped
    for (const candidate of fromFiles.candidates) mergeCandidate(merged, candidate)
  }

  const candidates = [...merged.values()]
  if (candidates.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: listError
        ? `没有发现可同步的客户端版本；${listError}`
        : '没有发现可同步的客户端版本'
    })
  }

  let created = 0
  let updated = 0
  const ids: string[] = []
  for (const candidate of candidates) {
    const result = upsertCandidate(candidate)
    ids.push(result.id)
    if (result.type === 'created') created += 1
    else updated += 1
  }

  const sourceUrl = safeSourceUrl(
    manifestFetch.sourceUrl,
    buildPublicUrl(config, manifestKey, manifestFetch.mode)
  )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.client_versions.sync_updater',
    targetType: 'client_version',
    metadata: {
      manifestKey,
      sourceUrl,
      created,
      updated,
      skipped,
      scannedFiles: files.length
    }
  })

  const versions = ids.length > 0
    ? getDb()
        .prepare(`SELECT * FROM client_versions WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at DESC, updated_at DESC`)
        .all(...ids) as ClientVersionRow[]
    : []

  return {
    success: true,
    data: {
      manifestKey,
      sourceUrl,
      created,
      updated,
      skipped,
      scannedFiles: files.length,
      listWarning: listError || '',
      versions: versions.map(toPublicClientVersion)
    }
  }
})

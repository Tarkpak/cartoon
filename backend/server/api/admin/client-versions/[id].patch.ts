import { createError } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString, requiredParam } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'
import { normalizeClientTarget, normalizeVersionText, toPublicClientVersion, type ClientVersionRow, type ClientVersionStatus } from '../../../utils/client-versions'

const CLIENT_VERSION_STATUSES: ClientVersionStatus[] = ['draft', 'published', 'disabled']

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function normalizeStatus(value: unknown, fallback: ClientVersionStatus) {
  if (value === undefined || value === null || value === '') return fallback
  const status = typeof value === 'string' ? value.trim() : ''
  if (CLIENT_VERSION_STATUSES.includes(status as ClientVersionStatus)) return status as ClientVersionStatus
  throw createError({ statusCode: 400, statusMessage: 'status is invalid' })
}

function optionalBodyString(value: unknown, fallback: string, maxLength: number) {
  if (value === undefined || value === null) return fallback
  return optionalString(value, maxLength)
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const id = requiredParam(event, 'id')
  const db = getDb()
  const existing = db.prepare('SELECT * FROM client_versions WHERE id = ? LIMIT 1').get(id) as ClientVersionRow | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Client version not found' })
  }

  const body = await readJsonBody<{
    appKey?: string
    platform?: string
    arch?: string
    channel?: string
    version?: string
    buildNumber?: number
    status?: string
    downloadUrl?: string
    sha256?: string
    signature?: string
    releaseNotes?: string
    forceUpdate?: boolean
    minSupportedVersion?: string
    rolloutPercent?: number
  }>(event)

  const status = normalizeStatus(body.status, existing.status)
  const timestamp = nowIso()
  const publishedAt = status === 'published'
    ? (existing.published_at || timestamp)
    : existing.published_at

  db.prepare(`
    UPDATE client_versions
    SET app_key = ?,
        platform = ?,
        arch = ?,
        channel = ?,
        version = ?,
        build_number = ?,
        status = ?,
        download_url = ?,
        sha256 = ?,
        signature = ?,
        release_notes = ?,
        force_update = ?,
        min_supported_version = ?,
        rollout_percent = ?,
        published_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    body.appKey === undefined ? existing.app_key : normalizeClientTarget(body.appKey, 'cartoon-desktop'),
    body.platform === undefined ? existing.platform : normalizeClientTarget(body.platform, 'all'),
    body.arch === undefined ? existing.arch : normalizeClientTarget(body.arch, 'all'),
    body.channel === undefined ? existing.channel : normalizeClientTarget(body.channel, 'stable'),
    body.version === undefined ? existing.version : normalizeVersionText(body.version, existing.version),
    numberInRange(body.buildNumber, existing.build_number, 0, 2_147_483_647),
    status,
    optionalBodyString(body.downloadUrl, existing.download_url, 2048),
    optionalBodyString(body.sha256, existing.sha256, 256),
    optionalBodyString(body.signature, existing.signature, 4096),
    optionalBodyString(body.releaseNotes, existing.release_notes, 20000),
    body.forceUpdate === undefined ? existing.force_update : (body.forceUpdate ? 1 : 0),
    body.minSupportedVersion === undefined ? existing.min_supported_version : normalizeVersionText(body.minSupportedVersion),
    numberInRange(body.rolloutPercent, existing.rollout_percent, 0, 100),
    publishedAt,
    timestamp,
    id
  )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.client_versions.update',
    targetType: 'client_version',
    targetId: id,
    metadata: { status }
  })

  const row = db.prepare('SELECT * FROM client_versions WHERE id = ? LIMIT 1').get(id) as ClientVersionRow
  return {
    success: true,
    data: {
      version: toPublicClientVersion(row)
    }
  }
})

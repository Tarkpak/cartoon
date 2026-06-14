import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString, requiredString } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'
import { normalizeClientTarget, normalizeVersionText, toPublicClientVersion, type ClientVersionRow, type ClientVersionStatus } from '../../../utils/client-versions'

const CLIENT_VERSION_STATUSES: ClientVersionStatus[] = ['draft', 'published', 'disabled']

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function normalizeStatus(value: unknown) {
  const status = typeof value === 'string' ? value.trim() : 'draft'
  if (CLIENT_VERSION_STATUSES.includes(status as ClientVersionStatus)) return status as ClientVersionStatus
  throw createError({ statusCode: 400, statusMessage: 'status is invalid' })
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
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

  const version = normalizeVersionText(requiredString(body.version, 'version', 64))
  const status = normalizeStatus(body.status)
  const timestamp = nowIso()
  const id = randomUUID()

  getDb()
    .prepare(`
      INSERT INTO client_versions
        (id, app_key, platform, arch, channel, version, build_number, status,
         download_url, sha256, signature, release_notes, force_update,
         min_supported_version, rollout_percent, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      normalizeClientTarget(body.appKey, 'cartoon-desktop'),
      normalizeClientTarget(body.platform, 'all'),
      normalizeClientTarget(body.arch, 'all'),
      normalizeClientTarget(body.channel, 'stable'),
      version,
      numberInRange(body.buildNumber, 0, 0, 2_147_483_647),
      status,
      optionalString(body.downloadUrl, 2048),
      optionalString(body.sha256, 256),
      optionalString(body.signature, 4096),
      optionalString(body.releaseNotes, 20000),
      body.forceUpdate ? 1 : 0,
      normalizeVersionText(body.minSupportedVersion),
      numberInRange(body.rolloutPercent, 100, 0, 100),
      status === 'published' ? timestamp : null,
      timestamp,
      timestamp
    )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.client_versions.create',
    targetType: 'client_version',
    targetId: id
  })

  const row = getDb().prepare('SELECT * FROM client_versions WHERE id = ? LIMIT 1').get(id) as ClientVersionRow
  return {
    success: true,
    data: {
      version: toPublicClientVersion(row)
    }
  }
})

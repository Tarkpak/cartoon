import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../../utils/db'
import { readJsonBody, requireAuth } from '../../../../utils/auth'
import { optionalString } from '../../../../utils/http'
import { LIBRARY_ASSET_SELECT, publicLibraryAsset, type LibraryAssetRow } from '../../../../utils/library-assets'

const MEDIA_TYPES = new Set(['image', 'audio'])
const CATEGORIES = new Set(['character', 'environment', 'prop', 'style', 'character_voice', 'narration', 'bgm', 'sfx', 'other'])
const SOURCE_TYPES = new Set(['upload', 'url', 'generated', 'project'])
const VISIBILITIES = new Set(['private', 'shared'])
const PERMISSIONS = new Set(['view', 'use', 'edit'])

function categoryMediaType(category: string) {
  return ['character_voice', 'narration', 'bgm', 'sfx'].includes(category) ? 'audio' : 'image'
}

function boolInt(value: unknown) {
  return value === true ? 1 : 0
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const asset = body.asset && typeof body.asset === 'object' ? body.asset as Record<string, unknown> : body
  const localAssetId = optionalString(asset.id, 128)
  const mediaType = optionalString(asset.mediaType, 32)
  const category = optionalString(asset.category, 64)
  const name = optionalString(asset.name, 256)
  const url = optionalString(asset.url, 8192)
  if (!localAssetId || !MEDIA_TYPES.has(mediaType) || !CATEGORIES.has(category) || categoryMediaType(category) !== mediaType || !name || !url) {
    throw createError({ statusCode: 400, statusMessage: 'invalid library asset payload' })
  }

  const db = getDb()
  const existing = db.prepare(`
    SELECT a.id, a.user_id, a.local_updated_at, COALESCE(s.permission, '') AS share_permission
    FROM library_assets a
    LEFT JOIN library_asset_shares s ON s.asset_id = a.id AND s.user_id = ?
    WHERE a.local_asset_id = ? AND (a.user_id = ? OR s.user_id = ?)
    LIMIT 1
  `).get(auth.user.id, localAssetId, auth.user.id, auth.user.id) as {
    id: string
    user_id: string
    local_updated_at: string | null
    share_permission: string
  } | undefined

  if (existing && existing.user_id !== auth.user.id && existing.share_permission !== 'edit') {
    throw createError({ statusCode: 403, statusMessage: 'library asset is read-only' })
  }

  const assetId = existing?.id || randomUUID()
  const ownerUserId = existing?.user_id || auth.user.id
  const localUpdatedAt = optionalString(asset.updatedAt, 64) || nowIso()
  if (existing?.local_updated_at && localUpdatedAt < existing.local_updated_at) {
    const current = db.prepare(`${LIBRARY_ASSET_SELECT} WHERE a.id = ? LIMIT 1`)
      .get(auth.user.id, auth.user.id, assetId) as LibraryAssetRow
    return { success: true, data: { asset: publicLibraryAsset(db, current), status: 'skipped' } }
  }

  const sourceTypeRaw = optionalString(asset.sourceType, 32) || 'upload'
  const visibilityRaw = optionalString(asset.visibility, 32) || 'private'
  const sourceType = SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : 'upload'
  const visibility = VISIBILITIES.has(visibilityRaw) ? visibilityRaw : 'private'
  const timestamp = nowIso()
  const upsert = db.prepare(`
    INSERT INTO library_assets
      (id, user_id, local_asset_id, media_type, category, name, description, tags_json, url,
       object_key, mime_type, size_bytes, width, height, duration_ms, content_hash, perceptual_hash,
       source_type, source_url, source_project_id, copyright_note, license_expires_at, favorite,
       visibility, use_count, last_used_at, bundle_json, version, local_created_at, local_updated_at,
       deleted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, local_asset_id) DO UPDATE SET
      media_type = excluded.media_type, category = excluded.category, name = excluded.name,
      description = excluded.description, tags_json = excluded.tags_json, url = excluded.url,
      object_key = excluded.object_key, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
      width = excluded.width, height = excluded.height, duration_ms = excluded.duration_ms,
      content_hash = excluded.content_hash, perceptual_hash = excluded.perceptual_hash,
      source_type = excluded.source_type, source_url = excluded.source_url,
      source_project_id = excluded.source_project_id, copyright_note = excluded.copyright_note,
      license_expires_at = excluded.license_expires_at, favorite = excluded.favorite,
      visibility = excluded.visibility, use_count = excluded.use_count, last_used_at = excluded.last_used_at,
      bundle_json = excluded.bundle_json, version = excluded.version, local_updated_at = excluded.local_updated_at,
      deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
  `)

  upsert.run(
    assetId,
    ownerUserId,
    localAssetId,
    mediaType,
    category,
    name,
    optionalString(asset.description, 4096),
    jsonText(Array.isArray(asset.tags) ? asset.tags : []),
    url,
    optionalString(asset.objectKey, 2048) || null,
    optionalString(asset.mimeType, 256) || null,
    optionalNumber(asset.sizeBytes),
    optionalNumber(asset.width),
    optionalNumber(asset.height),
    optionalNumber(asset.durationMs),
    optionalString(asset.contentHash, 256) || null,
    optionalString(asset.perceptualHash, 256) || null,
    sourceType,
    optionalString(asset.sourceUrl, 8192) || null,
    optionalString(asset.sourceProjectId, 128) || null,
    optionalString(asset.copyrightNote, 4096),
    optionalString(asset.licenseExpiresAt, 64) || null,
    boolInt(asset.favorite),
    visibility,
    Math.max(0, optionalNumber(asset.useCount) || 0),
    optionalString(asset.lastUsedAt, 64) || null,
    jsonText(asset.bundle && typeof asset.bundle === 'object' ? asset.bundle : null),
    Math.max(1, optionalNumber(asset.version) || 1),
    optionalString(asset.createdAt, 64) || timestamp,
    localUpdatedAt,
    optionalString(asset.deletedAt, 64) || null,
    timestamp,
    timestamp
  )

  if (ownerUserId === auth.user.id && Array.isArray(asset.shares)) {
    const replaceShares = db.transaction((shares: unknown[]) => {
      db.prepare('DELETE FROM library_asset_shares WHERE asset_id = ?').run(assetId)
      const insert = db.prepare(`
        INSERT INTO library_asset_shares (asset_id, user_id, permission, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const raw of shares) {
        if (!raw || typeof raw !== 'object') continue
        const share = raw as Record<string, unknown>
        const userId = optionalString(share.userId, 128)
        const permission = optionalString(share.permission, 16)
        if (!userId || userId === ownerUserId || !PERMISSIONS.has(permission)) continue
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND status = ? LIMIT 1').get(userId, 'active')
        if (user) insert.run(assetId, userId, permission, timestamp, timestamp)
      }
    })
    replaceShares(asset.shares)
  }

  if (Array.isArray(body.versions)) {
    const syncVersions = db.transaction((versions: unknown[]) => {
      const upsertVersion = db.prepare(`
        INSERT INTO library_asset_versions
          (id, asset_id, version, url, object_key, mime_type, size_bytes, content_hash, change_note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, version) DO UPDATE SET
          url = excluded.url,
          object_key = excluded.object_key,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          content_hash = excluded.content_hash,
          change_note = excluded.change_note,
          created_at = excluded.created_at
      `)
      for (const raw of versions) {
        if (!raw || typeof raw !== 'object') continue
        const version = raw as Record<string, unknown>
        const number = optionalNumber(version.version)
        const versionUrl = optionalString(version.url, 8192)
        if (!number || number < 1 || !versionUrl) continue
        upsertVersion.run(
          randomUUID(),
          assetId,
          number,
          versionUrl,
          optionalString(version.objectKey, 2048) || null,
          optionalString(version.mimeType, 256) || null,
          optionalNumber(version.sizeBytes),
          optionalString(version.contentHash, 256) || null,
          optionalString(version.changeNote, 1024),
          optionalString(version.createdAt, 64) || timestamp
        )
      }
    })
    syncVersions(body.versions)
  }

  const current = db.prepare(`${LIBRARY_ASSET_SELECT} WHERE a.id = ? LIMIT 1`)
    .get(auth.user.id, auth.user.id, assetId) as LibraryAssetRow
  return { success: true, data: { asset: publicLibraryAsset(db, current), status: 'synced' } }
})

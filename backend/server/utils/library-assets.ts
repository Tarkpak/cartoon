import type { Database } from 'bun:sqlite'
import { parseJsonText } from './db'

export interface LibraryAssetRow {
  id: string
  user_id: string
  owner_account: string
  owner_display_name: string
  local_asset_id: string
  media_type: string
  category: string
  name: string
  description: string
  tags_json: string
  url: string
  object_key: string | null
  mime_type: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  content_hash: string | null
  perceptual_hash: string | null
  source_type: string
  source_url: string | null
  source_project_id: string | null
  copyright_note: string
  license_expires_at: string | null
  favorite: number
  visibility: string
  use_count: number
  last_used_at: string | null
  bundle_json: string | null
  version: number
  local_created_at: string | null
  local_updated_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  permission: 'view' | 'use' | 'edit'
}

export const LIBRARY_ASSET_SELECT = `
  SELECT a.*, owner.account AS owner_account, owner.display_name AS owner_display_name,
         CASE WHEN a.user_id = ? THEN 'edit' ELSE COALESCE(s.permission, 'view') END AS permission
  FROM library_assets a
  JOIN users owner ON owner.id = a.user_id
  LEFT JOIN library_asset_shares s ON s.asset_id = a.id AND s.user_id = ?
`

export function libraryAssetShares(db: Database, assetId: string) {
  return db.prepare(`
    SELECT s.user_id, u.account, u.display_name, s.permission
    FROM library_asset_shares s
    JOIN users u ON u.id = s.user_id
    WHERE s.asset_id = ?
    ORDER BY u.display_name, u.account
  `).all(assetId).map((share: any) => ({
    userId: share.user_id,
    account: share.account,
    displayName: share.display_name || share.account,
    permission: share.permission
  }))
}

export function libraryAssetVersions(db: Database, assetId: string) {
  return db.prepare(`
    SELECT id, version, url, object_key, mime_type, size_bytes, content_hash, change_note, created_at
    FROM library_asset_versions
    WHERE asset_id = ?
    ORDER BY version DESC
  `).all(assetId).map((version: any) => ({
    id: version.id,
    version: version.version,
    url: version.url,
    objectKey: version.object_key || undefined,
    mimeType: version.mime_type || undefined,
    sizeBytes: version.size_bytes ?? undefined,
    contentHash: version.content_hash || undefined,
    changeNote: version.change_note || '',
    createdAt: version.created_at
  }))
}

export function libraryBundleAssetIds(bundle: unknown): string[] {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return []
  const value = bundle as Record<string, unknown>
  const ids = [value.baseImageAssetId, value.voiceAssetId]
  if (value.viewAssetIds && typeof value.viewAssetIds === 'object' && !Array.isArray(value.viewAssetIds)) {
    ids.push(...Object.values(value.viewAssetIds as Record<string, unknown>))
  }
  if (Array.isArray(value.expressionAssetIds)) ids.push(...value.expressionAssetIds)
  if (Array.isArray(value.poseAssetIds)) ids.push(...value.poseAssetIds)
  return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()).map(id => id.trim())))
}

export function expandLibraryAssetBundleDependencies(
  db: Database,
  viewerUserId: string,
  rows: LibraryAssetRow[]
): LibraryAssetRow[] {
  const expanded = [...rows]
  const known = new Set(rows.map(row => `${row.user_id}:${row.local_asset_id}`))
  const findDependency = db.prepare(`
    ${LIBRARY_ASSET_SELECT}
    WHERE a.user_id = ? AND a.local_asset_id = ? AND a.deleted_at IS NULL
    LIMIT 1
  `)

  for (let index = 0; index < expanded.length; index += 1) {
    const parent = expanded[index]!
    if (parent.permission === 'view') continue
    const bundle = parseJsonText(parent.bundle_json, null)
    for (const localAssetId of libraryBundleAssetIds(bundle)) {
      const key = `${parent.user_id}:${localAssetId}`
      if (known.has(key)) continue
      const dependency = findDependency.get(
        viewerUserId,
        viewerUserId,
        parent.user_id,
        localAssetId
      ) as LibraryAssetRow | undefined
      if (!dependency) continue
      expanded.push({
        ...dependency,
        permission: dependency.user_id === viewerUserId ? 'edit' : 'use'
      })
      known.add(key)
    }
  }

  return expanded
}

export function publicLibraryAsset(db: Database, row: LibraryAssetRow) {
  return {
    id: row.local_asset_id,
    cloudId: row.id,
    ownerUserId: row.user_id,
    ownerAccount: row.owner_account,
    ownerDisplayName: row.owner_display_name,
    mediaType: row.media_type,
    category: row.category,
    name: row.name,
    description: row.description || '',
    tags: parseJsonText(row.tags_json, []),
    url: row.url,
    objectKey: row.object_key || undefined,
    mimeType: row.mime_type || undefined,
    sizeBytes: row.size_bytes ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    contentHash: row.content_hash || undefined,
    perceptualHash: row.perceptual_hash || undefined,
    sourceType: row.source_type,
    sourceUrl: row.source_url || undefined,
    sourceProjectId: row.source_project_id || undefined,
    copyrightNote: row.copyright_note || '',
    licenseExpiresAt: row.license_expires_at || undefined,
    favorite: row.favorite !== 0,
    visibility: row.visibility,
    permission: row.permission,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at || undefined,
    bundle: parseJsonText(row.bundle_json, undefined),
    shares: libraryAssetShares(db, row.id),
    versions: libraryAssetVersions(db, row.id),
    version: row.version,
    createdAt: row.local_created_at || row.created_at,
    updatedAt: row.local_updated_at || row.updated_at,
    deletedAt: row.deleted_at || undefined
  }
}

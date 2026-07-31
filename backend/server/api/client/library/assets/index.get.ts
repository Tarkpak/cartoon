import { getDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/auth'
import { pagination } from '../../../../utils/http'
import {
  expandLibraryAssetBundleDependencies,
  LIBRARY_ASSET_SELECT,
  publicLibraryAsset,
  type LibraryAssetRow
} from '../../../../utils/library-assets'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const { page, pageSize, offset } = pagination(event)
  const db = getDb()
  const total = db.prepare(`
    SELECT COUNT(DISTINCT a.id) AS count
    FROM library_assets a
    LEFT JOIN library_asset_shares s ON s.asset_id = a.id AND s.user_id = ?
    WHERE a.user_id = ? OR s.user_id = ?
  `).get(auth.user.id, auth.user.id, auth.user.id) as { count: number }
  const rows = db.prepare(`
    ${LIBRARY_ASSET_SELECT}
    WHERE a.user_id = ? OR s.user_id = ?
    ORDER BY a.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(
    auth.user.id,
    auth.user.id,
    auth.user.id,
    auth.user.id,
    pageSize,
    offset
  ) as LibraryAssetRow[]
  const assets = expandLibraryAssetBundleDependencies(db, auth.user.id, rows)

  return {
    success: true,
    data: {
      libraryAssets: assets.map(asset => publicLibraryAsset(db, asset)),
      pagination: {
        page,
        pageSize,
        total: total.count,
        totalPages: Math.max(1, Math.ceil(total.count / pageSize))
      }
    }
  }
})

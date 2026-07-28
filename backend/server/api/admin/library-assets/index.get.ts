import { getQuery } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'
import { publicLibraryAsset, type LibraryAssetRow } from '../../../utils/library-assets'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const query = getQuery(event)
  const { page, pageSize, offset } = pagination(event)
  const keyword = String(query.keyword || '').trim()
  const category = String(query.category || '').trim()
  const status = String(query.status || 'active').trim()
  const conditions: string[] = []
  const params: SqlBinding[] = []
  if (keyword) {
    conditions.push('(a.name LIKE ? OR a.description LIKE ? OR owner.account LIKE ? OR owner.display_name LIKE ?)')
    const match = `%${keyword}%`
    params.push(match, match, match, match)
  }
  if (category) {
    conditions.push('a.category = ?')
    params.push(category)
  }
  if (status === 'deleted') conditions.push('a.deleted_at IS NOT NULL')
  else if (status === 'expiring') conditions.push("a.license_expires_at IS NOT NULL AND a.license_expires_at <= datetime('now', '+30 days')")
  else conditions.push('a.deleted_at IS NULL')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM library_assets a JOIN users owner ON owner.id = a.user_id ${where}
  `).get(...params) as { count: number }
  const rows = db.prepare(`
    SELECT a.*, owner.account AS owner_account, owner.display_name AS owner_display_name, 'edit' AS permission
    FROM library_assets a
    JOIN users owner ON owner.id = a.user_id
    ${where}
    ORDER BY a.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as LibraryAssetRow[]
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN media_type = 'image' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS images,
      SUM(CASE WHEN media_type = 'audio' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS audio,
      SUM(CASE WHEN visibility = 'shared' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS shared,
      SUM(CASE WHEN license_expires_at IS NOT NULL AND license_expires_at <= datetime('now', '+30 days') AND deleted_at IS NULL THEN 1 ELSE 0 END) AS expiring
    FROM library_assets
  `).get()
  return {
    success: true,
    data: {
      assets: rows.map(row => publicLibraryAsset(db, row)),
      summary,
      pagination: { page, pageSize, total: total.count }
    }
  }
})

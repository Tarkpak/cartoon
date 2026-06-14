import { getQuery } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'
import { toPublicClientVersion, type ClientVersionRow } from '../../../utils/client-versions'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const params: SqlBinding[] = []
  const where: string[] = []

  const keyword = String(query.keyword || '').trim()
  if (keyword) {
    const value = `%${keyword}%`
    where.push('(version LIKE ? OR download_url LIKE ? OR release_notes LIKE ?)')
    params.push(value, value, value)
  }

  for (const key of ['app_key', 'platform', 'arch', 'channel', 'status']) {
    const value = String(query[key] || '').trim()
    if (!value) continue
    where.push(`${key} = ?`)
    params.push(value)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM client_versions ${whereSql}`)
    .get(...params) as { count: number }
  const versions = db
    .prepare(`
      SELECT *
      FROM client_versions
      ${whereSql}
      ORDER BY
        CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
        published_at DESC,
        updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, pageSize, offset) as ClientVersionRow[]

  const deviceVersions = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(client_version, ''), '未知') AS version,
        COALESCE(NULLIF(os, ''), '未知') AS platform,
        COUNT(*) AS count,
        MAX(last_seen_at) AS last_seen_at
      FROM user_devices
      GROUP BY COALESCE(NULLIF(client_version, ''), '未知'), COALESCE(NULLIF(os, ''), '未知')
      ORDER BY count DESC, last_seen_at DESC
      LIMIT 50
    `)
    .all() as Array<{ version: string, platform: string, count: number, last_seen_at: string | null }>

  return {
    success: true,
    data: {
      versions: versions.map(toPublicClientVersion),
      deviceVersions: deviceVersions.map(row => ({
        version: row.version,
        platform: row.platform,
        count: row.count,
        lastSeenAt: row.last_seen_at
      })),
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})

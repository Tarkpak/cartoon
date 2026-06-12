import { setResponseHeader } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { decryptText } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'

const EXPORT_TYPE = 'playlet.model_providers'
const EXPORT_VERSION = 1

interface ProviderExportRow {
  provider_key: string
  display_name: string
  base_url: string | null
  enabled: number
  encrypted_api_key: string | null
  encrypted_access_key: string | null
  encrypted_secret_key: string | null
}

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
  const exportedAt = nowIso()
  const rows = getDb()
    .prepare(`
      SELECT p.provider_key, p.display_name, p.base_url, p.enabled,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      ORDER BY p.display_name ASC
    `)
    .all() as ProviderExportRow[]

  const payload = {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exportedAt,
    providers: rows.map(row => {
      const credentials = row.provider_key === 'kling'
        ? {
            accessKey: decryptText(row.encrypted_access_key),
            secretKey: decryptText(row.encrypted_secret_key)
          }
        : {
            apiKey: decryptText(row.encrypted_api_key)
          }
      return {
        providerKey: row.provider_key,
        displayName: row.display_name,
        baseUrl: row.base_url || '',
        enabled: Boolean(row.enabled),
        credentials
      }
    })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.export',
    targetType: 'model_provider',
    metadata: {
      providerCount: payload.providers.length
    }
  })

  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(
    event,
    'content-disposition',
    `attachment; filename="playlet-model-providers-${exportedAt.slice(0, 10)}.json"`
  )
  return payload
})

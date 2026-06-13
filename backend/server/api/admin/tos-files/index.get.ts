import { getQuery } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { listTosFiles } from '../../../utils/tos-files'

function queryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const query = getQuery(event)
  const prefixProvided = Object.prototype.hasOwnProperty.call(query, 'prefix')
  const maxKeys = Number.parseInt(queryString(query.maxKeys) || '100', 10)
  const data = await listTosFiles({
    prefix: queryString(query.prefix),
    prefixProvided,
    delimiter: queryString(query.delimiter) || '/',
    maxKeys: Number.isFinite(maxKeys) ? maxKeys : 100,
    continuationToken: queryString(query.continuationToken)
  })

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.tos_files.list',
    targetType: 'tos_storage_file',
    metadata: {
      prefix: data.prefix,
      maxKeys: data.maxKeys,
      fileCount: data.files.length,
      directoryCount: data.commonPrefixes.length
    }
  })

  return {
    success: true,
    data
  }
})

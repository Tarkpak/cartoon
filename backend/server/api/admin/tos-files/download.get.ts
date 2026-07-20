import { getQuery, sendRedirect } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { tosFileDownloadUrl } from '../../../utils/tos-files'

function queryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
  const query = getQuery(event)
  const key = queryString(query.key).trim()
  const filename = queryString(query.filename).trim()
  const url = tosFileDownloadUrl(key, filename)

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.tos_files.download',
    targetType: 'tos_storage_file',
    targetId: key
  })

  return sendRedirect(event, url, 302)
})

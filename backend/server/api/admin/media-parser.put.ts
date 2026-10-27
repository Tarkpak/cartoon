import { readJsonBody, requireAdmin } from '../../utils/auth'
import { setSetting } from '../../utils/db'
import { encryptText } from '../../utils/crypto'
import { writeAudit } from '../../utils/audit'
import { parseMediaCookieInput } from '../../../utils/media-parser-platforms'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{ platform?: unknown, cookie?: unknown }>(event)
  let input: ReturnType<typeof parseMediaCookieInput>
  try {
    input = parseMediaCookieInput(body)
  } catch (error) {
    throw createError({ statusCode: 400, message: (error as Error).message })
  }
  const { platform, cookie } = input
  setSetting(`media_parser_${platform}_cookie`, encryptText(cookie))
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.media_parser.update',
    targetType: 'media_parser',
    metadata: { platform, configured: Boolean(cookie) }
  })
  return { success: true, data: { platform, configured: Boolean(cookie) } }
})

import { requireAdmin } from '../../utils/auth'
import { getSetting } from '../../utils/db'
import { mediaParserPlatforms } from '../../../utils/media-parser-platforms'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const platforms = mediaParserPlatforms.map(platform => ({
    ...platform,
    configured: Boolean(getSetting(`media_parser_${platform.key}_cookie`))
  }))
  return { success: true, data: { configured: platforms[0]!.configured, platforms } }
})

import { requireAuth } from '../../utils/auth'
import { getSetting } from '../../utils/db'
import { decryptText } from '../../utils/crypto'
import { encryptedClientResponse } from '../../utils/secure-transport'
import { mediaParserPlatforms } from '../../../utils/media-parser-platforms'

export default defineEventHandler((event) => {
  requireAuth(event)
  const cookies = Object.fromEntries(mediaParserPlatforms.map(platform => [
    platform.key, decryptText(getSetting(`media_parser_${platform.key}_cookie`))
  ]))
  return encryptedClientResponse(event, {
    yuanbaoCookie: cookies.yuanbao,
    cookies
  })
})

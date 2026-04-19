import { isIP } from 'node:net'
import { z } from 'zod'

const QuerySchema = z.object({
  url: z.string().trim().url().max(2048)
})

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_PATH_EXT_REGEX = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|svg)$/i

function isDisallowedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true

  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
  ) {
    return true
  }

  // 为避免 SSRF，禁止直接使用 IP 字面量
  if (isIP(normalized) !== 0) {
    return true
  }

  return false
}

function assertSafeHttpUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createError({
      statusCode: 400,
      statusMessage: '仅支持 http/https 图片地址'
    })
  }

  if (isDisallowedHostname(parsed.hostname)) {
    throw createError({
      statusCode: 400,
      statusMessage: '不允许访问该图片地址'
    })
  }

  return parsed
}

function looksLikeImageByUrlPath(url: URL): boolean {
  return IMAGE_PATH_EXT_REGEX.test(url.pathname || '')
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return 'image/png'
  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
  ) return 'image/gif'
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  if (buffer.length >= 4 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) return 'image/tiff'
  if (buffer.length >= 4 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) return 'image/tiff'

  const prefix = buffer
    .slice(0, 512)
    .toString('utf8')
    .trimStart()
    .toLowerCase()
  if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) {
    return 'image/svg+xml'
  }

  return ''
}

/**
 * 同源图片代理，供前端 canvas 裁切等场景使用，避免跨域污染。
 * GET /api/image/proxy?url=<https-url>
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = QuerySchema.safeParse({
    url: typeof query.url === 'string' ? query.url : ''
  })

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '图片地址参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const upstreamUrl = assertSafeHttpUrl(parsed.data.url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/*,*/*;q=0.8'
      }
    })

    if (!upstream.ok) {
      throw createError({
        statusCode: upstream.status,
        statusMessage: `图片拉取失败: ${upstream.status}`
      })
    }

    // 重定向后再次校验目标地址，避免跳转到内网地址
    if (upstream.url) {
      assertSafeHttpUrl(upstream.url)
    }

    const contentLengthRaw = upstream.headers.get('content-length') || ''
    const contentLength = Number(contentLengthRaw)
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: '图片体积超过代理上限'
      })
    }

    const contentTypeRaw = (upstream.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || ''
    const isImageContentType = contentTypeRaw.startsWith('image/')
    if (!isImageContentType && !looksLikeImageByUrlPath(upstreamUrl)) {
      throw createError({
        statusCode: 415,
        statusMessage: '代理目标不是受支持的图片'
      })
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    if (body.length > MAX_IMAGE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: '图片体积超过代理上限'
      })
    }

    const detectedMimeType = detectImageMimeTypeFromBuffer(body)
    const finalMimeType = detectedMimeType || (isImageContentType ? contentTypeRaw : '')
    if (!finalMimeType || !finalMimeType.startsWith('image/')) {
      throw createError({
        statusCode: 415,
        statusMessage: '代理目标不是受支持的图片'
      })
    }

    setHeader(event, 'Content-Type', finalMimeType)
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
    setHeader(event, 'X-Image-Proxy', '1')

    return body
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    if ((error as { name?: string })?.name === 'AbortError') {
      throw createError({
        statusCode: 504,
        statusMessage: '图片拉取超时'
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: '图片代理失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  } finally {
    clearTimeout(timeout)
  }
})

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC_SUBDIR = 'generated-images'

function ensureOutputDir(): string {
  const outputDir = join(process.cwd(), 'public', PUBLIC_SUBDIR)
  mkdirSync(outputDir, { recursive: true })
  return outputDir
}

function looksLikeBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function detectMimeFromBuffer(buffer: Buffer): string {
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
  return 'image/png'
}

function extFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('bmp')) return 'bmp'
  if (normalized.includes('tiff') || normalized.includes('tif')) return 'tiff'
  return 'png'
}

function sanitizePrefix(prefix?: string): string {
  const normalized = (prefix || 'image')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'image'
}

async function resolveImageSource(source: string): Promise<{ buffer: Buffer, mimeType: string }> {
  const raw = source.trim()
  if (!raw) {
    throw new Error('图片内容为空，无法持久化')
  }

  if (raw.startsWith('/generated-images/')) {
    throw new Error('图片已是本地文件路径，无需重复持久化')
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type')?.trim() || ''
    const mimeType = contentType.startsWith('image/') ? contentType : detectMimeFromBuffer(buffer)
    return { buffer, mimeType }
  }

  const dataUriMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    const payload = dataUriMatch[2].replace(/\s+/g, '')
    return {
      buffer: Buffer.from(payload, 'base64'),
      mimeType: dataUriMatch[1]
    }
  }

  if (raw.startsWith('/') && !looksLikeBase64Image(raw)) {
    throw new Error('图片已是站内路径，无需持久化')
  }

  const payload = raw.replace(/\s+/g, '')
  const buffer = Buffer.from(payload, 'base64')
  if (!buffer.length) {
    throw new Error('无效的 base64 图片数据')
  }
  const mimeType = detectMimeFromBuffer(buffer)
  return { buffer, mimeType }
}

export async function persistImageToPublic(options: {
  source: string
  prefix?: string
}): Promise<string> {
  const source = options.source?.trim()
  if (!source) {
    throw new Error('图片内容为空，无法持久化')
  }

  if (source.startsWith('/generated-images/')) return source
  if (source.startsWith('/') && !looksLikeBase64Image(source)) return source

  const { buffer, mimeType } = await resolveImageSource(source)
  const outputDir = ensureOutputDir()
  const ext = extFromMimeType(mimeType)
  const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16)
  const filename = `${sanitizePrefix(options.prefix)}_${Date.now()}_${hash}.${ext}`
  const filePath = join(outputDir, filename)

  writeFileSync(filePath, buffer)

  return `/${PUBLIC_SUBDIR}/${filename}`
}


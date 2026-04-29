import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  buildCloudNewestFirstNamePrefix,
  buildCloudObjectKey,
  uploadBufferToCloudStorageOrThrow
} from './cloud-storage'

function sanitizePrefix(prefix?: string): string {
  const normalized = (prefix || 'video')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || 'video'
}

function extFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('mp4')) return 'mp4'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('quicktime') || normalized.includes('mov')) return 'mov'
  if (normalized.includes('mpeg')) return 'mpeg'
  if (normalized.includes('ogg')) return 'ogv'
  return 'mp4'
}

function detectVideoMimeType(buffer: Buffer): string {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (
    buffer.length >= 4
    && buffer[0] === 0x1a
    && buffer[1] === 0x45
    && buffer[2] === 0xdf
    && buffer[3] === 0xa3
  ) return 'video/webm'
  if (
    buffer.length >= 4
    && buffer[0] === 0x4f
    && buffer[1] === 0x67
    && buffer[2] === 0x67
    && buffer[3] === 0x53
  ) return 'video/ogg'
  return 'video/mp4'
}

function normalizeVideoMimeType(value?: string): string {
  const normalized = ((value || '').split(';')[0] || '').trim().toLowerCase()
  if (!normalized.startsWith('video/')) return 'video/mp4'
  return normalized
}

async function resolveVideoSource(source: string): Promise<{ buffer: Buffer, mimeType: string }> {
  const raw = source.trim()
  if (!raw) {
    throw new Error('视频内容为空，无法持久化')
  }

  if (raw.startsWith('url:')) {
    return resolveVideoSource(raw.slice(4))
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`下载视频失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeTypeHeader = normalizeVideoMimeType(response.headers.get('content-type') || '')
    const mimeType = mimeTypeHeader.startsWith('video/')
      ? mimeTypeHeader
      : detectVideoMimeType(buffer)
    return { buffer, mimeType }
  }

  const dataUriMatch = raw.match(/^data:(video\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    return {
      buffer: Buffer.from(dataUriMatch[2].replace(/\s+/g, ''), 'base64'),
      mimeType: normalizeVideoMimeType(dataUriMatch[1])
    }
  }

  if (raw.startsWith('/')) {
    throw new Error('检测到站内本地视频路径，已禁用本地媒体写入/读取，请先迁移至云存储')
  }

  const compact = raw.replace(/\s+/g, '')
  const buffer = Buffer.from(compact, 'base64')
  if (!buffer.length) {
    throw new Error('无效的视频 base64 数据')
  }
  const mimeType = detectVideoMimeType(buffer)
  return { buffer, mimeType }
}

export async function persistVideoSourceToCloud(options: {
  source: string
  prefix?: string
  category?: string
}): Promise<string> {
  const { buffer, mimeType } = await resolveVideoSource(options.source)
  const extension = extFromMimeType(mimeType)
  const filename = `${buildCloudNewestFirstNamePrefix()}_${sanitizePrefix(options.prefix)}_${randomUUID().slice(0, 8)}.${extension}`
  const cloudObjectKey = buildCloudObjectKey({
    category: options.category || 'videos',
    filename
  })

  return await uploadBufferToCloudStorageOrThrow({
    key: cloudObjectKey,
    buffer
  })
}

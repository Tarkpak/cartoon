import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { Buffer } from 'node:buffer'
import {
  buildCloudNewestFirstNamePrefix,
  buildCloudObjectKey,
  uploadBufferToCloudStorageOrThrow,
  uploadFileToCloudStorageOrThrow
} from './cloud-storage'

function sanitizePrefix(prefix?: string): string {
  const normalized = (prefix || 'audio')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || 'audio'
}

export async function persistAudioFileToCloud(options: {
  filePath: string
  prefix?: string
  category?: string
}): Promise<string> {
  const extension = extname(options.filePath).toLowerCase() || '.mp3'
  const filename = `${buildCloudNewestFirstNamePrefix()}_${sanitizePrefix(options.prefix)}_${randomUUID().slice(0, 8)}${extension}`
  const cloudObjectKey = buildCloudObjectKey({
    category: options.category || 'voice-assets',
    filename
  })

  return await uploadFileToCloudStorageOrThrow({
    key: cloudObjectKey,
    filePath: options.filePath
  })
}

function extFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('aac')) return 'aac'
  if (normalized.includes('m4a') || normalized.includes('mp4')) return 'm4a'
  if (normalized.includes('flac')) return 'flac'
  if (normalized.includes('ogg')) return 'ogg'
  return 'mp3'
}

async function resolveAudioSource(source: string): Promise<{ buffer: Buffer, mimeType: string }> {
  const raw = source.trim()
  if (!raw) {
    throw new Error('音频内容为空，无法持久化')
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`下载音频失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type')?.trim() || 'audio/mpeg'
    return { buffer, mimeType }
  }

  const dataUriMatch = raw.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    return {
      buffer: Buffer.from(dataUriMatch[2].replace(/\s+/g, ''), 'base64'),
      mimeType: dataUriMatch[1]
    }
  }

  throw new Error('仅支持音频 dataURL 或音频 URL')
}

export async function persistAudioSourceToCloud(options: {
  source: string
  prefix?: string
  category?: string
}): Promise<string> {
  const { buffer, mimeType } = await resolveAudioSource(options.source)
  const extension = extFromMimeType(mimeType)
  const filename = `${buildCloudNewestFirstNamePrefix()}_${sanitizePrefix(options.prefix)}_${randomUUID().slice(0, 8)}.${extension}`
  const cloudObjectKey = buildCloudObjectKey({
    category: options.category || 'voice-assets',
    filename
  })

  return await uploadBufferToCloudStorageOrThrow({
    key: cloudObjectKey,
    buffer
  })
}

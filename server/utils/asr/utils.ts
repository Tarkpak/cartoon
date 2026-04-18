import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AsrClientError } from './errors'
import { type AsrData, SUPPORTED_AUDIO_FORMATS, type SupportedAudioFormat } from './types'

export const DEFAULT_CACHE_DIR_NAME = 'data/cache/asr'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function normalizeAudioFormat(format: string): SupportedAudioFormat | null {
  const normalized = format.replace(/^\./, '').toLowerCase()
  return (SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(normalized)
    ? (normalized as SupportedAudioFormat)
    : null
}

export function getFileExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return ''
  }
  return fileName.slice(dotIndex + 1).toLowerCase()
}

export function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() ?? filePath
}

export function detectAudioFormat(filePath: string): SupportedAudioFormat {
  const ext = getFileExtension(filePath)
  const normalized = normalizeAudioFormat(ext)
  if (!normalized) {
    throw new AsrClientError(
      `Unsupported audio format: "${ext}". Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`
    )
  }
  return normalized
}

export async function ensureReadableFile(filePath: string): Promise<void> {
  const fileStat = await stat(filePath).catch((error) => {
    throw new AsrClientError(`Failed to access file "${filePath}"`, { details: error })
  })
  if (!fileStat.isFile()) {
    throw new AsrClientError(`Path is not a file: "${filePath}"`)
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const buffer = await readFile(filePath).catch((error) => {
    throw new AsrClientError(`Failed to read file for hashing: "${filePath}"`, { details: error })
  })
  return createHash('sha256').update(buffer).digest('hex')
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const file = await readFile(filePath, 'utf8').catch(() => null)
  if (!file) return null

  try {
    return JSON.parse(file) as T
  } catch {
    return null
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2))
}

export function msToSrtTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(safeMs / 3_600_000)
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1_000)
  const millis = safeMs % 1_000
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis
    .toString()
    .padStart(3, '0')}`
}

export function msToLrcTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms))
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1_000)
  const centis = Math.floor((safeMs % 1_000) / 10)
  return `[${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${centis.toString().padStart(2, '0')}]`
}

export function asrDataToText(data: AsrData): string {
  return data.utterances.map(segment => segment.transcript).join('\n')
}

export function asrDataToSrt(data: AsrData): string {
  return data.utterances
    .map((segment, index) => {
      const start = msToSrtTimestamp(segment.start_time)
      const end = msToSrtTimestamp(segment.end_time)
      return `${index + 1}\n${start} --> ${end}\n${segment.transcript}\n`
    })
    .join('\n')
}

export function asrDataToLrc(data: AsrData): string {
  return data.utterances
    .map(segment => `${msToLrcTimestamp(segment.start_time)}${segment.transcript}`)
    .join('\n')
}

export function asrDataToJson(data: AsrData): string {
  return JSON.stringify(data, null, 2)
}

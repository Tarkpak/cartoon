import { join } from 'node:path'
import { BcutAsrClient } from './bcut-asr-client'
import type { BcutAsrClientOptions, TranscribeResult, WaitForResultOptions } from './types'
import {
  asrDataToJson,
  asrDataToLrc,
  asrDataToSrt,
  asrDataToText,
  DEFAULT_CACHE_DIR_NAME,
  ensureReadableFile,
  readJsonFile,
  sha256File,
  writeJsonFile
} from './utils'

interface CachedTranscribePayload {
  version: number
  audioHash: string
  createdAt: string
  result: Omit<TranscribeResult, 'cached'>
}

export interface TranscribeFileOnlineOptions extends Omit<WaitForResultOptions, 'taskId'> {
  useCache?: boolean
  cacheDir?: string
  clientOptions?: BcutAsrClientOptions
  pollIntervalMs?: number
}

export async function transcribeFileOnline(
  filePath: string,
  options: TranscribeFileOnlineOptions = {}
): Promise<TranscribeResult> {
  await ensureReadableFile(filePath)

  const useCache = options.useCache !== false
  const cacheDir = options.cacheDir ?? process.env.ASR_CACHE_DIR ?? DEFAULT_CACHE_DIR_NAME
  let audioHash: string | undefined

  if (useCache) {
    audioHash = await sha256File(filePath)
    const cache = await loadCache(cacheDir, audioHash)
    if (cache) {
      return {
        ...cache.result,
        cached: true,
        audioHash
      }
    }
  }

  const client = new BcutAsrClient(options.clientOptions)
  const waitOptions: Omit<WaitForResultOptions, 'taskId'> = {
    intervalMs: options.pollIntervalMs ?? options.intervalMs,
    timeoutMs: options.timeoutMs,
    onProgress: options.onProgress
  }
  const { taskId, data } = await client.transcribeFile(filePath, waitOptions)

  const result: Omit<TranscribeResult, 'cached'> = {
    taskId,
    data,
    segments: data.utterances,
    text: asrDataToText(data),
    srt: asrDataToSrt(data),
    lrc: asrDataToLrc(data),
    json: asrDataToJson(data),
    audioHash
  }

  if (useCache && audioHash) {
    await saveCache(cacheDir, audioHash, {
      version: 1,
      audioHash,
      createdAt: new Date().toISOString(),
      result
    }).catch(() => {
      // Cache write failure should not break the ASR flow.
    })
  }

  return {
    ...result,
    cached: false
  }
}

async function loadCache(cacheDir: string, audioHash: string): Promise<CachedTranscribePayload | null> {
  const cachePath = buildCachePath(cacheDir, audioHash)
  const parsed = await readJsonFile<CachedTranscribePayload>(cachePath)
  if (!parsed || parsed.audioHash !== audioHash || !parsed.result) {
    return null
  }
  return parsed
}

async function saveCache(cacheDir: string, audioHash: string, payload: CachedTranscribePayload): Promise<void> {
  const cachePath = buildCachePath(cacheDir, audioHash)
  await writeJsonFile(cachePath, payload)
}

function buildCachePath(cacheDir: string, audioHash: string): string {
  return join(cacheDir, `${audioHash}.json`)
}

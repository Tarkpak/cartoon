import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { Database } from 'bun:sqlite'
import { VOLCENGINE_VOICE_PRESETS } from '../../../shared/types/volcengine-voice-presets.generated'
import { decryptText } from './crypto'
import { getDb, nowIso } from './db'
import { listAdminProviderRows } from './custom-openai-providers'
import { putTosObject, tosFileAccessUrl } from './tos-files'
import { tosStorageClientConfig } from './tos-storage'

export const VOICE_PREVIEW_MODEL = 'seed-audio-1.0'
export const VOICE_PREVIEW_TEXT_VERSION = 'zh-v1'
export const VOICE_PREVIEW_TEXT = '你好，很高兴认识你。愿这个声音，为你的故事带来生动的表达。'
const VOICE_PREVIEW_LEASE_MS = 2 * 60 * 1000
const VOLCENGINE_SPEECH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create'
const CHINESE_SPEAKER_IDS = new Set(
  VOLCENGINE_VOICE_PRESETS.filter(voice => voice.locale === 'zh').map(voice => voice.id)
)

interface VoicePreviewRow {
  cache_key: string
  speaker_id: string
  object_key: string | null
  status: 'generating' | 'ready' | 'failed'
  error_message: string | null
  lease_expires_at: string | null
}

export function isChineseVoicePreset(speakerId: string) {
  return CHINESE_SPEAKER_IDS.has(speakerId)
}

export function voicePreviewCacheKey(speakerId: string) {
  return createHash('sha256').update(JSON.stringify({
    model: VOICE_PREVIEW_MODEL,
    speakerId,
    textVersion: VOICE_PREVIEW_TEXT_VERSION,
    text: VOICE_PREVIEW_TEXT,
    audioConfig: {
      format: 'mp3',
      sampleRate: 24000,
      speechRate: 0,
      loudnessRate: 0,
      pitchRate: 0,
      enableSubtitle: false
    }
  })).digest('hex')
}

function cacheRow(db: Database, cacheKey: string) {
  return db.prepare(`
    SELECT cache_key, speaker_id, object_key, status, error_message, lease_expires_at
    FROM voice_preset_previews WHERE cache_key = ? LIMIT 1
  `).get(cacheKey) as VoicePreviewRow | undefined
}

export function claimVoicePreview(db: Database, speakerId: string, userId: string, now = new Date()) {
  const cacheKey = voicePreviewCacheKey(speakerId)
  const timestamp = nowIso(now)
  const leaseExpiresAt = nowIso(new Date(now.getTime() + VOICE_PREVIEW_LEASE_MS))
  return db.transaction(() => {
    const existing = cacheRow(db, cacheKey)
    if (existing?.status === 'ready' && existing.object_key) {
      return { state: 'ready' as const, row: existing }
    }
    if (existing?.status === 'generating' && existing.lease_expires_at && existing.lease_expires_at > timestamp) {
      return { state: 'generating' as const, row: existing }
    }
    db.prepare(`
      INSERT INTO voice_preset_previews
        (cache_key, speaker_id, model, preview_text_version, object_key, status,
         error_message, created_by_user_id, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, 'generating', NULL, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'generating', error_message = NULL, created_by_user_id = excluded.created_by_user_id,
        lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
    `).run(
      cacheKey,
      speakerId,
      VOICE_PREVIEW_MODEL,
      VOICE_PREVIEW_TEXT_VERSION,
      userId,
      leaseExpiresAt,
      timestamp,
      timestamp
    )
    return { state: 'claimed' as const, row: cacheRow(db, cacheKey)! }
  })()
}

function speechApiKey() {
  const provider = listAdminProviderRows(getDb()).find(row =>
    row.provider_key === 'volcengine' && Boolean(row.enabled)
  )
  const key = decryptText(provider?.encrypted_speech_api_key)
  if (!key) {
    throw createError({ statusCode: 400, statusMessage: '豆包语音 API Key 尚未配置' })
  }
  return key
}

async function generatePreviewAudio(speakerId: string) {
  const response = await fetch(VOLCENGINE_SPEECH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': speechApiKey(),
      'X-Api-Request-Id': randomUUID()
    },
    body: JSON.stringify({
      model: VOICE_PREVIEW_MODEL,
      text_prompt: VOICE_PREVIEW_TEXT,
      references: [{ speaker: speakerId }],
      audio_config: {
        format: 'mp3',
        sample_rate: 24000,
        speech_rate: 0,
        loudness_rate: 0,
        pitch_rate: 0,
        enable_subtitle: false
      },
      watermark: {}
    }),
    signal: AbortSignal.timeout(90000)
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`
    throw createError({ statusCode: 502, statusMessage: `豆包音色试听生成失败：${message}` })
  }
  if (typeof payload.audio === 'string' && payload.audio) {
    return Uint8Array.from(Buffer.from(payload.audio, 'base64'))
  }
  if (typeof payload.url === 'string' && payload.url) {
    const audioResponse = await fetch(payload.url, { signal: AbortSignal.timeout(20000) })
    if (audioResponse.ok) return new Uint8Array(await audioResponse.arrayBuffer())
  }
  throw createError({ statusCode: 502, statusMessage: '豆包语音未返回试听音频' })
}

function previewObjectKey(cacheKey: string) {
  const prefix = tosStorageClientConfig().keyPrefix.trim().replace(/^\/+|\/+$/g, '')
  return [prefix, 'shared', 'voice-preset-previews', VOICE_PREVIEW_TEXT_VERSION, `${cacheKey}.mp3`]
    .filter(Boolean)
    .join('/')
}

export function readyVoicePreview(row: VoicePreviewRow) {
  if (!row.object_key) throw createError({ statusCode: 500, statusMessage: '试听缓存文件无效' })
  return {
    status: 'ready' as const,
    speakerId: row.speaker_id,
    audioUrl: tosFileAccessUrl(row.object_key, 24 * 60 * 60),
    cached: true
  }
}

export async function resolveVoicePreview(speakerId: string, userId: string) {
  if (!isChineseVoicePreset(speakerId)) {
    throw createError({ statusCode: 400, statusMessage: '仅支持试听官方中文音色' })
  }
  const db = getDb()
  const claim = claimVoicePreview(db, speakerId, userId)
  if (claim.state === 'ready') return readyVoicePreview(claim.row)
  if (claim.state === 'generating') {
    return { status: 'generating' as const, speakerId, retryAfterMs: 1500 }
  }

  const cacheKey = claim.row.cache_key
  try {
    const audio = await generatePreviewAudio(speakerId)
    const objectKey = previewObjectKey(cacheKey)
    await putTosObject(objectKey, audio, 'audio/mpeg')
    const timestamp = nowIso()
    db.prepare(`
      UPDATE voice_preset_previews
      SET object_key = ?, status = 'ready', error_message = NULL,
          lease_expires_at = NULL, updated_at = ?
      WHERE cache_key = ?
    `).run(objectKey, timestamp, cacheKey)
    return {
      status: 'ready' as const,
      speakerId,
      audioUrl: tosFileAccessUrl(objectKey, 24 * 60 * 60),
      cached: false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare(`
      UPDATE voice_preset_previews
      SET status = 'failed', error_message = ?, lease_expires_at = NULL, updated_at = ?
      WHERE cache_key = ?
    `).run(message.slice(0, 2000), nowIso(), cacheKey)
    throw error
  }
}

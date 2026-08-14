import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import {
  claimVoicePreview,
  isChineseVoicePreset,
  voicePreviewCacheKey
} from './voice-preset-previews'

function previewDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE voice_preset_previews (
      cache_key TEXT PRIMARY KEY,
      speaker_id TEXT NOT NULL,
      model TEXT NOT NULL,
      preview_text_version TEXT NOT NULL,
      object_key TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_by_user_id TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  return db
}

describe('voice preset preview cache', () => {
  test('accepts official Chinese voices and rejects other locales', () => {
    expect(isChineseVoicePreset('zh_female_vv_uranus_bigtts')).toBe(true)
    expect(isChineseVoicePreset('en_female_lauren_moon_bigtts')).toBe(false)
    expect(isChineseVoicePreset('unknown_voice')).toBe(false)
  })

  test('builds a stable versioned cache key per speaker', () => {
    expect(voicePreviewCacheKey('zh_female_vv_uranus_bigtts')).toBe(
      voicePreviewCacheKey('zh_female_vv_uranus_bigtts')
    )
    expect(voicePreviewCacheKey('zh_female_vv_uranus_bigtts')).not.toBe(
      voicePreviewCacheKey('zh_male_jingqiangkanye_moon_bigtts')
    )
  })

  test('allows only the first concurrent request to generate', () => {
    const db = previewDb()
    const now = new Date('2026-08-10T08:00:00.000Z')
    const first = claimVoicePreview(db, 'zh_female_vv_uranus_bigtts', 'user-a', now)
    const second = claimVoicePreview(db, 'zh_female_vv_uranus_bigtts', 'user-b', now)
    expect(first.state).toBe('claimed')
    expect(second.state).toBe('generating')
    db.close()
  })

  test('reclaims failed and expired generation leases but reuses ready rows', () => {
    const db = previewDb()
    const speakerId = 'zh_female_vv_uranus_bigtts'
    const cacheKey = voicePreviewCacheKey(speakerId)
    const first = claimVoicePreview(db, speakerId, 'user-a', new Date('2026-08-10T08:00:00.000Z'))
    expect(first.state).toBe('claimed')

    const reclaimed = claimVoicePreview(db, speakerId, 'user-b', new Date('2026-08-10T08:03:00.000Z'))
    expect(reclaimed.state).toBe('claimed')

    db.prepare(`
      UPDATE voice_preset_previews
      SET status = 'ready', object_key = 'shared/preview.mp3', lease_expires_at = NULL
      WHERE cache_key = ?
    `).run(cacheKey)
    const ready = claimVoicePreview(db, speakerId, 'user-c', new Date('2026-08-10T08:04:00.000Z'))
    expect(ready.state).toBe('ready')
    expect(ready.row.object_key).toBe('shared/preview.mp3')
    db.close()
  })
})

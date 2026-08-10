import { describe, expect, it } from 'vitest'
import {
  VoiceGenerationTaskSchema,
  VoiceHealthSchema,
  VoiceProfileSchema
} from './voice'

describe('voice schemas', () => {
  it('accepts a ready Volcengine cloned voice profile', () => {
    const profile = VoiceProfileSchema.parse({
      id: 'voice_1',
      name: '旁白音色',
      provider: 'volcengine',
      speakerId: 'custom_zh_voice_1',
      customSpeakerId: 'custom_zh_voice_1',
      status: 'ready',
      language: 0,
      previewAudioUrl: '/api/media/voice-preview.mp3',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z'
    })

    expect(profile.status).toBe('ready')
    expect(profile.customSpeakerId).toBe('custom_zh_voice_1')
  })

  it('accepts a completed generation linked to a library asset', () => {
    const task = VoiceGenerationTaskSchema.parse({
      id: 'voice_task_1',
      name: '片头旁白',
      mode: 'prompt',
      prompt: '沉稳、有叙事感的中文旁白',
      status: 'completed',
      progress: 100,
      resultAssetId: 'lib_voice_1',
      audioUrl: '/api/media/voice.mp3',
      durationMs: 4200,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:05.000Z',
      completedAt: '2026-08-03T00:00:05.000Z'
    })

    expect(task.resultAssetId).toBe('lib_voice_1')
    expect(task.durationMs).toBe(4200)
  })

  it('accepts a generation using an official preset voice', () => {
    const task = VoiceGenerationTaskSchema.parse({
      id: 'voice_task_preset',
      name: '官方音色旁白',
      mode: 'preset',
      prompt: '欢迎来到声音工作台',
      status: 'queued',
      progress: 0,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z'
    })

    expect(task.mode).toBe('preset')
  })

  it('rejects invalid provider and progress values', () => {
    expect(() => VoiceHealthSchema.parse({
      configured: true,
      provider: 'ark',
      endpoint: 'https://example.com'
    })).toThrow()

    expect(() => VoiceGenerationTaskSchema.parse({
      id: 'voice_task_invalid',
      name: '无效任务',
      mode: 'prompt',
      prompt: 'test',
      status: 'generating',
      progress: 101,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z'
    })).toThrow()
  })
})

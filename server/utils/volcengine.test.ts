import { describe, expect, it } from 'vitest'
import { __volcengineTestUtils, resolveVolcengineVideoAspectRatio } from './volcengine'

describe('volcengine video aspect ratio', () => {
  it('returns the configured ratio when supported', () => {
    expect(resolveVolcengineVideoAspectRatio('16:9')).toBe('16:9')
    expect(resolveVolcengineVideoAspectRatio('9:16')).toBe('9:16')
    expect(resolveVolcengineVideoAspectRatio('1:1')).toBe('1:1')
  })

  it('falls back to 16:9 when ratio is missing or unsupported', () => {
    expect(resolveVolcengineVideoAspectRatio()).toBe('16:9')
    expect(resolveVolcengineVideoAspectRatio('21:9')).toBe('16:9')
  })

  it('supports trim normalization', () => {
    expect(resolveVolcengineVideoAspectRatio(' 9:16 ')).toBe('9:16')
  })
})

describe('volcengine video content builder', () => {
  it('injects reference audio when visual references exist', () => {
    const result = __volcengineTestUtils.buildVolcengineVideoContent({
      prompt: '测试提示词',
      normalizedReferenceImages: ['https://example.com/ref.png'],
      normalizedAudioUrl: 'https://example.com/voice.mp3'
    })

    expect(result.hasReferenceImages).toBe(true)
    expect(result.hasAudioReference).toBe(true)
    expect(result.content).toEqual(expect.arrayContaining([
      {
        type: 'audio_url',
        role: 'reference_audio',
        audio_url: { url: 'https://example.com/voice.mp3' }
      }
    ]))
  })

  it('does not inject reference audio in text-only mode', () => {
    const result = __volcengineTestUtils.buildVolcengineVideoContent({
      prompt: '纯文本场景',
      normalizedReferenceImages: [],
      normalizedAudioUrl: 'https://example.com/voice.mp3'
    })

    expect(result.hasReferenceImages).toBe(false)
    expect(result.hasAudioReference).toBe(false)
    expect(result.content.some(item => item.type === 'audio_url')).toBe(false)
  })

  it('treats first-frame input as mutually exclusive when reference images are provided', () => {
    const result = __volcengineTestUtils.buildVolcengineVideoContent({
      prompt: '连续镜头',
      normalizedReferenceImages: [
        'https://example.com/continuity.png',
        'https://example.com/character.png'
      ],
      normalizedFirstFrameUrl: 'https://example.com/continuity.png'
    })

    expect(result.content.some(item => item.type === 'image_url' && item.role === 'first_frame')).toBe(false)
    expect(result.content.filter(item => item.type === 'image_url' && item.role === 'reference_image')).toHaveLength(2)
  })
})

describe('volcengine reference audio guard', () => {
  it('detects short audio duration validation errors from upstream', () => {
    expect(
      __volcengineTestUtils.isVolcengineReferenceAudioDurationErrorMessage(
        'The parameter audio duration (seconds) specified in the request must be greater than or equal to 1.8 for model doubao-seedance-2-0 in r2v.'
      )
    ).toBe(true)
  })

  it('does not match unrelated upstream errors', () => {
    expect(
      __volcengineTestUtils.isVolcengineReferenceAudioDurationErrorMessage(
        'The parameter `ratio` specified in the request is not valid.'
      )
    ).toBe(false)
  })
})

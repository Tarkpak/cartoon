import { describe, expect, it } from 'vitest'
import type { AsrDataSegment } from './asr'
import { __testUtils } from './character-voice-assets'

describe('character voice asset helpers', () => {
  it('scores highly for near-identical transcripts', () => {
    const exact = __testUtils.calculateTranscriptMatchScore('你终于来了', '你终于来了')
    const normalized = __testUtils.calculateTranscriptMatchScore('别废话，快走！', '别废话快走')

    expect(exact).toBe(1)
    expect(normalized).toBeGreaterThan(0.8)
  })

  it('matches dialogue segments to the correct characters in order', () => {
    const context = {
      sceneId: 'scene_1',
      projectId: 'project_1',
      dialogues: [
        { character: '阿青', text: '你终于来了' },
        { character: '老周', text: '别废话，快走' }
      ],
      characters: [
        { id: 'char_1', name: '阿青', voiceAsset: null },
        { id: 'char_2', name: '老周', voiceAsset: null }
      ]
    }

    const segments: AsrDataSegment[] = [
      { start_time: 0, end_time: 800, transcript: '风越来越大了', words: [] },
      { start_time: 1_000, end_time: 2_200, transcript: '你终于来了', words: [] },
      { start_time: 2_400, end_time: 3_700, transcript: '别废话快走', words: [] }
    ]

    const matches = __testUtils.matchDialoguesToAsrSegments(context, segments)

    expect(matches).toHaveLength(2)
    expect(matches[0]?.characterId).toBe('char_1')
    expect(matches[0]?.characterName).toBe('阿青')
    expect(matches[1]?.characterId).toBe('char_2')
    expect(matches[1]?.transcript).toBe('别废话快走')
  })

  it('returns no matches when transcript similarity is too low', () => {
    const context = {
      sceneId: 'scene_2',
      projectId: 'project_1',
      dialogues: [
        { character: '阿青', text: '你终于来了' }
      ],
      characters: [
        { id: 'char_1', name: '阿青', voiceAsset: null }
      ]
    }

    const segments: AsrDataSegment[] = [
      { start_time: 0, end_time: 1_500, transcript: '今天天气真不错', words: [] }
    ]

    const matches = __testUtils.matchDialoguesToAsrSegments(context, segments)

    expect(matches).toHaveLength(0)
  })

  it('does not replace a locked voice asset with later auto extraction', () => {
    const shouldReplace = __testUtils.shouldReplaceVoiceAsset(
      {
        audioUrl: 'https://example.com/locked.mp3',
        locked: true,
        durationMs: 2000,
        matchScore: 0.6,
        updatedAt: new Date().toISOString()
      },
      {
        audioUrl: 'https://example.com/new.mp3',
        locked: false,
        durationMs: 5000,
        matchScore: 0.95,
        updatedAt: new Date().toISOString()
      }
    )

    expect(shouldReplace).toBe(false)
  })

  it('resolves single-speaker audio reference with fuzzy speaker name matching', () => {
    const candidate = __testUtils.resolveSingleSpeakerVoiceReference({
      sceneId: 'scene_3',
      projectId: 'project_1',
      dialogues: [
        { character: '阿青（画外）', text: '你终于来了。' }
      ],
      characters: [
        {
          id: 'char_1',
          name: '阿青',
          voiceAsset: JSON.stringify({
            audioUrl: 'https://example.com/aqing.mp3',
            updatedAt: new Date().toISOString()
          })
        }
      ]
    })

    expect(candidate?.characterId).toBe('char_1')
    expect(candidate?.voiceAsset.audioUrl).toBe('https://example.com/aqing.mp3')
  })

  it('prefers explicit audio reference when exactly one matched character has a voice asset', () => {
    const context = {
      sceneId: 'scene_4',
      projectId: 'project_1',
      dialogues: [
        { character: '阿青', text: '你终于来了。' },
        { character: '老周', text: '先别说话。' }
      ],
      characters: [
        {
          id: 'char_1',
          name: '阿青',
          voiceAsset: JSON.stringify({
            audioUrl: 'https://example.com/aqing.mp3',
            updatedAt: new Date().toISOString()
          })
        },
        {
          id: 'char_2',
          name: '老周',
          voiceAsset: null
        }
      ]
    }

    const candidate = __testUtils.resolvePreferredVoiceReference({
      context,
      candidates: [
        {
          characterId: 'char_1',
          characterName: '阿青',
          voiceAsset: {
            audioUrl: 'https://example.com/aqing.mp3',
            updatedAt: new Date().toISOString()
          }
        }
      ]
    })

    expect(candidate?.characterId).toBe('char_1')
    expect(candidate?.voiceAsset.audioUrl).toBe('https://example.com/aqing.mp3')
  })

  it('uses priority fallback for multi-character references when enabled', () => {
    const context = {
      sceneId: 'scene_5',
      projectId: 'project_1',
      dialogues: [
        { character: '阿青', text: '你终于来了。' },
        { character: '老周', text: '先别说话。' }
      ],
      characters: []
    }

    const candidate = __testUtils.resolvePreferredVoiceReference({
      context,
      candidates: [
        {
          characterId: 'char_1',
          characterName: '阿青',
          voiceAsset: {
            audioUrl: 'https://example.com/aqing.mp3',
            updatedAt: new Date().toISOString()
          }
        },
        {
          characterId: 'char_2',
          characterName: '老周',
          voiceAsset: {
            audioUrl: 'https://example.com/laozhou.mp3',
            locked: true,
            updatedAt: new Date().toISOString()
          }
        }
      ],
      allowMultiCandidateFallback: true
    })

    expect(candidate?.characterId).toBe('char_2')
    expect(candidate?.voiceAsset.audioUrl).toBe('https://example.com/laozhou.mp3')
  })
})

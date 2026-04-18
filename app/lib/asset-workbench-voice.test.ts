import { describe, expect, it } from 'vitest'
import { resolveSceneVoiceReferenceSummary } from './asset-workbench-voice'

describe('resolveSceneVoiceReferenceSummary', () => {
  it('returns explicit audio mode for a single-speaker scene with a voice asset', () => {
    const summary = resolveSceneVoiceReferenceSummary({
      scene: {
        dialogues: [
          { character: '阿青', text: '你终于来了' }
        ]
      },
      characters: [
        {
          id: 'char_1',
          name: '阿青',
          voiceAsset: {
            audioUrl: 'https://example.com/aqing.mp3',
            locked: true,
            updatedAt: new Date().toISOString()
          }
        }
      ]
    })

    expect(summary.mode).toBe('explicit_audio')
    expect(summary.characters).toEqual([
      {
        id: 'char_1',
        name: '阿青',
        locked: true,
        source: 'manual'
      }
    ])
  })

  it('falls back to prompt-only mode when the scene has multiple speakers', () => {
    const summary = resolveSceneVoiceReferenceSummary({
      scene: {
        dialogues: [
          { character: '阿青', text: '你终于来了' },
          { character: '老周', text: '先别说话' }
        ]
      },
      characters: [
        {
          id: 'char_1',
          name: '阿青',
          voiceAsset: {
            audioUrl: 'https://example.com/aqing.mp3',
            updatedAt: new Date().toISOString()
          }
        },
        {
          id: 'char_2',
          name: '老周'
        }
      ]
    })

    expect(summary.mode).toBe('prompt_only')
    expect(summary.characters).toHaveLength(1)
    expect(summary.characters[0]?.name).toBe('阿青')
  })

  it('classifies extracted samples as auto references', () => {
    const summary = resolveSceneVoiceReferenceSummary({
      scene: {
        dialogues: [
          { character: '白老板', text: '开始交易吧' }
        ]
      },
      characters: [
        {
          id: 'char_1',
          name: '白老板',
          voiceAsset: {
            audioUrl: 'https://example.com/boss.mp3',
            sourceSceneId: 'scene_9',
            sourceTaskId: 'task_9',
            updatedAt: new Date().toISOString()
          }
        }
      ]
    })

    expect(summary.mode).toBe('explicit_audio')
    expect(summary.characters[0]?.source).toBe('auto')
  })

  it('returns none when the scene has dialogue but no usable voice asset', () => {
    const summary = resolveSceneVoiceReferenceSummary({
      scene: {
        dialogues: [
          { character: '阿青', text: '你终于来了' }
        ]
      },
      characters: [
        {
          id: 'char_1',
          name: '阿青'
        }
      ]
    })

    expect(summary.hasDialogue).toBe(true)
    expect(summary.mode).toBe('none')
    expect(summary.characters).toEqual([])
  })
})

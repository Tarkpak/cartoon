import { describe, expect, it } from 'vitest'
import {
  extractSceneDialoguesFromDescription,
  shouldIncludeSceneDialoguesFromDescription
} from './scene-dialogue'

describe('shouldIncludeSceneDialoguesFromDescription', () => {
  it('returns true when description has explicit dialogue labels', () => {
    const description = '0-3秒：对白：师父：“文才，你昨晚偷喝供酒了吗？”'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(true)
  })

  it('returns true when description has quoted utterance', () => {
    const description = '师父怒视文才，低声说：“别再偷喝供酒。”'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(true)
  })

  it('returns true when description has speaker line', () => {
    const description = '0-3秒：师父：文才，站好。'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(true)
  })

  it('returns false when description only has action and camera movement', () => {
    const description = '0-3秒：全景快速推进近景，文才向右转头看向内堂。'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(false)
  })

  it('returns false when no-dialogue hint is present', () => {
    const description = '无对白。0-3秒：师父：文才，站好。'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(false)
  })

  it('ignores [引用资产] section tokens', () => {
    const description = '0-3秒：全景推进。\n\n[引用资产]\n@师父\n@内堂1'
    expect(shouldIncludeSceneDialoguesFromDescription(description)).toBe(false)
  })
})

describe('extractSceneDialoguesFromDescription', () => {
  it('extracts dialogues from timeline speaker lines', () => {
    const description = '0-3秒：师父：文才，你昨晚偷喝的供酒还没醒吗？'
    expect(extractSceneDialoguesFromDescription(description)).toEqual([
      {
        character: '师父',
        text: '文才，你昨晚偷喝的供酒还没醒吗？'
      }
    ])
  })

  it('extracts dialogues from explicit dialogue labels', () => {
    const description = '声音设计：对白：师父：站好；文才：是，师父。'
    expect(extractSceneDialoguesFromDescription(description)).toEqual([
      {
        character: '师父',
        text: '站好'
      },
      {
        character: '文才',
        text: '是，师父。'
      }
    ])
  })

  it('ignores non-dialogue speaker-like labels', () => {
    const description = '0-3秒：镜头：快速推进到中景。'
    expect(extractSceneDialoguesFromDescription(description)).toEqual([])
  })

  it('returns empty when no-dialogue hints are present', () => {
    const description = '无对白。0-3秒：师父：站好。'
    expect(extractSceneDialoguesFromDescription(description)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildScriptDocxFileName,
  normalizeScriptDocxScenes,
  sanitizeSceneDescription
} from './script-docx-export'

describe('script docx export utils', () => {
  it('sanitizes scene description for reading flow', () => {
    const raw = [
      '阿强冲进病房。[图片1]',
      '',
      '[引用资产]',
      '@阿强',
      '@病房',
      '不添加字幕，不添加BGM'
    ].join('\n')

    expect(sanitizeSceneDescription(raw)).toBe('阿强冲进病房。')
  })

  it('normalizes scenes and merges explicit/inferred dialogues', () => {
    const scenes = normalizeScriptDocxScenes([{
      title: '病房对峙',
      description: '对白：阿强："快走"；小美："跟我来"',
      duration: 8.2,
      setting: {
        location: '医院病房',
        timeOfDay: 'night'
      },
      characters: [
        { name: '阿强' },
        { name: '小美' }
      ],
      dialogues: [
        { character: '阿强', text: '快走' }
      ]
    }])

    expect(scenes).toHaveLength(1)
    expect(scenes[0]?.title).toBe('病房对峙')
    expect(scenes[0]?.location).toBe('医院病房')
    expect(scenes[0]?.timeOfDay).toBe('夜晚')
    expect(scenes[0]?.dialogues).toEqual([
      { character: '阿强', text: '快走' },
      { character: '小美', text: '跟我来' }
    ])
  })

  it('builds safe docx filename', () => {
    const fileName = buildScriptDocxFileName(
      '测试/项目:?*',
      new Date('2026-04-23T00:00:00.000Z')
    )

    expect(fileName).toBe('测试_项目___-格式化剧本-2026-04-23.docx')
  })
})

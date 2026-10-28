import { describe, expect, it } from 'vitest'
import { isCharacterOnlyMentionedOffscreen } from './scene-character-presence'

describe('scene character presence', () => {
  const description = '【时间轴】特写，张建军笑了，口型铺满整镜（**算盘打得深：用不了几天，郑学军就会主动把枪送过来——稀罕物不催，等它自己来求**）\n【台词】张建军（笃定）：“福林，你别急。郑学军就会主动把枪送过来。”'
  it('separates the visible speaker from people mentioned in dialogue and thoughts', () => {
    expect(isCharacterOnlyMentionedOffscreen(description, '郑学军')).toBe(true)
    expect(isCharacterOnlyMentionedOffscreen(description, '福林')).toBe(true)
    expect(isCharacterOnlyMentionedOffscreen(description, '张建军')).toBe(false)
  })
  it('keeps people with actual visual actions, including flashbacks', () => {
    expect(isCharacterOnlyMentionedOffscreen(`${description}\n郑学军走进矿场。`, '郑学军')).toBe(false)
    expect(isCharacterOnlyMentionedOffscreen(`${description}\n闪回画面：郑学军递出枪。`, '郑学军')).toBe(false)
    expect(isCharacterOnlyMentionedOffscreen('【画外音】郑学军：张建军还在等我。', '郑学军')).toBe(true)
  })
  it('ignores stale reference blocks and leaves ambiguous/manual references eligible', () => {
    expect(isCharacterOnlyMentionedOffscreen(`${description}\n[引用资产]\n@郑学军`, '郑学军')).toBe(true)
    expect(isCharacterOnlyMentionedOffscreen('矿场大门。\n[引用资产]\n@郑学军', '郑学军')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  GenerateCharacterRequestSchema,
  normalizeCharacterGender,
  normalizeCharacterGenderText,
  normalizeCharacterRole,
  normalizeCharacterRoleText
} from './character'

describe('normalizeCharacterRole', () => {
  it('maps Chinese role aliases to canonical enum values', () => {
    expect(normalizeCharacterRole('男主')).toBe('主角')
    expect(normalizeCharacterRole('反派')).toBe('反派')
    expect(normalizeCharacterRole('配角')).toBe('配角')
    expect(normalizeCharacterRole('群演')).toBe('龙套')
  })

  it('supports common English aliases', () => {
    expect(normalizeCharacterRole('lead')).toBe('主角')
    expect(normalizeCharacterRole('villain')).toBe('反派')
    expect(normalizeCharacterRole('background')).toBe('龙套')
  })

  it('preserves an unknown natural-language role in the text normalizer', () => {
    expect(normalizeCharacterRoleText('关键证人兼叙事误导者')).toBe('关键证人兼叙事误导者')
  })
})

describe('normalizeCharacterGender', () => {
  it('maps Chinese and English gender aliases to canonical enum values', () => {
    expect(normalizeCharacterGender('男')).toBe('男')
    expect(normalizeCharacterGender('女性')).toBe('女')
    expect(normalizeCharacterGender('年轻女性')).toBe('女')
    expect(normalizeCharacterGender('30岁男性')).toBe('男')
    expect(normalizeCharacterGender('girl')).toBe('女')
    expect(normalizeCharacterGender('non-binary')).toBe('其他')
  })

  it('preserves a specific natural-language description in the text normalizer', () => {
    expect(normalizeCharacterGenderText('无性别机械生命')).toBe('无性别机械生命')
  })
})

describe('GenerateCharacterRequestSchema role normalization', () => {
  it('normalizes known aliases before schema validation', () => {
    const result = GenerateCharacterRequestSchema.safeParse({
      character: {
        id: 'char_1',
        name: '林默',
        appearance: '黑发，冷静',
        role: '男主'
      },
      style: '国漫'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.character.role).toBe('主角')
  })

  it('preserves unknown role descriptions instead of dropping them', () => {
    const result = GenerateCharacterRequestSchema.safeParse({
      character: {
        id: 'char_2',
        name: '路人甲',
        appearance: '普通装束',
        role: '未知定位'
      },
      style: '国漫'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.character.role).toBe('未知定位')
  })

  it('normalizes gender aliases before schema validation', () => {
    const result = GenerateCharacterRequestSchema.safeParse({
      character: {
        id: 'char_3',
        name: '沈清',
        appearance: '长发，白裙',
        role: '女主',
        gender: '女'
      },
      style: '国漫'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.character.gender).toBe('女')
  })

  it('accepts open gender and speaking-style descriptions', () => {
    const result = GenerateCharacterRequestSchema.safeParse({
      character: {
        id: 'char_4',
        name: '零号',
        appearance: '银色仿生外壳',
        role: '失忆的叙事观察者',
        gender: '无性别机械生命',
        speakingStyle: '克制疏离，偶尔出现机械式停顿'
      },
      style: '科幻动画'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.character.role).toBe('失忆的叙事观察者')
    expect(result.data.character.gender).toBe('无性别机械生命')
    expect(result.data.character.speakingStyle).toBe('克制疏离，偶尔出现机械式停顿')
  })
})

import { describe, expect, it } from 'vitest'
import {
  GenerateCharacterRequestSchema,
  normalizeCharacterGender,
  normalizeCharacterRole
} from './character'

describe('normalizeCharacterRole', () => {
  it('maps Chinese role aliases to canonical enum values', () => {
    expect(normalizeCharacterRole('男主')).toBe('protagonist')
    expect(normalizeCharacterRole('反派')).toBe('antagonist')
    expect(normalizeCharacterRole('配角')).toBe('supporting')
    expect(normalizeCharacterRole('群演')).toBe('extra')
  })

  it('supports common English aliases', () => {
    expect(normalizeCharacterRole('lead')).toBe('protagonist')
    expect(normalizeCharacterRole('villain')).toBe('antagonist')
    expect(normalizeCharacterRole('background')).toBe('extra')
  })
})

describe('normalizeCharacterGender', () => {
  it('maps Chinese and English gender aliases to canonical enum values', () => {
    expect(normalizeCharacterGender('男')).toBe('male')
    expect(normalizeCharacterGender('女性')).toBe('female')
    expect(normalizeCharacterGender('年轻女性')).toBe('female')
    expect(normalizeCharacterGender('30岁男性')).toBe('male')
    expect(normalizeCharacterGender('girl')).toBe('female')
    expect(normalizeCharacterGender('non-binary')).toBe('other')
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
    expect(result.data.character.role).toBe('protagonist')
  })

  it('drops unknown role aliases instead of failing request', () => {
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
    expect(result.data.character.role).toBeUndefined()
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
    expect(result.data.character.gender).toBe('female')
  })
})

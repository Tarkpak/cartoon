import { describe, expect, it } from 'vitest'
import {
  GenerateCharacterRequestSchema,
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
})

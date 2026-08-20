import { describe, expect, it } from 'vitest'
import {
  isPromptReadonlyProfile,
  PROMPT_ADVANCED_PROFILE_ID,
  PROMPT_DEFAULT_PROFILE_ID
} from './prompt-template'

describe('prompt profile read-only rules', () => {
  it('protects both built-in profiles while allowing custom profiles', () => {
    expect(isPromptReadonlyProfile(PROMPT_DEFAULT_PROFILE_ID)).toBe(true)
    expect(isPromptReadonlyProfile(PROMPT_ADVANCED_PROFILE_ID)).toBe(true)
    expect(isPromptReadonlyProfile('profile_custom')).toBe(false)
  })
})

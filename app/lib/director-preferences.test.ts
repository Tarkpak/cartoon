import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_PREFERENCES_MAX_CHARS,
  getDirectorPreferencesValidationError,
  hasDirectorPreferencesChanges,
  normalizeDirectorPreferences
} from './director-preferences'

describe('director preferences', () => {
  it('normalizes surrounding whitespace without changing internal Markdown', () => {
    expect(normalizeDirectorPreferences('  # 导演规则\n\n- 使用慢推镜头  '))
      .toBe('# 导演规则\n\n- 使用慢推镜头')
  })

  it('treats surrounding whitespace as the same saved content', () => {
    expect(hasDirectorPreferencesChanges('规则正文\n', '规则正文')).toBe(false)
    expect(hasDirectorPreferencesChanges('规则正文 A', '规则正文 B')).toBe(true)
  })

  it('rejects content over the backend character limit', () => {
    expect(getDirectorPreferencesValidationError('字'.repeat(DIRECTOR_PREFERENCES_MAX_CHARS))).toBe('')
    expect(getDirectorPreferencesValidationError('字'.repeat(DIRECTOR_PREFERENCES_MAX_CHARS + 1)))
      .toContain('50,000')
  })
})

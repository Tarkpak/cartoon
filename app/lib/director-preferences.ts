export const DIRECTOR_PREFERENCES_MAX_CHARS = 50_000

export function normalizeDirectorPreferences(content: string): string {
  return content.trim()
}

export function hasDirectorPreferencesChanges(current: string, saved: string): boolean {
  return normalizeDirectorPreferences(current) !== normalizeDirectorPreferences(saved)
}

export function getDirectorPreferencesValidationError(content: string): string {
  if (content.length <= DIRECTOR_PREFERENCES_MAX_CHARS) return ''
  return `自定义提示词不能超过 ${DIRECTOR_PREFERENCES_MAX_CHARS.toLocaleString('zh-CN')} 个字符`
}

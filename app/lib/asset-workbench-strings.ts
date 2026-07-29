export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

export function normalizeToken(value?: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s\u3000]/g, '')
    .replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, '')
}

const NARRATIVE_PRONOUN_CHARACTER_NAMES = new Set(['我', '本人', '自己'])

export function isNarrativePronounCharacterName(value?: string): boolean {
  return NARRATIVE_PRONOUN_CHARACTER_NAMES.has(normalizeToken(value))
}

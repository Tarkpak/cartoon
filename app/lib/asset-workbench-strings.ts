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

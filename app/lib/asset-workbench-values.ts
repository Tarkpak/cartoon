export function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

export function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

export function toOptionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const normalized = Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item === 'string' && item.length > 0)
  )

  return Object.keys(normalized).length > 0
    ? normalized as Record<string, string>
    : undefined
}

export function getDisplayErrorMessage(error: unknown, fallback: string): string {
  const payload = error as {
    data?: { message?: string }
    statusMessage?: string
    message?: string
  }

  return payload?.data?.message
    || payload?.statusMessage
    || payload?.message
    || fallback
}

export function normalizeCharacterName(name?: string): string {
  if (!name) return ''

  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\u3000]/g, '')
    .replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, '')
}

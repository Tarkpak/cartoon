function parseStoredJson(raw: unknown, fallback: unknown) {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return fallback
  }
}

export function mergeModelLogResponse(existingRaw: unknown, incoming: unknown) {
  const existing = parseStoredJson(existingRaw, {})
  if (
    existing && typeof existing === 'object' && !Array.isArray(existing)
    && incoming && typeof incoming === 'object' && !Array.isArray(incoming)
  ) {
    return { ...existing, ...incoming }
  }
  return incoming ?? existing
}

export function mergeModelLogMediaRefs(existingRaw: unknown, incoming: unknown) {
  const existing = parseStoredJson(existingRaw, [])
  const existingItems = Array.isArray(existing) ? existing : []
  const incomingItems = Array.isArray(incoming) ? incoming : []
  const merged = new Map<string, unknown>()
  for (const item of [...existingItems, ...incomingItems]) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const key = [record.direction, record.mediaType, record.path, record.url]
      .map(value => String(value || ''))
      .join('|')
    merged.set(key, item)
  }
  return [...merged.values()]
}

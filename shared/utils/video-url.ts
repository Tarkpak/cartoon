export function normalizeProjectVideoUrl(rawValue?: string | null): string | null {
  const raw = rawValue?.trim()
  if (!raw) return null

  if (raw.startsWith('url:')) {
    return normalizeProjectVideoUrl(raw.slice(4))
  }

  if (raw.startsWith('/videos/')) {
    const filename = raw.slice('/videos/'.length)
    return filename ? `/api/video/file/${filename}` : null
  }

  if (raw.startsWith('/api/video/file/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('data:video')) return raw
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('ref:')) return null

  return `data:video/mp4;base64,${raw}`
}

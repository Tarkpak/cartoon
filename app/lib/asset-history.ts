import type {
  AssetHistorySource,
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry
} from '~/lib/asset-workbench-types'

const MAX_ASSET_HISTORY_ENTRIES = 24

function normalizeImage(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeVideo(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toTimestamp(value?: string): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildStableHistoryId(image: string, createdAt = ''): string {
  const seed = `${image}|${createdAt}`
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return `asset_hist_${hash.toString(36)}`
}

function buildStableVideoHistoryId(videoUrl: string, createdAt = ''): string {
  const seed = `${videoUrl}|${createdAt}`
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return `video_hist_${hash.toString(36)}`
}

function normalizeHistoryEntry(
  rawValue: unknown
): AssetImageHistoryEntry | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null
  }

  const item = rawValue as Partial<AssetImageHistoryEntry>
  const image = normalizeImage(item.image)
  if (!image) return null

  const createdAt = typeof item.createdAt === 'string' && item.createdAt.trim()
    ? item.createdAt
    : undefined

  return {
    id: typeof item.id === 'string' && item.id.trim()
      ? item.id
      : buildStableHistoryId(image, createdAt),
    image,
    createdAt,
    source: item.source,
    prompt: typeof item.prompt === 'string' && item.prompt.trim()
      ? item.prompt.trim()
      : undefined
  }
}

function normalizeVideoHistoryEntry(
  rawValue: unknown
): AssetVideoHistoryEntry | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null
  }

  const item = rawValue as Partial<AssetVideoHistoryEntry>
  const videoUrl = normalizeVideo(item.videoUrl)
  if (!videoUrl) return null

  const createdAt = typeof item.createdAt === 'string' && item.createdAt.trim()
    ? item.createdAt
    : undefined

  return {
    id: typeof item.id === 'string' && item.id.trim()
      ? item.id
      : buildStableVideoHistoryId(videoUrl, createdAt),
    videoUrl,
    createdAt,
    source: item.source,
    prompt: typeof item.prompt === 'string' && item.prompt.trim()
      ? item.prompt.trim()
      : undefined
  }
}

export function normalizeAssetHistoryEntries(
  rawEntries: unknown,
  currentImage?: string
): AssetImageHistoryEntry[] {
  const history: AssetImageHistoryEntry[] = []
  const seenImages = new Set<string>()

  if (Array.isArray(rawEntries)) {
    for (const rawEntry of rawEntries) {
      const entry = normalizeHistoryEntry(rawEntry)
      if (!entry || seenImages.has(entry.image)) continue

      seenImages.add(entry.image)
      history.push(entry)
    }
  }

  history.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))

  return ensureAssetHistoryEntry(history, currentImage, {
    source: 'legacy'
  })
}

export function ensureAssetHistoryEntry(
  history: AssetImageHistoryEntry[] | undefined,
  image: string | undefined,
  input: {
    createdAt?: string
    source?: AssetHistorySource
    prompt?: string
  } = {}
): AssetImageHistoryEntry[] {
  const nextImage = normalizeImage(image)
  const entries = Array.isArray(history) ? [...history] : []
  if (!nextImage) return entries

  const existingIndex = entries.findIndex(entry => normalizeImage(entry.image) === nextImage)
  if (existingIndex >= 0) {
    const existing = entries[existingIndex]
    if (!existing) return entries

    if (!existing.source && input.source) {
      existing.source = input.source
    }
    if (!existing.createdAt && input.createdAt) {
      existing.createdAt = input.createdAt
    }
    if (!existing.prompt && input.prompt) {
      existing.prompt = input.prompt
    }
    return entries
  }

  const entry: AssetImageHistoryEntry = {
    id: buildStableHistoryId(nextImage, input.createdAt),
    image: nextImage,
    createdAt: input.createdAt,
    source: input.source,
    prompt: input.prompt
  }

  return [entry, ...entries].slice(0, MAX_ASSET_HISTORY_ENTRIES)
}

export function normalizeVideoHistoryEntries(
  rawEntries: unknown,
  currentVideoUrl?: string
): AssetVideoHistoryEntry[] {
  const history: AssetVideoHistoryEntry[] = []
  const seenVideoUrls = new Set<string>()

  if (Array.isArray(rawEntries)) {
    for (const rawEntry of rawEntries) {
      const entry = normalizeVideoHistoryEntry(rawEntry)
      if (!entry || seenVideoUrls.has(entry.videoUrl)) continue

      seenVideoUrls.add(entry.videoUrl)
      history.push(entry)
    }
  }

  history.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))

  return ensureVideoHistoryEntry(history, currentVideoUrl, {
    source: 'legacy'
  })
}

export function ensureVideoHistoryEntry(
  history: AssetVideoHistoryEntry[] | undefined,
  videoUrl: string | undefined,
  input: {
    createdAt?: string
    source?: AssetHistorySource
    prompt?: string
  } = {}
): AssetVideoHistoryEntry[] {
  const nextVideoUrl = normalizeVideo(videoUrl)
  const entries = Array.isArray(history) ? [...history] : []
  if (!nextVideoUrl) return entries

  const existingIndex = entries.findIndex(entry => normalizeVideo(entry.videoUrl) === nextVideoUrl)
  if (existingIndex >= 0) {
    const existing = entries[existingIndex]
    if (!existing) return entries

    if (!existing.source && input.source) {
      existing.source = input.source
    }
    if (!existing.createdAt && input.createdAt) {
      existing.createdAt = input.createdAt
    }
    if (!existing.prompt && input.prompt) {
      existing.prompt = input.prompt
    }
    return entries
  }

  const entry: AssetVideoHistoryEntry = {
    id: buildStableVideoHistoryId(nextVideoUrl, input.createdAt),
    videoUrl: nextVideoUrl,
    createdAt: input.createdAt,
    source: input.source,
    prompt: input.prompt
  }

  return [entry, ...entries].slice(0, MAX_ASSET_HISTORY_ENTRIES)
}

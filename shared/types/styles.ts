import defaultStylePresets from '../../src-tauri/assets/default-style-presets.json'

const STYLE_THUMBNAIL_CDN_BASE = 'https://playlet-ai.tos-cn-guangzhou.volces.com/manju-assets/styles'
const LEGACY_STYLE_THUMBNAIL_CDN_BASE = 'https://playlet-ai.tos-cn-guangzhou.volces.com/playlet-assets/styles'

function resolveStyleThumbnail(path?: string): string | undefined {
  if (!path) return path
  if (path.startsWith(LEGACY_STYLE_THUMBNAIL_CDN_BASE)) {
    return `${STYLE_THUMBNAIL_CDN_BASE}${path.slice(LEGACY_STYLE_THUMBNAIL_CDN_BASE.length)}`
  }
  if (/^https?:\/\//i.test(path)) return path
  if (!path.startsWith('/styles/')) return path
  const filename = path.split('/').filter(Boolean).pop()
  return filename ? `${STYLE_THUMBNAIL_CDN_BASE}/${filename}` : path
}

export type StyleCategory
  = | 'live_action' | '3d' | 'chinese' | '2d' | 'chibi'
    | 'game' | 'japanese_anime' | 'western' | 'korean'

export type StyleCategoryIcon
  = | 'sparkles'
    | 'landmark'
    | 'box'
    | 'palette'
    | 'heart'
    | 'gamepad2'
    | 'clapperboard'
    | 'globe2'
    | 'music2'

export interface StylePreset {
  id: string
  name: string
  nameEn: string
  category: StyleCategory
  categories?: StyleCategory[]
  description: string
  prompt: string
  negativePrompt?: string
  thumbnail?: string
  isNew?: boolean
  isPro?: boolean
}

export interface StyleCategoryInfo {
  id: StyleCategory
  name: string
  nameEn: string
  icon: StyleCategoryIcon
}

type RawStylePreset = {
  id?: unknown
  name?: unknown
  nameEn?: unknown
  category?: unknown
  categories?: unknown
  description?: unknown
  prompt?: unknown
  negativePrompt?: unknown
  thumbnail?: unknown
  isNew?: unknown
  isPro?: unknown
}

export const STYLE_CATEGORIES: StyleCategoryInfo[] = [
  { id: 'live_action', name: '真人剧', nameEn: 'Live Action', icon: 'clapperboard' },
  { id: '3d', name: '3D', nameEn: '3D', icon: 'box' },
  { id: 'chinese', name: '国风', nameEn: 'Chinese', icon: 'landmark' },
  { id: '2d', name: '2D', nameEn: '2D', icon: 'palette' },
  { id: 'chibi', name: 'Q版', nameEn: 'Chibi', icon: 'heart' },
  { id: 'game', name: '游戏', nameEn: 'Game', icon: 'gamepad2' },
  { id: 'japanese_anime', name: '日漫', nameEn: 'Japanese Anime', icon: 'sparkles' },
  { id: 'western', name: '欧美', nameEn: 'Western', icon: 'globe2' },
  { id: 'korean', name: '韩流', nameEn: 'Korean', icon: 'music2' }
]

const STYLE_CATEGORY_IDS = new Set<StyleCategory>(STYLE_CATEGORIES.map(category => category.id))
const LEGACY_STYLE_CATEGORY_MAP: Record<string, StyleCategory> = {
  japanese_anime: 'japanese_anime',
  chinese_style: 'chinese',
  '3d_render': '3d',
  illustration: '2d',
  retro: '2d',
  cute_q: 'chibi',
  artistic: '2d',
  comic: '2d',
  pixel_game: 'game',
  special: '2d'
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  return normalized || undefined
}

export function normalizeStyleCategoryId(value: unknown): StyleCategory | null {
  const id = normalizeString(value)
  if (STYLE_CATEGORY_IDS.has(id as StyleCategory)) return id as StyleCategory
  return LEGACY_STYLE_CATEGORY_MAP[id] || null
}

export function normalizeStylePreset(style: RawStylePreset): StylePreset | null {
  const category = normalizeStyleCategoryId(style.category)
  if (!category) return null

  const id = normalizeString(style.id)
  const name = normalizeString(style.name)
  const nameEn = normalizeString(style.nameEn)
  const description = normalizeString(style.description)
  const prompt = normalizeString(style.prompt)
  if (!id || !name || !nameEn || !description || !prompt) return null
  const categories = Array.isArray(style.categories)
    ? style.categories
        .map(normalizeStyleCategoryId)
        .filter((item): item is StyleCategory => item !== null)
    : []
  if (!categories.includes(category)) categories.unshift(category)

  return {
    id,
    name,
    nameEn,
    category,
    categories,
    description,
    prompt,
    negativePrompt: normalizeOptionalString(style.negativePrompt),
    thumbnail: resolveStyleThumbnail(normalizeOptionalString(style.thumbnail)),
    isNew: style.isNew === true || undefined,
    isPro: style.isPro === true || undefined
  }
}

export function normalizeStylePresets(styles: unknown[]): StylePreset[] {
  return styles
    .map(style => normalizeStylePreset(style as RawStylePreset))
    .filter((style): style is StylePreset => style !== null)
}

export const STYLE_PRESETS: StylePreset[] = normalizeStylePresets(defaultStylePresets)

export function getStylesByCategory(category: StyleCategory): StylePreset[] {
  return STYLE_PRESETS.filter(style => (style.categories || [style.category]).includes(category))
}

export function getStyleById(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find(style => style.id === id)
}

export function searchStyles(query: string): StylePreset[] {
  const q = query.toLowerCase()
  return STYLE_PRESETS.filter(s => s.name.includes(q) || s.nameEn.toLowerCase().includes(q) || s.description.includes(q))
}

export function getNewStyles(): StylePreset[] {
  return STYLE_PRESETS.filter(style => style.isNew)
}

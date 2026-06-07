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
  = | 'japanese_anime' | 'chinese_style' | '3d_render' | 'illustration'
    | 'retro' | 'cute_q' | 'artistic' | 'comic' | 'pixel_game' | 'special'

export type StyleCategoryIcon
  = | 'sparkles'
    | 'landmark'
    | 'box'
    | 'palette'
    | 'clock3'
    | 'heart'
    | 'pen_tool'
    | 'message_square'
    | 'gamepad2'
    | 'star'

export interface StylePreset {
  id: string
  name: string
  nameEn: string
  category: StyleCategory
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
  description?: unknown
  prompt?: unknown
  negativePrompt?: unknown
  thumbnail?: unknown
  isNew?: unknown
  isPro?: unknown
}

export const STYLE_CATEGORIES: StyleCategoryInfo[] = [
  { id: 'japanese_anime', name: '日系动漫', nameEn: 'Japanese Anime', icon: 'sparkles' },
  { id: 'chinese_style', name: '国风', nameEn: 'Chinese Style', icon: 'landmark' },
  { id: '3d_render', name: '3D渲染', nameEn: '3D Render', icon: 'box' },
  { id: 'illustration', name: '插画', nameEn: 'Illustration', icon: 'palette' },
  { id: 'retro', name: '复古', nameEn: 'Retro', icon: 'clock3' },
  { id: 'cute_q', name: 'Q萌可爱', nameEn: 'Cute & Chibi', icon: 'heart' },
  { id: 'artistic', name: '艺术风格', nameEn: 'Artistic', icon: 'pen_tool' },
  { id: 'comic', name: '漫画', nameEn: 'Comic', icon: 'message_square' },
  { id: 'pixel_game', name: '像素游戏', nameEn: 'Pixel & Game', icon: 'gamepad2' },
  { id: 'special', name: '特殊IP', nameEn: 'Special IP', icon: 'star' }
]

const STYLE_CATEGORY_IDS = new Set<StyleCategory>(STYLE_CATEGORIES.map(category => category.id))

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  return normalized || undefined
}

function normalizeStylePreset(style: RawStylePreset): StylePreset | null {
  const category = normalizeString(style.category) as StyleCategory
  if (!STYLE_CATEGORY_IDS.has(category)) return null

  const id = normalizeString(style.id)
  const name = normalizeString(style.name)
  const nameEn = normalizeString(style.nameEn)
  const description = normalizeString(style.description)
  const prompt = normalizeString(style.prompt)
  if (!id || !name || !nameEn || !description || !prompt) return null

  return {
    id,
    name,
    nameEn,
    category,
    description,
    prompt,
    negativePrompt: normalizeOptionalString(style.negativePrompt),
    thumbnail: resolveStyleThumbnail(normalizeOptionalString(style.thumbnail)),
    isNew: style.isNew === true || undefined,
    isPro: style.isPro === true || undefined
  }
}

export const STYLE_PRESETS: StylePreset[] = (defaultStylePresets as RawStylePreset[])
  .map(normalizeStylePreset)
  .filter((style): style is StylePreset => style !== null)

export function getStylesByCategory(category: StyleCategory): StylePreset[] {
  return STYLE_PRESETS.filter(style => style.category === category)
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

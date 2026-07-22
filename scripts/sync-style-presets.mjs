import fs from 'node:fs'

const API_URL = 'https://api.oiioii.ai/knowledge/style_assets'
const PRESETS_FILE = 'src-tauri/assets/default-style-presets.json'
const LEGACY_IDS_FILE = 'src-tauri/assets/legacy-style-preset-ids-v1.json'
const PINNED_STYLE_ID = 1800
const CATEGORY_TAGS = [
  ['真人剧', 'live_action'],
  ['3D', '3d'],
  ['国风', 'chinese'],
  ['2D', '2d'],
  ['Q版', 'chibi'],
  ['游戏', 'game'],
  ['日漫', 'japanese_anime'],
  ['欧美', 'western'],
  ['韩流', 'korean'],
]
const CATEGORY_IDS = new Set(CATEGORY_TAGS.map(([, id]) => id))
const THUMBNAIL_ORIGIN = 'https://static-oiioii-sg.hogiai.cn'

const LEGACY_NAME_ALIASES = new Map([
  ['AI真人(建议垫图)', 'AI真人'],
  ['2D漫剧', '2D叙事影视'],
  ['皮克斯', '美式3D'],
  ['美漫恶搞风', '美式喜剧'],
  ['小绿鸟插画风', '扁平图形设计'],
  ['吊带袜天使', '吊带袜女孩'],
  ['柯南风', '名侦探阿楠'],
  ['芙莉莲', '辛逝季-芙莉莲'],
  ['死神风', '尸魂界-死神'],
  ['航海王', '草帽团'],
])

const STYLE_ID_OVERRIDES = new Map([
  [1800, 'ancient_3d_playlet'],
  [1820, 'urban_chic'],
  [1821, 'studio_animation'],
  [1816, 'fruit_love_story'],
  [1819, 'retro_games'],
  [1811, 'modern_urban'],
  [1806, 'shanghai_ink_animation'],
  [1808, 'bubble_doodle'],
  [1813, 'japanese_surreal_dream'],
  [1809, 'battle_royale'],
  [1817, 'live_action_xianxia'],
  [1789, 'kpop_3d'],
  [1814, 'black_stick_figure'],
  [1799, 'hong_kong_cinema'],
  [891, 'game_scifi_anime'],
  [1812, 'hand_drawn_superhero'],
  [1790, 'steampunk_fantasy'],
  [1797, 'cartoon_mascot_3d'],
  [1798, 'dark_fantasy_baroque'],
  [1807, 'neon_cyberpunk'],
  [1810, 'american_live_action'],
  [1805, 'grainy_retro_illustration'],
  [1794, 'reddead_outlaw'],
  [1793, 'stardew_pixel'],
])

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function fetchRemoteStyles() {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: { limit: 400, page: 1 } }),
  })
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`)

  const payload = await response.json()
  const items = payload?.data?.items
  if (!Array.isArray(items)) throw new TypeError('Unexpected style_assets response')

  return items
    .filter(item => item.meta?.status === 'online' && item.meta?.regions?.includes('CN'))
    .sort((left, right) => {
      if (left.id === PINNED_STYLE_ID) return -1
      if (right.id === PINNED_STYLE_ID) return 1
      return (left.meta?.region_order?.CN ?? Number.MAX_SAFE_INTEGER)
        - (right.meta?.region_order?.CN ?? Number.MAX_SAFE_INTEGER)
    })
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveCategories(typeCn) {
  const tags = new Set(String(typeCn || '').split(',').map(tag => tag.trim()))
  const categories = CATEGORY_TAGS
    .filter(([tag]) => tags.has(tag))
    .map(([, category]) => category)
  return categories.length > 0 ? categories : ['2d']
}

function webpUrl(value) {
  return String(value || '')
    .replace('https://static-hoe.hogi.ai/', 'https://static-oiioii-sg.hogiai.cn/')
    .replace(/\.(?:jpe?g|png)(?=$|\?)/i, '.webp')
}

function buildCatalog(remoteStyles, previousStyles) {
  const byName = new Map(previousStyles.map(style => [style.name, style]))
  const byEnglishName = new Map()
  for (const style of previousStyles) {
    const key = style.nameEn?.trim().toLowerCase()
    if (!key) continue
    const matches = byEnglishName.get(key) ?? []
    matches.push(style)
    byEnglishName.set(key, matches)
  }

  const usedIds = new Set()
  return remoteStyles.map((remote) => {
    const meta = remote.meta ?? {}
    const remoteName = String(meta.name_cn || '').trim()
    const legacyName = LEGACY_NAME_ALIASES.get(remoteName) ?? remoteName
    let previous = byName.get(legacyName)
    if (!previous) {
      const englishMatches = byEnglishName.get(String(meta.name || '').trim().toLowerCase()) ?? []
      previous = englishMatches.find(style => !usedIds.has(style.id))
    }

    const baseId = previous?.id
      ?? STYLE_ID_OVERRIDES.get(remote.id)
      ?? slugify(meta.name)
      ?? `oiioii_style_${remote.id}`
    let id = baseId
    if (usedIds.has(id)) id = `${baseId}_${remote.id}`
    usedIds.add(id)

    const categories = resolveCategories(meta.type_cn)
    const preset = {
      id,
      name: remoteName,
      nameEn: String(meta.name || previous?.nameEn || remoteName).trim(),
      category: categories[0],
      categories,
      description: String(remote.content || previous?.description || remoteName).trim(),
      prompt: String(previous?.prompt || meta.name || remoteName).trim(),
      thumbnail: webpUrl(meta.url) || previous?.thumbnail,
    }
    if (previous?.negativePrompt) preset.negativePrompt = previous.negativePrompt
    if (meta.is_new === true) preset.isNew = true
    if (previous?.isPro === true) preset.isPro = true
    return preset
  })
}

const write = process.argv.includes('--write')
const previousStyles = readJson(PRESETS_FILE)
const remoteStyles = await fetchRemoteStyles()
const nextStyles = buildCatalog(remoteStyles, previousStyles)

if (remoteStyles.length !== 171 || nextStyles.length !== 171) {
  throw new Error(`Expected 171 CN styles, received ${remoteStyles.length}`)
}

const ids = nextStyles.map(style => style.id)
if (new Set(ids).size !== ids.length) throw new Error('Generated duplicate style IDs')

const invalidCategories = nextStyles.filter(style => (
  !style.categories.includes(style.category)
  || style.categories.some(category => !CATEGORY_IDS.has(category))
))
if (invalidCategories.length > 0) {
  throw new Error(`Generated invalid categories for ${invalidCategories.length} styles`)
}

const invalidThumbnails = nextStyles.filter((style) => {
  try {
    return new URL(style.thumbnail).origin !== THUMBNAIL_ORIGIN
  }
  catch {
    return true
  }
})
if (invalidThumbnails.length > 0) {
  throw new Error(`Generated invalid thumbnails for ${invalidThumbnails.length} styles`)
}

if (write) {
  if (!fs.existsSync(LEGACY_IDS_FILE)) {
    const legacyIds = previousStyles.map(style => style.id)
    fs.writeFileSync(LEGACY_IDS_FILE, `${JSON.stringify(legacyIds, null, 2)}\n`, 'utf8')
  }
  fs.writeFileSync(PRESETS_FILE, `${JSON.stringify(nextStyles, null, 2)}\n`, 'utf8')
}

const previousNames = new Set(previousStyles.map(style => style.name))
const nextNames = new Set(nextStyles.map(style => style.name))
console.log(JSON.stringify({
  mode: write ? 'write' : 'dry-run',
  previous: previousStyles.length,
  remote: remoteStyles.length,
  next: nextStyles.length,
  addedNames: [...nextNames].filter(name => !previousNames.has(name)),
  removedNames: [...previousNames].filter(name => !nextNames.has(name)),
}, null, 2))

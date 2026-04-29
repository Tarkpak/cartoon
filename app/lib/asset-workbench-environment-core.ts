import type { SceneData } from '~/composables/useAssetWorkbench'
import { resolveTimeOfDayText } from '#shared/types/script'
import { uniqueSorted } from '~/lib/asset-workbench-strings'

export interface SceneEnvironmentConsistencyContext {
  environmentRoot: string
  anchorSceneId?: string
  anchorSceneTitle?: string
  anchorLocation?: string
  anchorDescription?: string
  siblingLocations?: string[]
}

export function resolveSceneReferenceImage(scene: SceneData): string | undefined {
  return scene.firstFrame || scene.lastFrame
}

export function normalizeEnvironmentToken(value?: string): string {
  return (value || '').trim().toLowerCase()
}

export const LOCATION_STYLE_PREFIX_REGEX = /^(?:豪华|奢华|现代|陈旧|老旧|破旧|残破|高端|高级|复古|阴暗|明亮|干净|凌乱|宽敞|狭窄|未来感|futuristic|modern|luxury|run[- ]?down|dilapidated|abandoned|vintage|old)\s*/i

export const LOCATION_SUBSPACE_SUFFIXES = [
  '走廊',
  '长廊',
  '大厅',
  '前台',
  '办公室',
  '病房',
  '病区',
  '手术室',
  '诊室',
  '急诊室',
  '候诊区',
  '会议室',
  '休息室',
  '楼梯间',
  '电梯间',
  '停车场',
  '天台',
  '仓库',
  '门厅',
  '通道',
  '后巷',
  '教室',
  '宿舍',
  '食堂',
  '实验室',
  '审讯室',
  '指挥室',
  '机房',
  '车间',
  '包厢',
  '吧台',
  '祠堂',
  '侧室',
  '偏厅',
  '厢房',
  '书房',
  '供桌',
  '祭台',
  '客厅',
  '卧室',
  '厨房',
  '浴室',
  '院子',
  '阳台',
  '庭院'
]

export const LOCATION_ANCHOR_KEYWORDS = [
  '医院',
  '诊所',
  '医务室',
  '警察局',
  '警局',
  '派出所',
  '学校',
  '校园',
  '大学',
  '中学',
  '小学',
  '公司',
  '写字楼',
  '工厂',
  '商场',
  '酒店',
  '旅馆',
  '餐厅',
  '咖啡馆',
  '酒吧',
  '公寓',
  '别墅',
  '老宅',
  '古宅',
  '宅院',
  '宅邸',
  '府邸',
  '府宅',
  '祠堂',
  '车站',
  '地铁站',
  '火车站',
  '机场',
  '码头',
  '港口',
  '法庭',
  '监狱',
  '图书馆'
]

export const LOCATION_ENGLISH_ANCHORS = [
  { keyword: 'hospital', root: 'hospital' },
  { keyword: 'clinic', root: 'clinic' },
  { keyword: 'police station', root: 'police station' },
  { keyword: 'school', root: 'school' },
  { keyword: 'campus', root: 'campus' },
  { keyword: 'office', root: 'office' },
  { keyword: 'factory', root: 'factory' },
  { keyword: 'mall', root: 'mall' },
  { keyword: 'hotel', root: 'hotel' },
  { keyword: 'restaurant', root: 'restaurant' },
  { keyword: 'apartment', root: 'apartment' },
  { keyword: 'station', root: 'station' },
  { keyword: 'airport', root: 'airport' },
  { keyword: 'port', root: 'port' },
  { keyword: 'court', root: 'court' },
  { keyword: 'prison', root: 'prison' },
  { keyword: 'library', root: 'library' }
]

const INTERIOR_VIEW_KEYWORDS = [
  '室内',
  '屋内',
  '屋里',
  '房内',
  '客厅',
  '卧室',
  '厨房',
  '浴室',
  '门厅',
  '大厅',
  '走廊',
  '办公室',
  '病房',
  '教室',
  '实验室'
]

const EXTERIOR_VIEW_KEYWORDS = [
  '室外',
  '屋外',
  '门外',
  '户外',
  '街头',
  '街道',
  '巷口',
  '院子',
  '庭院',
  '楼外',
  '外景',
  '露台',
  '天台',
  '公路'
]

const CROSS_SPACE_VIEW_KEYWORDS = [
  '门外',
  '门内',
  '窗外',
  '窗内',
  '透过门',
  '透过窗',
  '透过玻璃',
  '门缝',
  '窗口',
  '玻璃门',
  '玻璃窗',
  '室内灯光',
  '屋里',
  '屋内',
  '屋外',
  '室内',
  '室外',
  'inside',
  'outside',
  'through the window',
  'through the door',
  'visible interior',
  'visible exterior'
]

export type SceneSpatialViewpoint = 'interior' | 'exterior' | 'unknown'

export function stripLocationStylePrefix(value: string): string {
  let output = value.trim()
  while (LOCATION_STYLE_PREFIX_REGEX.test(output)) {
    output = output.replace(LOCATION_STYLE_PREFIX_REGEX, '').trim()
  }
  return output
}

export function resolveEnvironmentRootFromLocation(rawLocation?: string): string {
  if (!rawLocation) return ''

  let normalized = rawLocation
    .trim()
    .replace(/[（(][^()（）]{0,24}[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，,。.!！？；;]+$/g, '')
    .trim()

  if (!normalized) return ''

  const primary = normalized.split(/[，,。.;；/\\|｜>]+/)[0]?.trim() || normalized
  const compact = stripLocationStylePrefix(primary)

  for (const keyword of LOCATION_ANCHOR_KEYWORDS) {
    const index = compact.indexOf(keyword)
    if (index >= 0) {
      return compact.slice(0, index + keyword.length).trim()
    }
  }

  const compactLower = compact.toLowerCase()
  for (const anchor of LOCATION_ENGLISH_ANCHORS) {
    if (compactLower.includes(anchor.keyword)) {
      return anchor.root
    }
  }

  let candidate = primary.replace(/\s+/g, '')
  for (const suffix of LOCATION_SUBSPACE_SUFFIXES) {
    if (candidate.endsWith(suffix) && candidate.length > suffix.length) {
      candidate = candidate.slice(0, -suffix.length)
      break
    }
  }

  candidate = candidate.replace(/[-_/\\|｜>]+$/g, '').trim()
  return candidate || compact
}

export function resolveSceneEnvironmentRoot(scene: SceneData): string {
  const locationRoot = resolveEnvironmentRootFromLocation(scene.setting?.location)
  if (locationRoot) return locationRoot

  const titleRoot = resolveEnvironmentRootFromLocation(scene.title)
  if (titleRoot) return titleRoot

  return ''
}

function buildSceneSpatialText(scene: Pick<SceneData, 'title' | 'description' | 'setting'>): string {
  return [
    scene.setting?.location || '',
    scene.title || '',
    scene.description || ''
  ]
    .join(' ')
    .toLowerCase()
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()))
}

export function resolveSceneSpatialViewpoint(
  scene: Pick<SceneData, 'title' | 'description' | 'setting'>
): SceneSpatialViewpoint {
  const locationText = [scene.setting?.location || '', scene.title || '']
    .join(' ')
    .toLowerCase()
  const descriptionText = (scene.description || '').toLowerCase()

  const locationHasInterior = hasKeyword(locationText, INTERIOR_VIEW_KEYWORDS)
  const locationHasExterior = hasKeyword(locationText, EXTERIOR_VIEW_KEYWORDS)
  if (locationHasInterior && !locationHasExterior) return 'interior'
  if (locationHasExterior && !locationHasInterior) return 'exterior'

  const descriptionHasInterior = hasKeyword(descriptionText, INTERIOR_VIEW_KEYWORDS)
  const descriptionHasExterior = hasKeyword(descriptionText, EXTERIOR_VIEW_KEYWORDS)
  if (descriptionHasInterior && !descriptionHasExterior) return 'interior'
  if (descriptionHasExterior && !descriptionHasInterior) return 'exterior'

  return 'unknown'
}

export function sceneHasCrossSpaceViewCue(
  scene: Pick<SceneData, 'title' | 'description' | 'setting'>
): boolean {
  return hasKeyword(buildSceneSpatialText(scene), CROSS_SPACE_VIEW_KEYWORDS)
}

export function buildSceneEnvironmentCrossSpaceNote(
  scene: SceneData,
  scenes: SceneData[]
): string | undefined {
  const environmentRoot = resolveSceneEnvironmentRoot(scene)
  if (!environmentRoot) return undefined

  const relatedScenes = scenes.filter(item => resolveSceneEnvironmentRoot(item) === environmentRoot)
  if (relatedScenes.length <= 1) return undefined

  const currentLocation = scene.setting?.location?.trim() || scene.title?.trim() || scene.id
  const currentViewpoint = resolveSceneSpatialViewpoint(scene)
  const siblingLocations = uniqueSorted(
    relatedScenes
      .map(item => item.setting?.location?.trim() || item.title?.trim() || item.id)
      .filter(Boolean)
  )
    .filter(location => location !== currentLocation)
    .slice(0, 4)

  const oppositeViewLocations = uniqueSorted(
    relatedScenes
      .filter(item => item.id !== scene.id)
      .map((item) => {
        const viewpoint = resolveSceneSpatialViewpoint(item)
        if (currentViewpoint !== 'unknown' && viewpoint === currentViewpoint) return ''
        if (currentViewpoint === 'unknown' && viewpoint === 'unknown') return ''
        return item.setting?.location?.trim() || item.title?.trim() || item.id
      })
      .filter(Boolean)
  ).slice(0, 4)

  const crossSpaceTargets = oppositeViewLocations.length > 0 ? oppositeViewLocations : siblingLocations
  const hasCrossSpaceCue = sceneHasCrossSpaceViewCue(scene)

  if (!hasCrossSpaceCue && oppositeViewLocations.length === 0) return undefined
  if (crossSpaceTargets.length === 0) return undefined

  const continuityLead = currentViewpoint === 'exterior'
    ? '若外景镜头透过门窗看到室内'
    : currentViewpoint === 'interior'
      ? '若内景镜头透过门窗看到室外'
      : '若镜头透过门窗看到相邻空间'

  return [
    `同一主环境子空间：${[currentLocation, ...crossSpaceTargets].slice(0, 5).join('、')}`,
    `${continuityLead}，必须与对应子空间保持同一建筑结构、门窗朝向、灯光颜色、主色调和关键陈设`,
    '切到对应空间时，沿用已出现的布景，不得重置为另一套室内或室外设计'
  ].join('；')
}

export function buildSceneEnvironmentConsistencyContext(
  scene: SceneData,
  scenes: SceneData[]
): SceneEnvironmentConsistencyContext | undefined {
  const environmentRoot = resolveSceneEnvironmentRoot(scene)
  if (!environmentRoot) return undefined

  const relatedScenes = scenes.filter(item => resolveSceneEnvironmentRoot(item) === environmentRoot)
  const anchorScene = relatedScenes[0] || scene
  const siblingLocations = uniqueSorted(
    relatedScenes
      .map(item => item.setting?.location?.trim() || '')
      .filter(Boolean)
  ).slice(0, 8)

  return {
    environmentRoot,
    anchorSceneId: anchorScene.id,
    anchorSceneTitle: anchorScene.title?.trim() || anchorScene.id,
    anchorLocation: anchorScene.setting?.location?.trim() || undefined,
    anchorDescription: anchorScene.description?.trim() || undefined,
    siblingLocations: siblingLocations.length > 0 ? siblingLocations : undefined
  }
}

export function buildLegacySceneEnvironmentKey(scene: SceneData): string {
  const location = normalizeEnvironmentToken(scene.setting?.location)
  const timeOfDay = normalizeEnvironmentToken(resolveTimeOfDayText(scene.setting?.timeOfDay))
  const weather = normalizeEnvironmentToken(scene.setting?.weather)

  if (!location && !timeOfDay && !weather) return ''
  return `${location}||${timeOfDay}||${weather}`
}

export function buildExactSceneEnvironmentKey(scene: SceneData): string {
  const location = normalizeEnvironmentToken(scene.setting?.location)
  const timeOfDay = normalizeEnvironmentToken(resolveTimeOfDayText(scene.setting?.timeOfDay))

  if (!location && !timeOfDay) {
    return buildLegacySceneEnvironmentKey(scene)
  }

  return `${location}||${timeOfDay}`
}

export function buildSceneEnvironmentKey(scene: SceneData): string {
  const environmentRoot = normalizeEnvironmentToken(resolveSceneEnvironmentRoot(scene))
  const location = normalizeEnvironmentToken(scene.setting?.location)
  const timeOfDay = normalizeEnvironmentToken(resolveTimeOfDayText(scene.setting?.timeOfDay))

  if (environmentRoot || location || timeOfDay) {
    return `${environmentRoot || location}||${timeOfDay}`
  }

  return buildExactSceneEnvironmentKey(scene)
}

export function resolveSceneEnvironmentAssetKey(scene: SceneData): string {
  const structuredKey = buildSceneEnvironmentKey(scene)
  if (structuredKey) return structuredKey

  return `scene:${scene.id}`
}

export function resolveSceneEnvironmentAssetId(scene: SceneData): string {
  return `env:${resolveSceneEnvironmentAssetKey(scene)}`
}

export function resolveSceneEnvironmentAssetIdAliases(scene: SceneData): string[] {
  const aliases = new Set<string>([resolveSceneEnvironmentAssetId(scene)])
  const exactKey = buildExactSceneEnvironmentKey(scene)
  const legacyKey = buildLegacySceneEnvironmentKey(scene)

  if (exactKey) {
    aliases.add(`env:${exactKey}`)
  }
  if (legacyKey) {
    aliases.add(`env:${legacyKey}`)
  }

  return Array.from(aliases)
}

export function resolveSceneEnvironmentAssetLabel(scene: SceneData): string {
  const location = resolveSceneEnvironmentRoot(scene) || scene.setting?.location?.trim() || ''
  const timeOfDay = resolveTimeOfDayText(scene.setting?.timeOfDay)

  const parts = [location, timeOfDay].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')

  return resolveSceneEnvironmentLabel(scene)
}

export function resolveSceneEnvironmentLabel(scene: SceneData): string {
  const location = scene.setting?.location?.trim() || ''
  const timeOfDay = resolveTimeOfDayText(scene.setting?.timeOfDay)
  const weather = scene.setting?.weather?.trim() || ''
  const mood = scene.setting?.mood?.trim() || ''

  const parts = [location, timeOfDay, weather].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  if (mood) return mood
  if (scene.title?.trim()) return scene.title.trim()
  return `环境 ${scene.id.slice(-4)}`
}

export function findReusableEnvironmentImage(
  scene: SceneData,
  scenes: SceneData[]
): string | undefined {
  const targetKey = resolveSceneEnvironmentAssetKey(scene)
  if (!targetKey) return undefined

  for (const candidate of scenes) {
    if (candidate.id === scene.id) continue

    const key = resolveSceneEnvironmentAssetKey(candidate)
    if (key !== targetKey) continue

    const reference = resolveSceneReferenceImage(candidate)
    if (reference && candidate.referenceStatus === 'done') {
      return reference
    }
  }

  return undefined
}

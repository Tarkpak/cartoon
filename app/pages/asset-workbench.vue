<script setup lang="ts">
import {
  BookOpen,
  CheckCircle2,
  Download,
  Film,
  Layers3,
  Loader2,
  Merge,
  Pencil,
  RefreshCw,
  Split,
  Sparkles,
  Trash2,
  Upload,
  Users
} from 'lucide-vue-next'
import { useDebounceFn } from '@vueuse/core'
import type { CharacterData, SceneData } from '~/composables/useWorkbench'
import { toImageSrc } from '~/lib/media'
import { CHARACTER_REGENERATION_DEFAULT_PROMPT } from '#shared/constants/character-prompts'

// 资产一致性工作流页面
definePageMeta({
  layout: 'default'
})

type AssetTab = 'characters' | 'scenes' | 'props'
type ConsistencyLevel = 'lock' | 'soft'

type QueueStatus = 'pending' | 'running' | 'done' | 'error'
type AutoStageKey = 'parse' | 'assets' | 'videos' | 'final'
type AutoStageStatus = 'pending' | 'running' | 'done'

interface SceneConsistencyConfig {
  sceneId: string
  mustReferenceAssetIds: string[]
  consistencyLevel: ConsistencyLevel
  continuityNotes: string
}

interface PropAsset {
  id: string
  name: string
  description: string
}

interface AssetWorkflowMeta {
  version: number
  sceneConfigs: Record<string, SceneConsistencyConfig>
  props: PropAsset[]
}

interface QueueItem {
  sceneId: string
  status: QueueStatus
  error?: string
}

interface DisplayAsset {
  id: string
  name: string
  type: 'character' | 'environment' | 'prop'
  description?: string
  referenceImage?: string
}

interface EnvironmentAssetCard {
  id: string
  name: string
  description?: string
  referenceImage?: string
  sceneIds: string[]
  sceneTitles: string[]
  representativeSceneId: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
}

const route = useRoute()
const router = useRouter()
const { resolveStyleById, loadStylePresets } = useStylePresets()
void loadStylePresets()

const {
  projectId,
  projectName,
  projectDescription,
  projectStyleId,
  projectAspectRatio,
  projectAssetWorkflow,
  selectedStyleId,
  novelText,
  scenes,
  characters,
  parsing,
  saving,
  saveError,
  saveProject,
  loadProject,
  deleteScene,
  mergeWithNextScene,
  parseScript,
  splitScene,
  updateScene,
  generateCharacter,
  batchGenerateCharacters,
  mergeAllVideos,
  mergeStatus,
  finalVideo
} = useWorkbench()

function resolveSceneReferenceImage(scene: SceneData): string | undefined {
  return scene.firstFrame || scene.lastFrame
}

function normalizeEnvironmentToken(value?: string): string {
  return (value || '').trim().toLowerCase()
}

const LOCATION_STYLE_PREFIX_REGEX = /^(?:豪华|奢华|现代|陈旧|老旧|破旧|残破|高端|高级|复古|阴暗|明亮|干净|凌乱|宽敞|狭窄|未来感|futuristic|modern|luxury|run[- ]?down|dilapidated|abandoned|vintage|old)\s*/i
const LOCATION_SUBSPACE_SUFFIXES = [
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
  '客厅',
  '卧室',
  '厨房',
  '浴室',
  '阳台',
  '庭院'
]
const LOCATION_ANCHOR_KEYWORDS = [
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
const LOCATION_ENGLISH_ANCHORS = [
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

function stripLocationStylePrefix(value: string): string {
  let output = value.trim()
  while (LOCATION_STYLE_PREFIX_REGEX.test(output)) {
    output = output.replace(LOCATION_STYLE_PREFIX_REGEX, '').trim()
  }
  return output
}

function resolveEnvironmentRootFromLocation(rawLocation?: string): string {
  if (!rawLocation) return ''

  let normalized = rawLocation
    .trim()
    .replace(/[（(][^()（）]{0,24}[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，,。.!！？；;]+$/g, '')
    .trim()

  if (!normalized) return ''

  normalized = stripLocationStylePrefix(normalized)
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

  let candidate = compact.replace(/\s+/g, '')
  for (const suffix of LOCATION_SUBSPACE_SUFFIXES) {
    if (candidate.endsWith(suffix) && candidate.length > suffix.length) {
      candidate = candidate.slice(0, -suffix.length)
      break
    }
  }

  candidate = stripLocationStylePrefix(candidate)
  return candidate || compact
}

function resolveSceneEnvironmentRoot(scene: SceneData): string {
  const locationRoot = resolveEnvironmentRootFromLocation(scene.setting?.location)
  if (locationRoot) return locationRoot

  const titleRoot = resolveEnvironmentRootFromLocation(scene.title)
  if (titleRoot) return titleRoot

  return ''
}

function buildSceneEnvironmentConsistencyContext(scene: SceneData): {
  environmentRoot: string
  anchorSceneId?: string
  anchorSceneTitle?: string
  anchorLocation?: string
  anchorDescription?: string
  siblingLocations?: string[]
} | undefined {
  const environmentRoot = resolveSceneEnvironmentRoot(scene)
  if (!environmentRoot) return undefined

  const relatedScenes = scenes.value.filter(item => resolveSceneEnvironmentRoot(item) === environmentRoot)
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

function buildSceneEnvironmentKey(scene: SceneData): string {
  const location = normalizeEnvironmentToken(scene.setting?.location)
  const timeOfDay = normalizeEnvironmentToken(scene.setting?.timeOfDay)
  const weather = normalizeEnvironmentToken(scene.setting?.weather)

  if (!location && !timeOfDay && !weather) return ''
  return `${location}||${timeOfDay}||${weather}`
}

function resolveSceneEnvironmentAssetKey(scene: SceneData): string {
  const structuredKey = buildSceneEnvironmentKey(scene)
  if (structuredKey) return structuredKey

  return `scene:${scene.id}`
}

function resolveSceneEnvironmentAssetId(scene: SceneData): string {
  return `env:${resolveSceneEnvironmentAssetKey(scene)}`
}

function resolveSceneEnvironmentLabel(scene: SceneData): string {
  const location = scene.setting?.location?.trim() || ''
  const timeOfDay = scene.setting?.timeOfDay?.trim() || ''
  const weather = scene.setting?.weather?.trim() || ''
  const mood = scene.setting?.mood?.trim() || ''

  const parts = [location, timeOfDay, weather].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  if (mood) return mood
  if (scene.title?.trim()) return scene.title.trim()
  return `环境 ${scene.id.slice(-4)}`
}

function findReusableEnvironmentImage(scene: SceneData): string | undefined {
  const targetKey = resolveSceneEnvironmentAssetKey(scene)
  if (!targetKey) return undefined

  for (const candidate of scenes.value) {
    if (candidate.id === scene.id) continue
    const key = resolveSceneEnvironmentAssetKey(candidate)
    if (key !== targetKey) continue

    const reference = resolveSceneReferenceImage(candidate)
    if (reference && candidate.frameStatus === 'done') {
      return reference
    }
  }

  return undefined
}

const assetTab = ref<AssetTab>('characters')
const selectedSceneId = ref<string>('')

const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({})
const propAssets = ref<PropAsset[]>([])
const newPropName = ref('')
const newPropDescription = ref('')

const loadingWorkflowMeta = ref(false)
const savingWorkflowMeta = ref(false)
const workflowMetaReady = ref(false)
const hydratingWorkflowMeta = ref(false)
const workflowError = ref<string | null>(null)

const batchRunning = ref(false)
const queueItems = ref<QueueItem[]>([])
const autoRunning = ref(false)
const autoRunError = ref<string | null>(null)
const autoRunCurrentStage = ref<AutoStageKey | null>(null)
const activeAutoStage = ref<AutoStageKey>('parse')
const sceneEditDialogOpen = ref(false)
const editingScene = ref<SceneData | null>(null)
const imagePreviewOpen = ref(false)
const imagePreviewSrc = ref('')
const imagePreviewAlt = ref('')
const editingCharacterId = ref<string | null>(null)
const characterRegenerateDialogOpen = ref(false)
const characterRegenerateTargetId = ref<string | null>(null)
const characterRegeneratePrompt = ref(CHARACTER_REGENERATION_DEFAULT_PROMPT)
const characterRegenerateError = ref<string | null>(null)
const environmentRegenerateDialogOpen = ref(false)
const environmentRegenerateTargetId = ref<string | null>(null)
const environmentRegeneratePrompt = ref('')
const environmentRegenerateError = ref<string | null>(null)
const uploadingCharacterId = ref<string | null>(null)
const uploadingEnvironmentAssetId = ref<string | null>(null)
const characterEditDraft = reactive({
  id: '',
  name: '',
  appearance: '',
  role: 'supporting'
})

watch(characterRegenerateDialogOpen, (open) => {
  if (open) return
  characterRegenerateTargetId.value = null
  characterRegenerateError.value = null
})

watch(environmentRegenerateDialogOpen, (open) => {
  if (open) return
  environmentRegenerateTargetId.value = null
  environmentRegenerateError.value = null
})

const selectedScene = computed<SceneData | null>(() => {
  if (scenes.value.length === 0) return null

  const matched = scenes.value.find(scene => scene.id === selectedSceneId.value)
  if (matched) return matched

  return scenes.value[0] || null
})

const characterRegenerateTarget = computed(() => {
  if (!characterRegenerateTargetId.value) return null
  return characters.value.find(char => char.id === characterRegenerateTargetId.value) || null
})

const environmentRegenerateTarget = computed(() => {
  if (!environmentRegenerateTargetId.value) return null
  return environmentAssetCards.value.find(asset => asset.id === environmentRegenerateTargetId.value) || null
})

const characterAssets = computed<DisplayAsset[]>(() => {
  return characters.value.map(char => ({
    id: `char:${char.id}`,
    name: char.name,
    type: 'character' as const,
    description: char.appearance,
    referenceImage: char.baseImage
  }))
})

const environmentAssetCards = computed<EnvironmentAssetCard[]>(() => {
  const map = new Map<string, EnvironmentAssetCard>()

  for (const scene of scenes.value) {
    const assetId = resolveSceneEnvironmentAssetId(scene)
    const existing = map.get(assetId)
    const sceneImage = resolveSceneReferenceImage(scene)

    if (!existing) {
      map.set(assetId, {
        id: assetId,
        name: resolveSceneEnvironmentLabel(scene),
        description: scene.setting?.mood?.trim() || scene.description?.trim() || undefined,
        referenceImage: sceneImage,
        sceneIds: [scene.id],
        sceneTitles: [scene.title || scene.id],
        representativeSceneId: scene.id,
        frameStatus: scene.frameStatus
      })
      continue
    }

    existing.sceneIds.push(scene.id)
    existing.sceneTitles.push(scene.title || scene.id)

    if (!existing.referenceImage && sceneImage) {
      existing.referenceImage = sceneImage
      existing.representativeSceneId = scene.id
    }

    if (existing.frameStatus !== 'generating' && scene.frameStatus === 'generating') {
      existing.frameStatus = 'generating'
    } else if (
      existing.frameStatus !== 'generating'
      && existing.frameStatus !== 'done'
      && scene.frameStatus === 'done'
    ) {
      existing.frameStatus = 'done'
    } else if (existing.frameStatus === 'pending' && scene.frameStatus === 'error') {
      existing.frameStatus = 'error'
    }
  }

  return Array.from(map.values())
})

const environmentAssets = computed<DisplayAsset[]>(() => {
  return environmentAssetCards.value.map(asset => ({
    id: asset.id,
    name: asset.name,
    type: 'environment' as const,
    description: asset.description,
    referenceImage: asset.referenceImage
  }))
})

const propDisplayAssets = computed<DisplayAsset[]>(() => {
  return propAssets.value.map(prop => ({
    id: `prop:${prop.id}`,
    name: prop.name,
    type: 'prop' as const,
    description: prop.description
  }))
})

const allAssets = computed<DisplayAsset[]>(() => {
  return [
    ...characterAssets.value,
    ...environmentAssets.value,
    ...propDisplayAssets.value
  ]
})

const queueSummary = computed(() => {
  const total = queueItems.value.length
  const running = queueItems.value.filter(item => item.status === 'running').length
  const done = queueItems.value.filter(item => item.status === 'done').length
  const error = queueItems.value.filter(item => item.status === 'error').length

  return { total, running, done, error }
})

const assetsReady = computed(() => {
  if (characters.value.length === 0) return true
  return characters.value.every(character => !!character.baseImage)
})

const characterReadyCount = computed(() => {
  return characters.value.filter(char => !!char.baseImage).length
})

const characterGeneratingCount = computed(() => {
  return characters.value.filter(char => !!char.generating).length
})

const characterMissingCount = computed(() => {
  return Math.max(
    characters.value.length - characterReadyCount.value - characterGeneratingCount.value,
    0
  )
})

const assetsAllReady = computed(() => {
  if (characters.value.length === 0) return true
  return characterMissingCount.value === 0 && characterGeneratingCount.value === 0
})

const assetsPrimaryActionLabel = computed(() => {
  return assetsAllReady.value ? '检查资产状态' : '自动补齐缺失资产'
})

const workflowStylePrompt = computed(() => {
  const styleId = selectedStyleId.value || projectStyleId.value
  if (!styleId) return ''

  const style = resolveStyleById(styleId)
  if (!style) return styleId

  return `${style.name}, ${style.prompt} style`
})

function resolveAutoStageStatus(
  key: AutoStageKey,
  done: boolean
): AutoStageStatus {
  if (done) return 'done'
  if (autoRunning.value && autoRunCurrentStage.value === key) return 'running'
  return 'pending'
}

const autoStages = computed(() => {
  const parseDone = scenes.value.length > 0
  const videosDone = queueSummary.value.total > 0
    && queueSummary.value.done === queueSummary.value.total

  return [
    {
      key: 'parse' as const,
      label: '剧本解析',
      detail: parseDone ? `已拆解 ${scenes.value.length} 个场景` : '等待输入剧本',
      status: resolveAutoStageStatus('parse', parseDone)
    },
    {
      key: 'assets' as const,
      label: '资产准备',
      detail: characters.value.length === 0
        ? '自动按场景补齐角色'
        : `角色图 ${characters.value.filter(char => !!char.baseImage).length}/${characters.value.length}`,
      status: resolveAutoStageStatus('assets', parseDone && assetsReady.value)
    },
    {
      key: 'videos' as const,
      label: '场景视频',
      detail: queueSummary.value.total > 0
        ? `已完成 ${queueSummary.value.done}/${queueSummary.value.total}`
        : '等待开始生成',
      status: resolveAutoStageStatus('videos', videosDone)
    },
    {
      key: 'final' as const,
      label: '最终成片',
      detail: finalVideo.value?.videoData ? '已可下载' : '可选：自动合成',
      status: resolveAutoStageStatus('final', !!finalVideo.value?.videoData)
    }
  ]
})

function inferActiveAutoStage(): AutoStageKey {
  if (scenes.value.length === 0) return 'parse'
  if (!assetsReady.value) return 'assets'
  if (queueSummary.value.total === 0 || queueSummary.value.done < queueSummary.value.total) return 'videos'
  return 'final'
}

function selectAutoStage(stage: AutoStageKey) {
  activeAutoStage.value = stage
}

const debouncedSaveWorkflowMeta = useDebounceFn(() => {
  void saveWorkflowMeta()
}, 700)

const NARRATION_SPEAKERS = [
  '旁白',
  'narration',
  'voiceover',
  '画外音',
  'os',
  'vo',
  '内心独白'
]

interface SceneCharacterCandidate {
  primaryName: string
  aliases: string[]
  appearance?: string
}

function normalizeToken(value?: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s\u3000]/g, '')
    .replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, '')
}

function resolveCharacterRoleLabel(role?: string): string {
  if (role === 'protagonist') return '主角'
  if (role === 'antagonist') return '反派'
  if (role === 'supporting') return '配角'
  if (role === 'extra') return '群演'
  return role || '角色'
}

function resolveCharacterSceneCount(character: CharacterData): number {
  const target = normalizeToken(character.name)
  if (!target) return 0

  return scenes.value.filter((scene) => {
    return scene.characters.some((sceneCharacter) => {
      const candidate = normalizeToken(sceneCharacter.name)
      if (!candidate) return false
      return candidate === target || candidate.includes(target) || target.includes(candidate)
    })
  }).length
}

const characterRoleOptions = [
  { value: 'protagonist', label: '主角' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '配角' },
  { value: 'extra', label: '群演' }
]

const MAX_ASSET_UPLOAD_SIZE = 20 * 1024 * 1024

function hashForDomId(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function buildUploadInputId(type: 'char' | 'env', rawId: string): string {
  const normalized = rawId
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const suffix = hashForDomId(rawId)
  return `${type}_upload_${normalized || 'asset'}_${suffix}`
}

function triggerUploadInput(type: 'char' | 'env', rawId: string) {
  if (typeof document === 'undefined') return
  const inputId = buildUploadInputId(type, rawId)
  const input = document.getElementById(inputId) as HTMLInputElement | null
  input?.click()
}

function resetFileInput(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (input) {
    input.value = ''
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('读取图片文件失败，请重试'))
    }
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        reject(new Error('仅支持图片文件上传'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

async function uploadAssetImage(source: string, prefix: string): Promise<string> {
  const response = await $fetch<{
    success: boolean
    imageUrl?: string
  }>('/api/asset-workflow/upload-image', {
    method: 'POST',
    body: {
      imageData: source,
      prefix
    }
  })

  if (!response.success || !response.imageUrl) {
    throw new Error('图片上传失败，请稍后重试')
  }

  return response.imageUrl
}

async function handleCharacterImageUpload(characterId: string, event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) {
    resetFileInput(event)
    return
  }

  if (!file.type.startsWith('image/')) {
    resetFileInput(event)
    autoRunError.value = '仅支持上传图片文件'
    return
  }

  if (file.size > MAX_ASSET_UPLOAD_SIZE) {
    resetFileInput(event)
    autoRunError.value = '图片大小不能超过 20MB'
    return
  }

  const target = characters.value.find(char => char.id === characterId)
  if (!target) {
    resetFileInput(event)
    return
  }

  uploadingCharacterId.value = characterId
  autoRunError.value = null

  try {
    const dataUrl = await fileToDataUrl(file)
    const imageUrl = await uploadAssetImage(dataUrl, `char_${target.id}`)
    target.baseImage = imageUrl
    await saveProject()
  } catch (error) {
    autoRunError.value = resolveUiError(error, '角色图片上传失败')
  } finally {
    uploadingCharacterId.value = null
    resetFileInput(event)
  }
}

async function handleEnvironmentImageUpload(assetId: string, event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) {
    resetFileInput(event)
    return
  }

  if (!file.type.startsWith('image/')) {
    resetFileInput(event)
    autoRunError.value = '仅支持上传图片文件'
    return
  }

  if (file.size > MAX_ASSET_UPLOAD_SIZE) {
    resetFileInput(event)
    autoRunError.value = '图片大小不能超过 20MB'
    return
  }

  const asset = resolveEnvironmentCard(assetId)
  if (!asset) {
    resetFileInput(event)
    return
  }

  uploadingEnvironmentAssetId.value = assetId
  autoRunError.value = null

  try {
    const dataUrl = await fileToDataUrl(file)
    const imageUrl = await uploadAssetImage(dataUrl, `env_${asset.sceneIds[0] || assetId}`)

    for (const sceneId of asset.sceneIds) {
      const scene = scenes.value.find(item => item.id === sceneId)
      if (!scene) continue

      scene.firstFrame = imageUrl
      scene.lastFrame = undefined
      scene.frameStatus = 'done'
      scene.frameError = undefined
      scene.videoUrl = undefined
      scene.videoStatus = 'pending'
      scene.videoError = undefined
    }

    synchronizeQueueItems()
    await saveProject()
  } catch (error) {
    autoRunError.value = resolveUiError(error, '环境图片上传失败')
  } finally {
    uploadingEnvironmentAssetId.value = null
    resetFileInput(event)
  }
}

function resolvePropUsageCount(propId: string): number {
  const targetAssetId = `prop:${propId}`
  return scenes.value.filter((scene) => {
    const refs = sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
    return refs.includes(targetAssetId)
  }).length
}

function openImagePreview(imageData: string | undefined, alt = '图片预览') {
  const src = toImageSrc(imageData)
  if (!src) return
  imagePreviewSrc.value = src
  imagePreviewAlt.value = alt
  imagePreviewOpen.value = true
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function startEditCharacter(char: CharacterData) {
  editingCharacterId.value = char.id
  characterEditDraft.id = char.id
  characterEditDraft.name = char.name
  characterEditDraft.appearance = char.appearance || ''
  characterEditDraft.role = char.role || 'supporting'
}

function cancelEditCharacter() {
  editingCharacterId.value = null
  characterEditDraft.id = ''
  characterEditDraft.name = ''
  characterEditDraft.appearance = ''
  characterEditDraft.role = 'supporting'
}

function synchronizeCharacterNameInScenes(oldName: string, nextName: string) {
  if (!oldName || !nextName || oldName === nextName) return

  for (const scene of scenes.value) {
    for (const char of scene.characters) {
      if (char.name === oldName) {
        char.name = nextName
      }
    }

    for (const dialogue of scene.dialogues) {
      if (dialogue.character === oldName) {
        dialogue.character = nextName
      }
    }
  }
}

async function saveCharacterEdit(options: { regenerate?: boolean } = {}) {
  if (!editingCharacterId.value) return

  const target = characters.value.find(char => char.id === editingCharacterId.value)
  if (!target) {
    cancelEditCharacter()
    return
  }

  const nextName = characterEditDraft.name.trim()
  if (!nextName) {
    alert('角色名称不能为空')
    return
  }

  const oldName = target.name
  target.name = nextName
  target.appearance = characterEditDraft.appearance.trim()
  target.role = characterEditDraft.role || 'supporting'

  synchronizeCharacterNameInScenes(oldName, target.name)

  await saveProject()
  cancelEditCharacter()

  if (options.regenerate) {
    await handleGenerateCharacter(target.id)
  }
}

function normalizeWorkflowText(value: string): string {
  return value
    .replace(/首尾帧/g, '环境图')
    .replace(/首帧/g, '环境图')
    .replace(/尾帧/g, '环境图')
}

function resolveUiError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  return normalizeWorkflowText(message || fallback)
}

function normalizeVideoUrlFromTask(videoData?: string | null): string | undefined {
  const raw = videoData?.trim()
  if (!raw) return undefined

  if (raw.startsWith('url:')) {
    return normalizeVideoUrlFromTask(raw.slice(4))
  }

  if (raw.startsWith('/videos/')) {
    const filename = raw.slice('/videos/'.length)
    return filename ? `/api/video/file/${filename}` : undefined
  }

  if (
    raw.startsWith('/api/video/file/')
    || raw.startsWith('http://')
    || raw.startsWith('https://')
    || raw.startsWith('data:video')
    || raw.startsWith('/')
  ) {
    return raw
  }

  if (raw.startsWith('ref:')) return undefined

  return `data:video/mp4;base64,${raw}`
}

function collectSceneCharacterReferenceImages(scene: SceneData): string[] {
  const { refs } = resolveCharacterRefsFromScene(scene)
  const images: string[] = []
  const seen = new Set<string>()

  for (const ref of refs) {
    const characterId = ref.replace('char:', '')
    const matched = characters.value.find(character => character.id === characterId)
    const image = matched?.baseImage?.trim()
    if (image && !seen.has(image)) {
      seen.add(image)
      images.push(image)
    }
  }

  return images
}

function findCharacterByAssetRefId(rawCharacterId: string): CharacterData | undefined {
  return characters.value.find(character => character.id === rawCharacterId)
    || characters.value.find(character => character.id.endsWith(`_${rawCharacterId}`))
}

function resolveConfiguredCharacterReferences(scene: SceneData): CharacterData[] {
  const config = sceneConfigs.value[scene.id]
  if (!config) return []

  const characterIds = uniqueSorted(
    config.mustReferenceAssetIds
      .filter(assetId => assetId.startsWith('char:'))
      .map(assetId => assetId.slice('char:'.length))
      .filter(Boolean)
  )

  return characterIds
    .map(characterId => findCharacterByAssetRefId(characterId))
    .filter((character): character is CharacterData => !!character)
}

function resolveSceneVideoCharacterReferences(scene: SceneData): string[] {
  const images: string[] = []
  const seen = new Set<string>()

  const pushImage = (raw?: string) => {
    const image = raw?.trim()
    if (!image || seen.has(image)) return
    seen.add(image)
    images.push(image)
  }

  const configuredRefs = resolveConfiguredCharacterReferences(scene)
  for (const character of configuredRefs) {
    pushImage(character.baseImage)
  }

  const fallbackRefs = collectSceneCharacterReferenceImages(scene)
  for (const image of fallbackRefs) {
    pushImage(image)
  }

  return images
}

async function ensureSceneReferencedAssetsReady(scene: SceneData): Promise<void> {
  const config = ensureSceneConfig(scene.id)

  const referencedCharacters = resolveConfiguredCharacterReferences(scene)
  for (const character of referencedCharacters) {
    if (character.baseImage?.trim()) continue

    try {
      await generateCharacter(character, {
        workflowType: 'asset_consistency'
      })
    } catch (error) {
      const message = resolveUiError(error, `${character.name} 角色图生成失败`)
      throw new Error(`引用角色资产未就绪：${message}`)
    }

    if (!character.baseImage?.trim()) {
      throw new Error(`引用角色资产未就绪：${character.name}`)
    }
  }

  const referencedEnvironmentIds = uniqueSorted(
    config.mustReferenceAssetIds
      .filter(assetId => assetId.startsWith('env:'))
  )

  for (const environmentId of referencedEnvironmentIds) {
    const relatedScenes = scenes.value.filter(item => resolveSceneEnvironmentAssetId(item) === environmentId)
    if (relatedScenes.length === 0) continue

    const readyScene = relatedScenes.find((item) => {
      return !!resolveSceneReferenceImage(item) && item.frameStatus === 'done'
    })
    if (readyScene) continue

    const fallbackScene = relatedScenes.find((item) => {
      return item.frameStatus !== 'generating' && item.videoStatus !== 'generating'
    }) || relatedScenes[0]
    if (!fallbackScene) continue

    await generateSceneBaseline(fallbackScene.id, { preferReuse: true })

    if (fallbackScene.frameStatus === 'error') {
      throw new Error(normalizeWorkflowText(fallbackScene.frameError || `引用环境「${resolveSceneEnvironmentLabel(fallbackScene)}」生成失败`))
    }

    if (!resolveSceneReferenceImage(fallbackScene)) {
      throw new Error(`引用环境资产未就绪：${resolveSceneEnvironmentLabel(fallbackScene)}`)
    }
  }

  // 兼容旧数据：仍识别 scene:* 引用
  const referencedSceneIds = uniqueSorted(
    config.mustReferenceAssetIds
      .filter(assetId => assetId.startsWith('scene:'))
      .map(assetId => assetId.slice('scene:'.length))
      .filter(sceneId => !!sceneId && sceneId !== scene.id)
  )

  for (const referencedSceneId of referencedSceneIds) {
    const referencedScene = scenes.value.find(item => item.id === referencedSceneId)
    if (!referencedScene) continue

    const referenceImage = resolveSceneReferenceImage(referencedScene)
    if (referenceImage && referencedScene.frameStatus === 'done') continue

    await generateSceneBaseline(referencedSceneId, { preferReuse: true })

    if (referencedScene.frameStatus === 'error') {
      throw new Error(normalizeWorkflowText(referencedScene.frameError || `引用场景「${referencedScene.title}」环境图生成失败`))
    }

    if (!resolveSceneReferenceImage(referencedScene)) {
      throw new Error(`引用场景资产未就绪：${referencedScene.title}`)
    }
  }
}

function buildSceneGenerationCameraNote(scene: SceneData): string | undefined {
  const baseNote = scene.cameraNote?.trim() || ''
  const config = ensureSceneConfig(scene.id)
  const refNames = config.mustReferenceAssetIds.map(resolveAssetName).filter(Boolean)
  const continuityNote = config.continuityNotes.trim()

  const parts = [
    baseNote,
    refNames.length > 0 ? `引用资产：${refNames.join('、')}` : '',
    continuityNote ? `连续性提示：${continuityNote}` : ''
  ].filter(Boolean)

  return parts.length > 0 ? parts.join('\n') : undefined
}

function buildAssetWorkflowScenePayload(scene: SceneData) {
  const sceneIndex = scenes.value.findIndex(item => item.id === scene.id)

  return {
    id: scene.id,
    title: scene.title,
    sceneIndex: sceneIndex >= 0 ? sceneIndex + 1 : undefined,
    description: scene.description,
    cameraNote: buildSceneGenerationCameraNote(scene),
    duration: scene.duration,
    setting: scene.setting,
    narration: scene.narration,
    characters: scene.characters,
    dialogues: scene.dialogues
  }
}

async function pollAssetWorkflowVideoStatus(scene: SceneData, taskId: string) {
  const maxAttempts = 60
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000))

    const statusResponse = await $fetch<{
      success: boolean
      task: {
        status: string
        error?: string
        result?: {
          videoData?: string
        }
      }
    }>(`/api/video/status/${taskId}`)

    if (statusResponse.task.status === 'completed') {
      const normalizedUrl = normalizeVideoUrlFromTask(statusResponse.task.result?.videoData)
      if (!normalizedUrl) {
        scene.videoError = '视频已生成，但当前返回结果无法直接预览'
        scene.videoStatus = 'error'
        throw new Error(scene.videoError)
      }

      scene.videoUrl = normalizedUrl
      scene.videoError = undefined
      scene.videoStatus = 'done'
      await saveProject()
      return
    }

    if (statusResponse.task.status === 'failed') {
      scene.videoError = statusResponse.task.error || '视频生成失败'
      scene.videoStatus = 'error'
      throw new Error(scene.videoError)
    }
  }

  scene.videoError = '视频生成超时，请稍后重试'
  scene.videoStatus = 'error'
  throw new Error(scene.videoError)
}

function isNarrationSpeaker(name: string): boolean {
  const normalized = normalizeToken(name)
  if (!normalized) return true

  return NARRATION_SPEAKERS.some(speaker => normalizeToken(speaker) === normalized)
}

function splitCandidateNames(rawName?: string): string[] {
  if (!rawName) return []

  return uniqueSorted(
    rawName
      .split(/[/／|｜、,，\s]+/g)
      .map(name => name.trim())
      .filter(Boolean)
  )
}

function createSceneCharacterCandidate(
  rawName?: string,
  appearance?: string
): SceneCharacterCandidate | null {
  const aliases = splitCandidateNames(rawName).filter(name => !isNarrationSpeaker(name))
  if (aliases.length === 0) return null

  return {
    primaryName: aliases[0] || rawName || '未命名角色',
    aliases,
    appearance: appearance?.trim() || undefined
  }
}

function findCharacterByNameLike(name: string): CharacterData | undefined {
  const normalized = normalizeToken(name)
  if (!normalized) return undefined

  let fuzzyMatch: CharacterData | undefined
  for (const character of characters.value) {
    const target = normalizeToken(character.name)
    if (!target) continue

    if (target === normalized) {
      return character
    }

    if (!fuzzyMatch && (target.includes(normalized) || normalized.includes(target))) {
      fuzzyMatch = character
    }
  }

  return fuzzyMatch
}

function collectSceneCharacterCandidates(scene: SceneData): SceneCharacterCandidate[] {
  const map = new Map<string, SceneCharacterCandidate>()

  for (const sceneCharacter of scene.characters) {
    const candidate = createSceneCharacterCandidate(sceneCharacter.name, sceneCharacter.appearance)
    if (!candidate) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key) continue

    const existing = map.get(key)
    if (existing) {
      const mergedAliases = uniqueSorted([...existing.aliases, ...candidate.aliases])
      existing.aliases = mergedAliases
      if (!existing.appearance && candidate.appearance) {
        existing.appearance = candidate.appearance
      }
      continue
    }

    map.set(key, candidate)
  }

  for (const dialogue of scene.dialogues) {
    const candidate = createSceneCharacterCandidate(dialogue.character)
    if (!candidate) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key || map.has(key)) continue
    map.set(key, candidate)
  }

  return Array.from(map.values())
}

function getSceneText(scene: SceneData): string {
  return [
    scene.title || '',
    scene.description || '',
    scene.narration || '',
    scene.dialogues.map(item => `${item.character}:${item.text}`).join('\n')
  ]
    .join('\n')
    .toLowerCase()
}

function getValidAssetIdSet(): Set<string> {
  return new Set([
    ...characters.value.map(character => `char:${character.id}`),
    ...environmentAssets.value.map(asset => asset.id),
    ...propAssets.value.map(prop => `prop:${prop.id}`)
  ])
}

function resolveCharacterRefsFromScene(scene: SceneData): {
  refs: string[]
  matchedCharacterNames: string[]
} {
  const refs = new Set<string>()
  const matchedCharacterNames = new Set<string>()

  const candidates = collectSceneCharacterCandidates(scene)
  for (const candidate of candidates) {
    let matched: CharacterData | undefined

    for (const alias of candidate.aliases) {
      matched = findCharacterByNameLike(alias)
      if (matched) break
    }

    if (!matched) {
      matched = findCharacterByNameLike(candidate.primaryName)
    }

    if (!matched) continue

    refs.add(`char:${matched.id}`)
    matchedCharacterNames.add(matched.name)
  }

  return {
    refs: Array.from(refs),
    matchedCharacterNames: Array.from(matchedCharacterNames)
  }
}

function resolvePropRefsFromScene(scene: SceneData): string[] {
  if (propAssets.value.length === 0) return []

  const sceneText = getSceneText(scene)
  return propAssets.value
    .filter((prop) => {
      const name = prop.name.trim().toLowerCase()
      if (name.length < 2) return false
      return sceneText.includes(name)
    })
    .map(prop => `prop:${prop.id}`)
}

function sceneHasSameLocation(currentScene: SceneData, previousScene?: SceneData): boolean {
  if (!previousScene) return false
  const current = normalizeToken(currentScene.setting?.location)
  const previous = normalizeToken(previousScene.setting?.location)
  return !!current && current === previous
}

function buildContinuityNotes(
  scene: SceneData,
  index: number,
  currentCharacterNames: string[]
): string {
  const previous = index > 0 ? scenes.value[index - 1] : undefined
  const notes: string[] = []

  if (previous) {
    const previousCharacters = new Set(
      resolveCharacterRefsFromScene(previous).matchedCharacterNames.map(name => normalizeToken(name))
    )

    const sharedCharacters = currentCharacterNames.filter((name) => {
      const normalized = normalizeToken(name)
      return !!normalized && previousCharacters.has(normalized)
    })

    if (sharedCharacters.length > 0) {
      notes.push(`延续角色状态：${sharedCharacters.join('、')}`)
    }

    if (sceneHasSameLocation(scene, previous)) {
      notes.push(`地点延续：${scene.setting?.location || '同场景'}`)
    } else if (scene.setting?.location && previous.setting?.location) {
      notes.push(`地点切换：${previous.setting.location} -> ${scene.setting.location}`)
    }

    if (scene.setting?.timeOfDay && previous.setting?.timeOfDay && scene.setting.timeOfDay !== previous.setting.timeOfDay) {
      notes.push(`时间切换：${previous.setting.timeOfDay} -> ${scene.setting.timeOfDay}`)
    }
  }

  if (notes.length === 0) {
    notes.push('保持角色外观与场景主视觉连续')
  }

  return notes.join('；')
}

function buildAutoSceneConfig(scene: SceneData, index: number): SceneConsistencyConfig {
  const refs = new Set<string>([resolveSceneEnvironmentAssetId(scene)])

  const { refs: characterRefs, matchedCharacterNames } = resolveCharacterRefsFromScene(scene)
  for (const ref of characterRefs) refs.add(ref)

  const propRefs = resolvePropRefsFromScene(scene)
  for (const ref of propRefs) refs.add(ref)

  const previous = index > 0 ? scenes.value[index - 1] : undefined
  if (previous && sceneHasSameLocation(scene, previous)) {
    refs.add(resolveSceneEnvironmentAssetId(previous))
  }

  return {
    sceneId: scene.id,
    mustReferenceAssetIds: uniqueSorted(Array.from(refs)),
    consistencyLevel: characterRefs.length > 0 ? 'lock' : 'soft',
    continuityNotes: buildContinuityNotes(scene, index, matchedCharacterNames)
  }
}

function upsertCharactersFromScenes(): boolean {
  let changed = false

  for (const scene of scenes.value) {
    for (const candidate of collectSceneCharacterCandidates(scene)) {
      let matched: CharacterData | undefined
      for (const alias of candidate.aliases) {
        matched = findCharacterByNameLike(alias)
        if (matched) break
      }

      if (matched) {
        if (!matched.appearance && candidate.appearance) {
          matched.appearance = candidate.appearance
          changed = true
        }
        continue
      }

      characters.value.push({
        id: `char_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: candidate.primaryName,
        appearance: candidate.appearance || `${candidate.primaryName}，保持与剧情设定一致`,
        role: characters.value.length === 0 ? 'protagonist' : 'supporting',
        generating: false,
        generatingViews: false
      })
      changed = true
    }
  }

  return changed
}

function areSceneConfigsEqual(
  left: SceneConsistencyConfig,
  right: SceneConsistencyConfig
): boolean {
  return left.sceneId === right.sceneId
    && left.consistencyLevel === right.consistencyLevel
    && left.continuityNotes.trim() === right.continuityNotes.trim()
    && left.mustReferenceAssetIds.join('||') === right.mustReferenceAssetIds.join('||')
}

function applyAutomaticAssetPlan(
  options: { overwriteExistingConfigs?: boolean } = {}
): { characterChanged: boolean, configChanged: boolean } {
  const characterChanged = upsertCharactersFromScenes()
  const validAssetIds = getValidAssetIdSet()
  const nextConfigs: Record<string, SceneConsistencyConfig> = {}
  let configChanged = false

  for (let index = 0; index < scenes.value.length; index++) {
    const scene = scenes.value[index]
    if (!scene) continue

    const autoConfig = buildAutoSceneConfig(scene, index)
    const existing = sceneConfigs.value[scene.id]

    const baseConfig: SceneConsistencyConfig = !existing || options.overwriteExistingConfigs
      ? autoConfig
      : {
          sceneId: scene.id,
          mustReferenceAssetIds: uniqueSorted([
            ...existing.mustReferenceAssetIds,
            ...autoConfig.mustReferenceAssetIds
          ]),
          consistencyLevel: existing.consistencyLevel === 'lock' || autoConfig.consistencyLevel === 'lock' ? 'lock' : 'soft',
          continuityNotes: existing.continuityNotes.trim() || autoConfig.continuityNotes
        }

    const normalizedConfig: SceneConsistencyConfig = {
      sceneId: baseConfig.sceneId,
      mustReferenceAssetIds: baseConfig.mustReferenceAssetIds.filter(assetId => validAssetIds.has(assetId)),
      consistencyLevel: baseConfig.consistencyLevel,
      continuityNotes: baseConfig.continuityNotes.trim()
    }

    if (
      normalizedConfig.consistencyLevel === 'lock'
      && normalizedConfig.mustReferenceAssetIds.length === 0
    ) {
      normalizedConfig.consistencyLevel = 'soft'
    }

    nextConfigs[scene.id] = normalizedConfig
    if (!existing || !areSceneConfigsEqual(existing, normalizedConfig)) {
      configChanged = true
    }
  }

  if (Object.keys(sceneConfigs.value).length !== Object.keys(nextConfigs).length) {
    configChanged = true
  }

  if (configChanged) {
    sceneConfigs.value = nextConfigs
    synchronizeQueueItems()
  }

  return { characterChanged, configChanged }
}

watch(
  () => scenes.value.map(scene => scene.id),
  () => {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
  },
  { immediate: true }
)

watch(
  [sceneConfigs, propAssets],
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    debouncedSaveWorkflowMeta()
  },
  { deep: true }
)

watch(selectedScene, (scene) => {
  if (!scene) {
    selectedSceneId.value = ''
    return
  }

  if (!selectedSceneId.value) {
    selectedSceneId.value = scene.id
  }
})

function synchronizeSceneConfigs() {
  const nextConfigs: Record<string, SceneConsistencyConfig> = {}

  for (const scene of scenes.value) {
    nextConfigs[scene.id] = sceneConfigs.value[scene.id] || {
      sceneId: scene.id,
      mustReferenceAssetIds: [],
      consistencyLevel: 'lock',
      continuityNotes: ''
    }
  }

  sceneConfigs.value = nextConfigs

  if (!selectedSceneId.value && scenes.value.length > 0) {
    selectedSceneId.value = scenes.value[0]?.id || ''
  }

  if (selectedSceneId.value && !sceneConfigs.value[selectedSceneId.value] && scenes.value.length > 0) {
    selectedSceneId.value = scenes.value[0]?.id || ''
  }
}

function ensureSceneConfig(sceneId: string): SceneConsistencyConfig {
  if (!sceneConfigs.value[sceneId]) {
    sceneConfigs.value[sceneId] = {
      sceneId,
      mustReferenceAssetIds: [],
      consistencyLevel: 'lock',
      continuityNotes: ''
    }
  }
  return sceneConfigs.value[sceneId]!
}

function synchronizeQueueItems() {
  const previousMap = new Map(queueItems.value.map(item => [item.sceneId, item]))

  queueItems.value = scenes.value.map((scene) => {
    const previous = previousMap.get(scene.id)
    if (!previous) {
      return {
        sceneId: scene.id,
        status: scene.videoStatus === 'done' ? 'done' : 'pending'
      }
    }

    if (scene.videoStatus === 'done') {
      return { ...previous, status: 'done', error: undefined }
    }

    if (previous.status === 'done') {
      return { ...previous, status: 'pending', error: undefined }
    }

    return previous
  })
}

function resolveAssetName(assetId: string): string {
  const asset = allAssets.value.find(item => item.id === assetId)
  if (asset?.name) return asset.name

  if (assetId.startsWith('char:')) {
    const rawCharacterId = assetId.slice('char:'.length)
    const matched = findCharacterByAssetRefId(rawCharacterId)
    return matched?.name || '角色'
  }
  if (assetId.startsWith('env:') || assetId.startsWith('scene:')) return '环境'
  if (assetId.startsWith('prop:')) return '道具'

  return assetId
}

function resolveSceneReferenceAssets(sceneId: string): DisplayAsset[] {
  const config = ensureSceneConfig(sceneId)
  const assets = config.mustReferenceAssetIds
    .map(assetId => allAssets.value.find(item => item.id === assetId))
    .filter((asset): asset is DisplayAsset => !!asset && !!asset.referenceImage)

  return uniqueSorted(assets.map(asset => asset.name))
    .map(name => assets.find(asset => asset.name === name))
    .filter((asset): asset is DisplayAsset => !!asset)
}

function resolveSceneReferenceSummary(sceneId: string): string {
  const config = ensureSceneConfig(sceneId)
  const names = uniqueSorted(
    config.mustReferenceAssetIds
      .map(resolveAssetName)
      .filter(Boolean)
  )
  if (names.length === 0) return '参考资产：自动匹配'

  if (names.length <= 3) {
    return `参考资产：${names.join('、')}`
  }

  return `参考资产：${names.slice(0, 3).join('、')} 等 ${names.length} 项`
}

function resolveSceneReferencePreviewAssets(sceneId: string, limit = 4): DisplayAsset[] {
  return resolveSceneReferenceAssets(sceneId).slice(0, limit)
}

function resolveSceneReferenceRemainingCount(sceneId: string, limit = 4): number {
  const total = resolveSceneReferenceAssets(sceneId).length
  return total > limit ? total - limit : 0
}

function resolveSceneReferenceAssetIds(sceneId: string): string[] {
  const config = ensureSceneConfig(sceneId)
  return uniqueSorted(config.mustReferenceAssetIds)
}

function setSceneAssetReferences(sceneId: string, nextAssetIds: string[]) {
  const config = ensureSceneConfig(sceneId)
  const validAssetIds = getValidAssetIdSet()
  const normalized = uniqueSorted(nextAssetIds.filter(assetId => validAssetIds.has(assetId)))
  const previous = uniqueSorted(config.mustReferenceAssetIds)

  if (previous.join('||') === normalized.join('||')) return

  config.mustReferenceAssetIds = normalized

  if (config.mustReferenceAssetIds.length === 0 && config.consistencyLevel === 'lock') {
    config.consistencyLevel = 'soft'
  }

  const scene = scenes.value.find(item => item.id === sceneId)
  if (scene && scene.videoStatus === 'done') {
    scene.videoStatus = 'pending'
    scene.videoError = undefined
    scene.videoUrl = undefined
  }
}

function resolveQueueItem(sceneId: string): QueueItem | undefined {
  return queueItems.value.find(item => item.sceneId === sceneId)
}

function isSceneQueueRunning(sceneId: string): boolean {
  return resolveQueueItem(sceneId)?.status === 'running'
}

function isScenePreparing(scene: SceneData): boolean {
  return isSceneQueueRunning(scene.id) && scene.videoStatus !== 'generating'
}

function isSceneBusy(scene: SceneData): boolean {
  return scene.frameStatus === 'generating'
    || scene.videoStatus === 'generating'
    || isSceneQueueRunning(scene.id)
}

function resolveSceneVideoBadge(scene: SceneData): {
  variant: 'secondary' | 'destructive' | 'default' | 'outline'
  label: string
} {
  if (scene.videoStatus === 'done') {
    return { variant: 'secondary', label: '视频完成' }
  }
  if (scene.videoStatus === 'error') {
    return { variant: 'destructive', label: '视频失败' }
  }
  if (scene.videoStatus === 'generating') {
    return { variant: 'default', label: '视频生成中' }
  }
  if (isScenePreparing(scene)) {
    return { variant: 'default', label: '准备中' }
  }
  return { variant: 'outline', label: '待生成' }
}

function resolveEnvironmentCard(assetId: string): EnvironmentAssetCard | undefined {
  return environmentAssetCards.value.find(item => item.id === assetId)
}

function resolveEnvironmentRepresentativeScene(assetId: string): SceneData | undefined {
  const card = resolveEnvironmentCard(assetId)
  if (!card) return undefined
  return scenes.value.find(scene => scene.id === card.representativeSceneId)
}

function resolveEnvironmentSceneSummary(asset: EnvironmentAssetCard): string {
  if (asset.sceneTitles.length <= 2) {
    return `覆盖场景：${asset.sceneTitles.join('、')}`
  }
  return `覆盖场景：${asset.sceneTitles.slice(0, 2).join('、')} 等 ${asset.sceneTitles.length} 场`
}

async function regenerateEnvironmentAsset(assetId: string) {
  const targetScene = resolveEnvironmentRepresentativeScene(assetId)
  if (!targetScene) return
  await generateSceneBaseline(targetScene.id)
}

function openEnvironmentAssetSceneEditor(assetId: string) {
  const targetScene = resolveEnvironmentRepresentativeScene(assetId)
  if (!targetScene) return
  openSceneEdit(targetScene)
}

function selectScene(sceneId: string) {
  selectedSceneId.value = sceneId
}

const sceneEditAssetReferenceOptions = computed<DisplayAsset[]>(() => {
  return allAssets.value
})

const sceneEditSelectedAssetIds = computed<string[]>(() => {
  if (!editingScene.value?.id) return []
  return resolveSceneReferenceAssetIds(editingScene.value.id)
})

function openSceneEdit(scene: SceneData) {
  editingScene.value = {
    ...scene,
    setting: scene.setting
      ? { ...scene.setting }
      : { location: '未知', timeOfDay: 'morning' },
    characters: scene.characters.map(char => ({ ...char })),
    dialogues: scene.dialogues.map(dialogue => ({ ...dialogue }))
  }
  sceneEditDialogOpen.value = true
}

function handleSceneSave(updatedScene: Partial<SceneData> & { id: string }) {
  updateScene(updatedScene)
  sceneEditDialogOpen.value = false
  editingScene.value = null
}

function handleSceneAssetReferencesSave(payload: { sceneId: string, assetIds: string[] }) {
  setSceneAssetReferences(payload.sceneId, payload.assetIds)
}

async function handleSplitScene(sceneId: string) {
  const targetIndex = scenes.value.findIndex(scene => scene.id === sceneId)
  if (targetIndex < 0) return

  const beforeIds = scenes.value.map(scene => scene.id)
  const previousConfig = sceneConfigs.value[sceneId]
    ? {
        ...sceneConfigs.value[sceneId],
        mustReferenceAssetIds: [...sceneConfigs.value[sceneId]!.mustReferenceAssetIds]
      }
    : null

  splitScene(targetIndex)

  const afterIds = scenes.value.map(scene => scene.id)
  if (afterIds.length !== beforeIds.length + 1) return

  const firstSplitScene = scenes.value[targetIndex]
  const secondSplitScene = scenes.value[targetIndex + 1]
  if (!firstSplitScene || !secondSplitScene || firstSplitScene.id !== sceneId) return

  if (previousConfig) {
    sceneConfigs.value[secondSplitScene.id] = {
      ...previousConfig,
      sceneId: secondSplitScene.id,
      mustReferenceAssetIds: uniqueSorted(previousConfig.mustReferenceAssetIds)
    }
  }

  synchronizeSceneConfigs()
  synchronizeQueueItems()
  await saveWorkflowMeta()
}

function resolveSceneConfigSnapshot(sceneId: string): SceneConsistencyConfig | null {
  const config = sceneConfigs.value[sceneId]
  if (!config) return null
  return {
    ...config,
    mustReferenceAssetIds: [...config.mustReferenceAssetIds]
  }
}

function canMergeSceneByIndex(sceneIndex: number): boolean {
  const scene = scenes.value[sceneIndex]
  const nextScene = scenes.value[sceneIndex + 1]
  if (!scene || !nextScene) return false
  return !isSceneBusy(scene) && !isSceneBusy(nextScene)
}

async function handleMergeWithNextScene(sceneId: string) {
  const targetIndex = scenes.value.findIndex(scene => scene.id === sceneId)
  if (targetIndex < 0 || targetIndex >= scenes.value.length - 1) return
  if (!canMergeSceneByIndex(targetIndex)) return

  const currentScene = scenes.value[targetIndex]
  const nextScene = scenes.value[targetIndex + 1]
  if (!currentScene || !nextScene) return

  const currentConfig = resolveSceneConfigSnapshot(currentScene.id)
  const nextConfig = resolveSceneConfigSnapshot(nextScene.id)

  mergeWithNextScene(targetIndex)

  const mergedScene = scenes.value[targetIndex]
  if (!mergedScene || mergedScene.id !== currentScene.id) return

  const mergedAssetIds = uniqueSorted([
    ...(currentConfig?.mustReferenceAssetIds || []),
    ...(nextConfig?.mustReferenceAssetIds || [])
  ])
  const mergedNotes = Array.from(new Set([
    currentConfig?.continuityNotes?.trim() || '',
    nextConfig?.continuityNotes?.trim() || ''
  ].filter(Boolean))).join('；')

  if (currentConfig || nextConfig) {
    sceneConfigs.value[mergedScene.id] = {
      sceneId: mergedScene.id,
      mustReferenceAssetIds: mergedAssetIds,
      consistencyLevel: mergedAssetIds.length === 0
        ? 'soft'
        : (
            currentConfig?.consistencyLevel === 'lock'
            || nextConfig?.consistencyLevel === 'lock'
              ? 'lock'
              : 'soft'
          ),
      continuityNotes: mergedNotes
    }
  }

  const { [nextScene.id]: _removedConfig, ...remainingConfigs } = sceneConfigs.value
  void _removedConfig
  sceneConfigs.value = remainingConfigs
  synchronizeSceneConfigs()
  synchronizeQueueItems()
  await saveWorkflowMeta()
}

function handleDeleteScene(scene: SceneData) {
  const beforeLength = scenes.value.length
  deleteScene(scene)

  if (scenes.value.length !== beforeLength) {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
  }
}

function addPropAsset() {
  const name = newPropName.value.trim()
  const description = newPropDescription.value.trim()
  if (!name) return

  propAssets.value.push({
    id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    description
  })

  newPropName.value = ''
  newPropDescription.value = ''
  assetTab.value = 'props'
}

function removePropAsset(propId: string) {
  propAssets.value = propAssets.value.filter(prop => prop.id !== propId)

  const fullAssetId = `prop:${propId}`
  for (const config of Object.values(sceneConfigs.value)) {
    config.mustReferenceAssetIds = config.mustReferenceAssetIds.filter(assetId => assetId !== fullAssetId)
  }
}

async function handleParseScript() {
  if (!novelText.value.trim()) {
    alert('请先输入剧本原文')
    return
  }

  autoRunError.value = null

  try {
    const parsed = await parseScript({
      workflowType: 'asset_consistency',
      style: workflowStylePrompt.value
    })

    if (!parsed) {
      throw new Error('剧本解析失败，请检查模型配置或稍后重试')
    }

    const autoPlanResult = applyAutomaticAssetPlan({
      overwriteExistingConfigs: true
    })

    if (autoPlanResult.characterChanged) {
      await saveProject()
    }
    if (autoPlanResult.configChanged) {
      await saveWorkflowMeta()
    }

    synchronizeSceneConfigs()
    synchronizeQueueItems()

    if (scenes.value.length > 0) {
      selectAutoStage('assets')
    }
  } catch (error) {
    autoRunError.value = resolveUiError(error, '剧本解析失败')
  }
}

async function handleGenerateCharacter(characterId: string) {
  const target = characters.value.find(char => char.id === characterId)
  if (!target) return

  await generateCharacter(target, {
    workflowType: 'asset_consistency'
  })
}

function openCharacterRegenerateDialog(char: CharacterData) {
  if (!char.baseImage?.trim()) {
    alert('请先生成角色图，再进行二次生成')
    return
  }
  characterRegenerateTargetId.value = char.id
  characterRegeneratePrompt.value = CHARACTER_REGENERATION_DEFAULT_PROMPT
  characterRegenerateError.value = null
  characterRegenerateDialogOpen.value = true
}

function closeCharacterRegenerateDialog() {
  characterRegenerateDialogOpen.value = false
  characterRegenerateTargetId.value = null
  characterRegenerateError.value = null
}

async function submitCharacterRegeneration() {
  const targetId = characterRegenerateTargetId.value
  if (!targetId) return

  const target = characters.value.find(char => char.id === targetId)
  if (!target) {
    closeCharacterRegenerateDialog()
    return
  }

  const prompt = characterRegeneratePrompt.value.trim()
  if (!prompt) {
    characterRegenerateError.value = '请输入二次生成提示词'
    return
  }

  if (!target.baseImage?.trim()) {
    characterRegenerateError.value = '角色参考图不存在，请先生成角色图'
    return
  }

  characterRegenerateError.value = null

  try {
    await generateCharacter(target, {
      workflowType: 'asset_consistency',
      regenerationPrompt: prompt
    })
    closeCharacterRegenerateDialog()
  } catch (error) {
    characterRegenerateError.value = resolveUiError(error, '角色二次生成失败')
  }
}

function openEnvironmentRegenerateDialog(assetId: string) {
  const asset = resolveEnvironmentCard(assetId)
  if (!asset) return

  if (!asset.referenceImage?.trim()) {
    alert('请先生成或上传环境图，再进行二次生成')
    return
  }

  environmentRegenerateTargetId.value = asset.id
  environmentRegeneratePrompt.value = ''
  environmentRegenerateError.value = null
  environmentRegenerateDialogOpen.value = true
}

function closeEnvironmentRegenerateDialog() {
  environmentRegenerateDialogOpen.value = false
  environmentRegenerateTargetId.value = null
  environmentRegenerateError.value = null
}

async function submitEnvironmentRegeneration() {
  const targetAssetId = environmentRegenerateTargetId.value
  if (!targetAssetId) return

  const targetAsset = resolveEnvironmentCard(targetAssetId)
  if (!targetAsset) {
    closeEnvironmentRegenerateDialog()
    return
  }

  const prompt = environmentRegeneratePrompt.value.trim()
  if (!prompt) {
    environmentRegenerateError.value = '请输入二次生成提示词'
    return
  }

  const targetScene = resolveEnvironmentRepresentativeScene(targetAsset.id)
  if (!targetScene) {
    environmentRegenerateError.value = '未找到代表场景，无法二次生成'
    return
  }

  if (!resolveSceneReferenceImage(targetScene)?.trim() && !targetAsset.referenceImage?.trim()) {
    environmentRegenerateError.value = '环境参考图不存在，请先生成环境图'
    return
  }

  environmentRegenerateError.value = null

  try {
    await generateSceneBaseline(targetScene.id, {
      customPrompt: prompt
    })

    const updatedImage = resolveSceneReferenceImage(targetScene)
    if (updatedImage) {
      for (const sceneId of targetAsset.sceneIds) {
        if (sceneId === targetScene.id) continue
        const scene = scenes.value.find(item => item.id === sceneId)
        if (!scene) continue

        scene.firstFrame = updatedImage
        scene.lastFrame = undefined
        scene.frameStatus = 'done'
        scene.frameError = undefined
        scene.videoUrl = undefined
        scene.videoStatus = 'pending'
        scene.videoError = undefined
      }
      synchronizeQueueItems()
      await saveProject()
    }

    closeEnvironmentRegenerateDialog()
  } catch (error) {
    environmentRegenerateError.value = resolveUiError(error, '环境二次生成失败')
  }
}

async function handleBatchGenerateCharacters() {
  await batchGenerateCharacters(undefined, {
    workflowType: 'asset_consistency'
  })
}

async function generateSceneBaseline(
  sceneId: string,
  options: { preferReuse?: boolean, customPrompt?: string } = {}
) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return
  if (scene.frameStatus === 'generating' || scene.videoStatus === 'generating') return

  const customPrompt = options.customPrompt?.trim()

  if (options.preferReuse && !customPrompt) {
    const reusableImage = findReusableEnvironmentImage(scene)
    if (reusableImage) {
      scene.firstFrame = reusableImage
      scene.lastFrame = undefined
      scene.frameStatus = 'done'
      scene.frameError = undefined
      scene.videoUrl = undefined
      scene.videoStatus = 'pending'
      scene.videoError = undefined
      synchronizeQueueItems()
      await saveProject()
      return
    }
  }

  scene.frameStatus = 'generating'
  scene.frameError = undefined

  try {
    const environmentContext = buildSceneEnvironmentConsistencyContext(scene)
    const response = await $fetch<{
      success: boolean
      referenceImage?: string
      error?: string
    }>('/api/asset-workflow/reference/generate', {
      method: 'POST',
      body: {
        scene: buildAssetWorkflowScenePayload(scene),
        style: workflowStylePrompt.value,
        aspectRatio: projectAspectRatio.value,
        environmentContext,
        regeneration: customPrompt
          ? {
              customPrompt
            }
          : undefined
      }
    })

    if (!response.success || !response.referenceImage) {
      throw new Error(response.error || '环境图生成失败')
    }

    scene.firstFrame = response.referenceImage
    scene.lastFrame = undefined
    scene.frameStatus = 'done'
    scene.frameError = undefined
    scene.videoUrl = undefined
    scene.videoStatus = 'pending'
    scene.videoError = undefined
    synchronizeQueueItems()
    await saveProject()
  } catch (error) {
    scene.frameStatus = 'error'
    scene.frameError = resolveUiError(error, '环境图生成失败')
    throw new Error(scene.frameError)
  }
}

async function generateSingleSceneVideo(sceneId: string) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return

  await ensureSceneReferencedAssetsReady(scene)

  if (!resolveSceneReferenceImage(scene)) {
    await generateSceneBaseline(scene.id, { preferReuse: true })
  }
  if (scene.frameStatus === 'error') {
    throw new Error(normalizeWorkflowText(scene.frameError || '场景环境图生成失败'))
  }

  const environmentImage = resolveSceneReferenceImage(scene)
  if (!environmentImage) {
    throw new Error('场景环境图未就绪，无法生成视频')
  }
  const characterImages = resolveSceneVideoCharacterReferences(scene)

  scene.videoStatus = 'generating'
  scene.videoError = undefined

  try {
    const response = await $fetch<{
      success: boolean
      taskId?: string
      error?: string
    }>('/api/asset-workflow/video/generate', {
      method: 'POST',
      body: {
        scene: buildAssetWorkflowScenePayload(scene),
        style: workflowStylePrompt.value,
        aspectRatio: projectAspectRatio.value,
        references: {
          environmentImage,
          characterImage: characterImages[0],
          characterImages
        }
      }
    })

    if (!response.success || !response.taskId) {
      throw new Error(response.error || '视频任务创建失败')
    }

    await pollAssetWorkflowVideoStatus(scene, response.taskId)
  } catch (error) {
    scene.videoStatus = 'error'
    scene.videoError = resolveUiError(error, '视频生成失败')
    throw new Error(scene.videoError)
  }
}

async function runBatchSceneGeneration() {
  if (batchRunning.value) return

  const autoPlanResult = applyAutomaticAssetPlan()
  if (autoPlanResult.characterChanged) {
    await saveProject()
  }
  if (autoPlanResult.configChanged) {
    await saveWorkflowMeta()
  }

  const missingCharacterAssets = characters.value.filter(character => !character.baseImage)
  if (missingCharacterAssets.length > 0) {
    await batchGenerateCharacters(undefined, {
      workflowType: 'asset_consistency'
    })
  }

  batchRunning.value = true

  try {
    for (const item of queueItems.value) {
      if (item.status === 'done') continue

      item.status = 'running'
      item.error = undefined

      try {
        await generateSingleSceneVideo(item.sceneId)
        item.status = 'done'
      } catch (error) {
        item.status = 'error'
        item.error = resolveUiError(error, '生成失败')
      }
    }
  } finally {
    batchRunning.value = false
  }
}

async function retryScene(sceneId: string) {
  const item = queueItems.value.find(queue => queue.sceneId === sceneId)
  if (!item) return

  item.status = 'running'
  item.error = undefined

  try {
    await generateSingleSceneVideo(sceneId)
    item.status = 'done'
  } catch (error) {
    item.status = 'error'
    item.error = resolveUiError(error, '生成失败')
  }
}

async function handleMergeVideos() {
  if (scenes.value.length === 0) {
    alert('请先生成场景视频')
    return
  }

  await mergeAllVideos()
}

async function retryFailedQueueItemsOnce() {
  const failedItems = queueItems.value.filter(item => item.status === 'error')
  for (const item of failedItems) {
    await retryScene(item.sceneId)
  }
}

async function runSimpleAssetsStep() {
  if (autoRunning.value) return

  autoRunning.value = true
  autoRunError.value = null
  autoRunCurrentStage.value = 'assets'

  try {
    if (scenes.value.length === 0) {
      throw new Error('请先在“剧本解析”步骤输入并解析剧本')
    }

    const autoPlanResult = applyAutomaticAssetPlan()
    if (autoPlanResult.characterChanged) {
      await saveProject()
    }
    if (autoPlanResult.configChanged) {
      await saveWorkflowMeta()
    }

    const missingCharacterAssets = characters.value.filter(character => !character.baseImage)
    if (missingCharacterAssets.length > 0) {
      await batchGenerateCharacters(undefined, {
        workflowType: 'asset_consistency'
      })
    }

    selectAutoStage('videos')
  } catch (error) {
    autoRunError.value = resolveUiError(error, '资产准备失败')
  } finally {
    autoRunning.value = false
    autoRunCurrentStage.value = null
  }
}

async function runSimpleVideosStep() {
  if (autoRunning.value) return

  autoRunning.value = true
  autoRunError.value = null
  autoRunCurrentStage.value = 'videos'

  try {
    if (scenes.value.length === 0) {
      throw new Error('请先在“剧本解析”步骤输入并解析剧本')
    }
    await runBatchSceneGeneration()
    await retryFailedQueueItemsOnce()
    selectAutoStage('final')
  } catch (error) {
    autoRunError.value = resolveUiError(error, '场景视频生成失败')
  } finally {
    autoRunning.value = false
    autoRunCurrentStage.value = null
  }
}

async function runSimpleFinalStep() {
  if (autoRunning.value) return

  autoRunning.value = true
  autoRunError.value = null
  autoRunCurrentStage.value = 'final'

  try {
    const doneCount = queueItems.value.filter(item => item.status === 'done').length
    if (doneCount === 0) {
      throw new Error('请先在“场景视频”步骤生成至少一个场景视频')
    }
    await handleMergeVideos()
  } catch (error) {
    autoRunError.value = resolveUiError(error, '最终成片合成失败')
  } finally {
    autoRunning.value = false
    autoRunCurrentStage.value = null
  }
}

async function loadWorkflowMeta(rawMetaInput?: unknown): Promise<boolean> {
  loadingWorkflowMeta.value = true
  workflowError.value = null
  hydratingWorkflowMeta.value = true
  let hasMeta = false

  try {
    const rawMeta = rawMetaInput
    if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
      return false
    }

    const meta = rawMeta as {
      sceneConfigs?: Record<string, unknown>
      props?: unknown
    }

    const loadedConfigs: Record<string, SceneConsistencyConfig> = {}
    for (const [sceneId, rawConfig] of Object.entries(meta.sceneConfigs || {})) {
      if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue
      const item = rawConfig as Partial<SceneConsistencyConfig>

      loadedConfigs[sceneId] = {
        sceneId,
        mustReferenceAssetIds: Array.isArray(item.mustReferenceAssetIds)
          ? item.mustReferenceAssetIds.filter(assetId => typeof assetId === 'string')
          : [],
        consistencyLevel: item.consistencyLevel === 'soft' ? 'soft' : 'lock',
        continuityNotes: typeof item.continuityNotes === 'string' ? item.continuityNotes : ''
      }
    }

    const loadedProps = Array.isArray(meta.props)
      ? meta.props
          .filter(item => item && typeof item === 'object')
          .map((item) => {
            const prop = item as Partial<PropAsset>
            return {
              id: typeof prop.id === 'string' ? prop.id : `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: typeof prop.name === 'string' ? prop.name : '未命名道具',
              description: typeof prop.description === 'string' ? prop.description : ''
            }
          })
      : []

    hasMeta = Object.keys(loadedConfigs).length > 0 || loadedProps.length > 0
    sceneConfigs.value = loadedConfigs
    propAssets.value = loadedProps
  } catch (error) {
    console.error('[AssetWorkbench] 读取工作流元数据失败:', error)
    workflowError.value = '读取流程配置失败，已使用默认配置。'
  } finally {
    loadingWorkflowMeta.value = false
    synchronizeSceneConfigs()
    synchronizeQueueItems()
    workflowMetaReady.value = true
    hydratingWorkflowMeta.value = false
  }

  return hasMeta
}

async function saveWorkflowMeta() {
  if (!workflowMetaReady.value || !projectId.value) return

  const payload: AssetWorkflowMeta = {
    version: 1,
    sceneConfigs: sceneConfigs.value,
    props: propAssets.value
  }

  savingWorkflowMeta.value = true
  workflowError.value = null

  try {
    await $fetch(`/api/project/${projectId.value}`, {
      method: 'PUT',
      body: {
        assetWorkflow: payload
      }
    })
  } catch (error) {
    console.error('[AssetWorkbench] 保存工作流元数据失败:', error)
    workflowError.value = '流程配置保存失败，请稍后重试。'
  } finally {
    savingWorkflowMeta.value = false
  }
}

onMounted(async () => {
  const id = projectId.value || route.query.project
  if (!id || typeof id !== 'string') {
    await router.push('/projects')
    return
  }

  await loadProject(id)

  if (!selectedStyleId.value && projectStyleId.value) {
    selectedStyleId.value = projectStyleId.value
  }

  const hasMeta = await loadWorkflowMeta(projectAssetWorkflow.value)

  const autoPlanResult = applyAutomaticAssetPlan({
    overwriteExistingConfigs: !hasMeta
  })
  if (autoPlanResult.characterChanged) {
    await saveProject()
  }
  if (autoPlanResult.configChanged) {
    await saveWorkflowMeta()
  }

  if (scenes.value.length > 0) {
    selectAutoStage(inferActiveAutoStage())
    selectedSceneId.value = scenes.value[0]?.id || ''
  } else {
    selectAutoStage('parse')
  }
})
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden p-3 flex flex-col gap-2">
    <div class="shrink-0 flex flex-wrap items-center justify-between gap-1.5">
      <div class="min-w-0">
        <h1 class="text-lg font-bold leading-tight">
          自动剧本视频工作台
        </h1>
        <p class="text-[11px] text-muted-foreground mt-0.5">
          {{ projectName }}<span v-if="projectDescription"> · {{ projectDescription }}</span> · 画风：{{ selectedStyleId || projectStyleId || '未选择' }} · 比例：{{ projectAspectRatio }}
        </p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2.5 text-xs"
          :disabled="saving || savingWorkflowMeta"
          @click="saveProject"
        >
          <Loader2
            v-if="saving"
            class="h-4 w-4 mr-1 animate-spin"
          />
          保存项目
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2.5 text-xs"
          @click="router.push('/projects')"
        >
          返回项目列表
        </Button>
      </div>
    </div>

    <Card class="shrink-0 border-primary/20 bg-primary/[0.04]">
      <CardContent class="py-2 space-y-1.5">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          <Button
            v-for="stage in autoStages"
            :key="stage.key"
            type="button"
            variant="ghost"
            class="h-auto rounded-md border px-2 py-1 text-left transition focus-visible:outline-none"
            :class="[
              activeAutoStage === stage.key
                ? 'border-primary/40 bg-accent text-foreground shadow-sm'
                : stage.status === 'done'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : stage.status === 'running'
                    ? 'border-primary/30 bg-primary/[0.06]'
                    : 'border-input bg-background hover:border-primary/25'
            ]"
            @click="selectAutoStage(stage.key)"
          >
            <div class="flex items-center justify-between gap-1.5">
              <span class="text-[12px] font-medium">{{ stage.label }}</span>
              <CheckCircle2
                v-if="stage.status === 'done'"
                class="h-3.5 w-3.5 text-emerald-600"
              />
              <Loader2
                v-else-if="stage.status === 'running'"
                class="h-3.5 w-3.5 animate-spin text-primary"
              />
              <span
                v-else
                class="text-[10px] text-muted-foreground"
              >待执行</span>
            </div>
            <p
              v-if="activeAutoStage === stage.key"
              class="mt-0.5 text-[10px] text-muted-foreground truncate"
            >
              {{ stage.detail }}
            </p>
          </Button>
        </div>

        <p
          v-if="autoRunError"
          class="text-xs text-destructive"
        >
          {{ autoRunError }}
        </p>
        <p
          v-if="saveError"
          class="text-xs text-destructive"
        >
          {{ saveError }}
        </p>
      </CardContent>
    </Card>

    <Card
      v-if="activeAutoStage === 'parse'"
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <CardHeader class="pb-2">
        <CardTitle class="text-base flex items-center gap-2">
          <BookOpen class="h-4 w-4" />
          步骤一：剧本解析
        </CardTitle>
        <CardDescription class="text-xs">
          粘贴剧本后点击解析，系统会自动拆分场景并补齐资产规划。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
        <Textarea
          v-model="novelText"
          class="flex-1 min-h-[280px] resize-none overflow-y-auto"
          placeholder="粘贴完整剧本原文..."
        />
        <div class="shrink-0 flex flex-wrap items-center gap-2">
          <Button
            :disabled="parsing || !novelText.trim()"
            @click="handleParseScript"
          >
            <Loader2
              v-if="parsing"
              class="h-4 w-4 mr-2 animate-spin"
            />
            解析并自动准备资产
          </Button>
          <span class="text-xs text-muted-foreground">
            已解析场景 {{ scenes.length }} 个，角色 {{ characters.length }} 个
          </span>
        </div>
      </CardContent>
    </Card>

    <Card
      v-else-if="activeAutoStage === 'assets'"
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <CardHeader class="pb-3">
        <CardTitle class="text-base flex items-center gap-2">
          <Layers3 class="h-4 w-4" />
          步骤二：资产准备
        </CardTitle>
        <CardDescription>
          默认自动补齐资产；如需人工干预，可编辑资产后重新生成。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
        <div
          v-if="scenes.length === 0"
          class="text-sm text-muted-foreground"
        >
          请先完成“剧本解析”步骤。
        </div>
        <template v-else>
          <div class="shrink-0 rounded-md border bg-muted/20 px-3 py-2">
            <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="secondary"
                  class="text-[11px]"
                >
                  角色图就绪 {{ characterReadyCount }}/{{ characters.length }}
                </Badge>
                <Badge
                  v-if="characterGeneratingCount > 0"
                  variant="outline"
                  class="text-[11px]"
                >
                  生成中 {{ characterGeneratingCount }}
                </Badge>
                <Badge
                  v-if="characterMissingCount > 0"
                  variant="outline"
                  class="text-[11px]"
                >
                  待生成 {{ characterMissingCount }}
                </Badge>
              </div>

              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  :disabled="autoRunning"
                  @click="runSimpleAssetsStep"
                >
                  <Loader2
                    v-if="autoRunning && autoRunCurrentStage === 'assets'"
                    class="h-4 w-4 mr-2 animate-spin"
                  />
                  {{ assetsPrimaryActionLabel }}
                </Button>
                <Button
                  v-if="characterMissingCount > 0"
                  variant="outline"
                  :disabled="autoRunning || characters.length === 0"
                  @click="handleBatchGenerateCharacters"
                >
                  仅生成角色图
                </Button>
              </div>
            </div>
          </div>
          <div class="shrink-0 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              class="h-8 rounded-md border px-3 text-xs font-medium transition"
              :class="assetTab === 'characters' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
              @click="assetTab = 'characters'"
            >
              角色资产（{{ characters.length }}）
            </Button>
            <Button
              type="button"
              variant="ghost"
              class="h-8 rounded-md border px-3 text-xs font-medium transition"
              :class="assetTab === 'scenes' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
              @click="assetTab = 'scenes'"
            >
              环境资产（{{ environmentAssetCards.length }}）
            </Button>
            <Button
              type="button"
              variant="ghost"
              class="h-8 rounded-md border px-3 text-xs font-medium transition"
              :class="assetTab === 'props' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
              @click="assetTab = 'props'"
            >
              道具资产（{{ propAssets.length }}）
            </Button>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto pr-1">
            <template v-if="assetTab === 'characters'">
              <div
                v-if="characters.length === 0"
                class="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
              >
                暂未识别到角色。可返回“剧本解析”补充人物信息后重新解析。
              </div>
              <div
                v-else
                class="grid grid-cols-1 md:grid-cols-2 gap-3"
              >
                <div
                  v-for="char in characters"
                  :key="char.id"
                  class="rounded-md border p-3"
                >
                  <div class="flex items-start gap-3">
                    <div class="h-20 w-20 rounded-md border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
                      <img
                        v-if="char.baseImage"
                        :src="toImageSrc(char.baseImage)"
                        :alt="`${char.name} 角色图`"
                        class="h-full w-full object-cover cursor-zoom-in"
                        @click="openImagePreview(char.baseImage, `${char.name} 角色图`)"
                      >
                      <Users
                        v-else
                        class="h-8 w-8 text-muted-foreground"
                      />
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-medium truncate">{{ char.name }}</span>
                        <Badge
                          variant="outline"
                          class="text-[10px]"
                        >
                          {{ resolveCharacterRoleLabel(char.role) }}
                        </Badge>
                      </div>

                      <template v-if="editingCharacterId === char.id">
                        <div class="mt-2 space-y-2">
                          <Input
                            v-model="characterEditDraft.name"
                            class="h-8 text-xs"
                            placeholder="角色名称"
                          />
                          <Select v-model="characterEditDraft.role">
                            <SelectTrigger class="h-8 w-full text-xs">
                              <SelectValue placeholder="选择角色类型" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                v-for="opt in characterRoleOptions"
                                :key="opt.value"
                                :value="opt.value"
                              >
                                {{ opt.label }}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Textarea
                            v-model="characterEditDraft.appearance"
                            class="min-h-[72px] text-xs"
                            placeholder="角色外观描述（可人工补充）"
                          />
                        </div>
                      </template>
                      <template v-else>
                        <p class="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {{ char.appearance || '暂无外观描述' }}
                        </p>
                        <div class="mt-2 flex flex-wrap gap-1">
                          <Badge
                            variant="outline"
                            class="text-[10px]"
                          >
                            涉及场景 {{ resolveCharacterSceneCount(char) }}
                          </Badge>
                          <Badge
                            :variant="char.generating ? 'default' : char.baseImage ? 'secondary' : 'outline'"
                            class="text-[10px]"
                          >
                            {{ char.generating ? '生成中' : char.baseImage ? '已就绪' : '待生成' }}
                          </Badge>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <template v-if="editingCharacterId === char.id">
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="saveCharacterEdit()"
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="saveCharacterEdit({ regenerate: true })"
                      >
                        <Loader2
                          v-if="char.generating"
                          class="h-3.5 w-3.5 mr-1 animate-spin"
                        />
                        保存并重生成
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-8 px-2 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="cancelEditCharacter"
                      >
                        取消
                      </Button>
                    </template>
                    <template v-else>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="startEditCharacter(char)"
                      >
                        <Pencil class="h-3.5 w-3.5 mr-1" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="handleGenerateCharacter(char.id)"
                      >
                        <Loader2
                          v-if="char.generating"
                          class="h-3.5 w-3.5 mr-1 animate-spin"
                        />
                        {{ char.baseImage ? '重生成角色图' : '生成角色图' }}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating || !!uploadingCharacterId"
                        @click="triggerUploadInput('char', char.id)"
                      >
                        <Loader2
                          v-if="uploadingCharacterId === char.id"
                          class="h-3.5 w-3.5 mr-1 animate-spin"
                        />
                        <Upload
                          v-else
                          class="h-3.5 w-3.5 mr-1"
                        />
                        上传角色图
                      </Button>
                      <Button
                        v-if="char.baseImage"
                        size="sm"
                        variant="outline"
                        class="h-8 px-3 text-xs"
                        :disabled="autoRunning || char.generating"
                        @click="openCharacterRegenerateDialog(char)"
                      >
                        <Sparkles class="h-3.5 w-3.5 mr-1" />
                        二次生成
                      </Button>
                      <input
                        :id="buildUploadInputId('char', char.id)"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="handleCharacterImageUpload(char.id, $event)"
                      >
                    </template>
                  </div>
                </div>
              </div>
            </template>

            <template v-else-if="assetTab === 'scenes'">
              <div class="rounded-md border p-3 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm font-medium">
                    环境资产总览
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    @click="selectAutoStage('videos')"
                  >
                    去场景视频步骤
                  </Button>
                </div>

                <p class="text-xs text-muted-foreground">
                  {{ environmentAssetCards.length }} 个环境，按剧本环境聚合展示，可直接编辑并重生成环境图。
                </p>

                <div class="grid grid-cols-1 xl:grid-cols-2 gap-2">
                  <div
                    v-for="(asset, idx) in environmentAssetCards"
                    :key="`asset_env_${asset.id}`"
                    class="rounded-lg border bg-card p-3 space-y-2"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-[11px] text-muted-foreground">
                          环境 {{ idx + 1 }}
                        </div>
                        <div class="text-sm font-medium truncate">
                          {{ asset.name }}
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Badge
                          :variant="asset.frameStatus === 'done' ? 'secondary' : asset.frameStatus === 'error' ? 'destructive' : asset.frameStatus === 'generating' ? 'default' : 'outline'"
                          class="text-[11px]"
                        >
                          {{ asset.frameStatus === 'done' ? '环境图就绪' : asset.frameStatus === 'error' ? '环境图失败' : asset.frameStatus === 'generating' ? '生成中' : '待生成' }}
                        </Badge>
                      </div>
                    </div>

                    <p class="text-[11px] text-muted-foreground truncate">
                      {{ resolveEnvironmentSceneSummary(asset) }}
                    </p>

                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        class="relative h-auto aspect-video rounded border bg-muted/30 p-0 overflow-hidden flex items-center justify-center"
                        :class="asset.referenceImage ? 'cursor-zoom-in hover:border-primary/50' : 'cursor-not-allowed opacity-70'"
                        :disabled="!asset.referenceImage"
                        @click="openImagePreview(asset.referenceImage, `${asset.name} - 环境图`)"
                      >
                        <img
                          v-if="asset.referenceImage"
                          :src="toImageSrc(asset.referenceImage)"
                          :alt="`${asset.name} 环境图`"
                          class="h-full w-full object-cover"
                        >
                        <span
                          v-else
                          class="text-[10px] text-muted-foreground"
                        >暂无环境图</span>
                      </Button>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        :disabled="!resolveEnvironmentRepresentativeScene(asset.id)"
                        @click="openEnvironmentAssetSceneEditor(asset.id)"
                      >
                        <Pencil class="h-3.5 w-3.5 mr-1" />
                        编辑代表场景
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        :disabled="autoRunning || asset.frameStatus === 'generating' || !!uploadingEnvironmentAssetId"
                        @click="triggerUploadInput('env', asset.id)"
                      >
                        <Loader2
                          v-if="uploadingEnvironmentAssetId === asset.id"
                          class="h-3.5 w-3.5 mr-1 animate-spin"
                        />
                        <Upload
                          v-else
                          class="h-3.5 w-3.5 mr-1"
                        />
                        上传环境图
                      </Button>
                      <Button
                        v-if="asset.referenceImage"
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        :disabled="asset.frameStatus === 'generating'"
                        @click="openEnvironmentRegenerateDialog(asset.id)"
                      >
                        <Sparkles class="h-3.5 w-3.5 mr-1" />
                        二次生成
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        :disabled="asset.frameStatus === 'generating'"
                        @click="regenerateEnvironmentAsset(asset.id)"
                      >
                        <Loader2
                          v-if="asset.frameStatus === 'generating'"
                          class="h-3.5 w-3.5 mr-1 animate-spin"
                        />
                        <RefreshCw
                          v-else
                          class="h-3.5 w-3.5 mr-1"
                        />
                        重生成环境图
                      </Button>
                      <input
                        :id="buildUploadInputId('env', asset.id)"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="handleEnvironmentImageUpload(asset.id, $event)"
                      >
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="rounded-md border p-3 space-y-3">
                <div class="text-sm font-medium">
                  道具资产总览
                </div>
                <p class="text-xs text-muted-foreground">
                  支持人工补充道具并修改描述，系统会按名称自动匹配场景引用。
                </p>

                <div class="grid grid-cols-1 md:grid-cols-[1.3fr_1.7fr_auto] gap-2">
                  <Input
                    v-model="newPropName"
                    class="h-8 text-xs"
                    placeholder="道具名称，如：手电筒"
                  />
                  <Input
                    v-model="newPropDescription"
                    class="h-8 text-xs"
                    placeholder="可选描述，如：金属外壳，冷白光"
                  />
                  <Button
                    size="sm"
                    class="h-8 px-3 text-xs"
                    :disabled="!newPropName.trim()"
                    @click="addPropAsset"
                  >
                    添加道具
                  </Button>
                </div>

                <div
                  v-if="propAssets.length === 0"
                  class="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
                >
                  当前暂无道具资产。你可以手动新增需要保持一致的道具。
                </div>

                <div
                  v-else
                  class="grid grid-cols-1 md:grid-cols-2 gap-2"
                >
                  <div
                    v-for="prop in propAssets"
                    :key="prop.id"
                    class="rounded-md border p-2"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        class="text-[10px]"
                      >
                        引用场景 {{ resolvePropUsageCount(prop.id) }}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                        @click="removePropAsset(prop.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div class="mt-2 space-y-2">
                      <Input
                        v-model="prop.name"
                        class="h-8 text-xs"
                        placeholder="道具名称"
                      />
                      <Input
                        v-model="prop.description"
                        class="h-8 text-xs"
                        placeholder="道具描述（可选）"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </CardContent>
    </Card>

    <Card
      v-else-if="activeAutoStage === 'videos'"
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <CardHeader class="pb-3">
        <CardTitle class="text-base flex items-center gap-2">
          <Film class="h-4 w-4" />
          步骤三：场景视频
        </CardTitle>
        <CardDescription>
          批量生成场景视频并自动重试失败场景一次；生成效果不理想时可拆分或合并场景后再重试。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
        <div
          v-if="scenes.length === 0"
          class="text-sm text-muted-foreground"
        >
          请先完成“剧本解析”步骤。
        </div>
        <template v-else>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              场景 {{ scenes.length }}
            </Badge>
            <Badge variant="outline">
              环境图就绪 {{ scenes.filter(scene => scene.frameStatus === 'done').length }}
            </Badge>
            <Badge variant="outline">
              视频完成 {{ queueSummary.done }}
            </Badge>
            <Badge
              v-if="queueSummary.error > 0"
              variant="destructive"
            >
              失败 {{ queueSummary.error }}
            </Badge>
            <span class="text-muted-foreground">
              运行中 {{ queueSummary.running }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              :disabled="autoRunning"
              @click="runSimpleVideosStep"
            >
              <Loader2
                v-if="autoRunning && autoRunCurrentStage === 'videos'"
                class="h-4 w-4 mr-2 animate-spin"
              />
              批量生成场景视频
            </Button>
            <Button
              variant="outline"
              :disabled="autoRunning || queueSummary.error === 0"
              @click="retryFailedQueueItemsOnce"
            >
              重试失败场景
            </Button>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
            <div class="min-h-0 overflow-y-auto pr-1 space-y-2">
              <div
                v-for="(scene, idx) in scenes"
                :key="scene.id"
                class="rounded-md border p-3 transition cursor-pointer group"
                :class="selectedSceneId === scene.id ? 'border-primary bg-primary/5' : 'hover:border-primary/50'"
                title="单击选中，双击编辑场景详情"
                @click="selectScene(scene.id)"
                @dblclick.stop="openSceneEdit(scene)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs text-muted-foreground">
                      场景 {{ idx + 1 }}
                    </div>
                    <div class="text-sm font-medium truncate">
                      {{ scene.title }}
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <Badge
                      :variant="scene.frameStatus === 'done' ? 'secondary' : scene.frameStatus === 'error' ? 'destructive' : scene.frameStatus === 'generating' ? 'default' : 'outline'"
                      class="text-[10px]"
                    >
                      {{ scene.frameStatus === 'done' ? '环境图就绪' : scene.frameStatus === 'error' ? '环境图失败' : scene.frameStatus === 'generating' ? '环境图生成中' : '待生成环境图' }}
                    </Badge>
                    <Badge
                      :variant="resolveSceneVideoBadge(scene).variant"
                      class="text-[10px]"
                    >
                      {{ resolveSceneVideoBadge(scene).label }}
                    </Badge>

                    <div class="flex max-w-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-w-40 group-hover:opacity-100">
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 w-7 p-0"
                        title="拆分场景"
                        :disabled="isSceneBusy(scene)"
                        @click.stop="handleSplitScene(scene.id)"
                      >
                        <Split class="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 w-7 p-0"
                        title="与下一场景合并"
                        :disabled="!canMergeSceneByIndex(idx)"
                        @click.stop="handleMergeWithNextScene(scene.id)"
                      >
                        <Merge class="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        title="删除场景"
                        :disabled="isSceneBusy(scene)"
                        @click.stop="handleDeleteScene(scene)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                <p class="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {{ scene.description }}
                </p>

                <p class="mt-1 text-[11px] text-muted-foreground">
                  {{ resolveSceneReferenceSummary(scene.id) }}
                </p>

                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    v-for="asset in resolveSceneReferencePreviewAssets(scene.id)"
                    :key="`ref_preview_${scene.id}_${asset.id}`"
                    type="button"
                    variant="ghost"
                    class="h-8 w-8 rounded border bg-muted/30 p-0 overflow-hidden"
                    @click.stop="openImagePreview(asset.referenceImage, `${scene.title} · ${asset.name}`)"
                  >
                    <img
                      :src="toImageSrc(asset.referenceImage)"
                      :alt="`${asset.name} 参考图`"
                      class="h-full w-full object-cover"
                    >
                  </Button>
                  <Badge
                    v-if="resolveSceneReferenceRemainingCount(scene.id) > 0"
                    variant="outline"
                    class="text-[10px]"
                  >
                    +{{ resolveSceneReferenceRemainingCount(scene.id) }}
                  </Badge>
                </div>

                <div class="mt-2 flex flex-wrap gap-1">
                  <Badge
                    v-for="char in scene.characters.slice(0, 2)"
                    :key="`${scene.id}_${char.name}`"
                    variant="outline"
                    class="text-[10px]"
                  >
                    {{ char.name }}
                  </Badge>
                  <Badge
                    v-if="scene.characters.length > 2"
                    variant="outline"
                    class="text-[10px]"
                  >
                    +{{ scene.characters.length - 2 }}
                  </Badge>
                  <Badge
                    v-if="scene.setting?.location"
                    variant="outline"
                    class="text-[10px]"
                  >
                    {{ scene.setting.location }}
                  </Badge>
                  <Badge
                    v-if="scene.setting?.timeOfDay"
                    variant="outline"
                    class="text-[10px]"
                  >
                    {{ scene.setting.timeOfDay }}
                  </Badge>
                  <Badge
                    variant="outline"
                    class="text-[10px]"
                  >
                    {{ scene.duration }}s
                  </Badge>
                </div>

                <div class="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 px-2 text-xs"
                    :disabled="isSceneBusy(scene)"
                    @click.stop="generateSceneBaseline(scene.id)"
                  >
                    <Loader2
                      v-if="scene.frameStatus === 'generating'"
                      class="h-3.5 w-3.5 mr-1 animate-spin"
                    />
                    {{ resolveSceneReferenceImage(scene) ? '重生成环境图' : '生成环境图' }}
                  </Button>
                  <Button
                    size="sm"
                    class="h-7 px-2 text-xs"
                    :disabled="isSceneBusy(scene)"
                    @click.stop="retryScene(scene.id)"
                  >
                    <Loader2
                      v-if="scene.videoStatus === 'generating' || isScenePreparing(scene)"
                      class="h-3.5 w-3.5 mr-1 animate-spin"
                    />
                    {{ isScenePreparing(scene) ? '准备中' : scene.videoUrl ? '重生成视频' : '生成视频' }}
                  </Button>
                </div>

                <p
                  v-if="scene.videoStatus === 'error' && scene.videoError"
                  class="mt-2 text-xs text-destructive"
                >
                  {{ normalizeWorkflowText(scene.videoError) }}
                </p>
              </div>
            </div>

            <div class="rounded-md border p-3 space-y-3 min-h-0">
              <template v-if="selectedScene">
                <div class="space-y-1">
                  <div class="text-[11px] text-muted-foreground">
                    视频预览
                  </div>
                  <div class="aspect-video rounded bg-black/90 overflow-hidden flex items-center justify-center">
                    <video
                      v-if="selectedScene.videoUrl"
                      :src="selectedScene.videoUrl"
                      controls
                      class="w-full h-full"
                    />
                    <span
                      v-else
                      class="text-xs text-gray-300"
                    >等待生成视频</span>
                  </div>
                </div>
              </template>
              <p
                v-else
                class="text-sm text-muted-foreground"
              >
                请先选择场景
              </p>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <Card
      v-else
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <CardHeader class="pb-3">
        <CardTitle class="text-base flex items-center gap-2">
          <Download class="h-4 w-4" />
          步骤四：最终成片
        </CardTitle>
        <CardDescription>
          合成并下载最终视频（可选）。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 space-y-3 overflow-y-auto">
        <div class="text-sm text-muted-foreground">
          当前可用于合成的场景视频：{{ queueSummary.done }} 个
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            :disabled="autoRunning || mergeStatus.running || queueSummary.done === 0"
            @click="runSimpleFinalStep"
          >
            <Loader2
              v-if="mergeStatus.running || (autoRunning && autoRunCurrentStage === 'final')"
              class="h-4 w-4 mr-2 animate-spin"
            />
            合成最终视频
          </Button>
          <a
            v-if="finalVideo?.videoData"
            :href="finalVideo.videoData"
            download="final-video.mp4"
            class="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm"
          >下载成片</a>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="characterRegenerateDialogOpen">
      <DialogContent class="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>角色二次生成</DialogTitle>
          <DialogDescription>
            使用当前角色图作为参考图，按自定义提示词定向修改。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="text-xs text-muted-foreground">
            目标角色：{{ characterRegenerateTarget?.name || '-' }}
          </div>
          <Textarea
            v-model="characterRegeneratePrompt"
            class="min-h-[140px] text-sm"
            placeholder="输入二次生成提示词"
          />
          <p
            v-if="characterRegenerateError"
            class="text-xs text-destructive"
          >
            {{ characterRegenerateError }}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            :disabled="characterRegenerateTarget?.generating"
            @click="closeCharacterRegenerateDialog"
          >
            取消
          </Button>
          <Button
            :disabled="!characterRegeneratePrompt.trim() || !characterRegenerateTarget || characterRegenerateTarget.generating"
            @click="submitCharacterRegeneration"
          >
            <Loader2
              v-if="characterRegenerateTarget?.generating"
              class="h-4 w-4 mr-2 animate-spin"
            />
            开始二次生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="environmentRegenerateDialogOpen">
      <DialogContent class="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>环境二次生成</DialogTitle>
          <DialogDescription>
            基于当前环境资产，按你输入的提示词重新生成环境图。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="text-xs text-muted-foreground">
            目标环境：{{ environmentRegenerateTarget?.name || '-' }}
          </div>
          <Textarea
            v-model="environmentRegeneratePrompt"
            class="min-h-[140px] text-sm"
            placeholder="输入环境二次生成提示词"
          />
          <p
            v-if="environmentRegenerateError"
            class="text-xs text-destructive"
          >
            {{ environmentRegenerateError }}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            :disabled="environmentRegenerateTarget?.frameStatus === 'generating'"
            @click="closeEnvironmentRegenerateDialog"
          >
            取消
          </Button>
          <Button
            :disabled="!environmentRegeneratePrompt.trim() || !environmentRegenerateTarget || environmentRegenerateTarget.frameStatus === 'generating'"
            @click="submitEnvironmentRegeneration"
          >
            <Loader2
              v-if="environmentRegenerateTarget?.frameStatus === 'generating'"
              class="h-4 w-4 mr-2 animate-spin"
            />
            开始二次生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ScriptSceneEditDialog
      v-model:open="sceneEditDialogOpen"
      :scene="editingScene"
      :available-characters="characters.map(char => char.name)"
      :asset-reference-options="sceneEditAssetReferenceOptions"
      :selected-asset-reference-ids="sceneEditSelectedAssetIds"
      @save="handleSceneSave"
      @save-asset-references="handleSceneAssetReferencesSave"
    />

    <ImagePreview
      v-model:open="imagePreviewOpen"
      :src="imagePreviewSrc"
      :alt="imagePreviewAlt"
    />
  </div>
</template>

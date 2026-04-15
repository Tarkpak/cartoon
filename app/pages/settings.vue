<script setup lang="ts">
import {
  Cpu,
  Image,
  Video,
  Mic,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  X,
  Info,
  AlertCircle,
  FileText,
  Star,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Upload,
  Download
} from 'lucide-vue-next'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'
import type {
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowModelOptions,
  WorkflowGeminiImageSize,
  WorkflowImageGenerationModelOptions,
  WorkflowVideoGenerationModelOptions,
  KlingV3OmniVideoOptions
} from '#shared/types/workflow-models'
import type { PromptCategory, PromptTemplate } from '#shared/types/prompt-template'
import { getPromptTemplateMetadataForWorkflow } from '#shared/types/prompt-template'
import {
  STYLE_CATEGORIES,
  type StylePreset,
  type StyleCategory
} from '#shared/types/styles'
import { resolveStyleCategoryIcon } from '@/lib/style-category-icons'
import {
  PROJECT_WORKFLOW_LABELS,
  type ProjectWorkflowType
} from '#shared/types/project'

type ModelConfig = TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig

interface ModelsData {
  text: TextModelConfig[]
  image: ImageModelConfig[]
  video: VideoModelConfig[]
  voice: VoiceModelConfig[]
}

interface SelectedModels {
  text: string
  image: string
  video: string
  tts?: string
  asr?: string
}

interface TestSelectedModels {
  text: string
  image: string
  video: string
  tts: string
}

interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  latencyMs?: number
  result?: unknown
}

interface ProviderGroup {
  provider: string
  displayName: string
  models: ModelConfig[]
  expanded: boolean
}

const GEMINI_IMAGE_SIZES: WorkflowGeminiImageSize[] = ['512', '1K', '2K', '4K']

// 业务流程配置相关类型
interface CompatibleModel {
  model: string
  displayName: string
  provider: string
  description?: string
  capabilities: string[]
}

interface WorkflowConfig extends WorkflowStepConfig {
  compatibleModels: CompatibleModel[]
  selectedModel: string | null
  isOverridden?: boolean
  modelOptions?: WorkflowVideoGenerationModelOptions
}

interface WorkflowData {
  workflows: WorkflowConfig[]
  currentSelections: Record<WorkflowStep, string>
  modelOptions?: WorkflowModelOptions
}

definePageMeta({ layout: 'default' })

// ==================== 左侧菜单导航 ====================
type MenuSection = 'models' | 'prompts' | 'styles'
type ModelSubMenu = 'workflow' | 'test'

const activeSection = ref<MenuSection>('models')
const activeModelSubMenu = ref<ModelSubMenu>('workflow')
const selectedPromptId = ref<string | null>(null)
const { loadStylePresets: refreshAvailableStyles } = useStylePresets()
const route = useRoute()

const selectedWorkflowCategory = ref<string | null>(null)

const DEFAULT_KLING_V3_OMNI_VIDEO_OPTIONS: KlingV3OmniVideoOptions = {
  sound: 'off',
  mode: 'pro'
}

const DEFAULT_IMAGE_GENERATION_MODEL_OPTIONS: WorkflowImageGenerationModelOptions = {
  geminiImageSize: '1K'
}

function normalizeMenuSection(value: unknown): MenuSection {
  if (value === 'prompts' || value === 'styles' || value === 'models') return value
  return 'models'
}

function normalizeModelSubMenu(value: unknown): ModelSubMenu {
  return value === 'test' ? 'test' : 'workflow'
}

function applyRouteMenuState() {
  activeSection.value = normalizeMenuSection(route.query.section)
  activeModelSubMenu.value = normalizeModelSubMenu(route.query.sub)
}

// ==================== 提示词配置相关状态 ====================
const promptsLoading = ref(false)
const promptTemplates = ref<PromptTemplate[]>([])
const selectedPromptTemplate = ref<PromptTemplate | null>(null)
const selectedPromptWorkflow = ref<ProjectWorkflowType>('asset_consistency')

const promptWorkflowOptions: Array<{ value: ProjectWorkflowType, label: string }> = [
  { value: 'asset_consistency', label: PROJECT_WORKFLOW_LABELS.asset_consistency },
  { value: 'classic', label: PROJECT_WORKFLOW_LABELS.classic }
]

// 提示词分类配置
const promptCategoryConfig: Record<PromptCategory, { name: string; color: string }> = {
  text: { name: '文本生成', color: 'blue' },
  image: { name: '图片生成', color: 'green' },
  video: { name: '视频生成', color: 'purple' },
  audio: { name: '音频生成', color: 'orange' }
}

// 按分类分组的提示词
const groupedPrompts = computed(() => {
  const workflowMetadata = getPromptTemplateMetadataForWorkflow(selectedPromptWorkflow.value)
  const groups: Record<string, typeof workflowMetadata> = {}
  for (const meta of workflowMetadata) {
    if (!groups[meta.category]) groups[meta.category] = []
    groups[meta.category]!.push(meta)
  }
  return groups
})

const promptCategoryOrder: PromptCategory[] = ['text', 'image', 'video', 'audio']

const groupedPromptTemplates = computed<Array<{
  category: PromptCategory
  name: string
  templates: PromptTemplate[]
}>>(() => {
  const templateMap = new Map(promptTemplates.value.map(template => [template.id, template]))
  return promptCategoryOrder
    .map((category) => {
      const metadataList = groupedPrompts.value[category] || []
      const templates = metadataList
        .map(meta => templateMap.get(meta.id))
        .filter((template): template is PromptTemplate => Boolean(template))

      return {
        category,
        name: promptCategoryConfig[category].name,
        templates
      }
    })
    .filter(group => group.templates.length > 0)
})

// 加载提示词模板
async function loadPromptTemplates() {
  promptsLoading.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: { templates: PromptTemplate[] }
    }>('/api/prompts', {
      query: { workflow: selectedPromptWorkflow.value }
    })
    if (response.success && response.data?.templates) {
      promptTemplates.value = response.data.templates

      if (selectedPromptId.value) {
        selectedPromptTemplate.value = response.data.templates.find(
          t => t.id === selectedPromptId.value
        ) || null
      }

      if (!selectedPromptTemplate.value && response.data.templates.length > 0) {
        const firstTemplate = response.data.templates[0]!
        selectedPromptId.value = firstTemplate.id
        selectedPromptTemplate.value = firstTemplate
      }
    }
  } catch (e) {
    console.error('加载提示词模板失败:', e)
  } finally {
    promptsLoading.value = false
  }
}

// 选择提示词模板
function selectPrompt(id: string) {
  activeSection.value = 'prompts'
  selectedPromptId.value = id
  const template = promptTemplates.value.find(t => t.id === id)
  selectedPromptTemplate.value = template || null
}

function toSelectString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// 处理提示词更新
function handlePromptUpdate(template: PromptTemplate) {
  const index = promptTemplates.value.findIndex(t => t.id === template.id)
  if (index !== -1) {
    promptTemplates.value[index] = template
  }
  selectedPromptTemplate.value = template
}

// 处理提示词保存
function handlePromptSaved() {
  // 可以添加 toast 提示
}

// ==================== 画风预设配置状态 ====================
const styleConfigLoading = ref(false)
const styleConfigSaving = ref(false)
const allStylePresets = ref<StylePreset[]>([])
const enabledStyleIdSet = ref<Set<string>>(new Set())
const styleDefaultId = ref('')
const styleSearchKeyword = ref('')
const styleCategoryFilter = ref<'all' | 'enabled' | StyleCategory>('all')
const savedEnabledStyleIds = ref<string[]>([])
const savedDefaultStyleId = ref('')
const styleEditorMode = ref<'create' | 'edit' | null>(null)
const styleEditingId = ref<string | null>(null)
const styleCrudSaving = ref(false)
const styleDeletingId = ref<string | null>(null)
const styleResetting = ref(false)
const styleImporting = ref(false)
const styleExporting = ref(false)
const styleImportInputRef = ref<HTMLInputElement | null>(null)

interface StylePresetExportPayload {
  version: number
  exportedAt: string
  allPresets: StylePreset[]
  enabledStyleIds: string[]
  defaultStyleId: string
}

const styleForm = reactive({
  id: '',
  name: '',
  nameEn: '',
  category: 'japanese_anime' as StyleCategory,
  description: '',
  prompt: '',
  negativePrompt: '',
  thumbnail: '',
  isNew: false,
  isPro: false,
  enabled: true,
  setAsDefault: false
})

const enabledStyleIds = computed(() => Array.from(enabledStyleIdSet.value))
const enabledStyleCount = computed(() => enabledStyleIdSet.value.size)
const hasStyleSelection = computed(() => enabledStyleIdSet.value.size > 0)

const stylePresetMap = computed(() => {
  return new Map(allStylePresets.value.map(style => [style.id, style]))
})

const hasStyleConfigChanges = computed(() => {
  const currentEnabled = Array.from(enabledStyleIdSet.value)
  if (currentEnabled.length !== savedEnabledStyleIds.value.length) return true
  if (styleDefaultId.value !== savedDefaultStyleId.value) return true

  for (let i = 0; i < currentEnabled.length; i++) {
    if (currentEnabled[i] !== savedEnabledStyleIds.value[i]) {
      return true
    }
  }
  return false
})

const filteredStylePresets = computed(() => {
  const query = styleSearchKeyword.value.trim().toLowerCase()

  return allStylePresets.value.filter((style) => {
    const enabled = enabledStyleIdSet.value.has(style.id)

    if (styleCategoryFilter.value === 'enabled' && !enabled) {
      return false
    }
    if (
      styleCategoryFilter.value !== 'all'
      && styleCategoryFilter.value !== 'enabled'
      && style.category !== styleCategoryFilter.value
    ) {
      return false
    }

    if (!query) return true

    return (
      style.name.toLowerCase().includes(query)
      || style.nameEn.toLowerCase().includes(query)
      || style.description.toLowerCase().includes(query)
      || style.id.toLowerCase().includes(query)
    )
  })
})

const currentDefaultStyle = computed(() => {
  return stylePresetMap.value.get(styleDefaultId.value) || null
})

function getStyleCategoryName(category: StyleCategory): string {
  return STYLE_CATEGORIES.find(item => item.id === category)?.name || category
}

function resetStyleForm() {
  styleForm.id = ''
  styleForm.name = ''
  styleForm.nameEn = ''
  styleForm.category = STYLE_CATEGORIES[0]?.id || 'japanese_anime'
  styleForm.description = ''
  styleForm.prompt = ''
  styleForm.negativePrompt = ''
  styleForm.thumbnail = ''
  styleForm.isNew = false
  styleForm.isPro = false
  styleForm.enabled = true
  styleForm.setAsDefault = false
}

function openCreateStyleEditor() {
  resetStyleForm()
  styleEditorMode.value = 'create'
  styleEditingId.value = null
}

function openEditStyleEditor(style: StylePreset) {
  styleForm.id = style.id
  styleForm.name = style.name
  styleForm.nameEn = style.nameEn
  styleForm.category = style.category
  styleForm.description = style.description
  styleForm.prompt = style.prompt
  styleForm.negativePrompt = style.negativePrompt || ''
  styleForm.thumbnail = style.thumbnail || ''
  styleForm.isNew = style.isNew === true
  styleForm.isPro = style.isPro === true
  styleForm.enabled = enabledStyleIdSet.value.has(style.id)
  styleForm.setAsDefault = styleDefaultId.value === style.id
  styleEditorMode.value = 'edit'
  styleEditingId.value = style.id
}

function closeStyleEditor() {
  styleEditorMode.value = null
  styleEditingId.value = null
}

function handleStyleEditorOpenChange(open: boolean) {
  if (open) return
  if (styleCrudSaving.value) return
  closeStyleEditor()
}

function buildStyleFormPayload() {
  return {
    id: styleForm.id.trim() || undefined,
    name: styleForm.name.trim(),
    nameEn: styleForm.nameEn.trim() || null,
    category: styleForm.category,
    description: styleForm.description.trim(),
    prompt: styleForm.prompt.trim(),
    negativePrompt: styleForm.negativePrompt.trim() || null,
    thumbnail: styleForm.thumbnail.trim() || null,
    isNew: styleForm.isNew,
    isPro: styleForm.isPro,
    enabled: styleForm.enabled,
    setAsDefault: styleForm.setAsDefault
  }
}

function normalizeStyleConfigState(
  allPresets: StylePreset[],
  enabledStyleIds: string[],
  defaultStyleId: string
) {
  const validStyleIds = new Set(allPresets.map(style => style.id))
  const dedupEnabled: string[] = []

  for (const styleId of enabledStyleIds) {
    if (!validStyleIds.has(styleId)) continue
    if (dedupEnabled.includes(styleId)) continue
    dedupEnabled.push(styleId)
  }

  if (dedupEnabled.length === 0) {
    dedupEnabled.push(...allPresets.map(style => style.id))
  }

  const normalizedDefault = dedupEnabled.includes(defaultStyleId)
    ? defaultStyleId
    : (dedupEnabled[0] || '')

  return {
    enabledStyleIds: dedupEnabled,
    defaultStyleId: normalizedDefault
  }
}

async function loadStyleConfig() {
  styleConfigLoading.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: {
        allPresets: StylePreset[]
        enabledStyleIds: string[]
        defaultStyleId: string
      }
    }>('/api/styles/config')

    if (!response.success || !response.data) return

    allStylePresets.value = response.data.allPresets || []
    const normalized = normalizeStyleConfigState(
      allStylePresets.value,
      response.data.enabledStyleIds || [],
      response.data.defaultStyleId || ''
    )

    enabledStyleIdSet.value = new Set(normalized.enabledStyleIds)
    styleDefaultId.value = normalized.defaultStyleId
    savedEnabledStyleIds.value = [...normalized.enabledStyleIds]
    savedDefaultStyleId.value = normalized.defaultStyleId
  } catch (e) {
    console.error('加载画风预设配置失败:', e)
  } finally {
    styleConfigLoading.value = false
  }
}

async function submitStyleEditor() {
  if (!styleEditorMode.value) return

  styleCrudSaving.value = true
  try {
    const payload = buildStyleFormPayload()
    if (styleEditorMode.value === 'create') {
      await $fetch('/api/styles/presets', {
        method: 'POST',
        body: payload
      })
    } else if (styleEditingId.value) {
      await $fetch(`/api/styles/presets/${styleEditingId.value}`, {
        method: 'PUT',
        body: payload
      })
    }

    await loadStyleConfig()
    await refreshAvailableStyles(true)
    closeStyleEditor()
  } catch (e) {
    console.error('保存画风预设失败:', e)
    alert('保存画风预设失败，请检查输入后重试。')
  } finally {
    styleCrudSaving.value = false
  }
}

async function deleteStylePreset(styleId: string) {
  if (!confirm(`确定删除画风预设 ${styleId} 吗？`)) return

  styleDeletingId.value = styleId
  try {
    await $fetch(`/api/styles/presets/${styleId}`, {
      method: 'DELETE'
    })

    await loadStyleConfig()
    await refreshAvailableStyles(true)
    if (styleEditingId.value === styleId) {
      closeStyleEditor()
    }
  } catch (e) {
    console.error('删除画风预设失败:', e)
    alert('删除画风预设失败，请稍后重试。')
  } finally {
    styleDeletingId.value = null
  }
}

async function resetStylePresets() {
  if (!confirm('确定重置所有画风预设吗？此操作会恢复为系统默认预设。')) return

  styleResetting.value = true
  try {
    await $fetch('/api/styles/presets/reset', {
      method: 'POST'
    })
    await loadStyleConfig()
    await refreshAvailableStyles(true)
    closeStyleEditor()
  } catch (e) {
    console.error('重置画风预设失败:', e)
    alert('重置画风预设失败，请稍后重试。')
  } finally {
    styleResetting.value = false
  }
}

function triggerStyleImport() {
  styleImportInputRef.value?.click()
}

async function handleStyleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  styleImporting.value = true
  try {
    const rawText = await file.text()
    const payload = JSON.parse(rawText)
    await $fetch('/api/styles/presets/import', {
      method: 'POST',
      body: { payload }
    })
    await loadStyleConfig()
    await refreshAvailableStyles(true)
    closeStyleEditor()
  } catch (e) {
    console.error('导入画风预设失败:', e)
    alert('导入失败，请确认导入文件格式正确。')
  } finally {
    styleImporting.value = false
    input.value = ''
  }
}

async function exportStylePresets() {
  styleExporting.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: StylePresetExportPayload
    }>('/api/styles/presets/export')

    if (!response.success || !response.data) return

    const blob = new Blob([JSON.stringify(response.data, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const dateTag = new Date().toISOString().slice(0, 10)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `style-presets-${dateTag}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('导出画风预设失败:', e)
    alert('导出画风预设失败，请稍后重试。')
  } finally {
    styleExporting.value = false
  }
}

function toggleStyleEnabled(styleId: string) {
  const nextEnabled = new Set(enabledStyleIdSet.value)

  if (nextEnabled.has(styleId)) {
    if (nextEnabled.size <= 1) return
    nextEnabled.delete(styleId)
  } else {
    nextEnabled.add(styleId)
  }

  enabledStyleIdSet.value = nextEnabled

  if (!nextEnabled.has(styleDefaultId.value)) {
    styleDefaultId.value = Array.from(nextEnabled)[0] || ''
  }
}

function setDefaultStyle(styleId: string) {
  if (!enabledStyleIdSet.value.has(styleId)) return
  if (styleConfigSaving.value) return
  if (styleDefaultId.value === styleId) return
  styleDefaultId.value = styleId
  void saveStyleConfig()
}

function enableAllStyles() {
  const allIds = allStylePresets.value.map(style => style.id)
  enabledStyleIdSet.value = new Set(allIds)
  if (!enabledStyleIdSet.value.has(styleDefaultId.value)) {
    styleDefaultId.value = allIds[0] || ''
  }
}

async function saveStyleConfig() {
  if (!hasStyleSelection.value) return
  if (styleConfigSaving.value) return

  styleConfigSaving.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: {
        enabledStyleIds: string[]
        defaultStyleId: string
      }
    }>('/api/styles/config', {
      method: 'PUT',
      body: {
        enabledStyleIds: enabledStyleIds.value,
        defaultStyleId: styleDefaultId.value || null
      }
    })

    if (!response.success || !response.data) return

    const normalized = normalizeStyleConfigState(
      allStylePresets.value,
      response.data.enabledStyleIds || [],
      response.data.defaultStyleId || ''
    )

    enabledStyleIdSet.value = new Set(normalized.enabledStyleIds)
    styleDefaultId.value = normalized.defaultStyleId
    savedEnabledStyleIds.value = [...normalized.enabledStyleIds]
    savedDefaultStyleId.value = normalized.defaultStyleId
    await refreshAvailableStyles(true)
  } catch (e) {
    console.error('保存画风预设配置失败:', e)
    alert('保存画风预设配置失败，请稍后重试。')
  } finally {
    styleConfigSaving.value = false
  }
}

// ==================== 模型测试相关状态 ====================
const loading = ref(true)
const models = ref<ModelsData | null>(null)
const selectedModels = ref<SelectedModels>({
  text: '', image: '', video: '', tts: '', asr: ''
})
const testSelectedModels = ref<TestSelectedModels>({
  text: '', image: '', video: '', tts: ''
})
const activeTab = ref<'text' | 'image' | 'video' | 'tts'>('video')
const expandedProviders = ref<Set<string>>(new Set())
const customPrompts = ref({ text: '', image: '', video: '', tts: '' })
const referenceImages = ref<string[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const promptEditorRef = ref<HTMLDivElement | null>(null)
const syncingImagePromptFromEditor = ref(false)
const imagePromptEditorFocused = ref(false)
const imagePromptComposing = ref(false)
const MAX_IMAGE_TEST_REFERENCES = 4
const imageMentionOpen = ref(false)
const imageMentionQuery = ref('')
const imageMentionStart = ref<number | null>(null)
const imageMentionCaret = ref(0)
const imageMentionActiveIndex = ref(0)
const referencePreviewOpen = ref(false)
const referencePreviewSrc = ref('')
const referencePreviewAlt = ref('参考图预览')

const defaultPrompts = {
  text: '你好，请用一句话介绍你自己。',
  image: '一只可爱的橘色小猫，日式动漫风格，白色背景',
  video: '一只小猫在草地上奔跑，阳光明媚',
  tts: '你好，这是一段测试语音。'
}

const testResults = ref<{
  text: TestResult; image: TestResult; video: TestResult; tts: TestResult
}>({
  text: { status: 'idle' }, image: { status: 'idle' },
  video: { status: 'idle' }, tts: { status: 'idle' }
})

const providerConfig: Record<string, { displayName: string; color: string; order: number }> = {
  gemini: { displayName: 'Google Gemini', color: 'blue', order: 1 },
  qwen: { displayName: '阿里千问', color: 'orange', order: 2 },
  kling: { displayName: '可灵 AI', color: 'cyan', order: 3 },
  volcengine: { displayName: '火山引擎', color: 'red', order: 4 },
  openai: { displayName: 'OpenAI', color: 'green', order: 5 },
  deepseek: { displayName: 'DeepSeek', color: 'purple', order: 6 }
}

// ==================== 业务流程配置相关状态 ====================
const workflowLoading = ref(true)
const workflowSaving = ref(false)
const workflowData = ref<WorkflowData | null>(null)
const expandedCategories = ref<Set<string>>(new Set(['text', 'image', 'video']))

const categoryConfig = {
  text: { name: '文本生成', icon: Cpu, color: 'blue' },
  image: { name: '图片生成', icon: Image, color: 'green' },
  video: { name: '视频生成', icon: Video, color: 'purple' },
  voice: { name: '语音合成', icon: Mic, color: 'orange' }
}

// ==================== 模型测试计算属性 ====================
const currentImageModel = computed(() => {
  if (activeTab.value !== 'image' || !models.value) return null
  const modelId = testSelectedModels.value.image
  return models.value.image.find(m => m.model === modelId) || null
})

const currentImageModelSupportsReference = computed(() => {
  return currentImageModel.value?.supportReferenceImage === true
})

const currentImageModelRequiresReference = computed(() => {
  return (currentImageModel.value as any)?.requireReferenceImage === true
})

const canRunImageTest = computed(() => {
  if (activeTab.value !== 'image') return true
  if (!currentImageModelRequiresReference.value) return true
  return referenceImages.value.length > 0
})

const imagePromptIsEmpty = computed(() => {
  return !(customPrompts.value.image || '').trim()
})

function getCurrentModelList(): ModelConfig[] {
  if (!models.value) return []
  switch (activeTab.value) {
    case 'text': return models.value.text
    case 'image': return models.value.image
    case 'video': return models.value.video
    case 'tts': return models.value.voice.filter(v => v.type === 'tts')
    default: return []
  }
}

const groupedModels = computed<ProviderGroup[]>(() => {
  const modelList = getCurrentModelList()
  const groups: Record<string, ModelConfig[]> = {}
  modelList.forEach(model => {
    if (!groups[model.provider]) groups[model.provider] = []
    groups[model.provider]!.push(model)
  })
  return Object.entries(groups)
    .map(([provider, models]) => ({
      provider,
      displayName: providerConfig[provider]?.displayName || provider,
      models,
      expanded: expandedProviders.value.has(provider)
    }))
    .sort((a, b) => (providerConfig[a.provider]?.order || 99) - (providerConfig[b.provider]?.order || 99))
})

const currentSelectedModel = computed(() => {
  switch (activeTab.value) {
    case 'text': return testSelectedModels.value.text
    case 'image': return testSelectedModels.value.image
    case 'video': return testSelectedModels.value.video
    case 'tts': return testSelectedModels.value.tts
    default: return ''
  }
})

const currentTtsAudioUrl = computed(() => {
  const result = testResults.value.tts.result as { audioUrl?: string } | undefined
  return result?.audioUrl
})

const tabs = [
  { key: 'text' as const, label: '文本生成', icon: Cpu },
  { key: 'image' as const, label: '图片生成', icon: Image },
  { key: 'video' as const, label: '视频生成', icon: Video },
  { key: 'tts' as const, label: '语音合成', icon: Mic }
]

// ==================== 业务流程配置计算属性 ====================
const groupedWorkflows = computed(() => {
  if (!workflowData.value) return {}
  const groups: Record<string, WorkflowConfig[]> = {}
  for (const workflow of workflowData.value.workflows) {
    if (!groups[workflow.category]) groups[workflow.category] = []
    groups[workflow.category]!.push(workflow)
  }
  return groups
})

// 根据选中的分类过滤显示的工作流
const filteredWorkflows = computed(() => {
  if (!selectedWorkflowCategory.value) return groupedWorkflows.value
  const category = selectedWorkflowCategory.value
  if (groupedWorkflows.value[category]) {
    return { [category]: groupedWorkflows.value[category] }
  }
  return groupedWorkflows.value
})

function getCapabilityLabel(cap: string): string {
  const labels: Record<string, string> = {
    'reference_image': '需参考图',
    'first_last_frame': '需首尾帧',
    'image_to_video': '需图生视频',
    'text_to_video': '需文生视频',
    'tts': 'TTS', 'asr': 'ASR', 'text_generation': '文本生成'
  }
  return labels[cap] || cap
}

function getProviderLabel(provider: string): string {
  return { gemini: 'Gemini', qwen: '千问', kling: '可灵', volcengine: '火山', openai: 'OpenAI', deepseek: 'DeepSeek' }[provider] || provider
}

function hasCompatibleModels(workflow: WorkflowConfig): boolean {
  return workflow.compatibleModels.length > 0
}

// ==================== 模型测试方法 ====================
async function loadModels() {
  loading.value = true
  try {
    const response = await $fetch<{ success: boolean; data: { available: ModelsData; selected: SelectedModels } }>('/api/models')
    if (response.success) {
      models.value = response.data.available
      selectedModels.value = response.data.selected
      testSelectedModels.value = {
        text: response.data.selected.text || response.data.available.text[0]?.model || '',
        image: response.data.selected.image || response.data.available.image[0]?.model || '',
        video: response.data.selected.video || response.data.available.video[0]?.model || '',
        tts: response.data.selected.tts || response.data.available.voice.find(v => v.type === 'tts')?.model || ''
      }
      autoExpandSelectedProviders()
    }
  } catch (e) { console.error('加载模型列表失败:', e) }
  finally { loading.value = false }
}

function autoExpandSelectedProviders() {
  // 展开所有供应商
  const currentModels = getCurrentModelList()
  const providers = new Set(currentModels.map(m => m.provider))
  providers.forEach(p => expandedProviders.value.add(p))
}

function selectTestModel(type: 'text' | 'image' | 'video' | 'tts', modelId: string) {
  if (testSelectedModels.value[type] === modelId) return
  testSelectedModels.value[type] = modelId
  testResults.value[type] = { status: 'idle' }
  if (type === 'image') {
    referenceImages.value = []
  }
  closeImageMention()
}

function getTestModelId(modelType: 'text' | 'image' | 'video' | 'tts'): string {
  return testSelectedModels.value[modelType] || ''
}

function toggleProvider(provider: string) {
  if (expandedProviders.value.has(provider)) expandedProviders.value.delete(provider)
  else expandedProviders.value.add(provider)
}

function getProviderColor(provider: string) {
  return providerConfig[provider]?.color || 'gray'
}

const imageMentionCandidates = computed(() => {
  if (activeTab.value !== 'image') return []
  const rawQuery = imageMentionQuery.value.trim().toLowerCase()

  return referenceImages.value
    .map((image, index) => {
      const numeric = String(index + 1)
      const aliases = [
        numeric,
        `图${numeric}`,
        `img${numeric}`,
        `image${numeric}`
      ]
      return {
        index,
        image,
        token: `@图${numeric}`,
        aliases
      }
    })
    .filter((item) => {
      if (!rawQuery) return true
      return item.aliases.some(alias => alias.includes(rawQuery) || rawQuery.includes(alias))
    })
})

function closeImageMention() {
  imageMentionOpen.value = false
  imageMentionQuery.value = ''
  imageMentionStart.value = null
  imageMentionActiveIndex.value = 0
}

function getImageMentionToken(index: number): string {
  return `@图${index + 1}`
}

function resolvePromptEditorElement(): HTMLDivElement | null {
  return promptEditorRef.value
}

function serializePromptNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '')
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    let fallback = ''
    for (const child of Array.from(node.childNodes)) {
      fallback += serializePromptNode(child)
    }
    return fallback
  }

  const element = node as HTMLElement
  const mentionToken = element.dataset?.mentionToken
  if (mentionToken) return mentionToken

  if (element.tagName === 'BR') return '\n'

  let text = ''
  for (const child of Array.from(element.childNodes)) {
    text += serializePromptNode(child)
  }

  if (element.tagName === 'DIV' || element.tagName === 'P') {
    text += '\n'
  }

  return text
}

function getSerializedTextFromNodes(nodes: NodeList | Node[]): string {
  return Array.from(nodes).map(node => serializePromptNode(node)).join('')
}

function getImagePromptEditorState(): { text: string, caret: number } {
  const editor = resolvePromptEditorElement()
  const fallbackText = customPrompts.value.image || ''
  if (!editor) {
    return { text: fallbackText, caret: fallbackText.length }
  }

  const text = getSerializedTextFromNodes(editor.childNodes)
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { text, caret: text.length }
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.endContainer)) {
    return { text, caret: text.length }
  }

  const preRange = range.cloneRange()
  preRange.selectNodeContents(editor)
  preRange.setEnd(range.endContainer, range.endOffset)
  const fragment = preRange.cloneContents()
  const caret = getSerializedTextFromNodes(fragment.childNodes)

  return {
    text,
    caret: caret.length
  }
}

function getNodeSerializedLength(node: Node): number {
  return serializePromptNode(node).length
}

interface CaretSegment {
  type: 'text' | 'mention'
  node: Node
  start: number
  end: number
}

function collectCaretSegments(nodes: Node[], start = 0): { segments: CaretSegment[], end: number } {
  const segments: CaretSegment[] = []
  let offset = start

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = getNodeSerializedLength(node)
      const next = offset + length
      segments.push({
        type: 'text',
        node,
        start: offset,
        end: next
      })
      offset = next
      continue
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.dataset?.mentionToken) {
        const length = getNodeSerializedLength(node)
        const next = offset + length
        segments.push({
          type: 'mention',
          node,
          start: offset,
          end: next
        })
        offset = next
        continue
      }

      const nested = collectCaretSegments(Array.from(node.childNodes), offset)
      segments.push(...nested.segments)
      offset = nested.end
      continue
    }

    offset += getNodeSerializedLength(node)
  }

  return {
    segments,
    end: offset
  }
}

function setImagePromptEditorCaret(offset: number) {
  const editor = resolvePromptEditorElement()
  if (!editor) return

  const selection = window.getSelection()
  if (!selection) return

  editor.focus()

  const { segments, end } = collectCaretSegments(Array.from(editor.childNodes))
  const targetOffset = Math.max(0, Math.min(offset, end))

  const range = document.createRange()
  if (segments.length === 0) {
    range.selectNodeContents(editor)
    range.collapse(false)
  } else {
    let placed = false
    for (const segment of segments) {
      if (targetOffset > segment.end) continue

      if (segment.type === 'text' && segment.node.nodeType === Node.TEXT_NODE) {
        const node = segment.node as Text
        range.setStart(node, Math.max(0, targetOffset - segment.start))
        range.collapse(true)
        placed = true
      } else {
        if (targetOffset <= segment.start) {
          range.setStartBefore(segment.node)
        } else {
          range.setStartAfter(segment.node)
        }
        range.collapse(true)
        placed = true
      }
      break
    }

    if (!placed) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

function createImageMentionNode(imageIndex: number): HTMLSpanElement {
  const token = getImageMentionToken(imageIndex)
  const mention = document.createElement('span')
  mention.className = 'inline-flex items-center gap-1 rounded-md border bg-muted/70 px-1.5 py-0.5 align-middle'
  mention.contentEditable = 'false'
  mention.dataset.mentionToken = token
  mention.dataset.mentionIndex = String(imageIndex)

  const image = document.createElement('img')
  image.src = referenceImages.value[imageIndex] || ''
  image.className = 'h-4 w-4 rounded object-cover'
  image.alt = token

  const label = document.createElement('span')
  label.className = 'text-xs'
  label.textContent = token

  mention.append(image, label)
  return mention
}

const IMAGE_REFERENCE_INLINE_PATTERN = String.raw`(?:@(?:图|img|image)?\s*([1-9]\d*)|\[(?:图|img|image)\s*([1-9]\d*)\])`

function renderImagePromptEditor(text: string, caretOffset?: number) {
  const editor = resolvePromptEditorElement()
  if (!editor) return

  const fragment = document.createDocumentFragment()
  const matcher = new RegExp(IMAGE_REFERENCE_INLINE_PATTERN, 'giu')
  let lastIndex = 0

  for (const match of text.matchAll(matcher)) {
    const fullMatch = match[0] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    if (matchIndex > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, matchIndex)))
    }

    const rawIndex = Number(match[1] || match[2] || NaN)
    const imageIndex = Number.isInteger(rawIndex) ? rawIndex - 1 : -1
    if (imageIndex >= 0 && imageIndex < referenceImages.value.length) {
      fragment.append(createImageMentionNode(imageIndex))
    } else {
      fragment.append(document.createTextNode(fullMatch))
    }

    lastIndex = matchIndex + fullMatch.length
  }

  if (lastIndex < text.length) {
    fragment.append(document.createTextNode(text.slice(lastIndex)))
  }

  if (fragment.childNodes.length === 0) {
    fragment.append(document.createTextNode(''))
  }

  editor.replaceChildren(fragment)

  if (typeof caretOffset === 'number') {
    nextTick(() => {
      setImagePromptEditorCaret(caretOffset)
    })
  }
}

function syncImagePromptFromEditor() {
  const state = getImagePromptEditorState()
  syncingImagePromptFromEditor.value = true
  customPrompts.value.image = state.text
  syncingImagePromptFromEditor.value = false
  return state
}

function updateImageMentionState(state?: { text: string, caret: number }) {
  if (activeTab.value !== 'image' || referenceImages.value.length === 0 || imagePromptComposing.value) {
    closeImageMention()
    return
  }

  const currentState = state || getImagePromptEditorState()
  imageMentionCaret.value = currentState.caret

  const beforeCaret = currentState.text.slice(0, currentState.caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) {
    closeImageMention()
    return
  }

  const query = beforeCaret.slice(atIndex + 1)
  if (query.length > 24 || /[\s\r\n]/.test(query)) {
    closeImageMention()
    return
  }

  const charBeforeAt = beforeCaret[atIndex - 1]
  if (charBeforeAt && /[a-zA-Z0-9_]/.test(charBeforeAt)) {
    closeImageMention()
    return
  }

  imageMentionStart.value = atIndex
  imageMentionQuery.value = query
  imageMentionOpen.value = true
  if (imageMentionActiveIndex.value >= imageMentionCandidates.value.length) {
    imageMentionActiveIndex.value = 0
  }
}

function insertImageMention(imageIndex: number) {
  if (activeTab.value !== 'image') return

  const state = getImagePromptEditorState()
  const start = imageMentionStart.value
  if (start === null) return

  const safeStart = Math.max(0, Math.min(start, state.text.length))
  const safeCaret = Math.max(safeStart, Math.min(state.caret, state.text.length))
  const before = state.text.slice(0, safeStart)
  const after = state.text.slice(safeCaret)
  const token = getImageMentionToken(imageIndex)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
  const insertion = `${needsLeadingSpace ? ' ' : ''}${token}${needsTrailingSpace ? ' ' : ''}`
  const nextText = `${before}${insertion}${after}`
  const nextCaret = before.length + insertion.length

  syncingImagePromptFromEditor.value = true
  customPrompts.value.image = nextText
  syncingImagePromptFromEditor.value = false

  closeImageMention()
  renderImagePromptEditor(nextText, nextCaret)
}

function handlePromptTextareaInput() {
  if (activeTab.value !== 'image') return
  if (imagePromptComposing.value) return
  const state = syncImagePromptFromEditor()
  updateImageMentionState(state)
}

function handlePromptTextareaCursorChange() {
  if (activeTab.value !== 'image') return
  if (imagePromptComposing.value) return
  updateImageMentionState()
}

function handlePromptTextareaFocus() {
  if (activeTab.value !== 'image') return
  imagePromptEditorFocused.value = true
  if (!imagePromptComposing.value) {
    updateImageMentionState()
  }
}

function handlePromptTextareaCompositionStart() {
  if (activeTab.value !== 'image') return
  imagePromptComposing.value = true
  closeImageMention()
}

function handlePromptTextareaCompositionEnd() {
  if (activeTab.value !== 'image') return
  imagePromptComposing.value = false
  const state = syncImagePromptFromEditor()
  updateImageMentionState(state)
}

function handlePromptTextareaBlur() {
  if (activeTab.value !== 'image') return
  imagePromptEditorFocused.value = false

  syncImagePromptFromEditor()
  const state = getImagePromptEditorState()
  renderImagePromptEditor(state.text, state.caret)

  setTimeout(() => {
    closeImageMention()
  }, 120)
}

function handlePromptTextareaKeydown(event: KeyboardEvent) {
  if (imagePromptComposing.value) return
  if (activeTab.value !== 'image' || !imageMentionOpen.value) return

  const candidates = imageMentionCandidates.value
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (candidates.length === 0) return
    imageMentionActiveIndex.value = (imageMentionActiveIndex.value + 1) % candidates.length
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (candidates.length === 0) return
    imageMentionActiveIndex.value = (imageMentionActiveIndex.value - 1 + candidates.length) % candidates.length
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    if (candidates.length === 0) {
      closeImageMention()
      return
    }
    const target = candidates[imageMentionActiveIndex.value] || candidates[0]
    if (target) {
      insertImageMention(target.index)
    }
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeImageMention()
  }
}

const IMAGE_REFERENCE_EXTRACT_PATTERN = String.raw`(?:\[(?:图|img|image)\s*([1-9]\d*)\]|@(?:图|img|image)?\s*([1-9]\d*))`

function resolveImagePromptWithReferenceTokens(rawPrompt: string): string {
  const prompt = rawPrompt || defaultPrompts.image
  const total = referenceImages.value.length
  if (total === 0) return prompt

  const referencedIndexes: number[] = []
  const matcher = new RegExp(IMAGE_REFERENCE_EXTRACT_PATTERN, 'giu')
  for (const match of prompt.matchAll(matcher)) {
    const rawIndex = Number(match[1] || match[2] || NaN)
    if (!Number.isInteger(rawIndex)) continue
    const imageIndex = rawIndex - 1
    if (imageIndex < 0 || imageIndex >= total) continue
    if (!referencedIndexes.includes(imageIndex)) {
      referencedIndexes.push(imageIndex)
    }
  }

  if (referencedIndexes.length === 0) return prompt

  const mappingText = referencedIndexes
    .map(imageIndex => `- @图${imageIndex + 1} 表示第 ${imageIndex + 1} 张上传参考图`)
    .join('\n')

  return `${prompt}\n\n[参考图标签映射]\n${mappingText}`
}

function handleReferenceImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  const remainingSlots = MAX_IMAGE_TEST_REFERENCES - referenceImages.value.length
  Array.from(files).slice(0, remainingSlots).forEach(file => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      if (base64 && referenceImages.value.length < MAX_IMAGE_TEST_REFERENCES) {
        referenceImages.value.push(base64)
      }
    }
    reader.readAsDataURL(file)
  })
  input.value = ''
}

function removeReferenceImage(index: number) { referenceImages.value.splice(index, 1) }
function triggerFileInput() { fileInputRef.value?.click() }

function openReferenceImagePreview(src: string, index?: number) {
  if (!src) return
  referencePreviewSrc.value = src
  referencePreviewAlt.value = typeof index === 'number' ? `参考图 ${index + 1}` : '参考图预览'
  referencePreviewOpen.value = true
}

async function testModel(modelType: 'text' | 'image' | 'video' | 'tts') {
  testResults.value[modelType] = { status: 'testing' }
  const rawPrompt = customPrompts.value[modelType] || defaultPrompts[modelType]
  const modelId = getTestModelId(modelType)
  try {
    const body: Record<string, unknown> = {
      modelType,
      prompt: modelType === 'image'
        ? resolveImagePromptWithReferenceTokens(rawPrompt)
        : rawPrompt
    }
    if (modelId) body.modelId = modelId
    if (modelType === 'image' && referenceImages.value.length > 0) body.referenceImages = referenceImages.value
    const response = await $fetch<{ success: boolean; data?: { result: unknown; latencyMs: number }; error?: string }>('/api/models/test', { method: 'POST', body })
    if (response.success && response.data) {
      testResults.value[modelType] = { status: 'success', message: `测试成功 (${response.data.latencyMs}ms)`, latencyMs: response.data.latencyMs, result: response.data.result }
    } else {
      testResults.value[modelType] = { status: 'error', message: response.error || '测试失败' }
    }
  } catch (e) {
    testResults.value[modelType] = { status: 'error', message: e instanceof Error ? e.message : '测试失败' }
  }
}

// ==================== 业务流程配置方法 ====================
async function loadWorkflowModels() {
  workflowLoading.value = true
  try {
    const response = await $fetch<{ success: boolean; data: WorkflowData }>('/api/models/workflow')
    if (response.success) workflowData.value = response.data
  } catch (e) { console.error('加载业务流程模型配置失败:', e) }
  finally { workflowLoading.value = false }
}

function getVideoGenerationModelOptions(): WorkflowVideoGenerationModelOptions {
  return workflowData.value?.modelOptions?.video_generation || {
    klingV3Omni: { ...DEFAULT_KLING_V3_OMNI_VIDEO_OPTIONS }
  }
}

function getImageGenerationModelOptions(): WorkflowImageGenerationModelOptions {
  return workflowData.value?.modelOptions?.image_generation || {
    ...DEFAULT_IMAGE_GENERATION_MODEL_OPTIONS
  }
}

const klingV3OmniOptions = computed<KlingV3OmniVideoOptions>(() => {
  return getVideoGenerationModelOptions().klingV3Omni
})

const imageGenerationOptions = computed<WorkflowImageGenerationModelOptions>(() => {
  return getImageGenerationModelOptions()
})

async function updateWorkflowModel(step: WorkflowStep, modelId: string) {
  if (!workflowData.value) return
  workflowSaving.value = true
  try {
    const response = await $fetch<{ success: boolean; data: { currentSelections: Record<WorkflowStep, string> } }>('/api/models/workflow', { method: 'POST', body: { step, modelId } })
    if (response.success) {
      await loadWorkflowModels()
    }
  } catch (e) { console.error('更新模型选择失败:', e) }
  finally { workflowSaving.value = false }
}

async function updateVideoGenerationModelOptions(
  patch: Partial<KlingV3OmniVideoOptions>
) {
  if (!workflowData.value) return

  const current = getVideoGenerationModelOptions()
  const next: WorkflowVideoGenerationModelOptions = {
    klingV3Omni: {
      ...current.klingV3Omni,
      ...patch
    }
  }

  workflowSaving.value = true
  try {
    const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
      method: 'POST',
      body: {
        step: 'video_generation',
        modelOptions: next
      }
    })
    if (response.success) {
      await loadWorkflowModels()
    }
  } catch (e) {
    console.error('更新视频模型扩展配置失败:', e)
  } finally {
    workflowSaving.value = false
  }
}

async function updateImageGenerationModelOptions(
  patch: Partial<WorkflowImageGenerationModelOptions>
) {
  if (!workflowData.value) return

  const current = getImageGenerationModelOptions()
  const next: WorkflowImageGenerationModelOptions = {
    ...current,
    ...patch
  }

  workflowSaving.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data?: {
        modelOptions?: WorkflowModelOptions
        currentSelections?: Record<WorkflowStep, string>
      }
    }>('/api/models/workflow', {
      method: 'POST',
      body: {
        step: 'image_generation',
        modelOptions: next
      }
    })

    if (response.success) {
      await loadWorkflowModels()
    }
  } catch (e) {
    console.error('更新图片流程模型扩展配置失败:', e)
  } finally {
    workflowSaving.value = false
  }
}

function updateWorkflowGeminiImageSize(value: unknown) {
  const normalized = toSelectString(value).toUpperCase()
  const isValid = GEMINI_IMAGE_SIZES.includes(normalized as WorkflowGeminiImageSize)
  if (!isValid) return
  updateImageGenerationModelOptions({
    geminiImageSize: normalized as WorkflowGeminiImageSize
  })
}

async function updateGlobalWorkflowDefault(type: 'text' | 'image' | 'video', modelId: string) {
  if (selectedModels.value[type] === modelId) return
  try {
    await $fetch('/api/models/switch', {
      method: 'POST',
      body: { type, modelId }
    })
    selectedModels.value[type] = modelId
    testSelectedModels.value[type] = modelId
    await loadWorkflowModels()
  } catch (e) {
    console.error('更新全局默认模型失败:', e)
  }
}

function toggleCategory(category: string) {
  if (expandedCategories.value.has(category)) expandedCategories.value.delete(category)
  else expandedCategories.value.add(category)
}

function scrollToCategory(category: string) {
  nextTick(() => {
    const element = document.getElementById(`workflow-category-${category}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}

watch(activeTab, () => {
  autoExpandSelectedProviders()
  closeImageMention()
  if (activeTab.value === 'image') {
    nextTick(() => {
      const prompt = customPrompts.value.image || ''
      renderImagePromptEditor(prompt, prompt.length)
    })
  }
})

watch(referenceImages, () => {
  if (activeTab.value !== 'image') {
    if (referenceImages.value.length === 0) {
      closeImageMention()
    }
    return
  }

  nextTick(() => {
    const state = getImagePromptEditorState()
    const prompt = customPrompts.value.image || ''
    renderImagePromptEditor(prompt, Math.min(state.caret, prompt.length))
    if (referenceImages.value.length === 0) {
      closeImageMention()
    } else {
      updateImageMentionState()
    }
  })
})

watch(() => customPrompts.value.image, (prompt) => {
  if (activeTab.value !== 'image') return
  if (syncingImagePromptFromEditor.value) return
  if (imagePromptEditorFocused.value || imagePromptComposing.value) return

  nextTick(() => {
    const state = getImagePromptEditorState()
    const safePrompt = prompt || ''
    renderImagePromptEditor(safePrompt, Math.min(state.caret, safePrompt.length))
    updateImageMentionState()
  })
})

watch(() => [route.query.section, route.query.sub], () => {
  applyRouteMenuState()
})

// 切换配置模块时按需加载数据
watch(activeSection, (section) => {
  if (section === 'prompts' && promptTemplates.value.length === 0) {
    loadPromptTemplates()
  } else if (section === 'styles' && allStylePresets.value.length === 0) {
    loadStyleConfig()
  }
})

watch(selectedPromptWorkflow, () => {
  loadPromptTemplates()
})

onMounted(() => {
  applyRouteMenuState()
  loadModels()
  loadWorkflowModels()
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <!-- 右侧内容区 -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- 模型设置 - 业务流程配置 -->
      <div v-if="activeSection === 'models' && activeModelSubMenu === 'workflow'" class="h-full flex flex-col">
        <div class="flex-shrink-0 px-6 py-4 border-b">
          <h2 class="text-lg font-semibold">业务流程配置</h2>
          <p class="text-sm text-muted-foreground">为每个业务流程选择合适的 AI 模型</p>
        </div>
        <div class="flex-1 overflow-y-auto p-6">
          <div v-if="workflowLoading" class="flex items-center justify-center py-12">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
            <span class="ml-2 text-muted-foreground">加载配置中...</span>
          </div>

          <div v-else-if="workflowData" class="max-w-4xl mx-auto space-y-4">
            <!-- 说明 -->
            <div class="flex items-start gap-2 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <Info class="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p>为每个业务流程选择合适的 AI 模型，系统会根据能力要求自动筛选可用模型。</p>
                <p class="mt-1">未单独配置的流程会继承全局默认模型，红色标签表示该流程的必需能力要求。</p>
              </div>
            </div>

            <!-- 全局默认模型 -->
            <div v-if="models" class="p-4 border rounded-lg bg-background space-y-3">
              <div>
                <h3 class="text-sm font-medium">全局默认模型</h3>
                <p class="text-xs text-muted-foreground mt-1">用于文本/图片/视频流程的统一默认值，流程可按需局部覆盖。</p>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">文本生成</label>
                  <Select
                    :model-value="selectedModels.text"
                    @update:model-value="(value) => updateGlobalWorkflowDefault('text', toSelectString(value))"
                  >
                    <SelectTrigger class="w-full h-9 text-sm">
                      <SelectValue placeholder="选择文本模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="model in models.text" :key="model.model" :value="model.model">
                        [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">图片生成</label>
                  <Select
                    :model-value="selectedModels.image"
                    @update:model-value="(value) => updateGlobalWorkflowDefault('image', toSelectString(value))"
                  >
                    <SelectTrigger class="w-full h-9 text-sm">
                      <SelectValue placeholder="选择图片模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="model in models.image" :key="model.model" :value="model.model">
                        [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">视频生成</label>
                  <Select
                    :model-value="selectedModels.video"
                    @update:model-value="(value) => updateGlobalWorkflowDefault('video', toSelectString(value))"
                  >
                    <SelectTrigger class="w-full h-9 text-sm">
                      <SelectValue placeholder="选择视频模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="model in models.video" :key="model.model" :value="model.model">
                        [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <!-- 按分类显示 - 如果选择了某个分类则只显示该分类 -->
            <div v-for="(workflows, category) in filteredWorkflows" :key="category" :id="`workflow-category-${category}`" class="border rounded-lg overflow-hidden">
              <div class="flex items-center gap-3 px-4 py-3 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors" @click="toggleCategory(category)">
                <component :is="expandedCategories.has(category) ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
                <component :is="categoryConfig[category as keyof typeof categoryConfig]?.icon || Cpu" class="h-5 w-5"
                  :class="{ 'text-blue-500': category === 'text', 'text-green-500': category === 'image', 'text-purple-500': category === 'video', 'text-orange-500': category === 'voice' }" />
                <span class="font-medium">{{ categoryConfig[category as keyof typeof categoryConfig]?.name || category }}</span>
                <span class="text-xs text-muted-foreground">({{ workflows.length }} 个流程)</span>
              </div>

              <div v-show="expandedCategories.has(category)" class="divide-y">
                <div v-for="workflow in workflows" :key="workflow.id" class="p-4 space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <h4 class="font-medium">{{ workflow.name }}</h4>
                        <span
                          class="px-1.5 py-0.5 text-[10px] rounded"
                          :class="workflow.isOverridden ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'"
                        >
                          {{ workflow.isOverridden ? '局部覆盖' : '继承全局' }}
                        </span>
                        <span v-for="cap in workflow.requiredCapabilities" :key="cap"
                          class="px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                          {{ getCapabilityLabel(cap) }}
                        </span>
                      </div>
                      <p class="text-sm text-muted-foreground mt-0.5">{{ workflow.description }}</p>
                      <div v-if="workflow.tips" class="flex items-start gap-1.5 mt-2 text-xs text-muted-foreground">
                        <Info class="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>{{ workflow.tips }}</span>
                      </div>
                    </div>
                    <CheckCircle2 v-if="workflow.selectedModel && hasCompatibleModels(workflow)" class="h-4 w-4 text-green-500 flex-shrink-0" />
                    <AlertCircle v-else-if="!hasCompatibleModels(workflow)" class="h-4 w-4 text-amber-500 flex-shrink-0" />
                  </div>

                  <div v-if="hasCompatibleModels(workflow)">
                    <Select
                      :model-value="workflow.selectedModel || undefined"
                      :disabled="workflowSaving"
                      @update:model-value="(value) => updateWorkflowModel(workflow.id, toSelectString(value))"
                    >
                      <SelectTrigger class="w-full h-10 text-sm disabled:opacity-50">
                        <SelectValue placeholder="选择模型..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="model in workflow.compatibleModels" :key="model.model" :value="model.model">
                          [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                          <template v-if="model.capabilities.length"> - {{ model.capabilities.slice(0, 2).join(', ') }}</template>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div v-if="workflow.selectedModel" class="mt-2 flex flex-wrap gap-1">
                      <span v-for="cap in (workflow.compatibleModels.find(m => m.model === workflow.selectedModel)?.capabilities || [])" :key="cap"
                        class="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">{{ cap }}</span>
                    </div>

                    <div
                      v-if="workflow.id === 'video_generation' && workflow.selectedModel === 'kling-v3-omni'"
                      class="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3"
                    >
                      <div>
                        <h5 class="text-xs font-medium">Kling v3 Omni 额外配置</h5>
                        <p class="mt-1 text-[11px] text-muted-foreground">
                          仅对 `kling-v3-omni` 生效，会覆盖该模型默认的声音与模式参数。
                        </p>
                      </div>

                      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div class="space-y-1.5">
                          <label class="text-xs text-muted-foreground">sound（是否生成声音）</label>
                          <Select
                            :model-value="klingV3OmniOptions.sound"
                            :disabled="workflowSaving"
                            @update:model-value="(value) => updateVideoGenerationModelOptions({ sound: toSelectString(value) === 'on' ? 'on' : 'off' })"
                          >
                            <SelectTrigger class="w-full h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">
                                off（默认，不生成声音）
                              </SelectItem>
                              <SelectItem value="on">
                                on（同时生成声音）
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div class="space-y-1.5">
                          <label class="text-xs text-muted-foreground">mode（生成模式）</label>
                          <Select
                            :model-value="klingV3OmniOptions.mode"
                            :disabled="workflowSaving"
                            @update:model-value="(value) => updateVideoGenerationModelOptions({ mode: toSelectString(value) === 'std' ? 'std' : 'pro' })"
                          >
                            <SelectTrigger class="w-full h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="std">
                                std（标准模式，性价比高）
                              </SelectItem>
                              <SelectItem value="pro">
                                pro（专家模式，画质更高）
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="workflow.id === 'character_portrait'"
                      class="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3"
                    >
                      <div>
                        <h5 class="text-xs font-medium">图片生成额外配置</h5>
                        <p class="mt-1 text-[11px] text-muted-foreground">
                          对角色立绘/角色多视角/首尾帧流程统一生效；仅 Gemini 图片模型会使用该设置。
                        </p>
                      </div>

                      <div class="space-y-1.5">
                        <label class="text-xs text-muted-foreground">Gemini 画质（image_size）</label>
                        <Select
                          :model-value="imageGenerationOptions.geminiImageSize"
                          :disabled="workflowSaving"
                          @update:model-value="updateWorkflowGeminiImageSize"
                        >
                          <SelectTrigger class="w-full h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              v-for="size in GEMINI_IMAGE_SIZES"
                              :key="`workflow_gemini_image_size_${size}`"
                              :value="size"
                            >
                              {{ size }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p class="text-[11px] text-muted-foreground">
                          支持 `1K` / `2K` / `4K`；`512` 仅 `Gemini 3.1 Flash Image` 支持，其他模型会自动回退到 `1K`。
                        </p>
                      </div>
                    </div>
                  </div>
                  <div v-else class="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-sm">
                    <AlertCircle class="h-4 w-4 flex-shrink-0" />
                    <span>没有满足能力要求的模型</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>

      <!-- 模型设置 - 模型测试 -->
      <div v-else-if="activeSection === 'models' && activeModelSubMenu === 'test'" class="h-full flex overflow-hidden">
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
        <span class="ml-2 text-muted-foreground">加载模型配置...</span>
      </div>

      <template v-else-if="models">
        <!-- 左侧：模型选择 -->
        <div class="w-72 flex-shrink-0 border-r flex flex-col bg-muted/30">
          <div class="flex-1 overflow-y-auto py-1">
            <div v-for="group in groupedModels" :key="group.provider" class="select-none">
              <div class="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors" @click="toggleProvider(group.provider)">
                <component :is="group.expanded ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div class="w-2 h-2 rounded-full flex-shrink-0"
                  :class="{ 'bg-blue-500': getProviderColor(group.provider) === 'blue', 'bg-orange-500': getProviderColor(group.provider) === 'orange', 'bg-cyan-500': getProviderColor(group.provider) === 'cyan', 'bg-green-500': getProviderColor(group.provider) === 'green', 'bg-purple-500': getProviderColor(group.provider) === 'purple', 'bg-red-500': getProviderColor(group.provider) === 'red' }" />
                <span class="text-sm font-medium flex-1 truncate">{{ group.displayName }}</span>
                <span class="text-xs text-muted-foreground">{{ group.models.length }}</span>
              </div>
              <div v-show="group.expanded" class="pb-1">
                <div v-for="model in group.models" :key="model.model"
                  class="flex items-start gap-2 pl-7 pr-2 py-1.5 cursor-pointer transition-colors"
                  :class="model.model === currentSelectedModel ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'"
                  @click="selectTestModel(activeTab, model.model)">
                  <div class="mt-1 w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                    :class="model.model === currentSelectedModel ? 'border-primary' : 'border-muted-foreground/40'">
                    <div v-if="model.model === currentSelectedModel" class="w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1">
                      <span class="text-sm truncate">{{ model.displayName }}</span>
                      <a v-if="(model as any).docUrl" :href="(model as any).docUrl" target="_blank" class="text-muted-foreground hover:text-primary" @click.stop>
                        <ExternalLink class="h-3 w-3" />
                      </a>
                    </div>
                    <div class="flex gap-1 mt-0.5 flex-wrap">
                      <span v-if="(model as any).supportThinking" class="px-1 py-0.5 text-[9px] rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">思考</span>
                      <span v-if="(model as any).supportReferenceImage" class="px-1 py-0.5 text-[9px] rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300">参考图</span>
                      <span v-if="(model as any).maxDuration" class="px-1 py-0.5 text-[9px] rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{{ (model as any).maxDuration }}s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：测试区域 -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex-shrink-0 p-4 border-b space-y-3">
            <div class="flex items-center gap-1 overflow-x-auto pb-1">
              <Button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                variant="ghost"
                class="h-auto px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap"
                :class="activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent'"
                @click="activeTab = tab.key"
              >
                <component :is="tab.icon" class="h-3.5 w-3.5" />
                <span>{{ tab.label }}</span>
              </Button>
            </div>

            <div class="flex items-center justify-between">
              <h3 class="font-medium flex items-center gap-2">
                <Sparkles class="h-4 w-4 text-primary" />
                测试 {{ tabs.find(t => t.key === activeTab)?.label }}
              </h3>
              <div class="flex items-center gap-2">
                <span v-if="activeTab === 'image' && currentImageModelRequiresReference && referenceImages.length === 0" class="text-xs text-amber-600 dark:text-amber-400">此模型需要参考图</span>
                <Button size="sm" @click="testModel(activeTab)" :disabled="testResults[activeTab].status === 'testing' || !canRunImageTest">
                  <Loader2 v-if="testResults[activeTab].status === 'testing'" class="h-4 w-4 mr-1.5 animate-spin" />
                  <Play v-else class="h-4 w-4 mr-1.5" />
                  {{ testResults[activeTab].status === 'testing' ? '测试中...' : '运行测试' }}
                </Button>
              </div>
            </div>
            <div>
              <label class="text-xs text-muted-foreground mb-1.5 block">{{ activeTab === 'tts' ? '测试文本' : '测试提示词' }}</label>
              <template v-if="activeTab === 'image'">
                <div class="relative min-h-[92px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <div
                    ref="promptEditorRef"
                    contenteditable="true"
                    class="min-h-[72px] whitespace-pre-wrap break-words outline-none"
                    @keydown="handlePromptTextareaKeydown"
                    @input="handlePromptTextareaInput"
                    @click="handlePromptTextareaCursorChange"
                    @keyup="handlePromptTextareaCursorChange"
                    @focus="handlePromptTextareaFocus"
                    @compositionstart="handlePromptTextareaCompositionStart"
                    @compositionend="handlePromptTextareaCompositionEnd"
                    @blur="handlePromptTextareaBlur"
                  ></div>
                  <span
                    v-if="imagePromptIsEmpty"
                    class="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground"
                  >
                    {{ defaultPrompts.image }}
                  </span>
                </div>
              </template>
              <template v-else>
                <Textarea
                  v-model="customPrompts[activeTab]"
                  :placeholder="defaultPrompts[activeTab]"
                  class="resize-none text-sm"
                  :rows="activeTab === 'video' ? 3 : 2"
                />
              </template>
              <p
                v-if="activeTab === 'image' && currentImageModelSupportsReference"
                class="mt-1 text-[11px] text-muted-foreground"
              >
                输入 `@` 可直接选择参考图；选中后会在输入框中以内联缩略图显示。
              </p>
              <div
                v-if="activeTab === 'image' && imageMentionOpen"
                class="mt-2 rounded-md border bg-background shadow-sm max-h-48 overflow-y-auto"
              >
                <Button
                  v-for="(item, mentionIndex) in imageMentionCandidates"
                  :key="`image_mention_${item.index}`"
                  type="button"
                  variant="ghost"
                  class="w-full h-auto px-2 py-1.5 justify-start gap-2 rounded-none font-normal hover:bg-accent"
                  :class="mentionIndex === imageMentionActiveIndex ? 'bg-accent' : ''"
                  @mousedown.prevent="insertImageMention(item.index)"
                >
                  <img
                    :src="item.image"
                    class="w-10 h-10 rounded border object-cover"
                  >
                  <span class="text-xs">{{ item.token }}</span>
                </Button>
                <div
                  v-if="imageMentionCandidates.length === 0"
                  class="px-3 py-2 text-xs text-muted-foreground"
                >
                  没有匹配的参考图
                </div>
              </div>

            </div>
            <div v-if="activeTab === 'image' && currentImageModelSupportsReference" class="space-y-2">
              <label class="text-xs text-muted-foreground flex items-center gap-1"><ImagePlus class="h-3 w-3" />参考图片 (可选，最多 {{ MAX_IMAGE_TEST_REFERENCES }} 张)</label>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="(img, index) in referenceImages"
                  :key="index"
                  class="relative w-16 h-16 rounded-lg overflow-hidden border group cursor-zoom-in"
                  @click="openReferenceImagePreview(img, index)"
                >
                  <img :src="img" class="w-full h-full object-cover" />
                  <span class="absolute left-0.5 top-0.5 px-1 py-0.5 rounded bg-black/60 text-white text-[10px] leading-none">
                    图{{ index + 1 }}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover:opacity-100"
                    @click.stop="removeReferenceImage(index)"
                  >
                    <X class="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  v-if="referenceImages.length < MAX_IMAGE_TEST_REFERENCES"
                  type="button"
                  variant="ghost"
                  class="h-16 w-16 rounded-lg border-2 border-dashed border-muted-foreground/30 p-0 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  @click="triggerFileInput"
                >
                  <ImagePlus class="h-5 w-5" />
                </Button>
              </div>
              <input ref="fileInputRef" type="file" accept="image/*" multiple class="hidden" @change="handleReferenceImageUpload" />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="testResults[activeTab].status === 'idle'" class="h-full flex flex-col items-center justify-center text-muted-foreground">
              <component :is="tabs.find(t => t.key === activeTab)?.icon" class="h-12 w-12 mb-3 opacity-20" />
              <p class="text-sm">点击"运行测试"查看结果</p>
            </div>
            <div v-else-if="testResults[activeTab].status === 'testing'" class="h-full flex flex-col items-center justify-center">
              <Loader2 class="h-10 w-10 animate-spin text-primary mb-3" />
              <p class="text-sm text-muted-foreground">正在测试模型...</p>
            </div>
            <div v-else-if="testResults[activeTab].status === 'success'" class="space-y-4">
              <div class="flex items-center gap-2 text-green-600 dark:text-green-400"><CheckCircle2 class="h-5 w-5" /><span class="font-medium">{{ testResults[activeTab].message }}</span></div>
              <div v-if="activeTab === 'text' && testResults.text.result" class="p-4 rounded-lg bg-muted/50 border"><p class="text-sm whitespace-pre-wrap">{{ testResults.text.result }}</p></div>
              <img v-if="activeTab === 'image' && (testResults.image.result as any)?.imageUrl" :src="(testResults.image.result as any).imageUrl" class="max-w-full max-h-[400px] rounded-lg border shadow-sm" />
              <video v-if="activeTab === 'video' && (testResults.video.result as any)?.videoUrl" :src="(testResults.video.result as any).videoUrl" controls class="max-w-full max-h-[400px] rounded-lg border shadow-sm" />
              <audio v-if="activeTab === 'tts' && currentTtsAudioUrl" :src="currentTtsAudioUrl" controls class="w-full max-w-xl" />
              <div v-else-if="activeTab === 'tts'" class="p-3 rounded-lg border bg-muted/40 text-sm text-muted-foreground">
                测试成功，但未获取到可预览的音频地址
              </div>
            </div>
            <div v-else-if="testResults[activeTab].status === 'error'" class="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
              <div class="flex items-start gap-2"><XCircle class="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" /><div><p class="font-medium text-red-700 dark:text-red-300">测试失败</p><p class="text-sm text-red-600 dark:text-red-400 mt-1">{{ testResults[activeTab].message }}</p></div></div>
            </div>
          </div>
        </div>
      </template>
      </div>

      <!-- 画风预设配置 -->
      <div v-else-if="activeSection === 'styles'" class="h-full flex flex-col">
        <div class="flex-shrink-0 px-6 py-4 border-b">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold">画风预设配置</h2>
              <p class="text-sm text-muted-foreground">控制项目创建和工作台可选择的画风范围，并设置默认画风。</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-end">
              <input
                ref="styleImportInputRef"
                type="file"
                accept=".json,application/json"
                class="hidden"
                @change="handleStyleImport"
              >
              <Button
                variant="outline"
                size="sm"
                :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
                @click="openCreateStyleEditor"
              >
                <Plus class="h-4 w-4 mr-1.5" />
                新增预设
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
                @click="triggerStyleImport"
              >
                <Upload class="h-4 w-4 mr-1.5" />
                {{ styleImporting ? '导入中...' : '导入' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="styleConfigLoading || styleCrudSaving || styleExporting"
                @click="exportStylePresets"
              >
                <Download class="h-4 w-4 mr-1.5" />
                {{ styleExporting ? '导出中...' : '导出' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="styleConfigLoading || styleCrudSaving || styleResetting"
                @click="resetStylePresets"
              >
                <RotateCcw class="h-4 w-4 mr-1.5" />
                {{ styleResetting ? '重置中...' : '重置默认' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="styleConfigLoading || styleConfigSaving"
                @click="enableAllStyles"
              >
                全部启用
              </Button>
              <Button
                size="sm"
                :disabled="styleConfigLoading || styleConfigSaving || !hasStyleSelection || !hasStyleConfigChanges"
                @click="saveStyleConfig"
              >
                <Loader2 v-if="styleConfigSaving" class="h-4 w-4 mr-1.5 animate-spin" />
                保存配置
              </Button>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-6">
          <div v-if="styleConfigLoading" class="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 class="h-6 w-6 animate-spin" />
            <span class="ml-2">加载画风配置中...</span>
          </div>

          <div v-else class="max-w-5xl mx-auto space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="rounded-lg border bg-background p-3">
                <p class="text-xs text-muted-foreground">总预设</p>
                <p class="text-xl font-semibold mt-1">{{ allStylePresets.length }}</p>
              </div>
              <div class="rounded-lg border bg-background p-3">
                <p class="text-xs text-muted-foreground">已启用</p>
                <p class="text-xl font-semibold mt-1">{{ enabledStyleCount }}</p>
              </div>
              <div class="rounded-lg border bg-background p-3">
                <p class="text-xs text-muted-foreground">默认画风</p>
                <div class="mt-2 flex items-center gap-3">
                  <div class="w-10 h-14 rounded-md overflow-hidden bg-muted/40 border flex-shrink-0">
                    <img
                      v-if="currentDefaultStyle?.thumbnail"
                      :src="currentDefaultStyle.thumbnail"
                      :alt="currentDefaultStyle.name"
                      class="w-full h-full object-contain"
                    >
                    <div v-else class="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                      无图
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">{{ currentDefaultStyle?.name || '未设置' }}</p>
                    <p class="text-xs text-muted-foreground truncate">{{ styleDefaultId || '-' }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border bg-background p-3 space-y-3">
              <div class="flex flex-col md:flex-row gap-2">
                <Input
                  v-model="styleSearchKeyword"
                  class="md:flex-1"
                  placeholder="搜索画风名称 / ID"
                />
                <Select v-model="styleCategoryFilter">
                  <SelectTrigger class="h-10 text-sm md:w-48">
                    <SelectValue placeholder="全部分类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      全部分类
                    </SelectItem>
                    <SelectItem value="enabled">
                      仅看已启用
                    </SelectItem>
                    <SelectItem
                      v-for="cat in STYLE_CATEGORIES"
                      :key="cat.id"
                      :value="cat.id"
                    >
                      {{ cat.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div v-if="filteredStylePresets.length === 0" class="py-10 text-center text-sm text-muted-foreground">
                当前筛选条件下没有画风
              </div>

              <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                <div
                  v-for="style in filteredStylePresets"
                  :key="style.id"
                  class="rounded-xl border overflow-hidden bg-background transition-colors"
                  :class="[
                    enabledStyleIdSet.has(style.id) ? 'border-primary/50' : 'border-border',
                    styleEditorMode === 'edit' && styleEditingId === style.id ? 'ring-2 ring-primary/40' : ''
                  ]"
                >
                  <div class="relative aspect-[4/5] bg-muted/30">
                    <img
                      v-if="style.thumbnail"
                      :src="style.thumbnail"
                      :alt="style.name"
                      class="w-full h-full object-contain"
                      loading="lazy"
                    >
                    <div v-else class="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                      无缩略图
                    </div>
                    <div class="absolute left-2 top-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] inline-flex items-center gap-1">
                      <component :is="resolveStyleCategoryIcon(style.category)" class="h-3 w-3" />
                      <span>{{ getStyleCategoryName(style.category) }}</span>
                    </div>
                  </div>

                  <div class="p-3 space-y-3">
                    <div class="min-w-0">
                      <div class="font-medium text-sm truncate">{{ style.name }}</div>
                      <div class="text-[12px] text-muted-foreground truncate">{{ style.nameEn }}</div>
                    </div>
                    <div class="text-[12px] text-muted-foreground line-clamp-2 min-h-[36px]">
                      {{ style.description }}
                    </div>

                    <div class="pt-2 border-t flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        class="h-auto px-0 text-xs hover:bg-transparent"
                        @click="toggleStyleEnabled(style.id)"
                      >
                        <span
                          class="relative inline-flex h-5 w-9 rounded-full transition-colors"
                          :class="enabledStyleIdSet.has(style.id) ? 'bg-primary/80' : 'bg-muted-foreground/30'"
                        >
                          <span
                            class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform"
                            :class="enabledStyleIdSet.has(style.id) ? 'translate-x-4' : 'translate-x-0'"
                          />
                        </span>
                        <span class="text-muted-foreground">{{ enabledStyleIdSet.has(style.id) ? '已启用' : '未启用' }}</span>
                      </Button>

                      <Button
                        size="sm"
                        :variant="styleDefaultId === style.id ? 'default' : 'outline'"
                        class="h-7 px-2 text-xs"
                        :disabled="!enabledStyleIdSet.has(style.id)"
                        @click="setDefaultStyle(style.id)"
                      >
                        <Star class="h-3.5 w-3.5 mr-1" />
                        {{ styleDefaultId === style.id ? '默认' : '设为默认' }}
                      </Button>
                    </div>

                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 flex-1 text-xs"
                        @click="openEditStyleEditor(style)"
                      >
                        <Pencil class="h-3.5 w-3.5 mr-1.5" />
                        {{ styleEditorMode === 'edit' && styleEditingId === style.id ? '编辑中' : '编辑' }}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs text-destructive"
                        :disabled="styleDeletingId === style.id"
                        @click="deleteStylePreset(style.id)"
                      >
                        <Loader2 v-if="styleDeletingId === style.id" class="h-3.5 w-3.5 animate-spin" />
                        <Trash2 v-else class="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <details class="rounded-md border bg-muted/20 px-2 py-1.5">
                      <summary class="text-xs text-muted-foreground cursor-pointer select-none">
                        查看预设详情
                      </summary>
                      <div class="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                        <p class="break-all">ID：{{ style.id }}</p>
                        <p class="break-words">预设词：{{ style.prompt }}</p>
                        <p v-if="style.negativePrompt" class="break-words">反向词：{{ style.negativePrompt }}</p>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Dialog
          :open="Boolean(styleEditorMode)"
          @update:open="handleStyleEditorOpenChange"
        >
          <DialogContent class="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {{ styleEditorMode === 'create' ? '新增画风预设' : `编辑画风预设 · ${styleEditingId}` }}
              </DialogTitle>
              <DialogDescription>
                配置画风预设信息，并可同步启用状态与默认画风。
              </DialogDescription>
            </DialogHeader>

            <div class="space-y-4 py-2">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">预设ID</label>
                  <Input
                    v-model="styleForm.id"
                    :disabled="styleEditorMode === 'edit'"
                    placeholder="如: custom_style_demo"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">分类</label>
                  <Select v-model="styleForm.category">
                    <SelectTrigger class="w-full h-10 text-sm">
                      <SelectValue placeholder="选择分类" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="cat in STYLE_CATEGORIES"
                        :key="cat.id"
                        :value="cat.id"
                      >
                        {{ cat.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">中文名称</label>
                  <Input v-model="styleForm.name" placeholder="输入中文名称" />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">英文名称</label>
                  <Input v-model="styleForm.nameEn" placeholder="输入英文名称（可选）" />
                </div>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs text-muted-foreground">描述</label>
                <Textarea
                  v-model="styleForm.description"
                  rows="2"
                  placeholder="输入画风描述"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-xs text-muted-foreground">预设词（Prompt）</label>
                <Textarea
                  v-model="styleForm.prompt"
                  rows="3"
                  placeholder="输入预设词"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">反向预设词（可选）</label>
                  <Input v-model="styleForm.negativePrompt" placeholder="negative prompt" />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">缩略图地址（可选）</label>
                  <Input v-model="styleForm.thumbnail" placeholder="https://playlet-ai.tos-cn-guangzhou.volces.com/manju-assets/styles/example.webp" />
                  <p class="text-[11px] text-muted-foreground">
                    请填写云存储 URL，避免使用本地路径（如 /styles/...）
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <Checkbox v-model:checked="styleForm.enabled" />
                  启用
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <Checkbox v-model:checked="styleForm.setAsDefault" />
                  设为默认
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <Checkbox v-model:checked="styleForm.isNew" />
                  NEW 标记
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <Checkbox v-model:checked="styleForm.isPro" />
                  PRO 标记
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                :disabled="styleCrudSaving"
                @click="closeStyleEditor"
              >
                取消
              </Button>
              <Button
                :disabled="styleCrudSaving || !styleForm.name.trim() || !styleForm.prompt.trim() || !styleForm.description.trim()"
                @click="submitStyleEditor"
              >
                <Loader2 v-if="styleCrudSaving" class="h-4 w-4 mr-1.5 animate-spin" />
                {{ styleEditorMode === 'create' ? '创建预设' : '保存修改' }}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <!-- 提示词配置 -->
      <div v-else-if="activeSection === 'prompts'" class="h-full flex flex-col overflow-hidden">
        <div class="flex-shrink-0 px-6 py-4 border-b">
          <div class="flex flex-col lg:flex-row lg:items-end gap-3">
            <div class="space-y-1.5 lg:w-56">
              <label class="text-xs text-muted-foreground">工作流</label>
              <Select v-model="selectedPromptWorkflow">
                <SelectTrigger class="w-full h-10 text-sm">
                  <SelectValue placeholder="选择工作流" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in promptWorkflowOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1.5 flex-1 min-w-0">
              <label class="text-xs text-muted-foreground">提示词模板</label>
              <Select
                :model-value="selectedPromptId || undefined"
                :disabled="promptsLoading || groupedPromptTemplates.length === 0"
                @update:model-value="(value) => { const nextValue = toSelectString(value); if (nextValue) selectPrompt(nextValue) }"
              >
                <SelectTrigger class="w-full h-10 text-sm disabled:opacity-50">
                  <SelectValue :placeholder="promptsLoading ? '加载模板中...' : '请选择提示词模板'" />
                </SelectTrigger>
                <SelectContent>
                  <template
                    v-for="(group, groupIndex) in groupedPromptTemplates"
                    :key="group.category"
                  >
                    <SelectGroup>
                      <SelectLabel>{{ group.name }}</SelectLabel>
                      <SelectItem
                        v-for="template in group.templates"
                        :key="template.id"
                        :value="template.id"
                      >
                        {{ template.name }}
                      </SelectItem>
                    </SelectGroup>
                    <SelectSeparator
                      v-if="groupIndex < groupedPromptTemplates.length - 1"
                    />
                  </template>
                </SelectContent>
              </Select>
            </div>

            <div class="text-xs text-muted-foreground whitespace-nowrap">
              共 {{ promptTemplates.length }} 个模板
            </div>
          </div>
        </div>

        <div v-if="promptsLoading && !selectedPromptTemplate" class="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 class="h-6 w-6 animate-spin" />
          <span class="ml-2 text-sm">加载提示词模板中...</span>
        </div>
        <div v-else-if="!selectedPromptTemplate" class="h-full flex flex-col items-center justify-center text-muted-foreground">
          <FileText class="h-12 w-12 mb-3 opacity-20" />
          <p class="text-sm">请选择一个提示词模板进行编辑</p>
        </div>
        <PromptEditor
          v-else
          class="flex-1 min-h-0"
          :key="`${selectedPromptWorkflow}-${selectedPromptTemplate.id}`"
          :template="selectedPromptTemplate"
          :workflow="selectedPromptWorkflow"
          @update="handlePromptUpdate"
          @saved="handlePromptSaved"
        />
      </div>

      <ImagePreview
        v-model:open="referencePreviewOpen"
        :src="referencePreviewSrc"
        :alt="referencePreviewAlt"
      />
    </div>
  </div>
</template>

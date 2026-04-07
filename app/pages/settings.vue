<script setup lang="ts">
import {
  Settings,
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
  Workflow,
  FlaskConical,
  Info,
  AlertCircle,
  FileText,
  Sliders
} from 'lucide-vue-next'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'
import type { WorkflowStep, WorkflowStepConfig } from '#shared/types/workflow-models'
import type { PromptTemplate } from '#shared/types/prompt-template'
import { PROMPT_TEMPLATE_METADATA } from '#shared/types/prompt-template'

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
}

interface WorkflowData {
  workflows: WorkflowConfig[]
  currentSelections: Record<WorkflowStep, string>
}

definePageMeta({ layout: 'default' })

// ==================== 左侧菜单导航 ====================
type MenuSection = 'models' | 'prompts'
type ModelSubMenu = 'workflow' | 'test'

const activeSection = ref<MenuSection>('models')
const activeModelSubMenu = ref<ModelSubMenu>('workflow')
const selectedPromptId = ref<string | null>(null)

// 业务流程菜单展开状态和选中分类
const workflowMenuExpanded = ref(true)
const selectedWorkflowCategory = ref<string | null>(null)

// 模型测试菜单展开状态
const testMenuExpanded = ref(false)

// 下拉树展开状态
const expandedSections = ref<Set<string>>(new Set(['models']))
const expandedPromptCategories = ref<Set<string>>(new Set(['text']))

// 切换菜单展开/折叠
function toggleSection(section: string) {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section)
  } else {
    // 折叠其他主菜单，保持互斥
    expandedSections.value.clear()
    expandedSections.value.add(section)
  }
  // 切换到对应的 section
  if (section === 'models') {
    activeSection.value = 'models'
  } else if (section === 'prompts') {
    activeSection.value = 'prompts'
  }
}

// 选择模型子菜单并管理展开状态
function selectModelSubMenu(subMenu: ModelSubMenu) {
  const wasSelected = activeSection.value === 'models' && activeModelSubMenu.value === subMenu
  activeSection.value = 'models'
  activeModelSubMenu.value = subMenu

  // 如果是新选中，则展开对应菜单；如果已选中，则切换展开状态
  if (subMenu === 'workflow') {
    if (wasSelected) {
      workflowMenuExpanded.value = !workflowMenuExpanded.value
    } else {
      workflowMenuExpanded.value = true
      testMenuExpanded.value = false // 折叠其他子菜单
    }
  } else if (subMenu === 'test') {
    if (wasSelected) {
      testMenuExpanded.value = !testMenuExpanded.value
    } else {
      testMenuExpanded.value = true
      workflowMenuExpanded.value = false // 折叠其他子菜单
    }
  }
}

// 选择业务流程分类
function selectWorkflowCategory(category: string) {
  activeSection.value = 'models'
  activeModelSubMenu.value = 'workflow'
  selectedWorkflowCategory.value = category
  // 展开对应分类，折叠其他分类
  expandedCategories.value.clear()
  expandedCategories.value.add(category)
  // 滚动到对应分类
  scrollToCategory(category)
}

// 选择模型测试分类
function selectTestCategory(tab: 'text' | 'image' | 'video' | 'tts') {
  activeSection.value = 'models'
  activeModelSubMenu.value = 'test'
  activeTab.value = tab
}

// 切换提示词分类展开/折叠
function togglePromptCategory(category: string) {
  if (expandedPromptCategories.value.has(category)) {
    expandedPromptCategories.value.delete(category)
  } else {
    expandedPromptCategories.value.add(category)
  }
}

// ==================== 提示词配置相关状态 ====================
const promptsLoading = ref(false)
const promptTemplates = ref<PromptTemplate[]>([])
const selectedPromptTemplate = ref<PromptTemplate | null>(null)

// 提示词分类配置
const promptCategoryConfig: Record<string, { name: string; color: string }> = {
  text: { name: '文本生成', color: 'blue' },
  image: { name: '图片生成', color: 'green' },
  video: { name: '视频生成', color: 'purple' },
  audio: { name: '音频生成', color: 'orange' }
}

// 按分类分组的提示词
const groupedPrompts = computed(() => {
  const groups: Record<string, typeof PROMPT_TEMPLATE_METADATA[number][]> = {}
  for (const meta of PROMPT_TEMPLATE_METADATA) {
    if (!groups[meta.category]) groups[meta.category] = []
    groups[meta.category]!.push(meta)
  }
  return groups
})

// 加载提示词模板
async function loadPromptTemplates() {
  promptsLoading.value = true
  try {
    const response = await $fetch<{ success: boolean; data: { templates: PromptTemplate[] } }>('/api/prompts')
    if (response.success && response.data?.templates) {
      promptTemplates.value = response.data.templates
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
  if (template) {
    selectedPromptTemplate.value = template
  }
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

// ==================== 页面级 Tab (保留兼容) ====================
const pageTab = ref<'workflow' | 'test'>('workflow')

// ==================== 模型测试相关状态 ====================
const loading = ref(true)
const models = ref<ModelsData | null>(null)
const selectedModels = ref<SelectedModels>({
  text: '', image: '', video: '', tts: '', asr: ''
})
const activeTab = ref<'text' | 'image' | 'video' | 'tts'>('text')
const expandedProviders = ref<Set<string>>(new Set())
const customPrompts = ref({ text: '', image: '', video: '', tts: '' })
const referenceImages = ref<string[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

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
  volcengine: { displayName: '火山引擎', color: 'red', order: 3 },
  openai: { displayName: 'OpenAI', color: 'green', order: 4 },
  deepseek: { displayName: 'DeepSeek', color: 'purple', order: 5 }
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
const currentImageModelSupportsReference = computed(() => {
  if (activeTab.value !== 'image' || !models.value) return false
  const modelId = selectedModels.value.image
  const model = models.value.image.find(m => m.model === modelId)
  return model?.supportReferenceImage === true
})

const currentImageModelRequiresReference = computed(() => {
  if (activeTab.value !== 'image' || !models.value) return false
  const modelId = selectedModels.value.image
  const model = models.value.image.find(m => m.model === modelId)
  return (model as any)?.requireReferenceImage === true
})

const canRunImageTest = computed(() => {
  if (activeTab.value !== 'image') return true
  if (!currentImageModelRequiresReference.value) return true
  return referenceImages.value.length > 0
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
    case 'text': return selectedModels.value.text
    case 'image': return selectedModels.value.image
    case 'video': return selectedModels.value.video
    case 'tts': return selectedModels.value.tts
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
  return { gemini: 'Gemini', qwen: '千问', volcengine: '火山', openai: 'OpenAI', deepseek: 'DeepSeek' }[provider] || provider
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

async function selectModel(type: 'text' | 'image' | 'video' | 'tts', modelId: string) {
  try {
    await $fetch('/api/models/switch', { method: 'POST', body: { type, modelId } })
    selectedModels.value[type] = modelId
    testResults.value[type] = { status: 'idle' }
    if (type === 'image') referenceImages.value = []
  } catch (e) { console.error('切换模型失败:', e) }
}

function toggleProvider(provider: string) {
  if (expandedProviders.value.has(provider)) expandedProviders.value.delete(provider)
  else expandedProviders.value.add(provider)
}

function getProviderColor(provider: string) {
  return providerConfig[provider]?.color || 'gray'
}

function handleReferenceImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  const remainingSlots = 4 - referenceImages.value.length
  Array.from(files).slice(0, remainingSlots).forEach(file => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      if (base64 && referenceImages.value.length < 4) referenceImages.value.push(base64)
    }
    reader.readAsDataURL(file)
  })
  input.value = ''
}

function removeReferenceImage(index: number) { referenceImages.value.splice(index, 1) }
function triggerFileInput() { fileInputRef.value?.click() }

async function testModel(modelType: 'text' | 'image' | 'video' | 'tts') {
  testResults.value[modelType] = { status: 'testing' }
  const prompt = customPrompts.value[modelType] || defaultPrompts[modelType]
  try {
    const body: Record<string, unknown> = { modelType, prompt }
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

async function updateGlobalWorkflowDefault(type: 'text' | 'image' | 'video', modelId: string) {
  if (selectedModels.value[type] === modelId) return
  try {
    await $fetch('/api/models/switch', {
      method: 'POST',
      body: { type, modelId }
    })
    selectedModels.value[type] = modelId
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

watch(activeTab, () => { autoExpandSelectedProviders() })

// 切换到提示词配置时加载数据
watch(activeSection, (section) => {
  if (section === 'prompts' && promptTemplates.value.length === 0) {
    loadPromptTemplates()
  }
})

// 展开提示词菜单时加载数据
watch(() => expandedSections.value.has('prompts'), (expanded) => {
  if (expanded && promptTemplates.value.length === 0) {
    loadPromptTemplates()
  }
})

onMounted(() => { loadModels(); loadWorkflowModels() })
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <!-- 左侧菜单 -->
    <div class="w-64 flex-shrink-0 border-r bg-muted/30 flex flex-col overflow-hidden">
      <!-- 标题 -->
      <div class="flex-shrink-0 px-4 py-4 border-b">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-primary/10">
            <Settings class="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 class="text-lg font-semibold">设置</h1>
            <p class="text-xs text-muted-foreground">系统配置管理</p>
          </div>
        </div>
      </div>

      <!-- 菜单列表 - 下拉树形式 -->
      <div class="flex-1 overflow-y-auto py-2">
        <!-- 模型设置 -->
        <div class="px-2">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            :class="activeSection === 'models' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
            @click="toggleSection('models')"
          >
            <component :is="expandedSections.has('models') ? ChevronDown : ChevronRight" class="h-4 w-4 transition-transform" />
            <Sliders class="h-4 w-4" />
            模型设置
          </button>

          <!-- 模型设置子菜单 -->
          <div v-show="expandedSections.has('models')" class="ml-6 mt-1 space-y-0.5 border-l pl-2">
            <div>
              <button
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left"
                :class="activeSection === 'models' && activeModelSubMenu === 'workflow' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                @click="selectModelSubMenu('workflow')"
              >
                <component :is="workflowMenuExpanded ? ChevronDown : ChevronRight" class="h-3 w-3" />
                <Workflow class="h-3.5 w-3.5" />
                业务流程配置
              </button>
              <!-- 业务流程分类子菜单 -->
              <div v-show="workflowMenuExpanded && workflowData" class="ml-4 mt-1 space-y-0.5 border-l pl-2">
                <button
                  v-for="(workflows, category) in groupedWorkflows"
                  :key="category"
                  class="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors text-left"
                  :class="selectedWorkflowCategory === category ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                  @click="selectWorkflowCategory(category)"
                >
                  <component :is="categoryConfig[category as keyof typeof categoryConfig]?.icon || Cpu" class="h-3 w-3"
                    :class="{ 'text-blue-500': category === 'text', 'text-green-500': category === 'image', 'text-purple-500': category === 'video', 'text-orange-500': category === 'voice' }" />
                  {{ categoryConfig[category as keyof typeof categoryConfig]?.name || category }}
                </button>
              </div>
            </div>
            <div>
              <button
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left"
                :class="activeSection === 'models' && activeModelSubMenu === 'test' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                @click="selectModelSubMenu('test')"
              >
                <component :is="testMenuExpanded ? ChevronDown : ChevronRight" class="h-3 w-3" />
                <FlaskConical class="h-3.5 w-3.5" />
                模型测试
              </button>
              <!-- 模型测试分类子菜单 -->
              <div v-show="testMenuExpanded" class="ml-4 mt-1 space-y-0.5 border-l pl-2">
                <button
                  v-for="tab in tabs"
                  :key="tab.key"
                  class="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors text-left"
                  :class="activeModelSubMenu === 'test' && activeTab === tab.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                  @click="selectTestCategory(tab.key)"
                >
                  <component :is="tab.icon" class="h-3 w-3"
                    :class="{ 'text-blue-500': tab.key === 'text', 'text-green-500': tab.key === 'image', 'text-purple-500': tab.key === 'video', 'text-orange-500': tab.key === 'tts' }" />
                  {{ tab.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 提示词配置 -->
        <div class="px-2 mt-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            :class="activeSection === 'prompts' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
            @click="toggleSection('prompts')"
          >
            <component :is="expandedSections.has('prompts') ? ChevronDown : ChevronRight" class="h-4 w-4 transition-transform" />
            <FileText class="h-4 w-4" />
            提示词配置
          </button>

          <!-- 提示词列表 - 树形结构 -->
          <div v-show="expandedSections.has('prompts')" class="ml-6 mt-1 space-y-0.5 border-l pl-2">
            <div v-if="promptsLoading" class="flex items-center justify-center py-4">
              <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
            <div v-else class="space-y-0.5">
              <div v-for="(prompts, category) in groupedPrompts" :key="category">
                <!-- 分类标题 - 可折叠 -->
                <button
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left"
                  :class="expandedPromptCategories.has(category) ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                  @click="togglePromptCategory(category)"
                >
                  <component :is="expandedPromptCategories.has(category) ? ChevronDown : ChevronRight" class="h-3 w-3" />
                  <component
                    :is="categoryConfig[category as keyof typeof categoryConfig]?.icon || FileText"
                    class="h-3.5 w-3.5"
                    :class="{
                      'text-blue-500': category === 'text',
                      'text-green-500': category === 'image',
                      'text-purple-500': category === 'video',
                      'text-orange-500': category === 'audio'
                    }"
                  />
                  {{ promptCategoryConfig[category]?.name || category }}
                </button>
                <!-- 分类下的提示词 -->
                <div v-show="expandedPromptCategories.has(category)" class="ml-4 mt-1 space-y-0.5 border-l pl-2">
                  <button
                    v-for="prompt in prompts"
                    :key="prompt.id"
                    class="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors text-left"
                    :class="selectedPromptId === prompt.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'"
                    @click="selectPrompt(prompt.id)"
                  >
                    <span class="truncate">{{ prompt.name }}</span>
                    <span
                      v-if="promptTemplates?.find?.(t => t.id === prompt.id)?.isCustomized"
                      class="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

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
                  <select
                    :value="selectedModels.text"
                    class="w-full h-9 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    @change="updateGlobalWorkflowDefault('text', ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="model in models.text" :key="model.model" :value="model.model">
                      [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                    </option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">图片生成</label>
                  <select
                    :value="selectedModels.image"
                    class="w-full h-9 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    @change="updateGlobalWorkflowDefault('image', ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="model in models.image" :key="model.model" :value="model.model">
                      [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                    </option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs text-muted-foreground">视频生成</label>
                  <select
                    :value="selectedModels.video"
                    class="w-full h-9 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    @change="updateGlobalWorkflowDefault('video', ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="model in models.video" :key="model.model" :value="model.model">
                      [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                    </option>
                  </select>
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
                    <select :value="workflow.selectedModel || ''" :disabled="workflowSaving"
                      class="w-full h-10 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      @change="updateWorkflowModel(workflow.id, ($event.target as HTMLSelectElement).value)">
                      <option value="" disabled>选择模型...</option>
                      <option v-for="model in workflow.compatibleModels" :key="model.model" :value="model.model">
                        [{{ getProviderLabel(model.provider) }}] {{ model.displayName }}
                        <template v-if="model.capabilities.length"> - {{ model.capabilities.slice(0, 2).join(', ') }}</template>
                      </option>
                    </select>
                    <div v-if="workflow.selectedModel" class="mt-2 flex flex-wrap gap-1">
                      <span v-for="cap in (workflow.compatibleModels.find(m => m.model === workflow.selectedModel)?.capabilities || [])" :key="cap"
                        class="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">{{ cap }}</span>
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
                  :class="{ 'bg-blue-500': getProviderColor(group.provider) === 'blue', 'bg-orange-500': getProviderColor(group.provider) === 'orange', 'bg-green-500': getProviderColor(group.provider) === 'green', 'bg-purple-500': getProviderColor(group.provider) === 'purple', 'bg-red-500': getProviderColor(group.provider) === 'red' }" />
                <span class="text-sm font-medium flex-1 truncate">{{ group.displayName }}</span>
                <span class="text-xs text-muted-foreground">{{ group.models.length }}</span>
              </div>
              <div v-show="group.expanded" class="pb-1">
                <div v-for="model in group.models" :key="model.model"
                  class="flex items-start gap-2 pl-7 pr-2 py-1.5 cursor-pointer transition-colors"
                  :class="model.model === currentSelectedModel ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'"
                  @click="selectModel(activeTab === 'tts' ? 'tts' : activeTab, model.model)">
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
              <Textarea v-model="customPrompts[activeTab]" :placeholder="defaultPrompts[activeTab]" class="resize-none text-sm" :rows="activeTab === 'image' || activeTab === 'video' ? 3 : 2" />
            </div>
            <div v-if="activeTab === 'image' && currentImageModelSupportsReference" class="space-y-2">
              <label class="text-xs text-muted-foreground flex items-center gap-1"><ImagePlus class="h-3 w-3" />参考图片 (可选，最多4张)</label>
              <div class="flex flex-wrap gap-2">
                <div v-for="(img, index) in referenceImages" :key="index" class="relative w-16 h-16 rounded-lg overflow-hidden border group">
                  <img :src="img" class="w-full h-full object-cover" />
                  <button class="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity" @click="removeReferenceImage(index)"><X class="h-3 w-3" /></button>
                </div>
                <button v-if="referenceImages.length < 4" class="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors" @click="triggerFileInput"><ImagePlus class="h-5 w-5" /></button>
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

      <!-- 提示词配置 -->
      <div v-else-if="activeSection === 'prompts'" class="h-full flex flex-col">
        <div v-if="!selectedPromptTemplate" class="h-full flex flex-col items-center justify-center text-muted-foreground">
          <FileText class="h-12 w-12 mb-3 opacity-20" />
          <p class="text-sm">请从左侧选择一个提示词模板进行编辑</p>
        </div>
        <PromptEditor
          v-else
          :template="selectedPromptTemplate"
          @update="handlePromptUpdate"
          @saved="handlePromptSaved"
        />
      </div>
    </div>
  </div>
</template>

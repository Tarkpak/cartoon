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
  X
} from 'lucide-vue-next'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'

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

definePageMeta({ layout: 'default' })

// 状态
const loading = ref(true)
const models = ref<ModelsData | null>(null)
const selectedModels = ref<SelectedModels>({
  text: '', image: '', video: '', tts: '', asr: ''
})

// 当前选中的模型类型
const activeTab = ref<'text' | 'image' | 'video' | 'tts'>('text')

// 展开的供应商
const expandedProviders = ref<Set<string>>(new Set())

// 自定义提示词
const customPrompts = ref({ text: '', image: '', video: '', tts: '' })

// 参考图片 (base64 数组，最多4张)
const referenceImages = ref<string[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

// 默认提示词
const defaultPrompts = {
  text: '你好，请用一句话介绍你自己。',
  image: '一只可爱的橘色小猫，日式动漫风格，白色背景',
  video: '一只小猫在草地上奔跑，阳光明媚',
  tts: '你好，这是一段测试语音。'
}

// 测试状态
const testResults = ref<{
  text: TestResult; image: TestResult; video: TestResult; tts: TestResult
}>({
  text: { status: 'idle' }, image: { status: 'idle' },
  video: { status: 'idle' }, tts: { status: 'idle' }
})

// 供应商配置
const providerConfig: Record<string, { displayName: string; color: string; order: number }> = {
  gemini: { displayName: 'Google Gemini', color: 'blue', order: 1 },
  qwen: { displayName: '阿里千问', color: 'orange', order: 2 },
  openai: { displayName: 'OpenAI', color: 'green', order: 3 },
  deepseek: { displayName: 'DeepSeek', color: 'purple', order: 4 },
  anthropic: { displayName: 'Anthropic', color: 'amber', order: 5 },
  baidu: { displayName: '百度文心', color: 'red', order: 6 }
}

// 当前选中的图片模型是否支持参考图
const currentImageModelSupportsReference = computed(() => {
  if (activeTab.value !== 'image' || !models.value) return false
  const modelId = selectedModels.value.image
  const model = models.value.image.find(m => m.model === modelId)
  return model?.supportReferenceImage === true
})

// 当前选中的图片模型是否必须需要参考图
const currentImageModelRequiresReference = computed(() => {
  if (activeTab.value !== 'image' || !models.value) return false
  const modelId = selectedModels.value.image
  const model = models.value.image.find(m => m.model === modelId)
  return (model as any)?.requireReferenceImage === true
})

// 是否可以运行测试 (如果模型需要参考图但没有上传，则不能测试)
const canRunImageTest = computed(() => {
  if (activeTab.value !== 'image') return true
  if (!currentImageModelRequiresReference.value) return true
  return referenceImages.value.length > 0
})

// 加载模型列表
async function loadModels() {
  loading.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: { available: ModelsData; selected: SelectedModels }
    }>('/api/models')
    if (response.success) {
      models.value = response.data.available
      selectedModels.value = response.data.selected
      // 自动展开已选中模型的供应商
      autoExpandSelectedProviders()
    }
  } catch (e) {
    console.error('加载模型列表失败:', e)
  } finally {
    loading.value = false
  }
}

// 自动展开已选中模型的供应商
function autoExpandSelectedProviders() {
  const currentModels = getCurrentModelList()
  const selectedId = currentSelectedModel.value
  const selectedModel = currentModels.find(m => m.model === selectedId)
  if (selectedModel) {
    expandedProviders.value.add(selectedModel.provider)
  }
}

// 切换模型
async function selectModel(type: 'text' | 'image' | 'video' | 'tts', modelId: string) {
  try {
    await $fetch('/api/models/switch', { method: 'POST', body: { type, modelId } })
    selectedModels.value[type] = modelId
    testResults.value[type] = { status: 'idle' }
    // 切换图片模型时清空参考图
    if (type === 'image') {
      referenceImages.value = []
    }
  } catch (e) {
    console.error('切换模型失败:', e)
  }
}

// 处理参考图上传
function handleReferenceImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  // 最多4张
  const remainingSlots = 4 - referenceImages.value.length
  const filesToProcess = Array.from(files).slice(0, remainingSlots)

  filesToProcess.forEach(file => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      if (base64 && referenceImages.value.length < 4) {
        referenceImages.value.push(base64)
      }
    }
    reader.readAsDataURL(file)
  })

  // 清空 input 以便重复选择同一文件
  input.value = ''
}

// 删除参考图
function removeReferenceImage(index: number) {
  referenceImages.value.splice(index, 1)
}

// 触发文件选择
function triggerFileInput() {
  fileInputRef.value?.click()
}

// 测试模型
async function testModel(modelType: 'text' | 'image' | 'video' | 'tts') {
  testResults.value[modelType] = { status: 'testing' }
  const prompt = customPrompts.value[modelType] || defaultPrompts[modelType]

  try {
    const body: Record<string, unknown> = { modelType, prompt }
    
    // 图片模型支持参考图
    if (modelType === 'image' && referenceImages.value.length > 0) {
      body.referenceImages = referenceImages.value
    }

    const response = await $fetch<{
      success: boolean
      data?: { modelId: string; provider: string; displayName: string; result: unknown; latencyMs: number }
      error?: string
    }>('/api/models/test', { method: 'POST', body })

    if (response.success && response.data) {
      testResults.value[modelType] = {
        status: 'success',
        message: `测试成功 (${response.data.latencyMs}ms)`,
        latencyMs: response.data.latencyMs,
        result: response.data.result
      }
    } else {
      testResults.value[modelType] = { status: 'error', message: response.error || '测试失败' }
    }
  } catch (e) {
    testResults.value[modelType] = {
      status: 'error',
      message: e instanceof Error ? e.message : '测试失败'
    }
  }
}

// 获取当前 tab 的模型列表
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

// 按供应商分组的模型
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
    .sort((a, b) => {
      const orderA = providerConfig[a.provider]?.order || 99
      const orderB = providerConfig[b.provider]?.order || 99
      return orderA - orderB
    })
})

// 当前选中的模型 ID
const currentSelectedModel = computed(() => {
  switch (activeTab.value) {
    case 'text': return selectedModels.value.text
    case 'image': return selectedModels.value.image
    case 'video': return selectedModels.value.video
    case 'tts': return selectedModels.value.tts
    default: return ''
  }
})

// 切换供应商展开状态
function toggleProvider(provider: string) {
  if (expandedProviders.value.has(provider)) {
    expandedProviders.value.delete(provider)
  } else {
    expandedProviders.value.add(provider)
  }
}

// Tab 配置
const tabs = [
  { key: 'text' as const, label: '文本生成', icon: Cpu },
  { key: 'image' as const, label: '图片生成', icon: Image },
  { key: 'video' as const, label: '视频生成', icon: Video },
  { key: 'tts' as const, label: '语音合成', icon: Mic }
]

// 切换 tab 时自动展开已选中模型的供应商
watch(activeTab, () => {
  expandedProviders.value.clear()
  autoExpandSelectedProviders()
})

function getProviderColor(provider: string) {
  return providerConfig[provider]?.color || 'gray'
}

onMounted(() => loadModels())
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 页面标题 -->
    <div class="flex-shrink-0 px-6 py-4 border-b">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-primary/10">
          <Settings class="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 class="text-xl font-semibold">模型设置</h1>
          <p class="text-sm text-muted-foreground">配置和测试 AI 模型</p>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">加载模型配置...</span>
    </div>

    <!-- 主内容区 -->
    <div v-else-if="models" class="flex-1 flex overflow-hidden">
      <!-- 左侧：模型选择 -->
      <div class="w-72 flex-shrink-0 border-r flex flex-col bg-muted/30">
        <!-- Tab 切换 -->
        <div class="flex-shrink-0 p-2 border-b bg-background">
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-colors"
              :class="activeTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent text-muted-foreground'"
              @click="activeTab = tab.key"
            >
              <component :is="tab.icon" class="h-4 w-4" />
              <span class="truncate">{{ tab.label.slice(0, 2) }}</span>
            </button>
          </div>
        </div>

        <!-- 树形模型列表 -->
        <div class="flex-1 overflow-y-auto py-1">
          <div v-for="group in groupedModels" :key="group.provider" class="select-none">
            <!-- 供应商节点 -->
            <div
              class="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors"
              @click="toggleProvider(group.provider)"
            >
              <component
                :is="group.expanded ? ChevronDown : ChevronRight"
                class="h-4 w-4 text-muted-foreground flex-shrink-0"
              />
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="{
                  'bg-blue-500': getProviderColor(group.provider) === 'blue',
                  'bg-orange-500': getProviderColor(group.provider) === 'orange',
                  'bg-green-500': getProviderColor(group.provider) === 'green',
                  'bg-purple-500': getProviderColor(group.provider) === 'purple',
                  'bg-amber-500': getProviderColor(group.provider) === 'amber',
                  'bg-red-500': getProviderColor(group.provider) === 'red',
                  'bg-gray-500': getProviderColor(group.provider) === 'gray'
                }"
              />
              <span class="text-sm font-medium flex-1 truncate">{{ group.displayName }}</span>
              <span class="text-xs text-muted-foreground">{{ group.models.length }}</span>
            </div>

            <!-- 模型列表 -->
            <div v-show="group.expanded" class="pb-1">
              <div
                v-for="model in group.models"
                :key="model.model"
                class="flex items-start gap-2 pl-7 pr-2 py-1.5 cursor-pointer transition-colors"
                :class="model.model === currentSelectedModel
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-accent/50'"
                @click="selectModel(activeTab === 'tts' ? 'tts' : activeTab, model.model)"
              >
                <div
                  class="mt-1 w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                  :class="model.model === currentSelectedModel
                    ? 'border-primary'
                    : 'border-muted-foreground/40'"
                >
                  <div
                    v-if="model.model === currentSelectedModel"
                    class="w-1.5 h-1.5 rounded-full bg-primary"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1">
                    <span class="text-sm truncate">{{ model.displayName }}</span>
                    <a
                      v-if="(model as any).docUrl"
                      :href="(model as any).docUrl"
                      target="_blank"
                      class="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                      @click.stop
                      title="查看API文档"
                    >
                      <ExternalLink class="h-3 w-3" />
                    </a>
                  </div>
                  <div class="flex gap-1 mt-0.5 flex-wrap">
                    <span
                      v-if="(model as any).supportThinking"
                      class="px-1 py-0.5 text-[9px] rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                    >思考</span>
                    <span
                      v-if="(model as any).supportReferenceImage"
                      class="px-1 py-0.5 text-[9px] rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300"
                    >参考图</span>
                    <span
                      v-if="(model as any).supportReferenceImage === false && activeTab === 'image'"
                      class="px-1 py-0.5 text-[9px] rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
                    >纯文生图</span>
                    <span
                      v-if="(model as any).maxDuration"
                      class="px-1 py-0.5 text-[9px] rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    >{{ (model as any).maxDuration }}s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：测试区域 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 测试输入区 -->
        <div class="flex-shrink-0 p-4 border-b space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium flex items-center gap-2">
              <Sparkles class="h-4 w-4 text-primary" />
              测试 {{ tabs.find(t => t.key === activeTab)?.label }}
            </h3>
            <div class="flex items-center gap-2">
              <span
                v-if="activeTab === 'image' && currentImageModelRequiresReference && referenceImages.length === 0"
                class="text-xs text-amber-600 dark:text-amber-400"
              >
                此模型需要参考图
              </span>
              <Button
                size="sm"
                @click="testModel(activeTab)"
                :disabled="testResults[activeTab].status === 'testing' || !canRunImageTest"
              >
                <Loader2
                  v-if="testResults[activeTab].status === 'testing'"
                  class="h-4 w-4 mr-1.5 animate-spin"
                />
                <Play v-else class="h-4 w-4 mr-1.5" />
                {{ testResults[activeTab].status === 'testing' ? '测试中...' : '运行测试' }}
              </Button>
            </div>
          </div>

          <div>
            <label class="text-xs text-muted-foreground mb-1.5 block">
              {{ activeTab === 'tts' ? '测试文本' : '测试提示词' }}
            </label>
            <Textarea
              v-model="customPrompts[activeTab]"
              :placeholder="defaultPrompts[activeTab]"
              class="resize-none text-sm"
              :rows="activeTab === 'image' || activeTab === 'video' ? 3 : 2"
            />
          </div>

          <!-- 参考图上传区域 (仅支持参考图的图片模型显示) -->
          <div v-if="activeTab === 'image' && currentImageModelSupportsReference" class="space-y-2">
            <label class="text-xs text-muted-foreground flex items-center gap-1">
              <ImagePlus class="h-3 w-3" />
              参考图片 (可选，最多4张)
            </label>
            <div class="flex flex-wrap gap-2">
              <!-- 已上传的图片 -->
              <div
                v-for="(img, index) in referenceImages"
                :key="index"
                class="relative w-16 h-16 rounded-lg overflow-hidden border group"
              >
                <img :src="img" class="w-full h-full object-cover" />
                <button
                  class="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  @click="removeReferenceImage(index)"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
              <!-- 添加按钮 -->
              <button
                v-if="referenceImages.length < 4"
                class="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                @click="triggerFileInput"
              >
                <ImagePlus class="h-5 w-5" />
              </button>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleReferenceImageUpload"
            />
          </div>
        </div>

        <!-- 测试结果区 -->
        <div class="flex-1 overflow-y-auto p-4">
          <!-- 空状态 -->
          <div
            v-if="testResults[activeTab].status === 'idle'"
            class="h-full flex flex-col items-center justify-center text-muted-foreground"
          >
            <component
              :is="tabs.find(t => t.key === activeTab)?.icon"
              class="h-12 w-12 mb-3 opacity-20"
            />
            <p class="text-sm">点击"运行测试"查看结果</p>
          </div>

          <!-- 测试中 -->
          <div
            v-else-if="testResults[activeTab].status === 'testing'"
            class="h-full flex flex-col items-center justify-center"
          >
            <Loader2 class="h-10 w-10 animate-spin text-primary mb-3" />
            <p class="text-sm text-muted-foreground">正在测试模型...</p>
          </div>

          <!-- 测试成功 -->
          <div v-else-if="testResults[activeTab].status === 'success'" class="space-y-4">
            <div class="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 class="h-5 w-5" />
              <span class="font-medium">{{ testResults[activeTab].message }}</span>
            </div>

            <div
              v-if="activeTab === 'text' && testResults.text.result"
              class="p-4 rounded-lg bg-muted/50 border"
            >
              <p class="text-sm whitespace-pre-wrap">{{ testResults.text.result }}</p>
            </div>

            <div v-if="activeTab === 'image' && (testResults.image.result as any)?.imageUrl">
              <img
                :src="(testResults.image.result as any).imageUrl"
                alt="生成的图片"
                class="max-w-full max-h-[400px] rounded-lg border shadow-sm"
              />
            </div>

            <div
              v-if="activeTab === 'video' && testResults.video.result"
              class="space-y-2"
            >
              <video
                v-if="(testResults.video.result as any)?.videoUrl"
                :src="(testResults.video.result as any).videoUrl"
                controls
                class="max-w-full max-h-[400px] rounded-lg border shadow-sm"
              />
              <p v-else class="text-sm p-4 rounded-lg bg-muted/50 border">
                {{ (testResults.video.result as any)?.message }}
              </p>
            </div>

            <div
              v-if="activeTab === 'tts' && testResults.tts.result"
              class="p-4 rounded-lg bg-muted/50 border"
            >
              <p class="text-sm text-muted-foreground">
                {{ (testResults.tts.result as any)?.hasAudioData ? '音频生成成功' : '音频生成完成' }}
              </p>
            </div>
          </div>

          <!-- 测试失败 -->
          <div
            v-else-if="testResults[activeTab].status === 'error'"
            class="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
          >
            <div class="flex items-start gap-2">
              <XCircle class="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-red-700 dark:text-red-300">测试失败</p>
                <p class="text-sm text-red-600 dark:text-red-400 mt-1">
                  {{ testResults[activeTab].message }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

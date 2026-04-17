<script setup lang="ts">
import { ChevronDown, Cpu, Image, Video, Mic, Check } from 'lucide-vue-next'
import type { TextModelConfig, ImageModelConfig, VideoModelConfig, VoiceModelConfig } from '#shared/types/provider'

type ModelType = 'text' | 'image' | 'video' | 'tts' | 'asr'
type ModelConfig = TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig

const props = defineProps<{
  type: ModelType
  modelId: string
  models: ModelConfig[]
  label?: string
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelId': [value: string]
}>()

const open = ref(false)

const selectedModel = computed(() =>
  props.models.find(m => m.model === props.modelId)
)

const typeIcon = computed(() => {
  switch (props.type) {
    case 'text': return Cpu
    case 'image': return Image
    case 'video': return Video
    case 'tts':
    case 'asr': return Mic
    default: return Cpu
  }
})

const typeLabel = computed(() => {
  if (props.label) return props.label
  switch (props.type) {
    case 'text': return '文本模型'
    case 'image': return '图片模型'
    case 'video': return '视频模型'
    case 'tts': return '语音合成'
    case 'asr': return '语音识别'
    default: return '模型'
  }
})

function selectModel(model: ModelConfig) {
  emit('update:modelId', model.model)
  open.value = false
}

function getProviderBadge(provider: string) {
  switch (provider) {
    case 'gemini': return { text: 'Gemini', class: 'bg-blue-100 text-blue-700' }
    case 'qwen': return { text: '千问', class: 'bg-orange-100 text-orange-700' }
    case 'kling': return { text: '可灵', class: 'bg-cyan-100 text-cyan-700' }
    case 'volcengine': return { text: '火山', class: 'bg-red-100 text-red-700' }
    case 'openai': return { text: 'OpenAI', class: 'bg-green-100 text-green-700' }
    case 'deepseek': return { text: 'DeepSeek', class: 'bg-purple-100 text-purple-700' }
    default: return { text: provider, class: 'bg-gray-100 text-gray-700' }
  }
}
</script>

<template>
  <div class="relative">
    <Button
      variant="outline"
      role="combobox"
      :aria-expanded="open"
      :class="[
        'w-full justify-between',
        compact ? 'h-8 text-xs px-2' : 'h-9'
      ]"
      @click="open = !open"
    >
      <div class="flex items-center gap-2 truncate">
        <component
          :is="typeIcon"
          :class="compact ? 'h-3 w-3' : 'h-4 w-4'"
        />
        <span
          v-if="!compact"
          class="text-muted-foreground"
        >{{ typeLabel }}:</span>
        <span class="truncate">{{ selectedModel?.displayName || '选择模型' }}</span>
      </div>
      <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>

    <!-- 下拉菜单 -->
    <div
      v-if="open"
      class="absolute z-50 mt-1 w-full min-w-80 bg-background border rounded-md shadow-lg"
    >
      <div class="p-2 border-b">
        <div class="text-sm font-medium">
          {{ typeLabel }}
        </div>
        <div class="text-xs text-muted-foreground">
          选择要使用的AI模型
        </div>
      </div>
      <div class="max-h-64 overflow-y-auto p-1">
        <div
          v-for="model in models"
          :key="model.model"
          class="flex items-start gap-3 p-2 rounded-md cursor-pointer hover:bg-accent"
          :class="{ 'bg-accent': model.model === modelId }"
          @click="selectModel(model)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">{{ model.displayName }}</span>
              <span
                :class="[
                  'px-1.5 py-0.5 text-[10px] rounded',
                  getProviderBadge(model.provider).class
                ]"
              >
                {{ getProviderBadge(model.provider).text }}
              </span>
            </div>
            <p
              v-if="model.description"
              class="text-xs text-muted-foreground mt-0.5 truncate"
            >
              {{ model.description }}
            </p>
          </div>
          <Check
            v-if="model.model === modelId"
            class="h-4 w-4 text-primary shrink-0 mt-0.5"
          />
        </div>
      </div>
    </div>

    <!-- 点击外部关闭 -->
    <div
      v-if="open"
      class="fixed inset-0 z-40"
      @click="open = false"
    />
  </div>
</template>

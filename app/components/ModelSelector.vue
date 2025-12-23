<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { 
  TextModelConfig, 
  ImageModelConfig, 
  VideoModelConfig, 
  VoiceModelConfig,
  SelectedModels 
} from '../../shared/types/provider'

// 模型数据
const textModels = ref<TextModelConfig[]>([])
const imageModels = ref<ImageModelConfig[]>([])
const videoModels = ref<VideoModelConfig[]>([])
const voiceModels = ref<VoiceModelConfig[]>([])
const selectedModels = ref<SelectedModels>({
  text: '',
  image: '',
  video: '',
  tts: '',
  asr: ''
})

const loading = ref(false)
const error = ref<string | null>(null)

// 获取模型列表
async function fetchModels() {
  loading.value = true
  error.value = null
  
  try {
    const response = await $fetch<{
      success: boolean
      data: {
        available: {
          text: TextModelConfig[]
          image: ImageModelConfig[]
          video: VideoModelConfig[]
          voice: VoiceModelConfig[]
        }
        selected: SelectedModels
      }
    }>('/api/models')
    
    if (response.success) {
      textModels.value = response.data.available.text
      imageModels.value = response.data.available.image
      videoModels.value = response.data.available.video
      voiceModels.value = response.data.available.voice
      selectedModels.value = response.data.selected
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '获取模型列表失败'
  } finally {
    loading.value = false
  }
}

// 切换模型
async function switchModel(type: 'text' | 'image' | 'video' | 'tts' | 'asr', modelId: string) {
  try {
    const response = await $fetch<{
      success: boolean
      data: { selected: SelectedModels }
    }>('/api/models/switch', {
      method: 'POST',
      body: { type, modelId }
    })
    
    if (response.success) {
      selectedModels.value = response.data.selected
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '切换模型失败'
  }
}

// 获取提供商标签颜色
function getProviderColor(provider: string) {
  switch (provider) {
    case 'gemini': return 'bg-blue-100 text-blue-800'
    case 'qwen': return 'bg-orange-100 text-orange-800'
    case 'openai': return 'bg-green-100 text-green-800'
    case 'deepseek': return 'bg-purple-100 text-purple-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function getProviderName(provider: string) {
  switch (provider) {
    case 'gemini': return 'Google'
    case 'qwen': return '阿里云'
    case 'openai': return 'OpenAI'
    case 'deepseek': return 'DeepSeek'
    default: return provider
  }
}

onMounted(fetchModels)
</script>

<template>
  <div class="p-4 space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">模型设置</h2>
      <button 
        @click="fetchModels" 
        :disabled="loading"
        class="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
      >
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="error" class="p-3 bg-red-50 text-red-600 rounded-md text-sm">
      {{ error }}
    </div>

    <!-- 文本模型 -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">文本生成模型</h3>
      <div class="grid gap-2">
        <label 
          v-for="model in textModels" 
          :key="model.model"
          class="flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
          :class="{ 'border-blue-500 bg-blue-50': selectedModels.text === model.model }"
        >
          <input 
            type="radio" 
            :value="model.model" 
            :checked="selectedModels.text === model.model"
            @change="switchModel('text', model.model)"
            class="mt-1 mr-3"
          />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ model.displayName }}</span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full"
                :class="getProviderColor(model.provider)"
              >
                {{ getProviderName(model.provider) }}
              </span>
              <span 
                v-if="model.supportThinking" 
                class="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full"
              >
                深度思考
              </span>
            </div>
            <p v-if="model.description" class="text-sm text-gray-500 mt-1">
              {{ model.description }}
            </p>
          </div>
        </label>
      </div>
    </div>

    <!-- 图片模型 -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">图片生成模型</h3>
      <div class="grid gap-2">
        <label 
          v-for="model in imageModels" 
          :key="model.model"
          class="flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
          :class="{ 'border-blue-500 bg-blue-50': selectedModels.image === model.model }"
        >
          <input 
            type="radio" 
            :value="model.model" 
            :checked="selectedModels.image === model.model"
            @change="switchModel('image', model.model)"
            class="mt-1 mr-3"
          />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ model.displayName }}</span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full"
                :class="getProviderColor(model.provider)"
              >
                {{ getProviderName(model.provider) }}
              </span>
              <span 
                v-if="model.supportReferenceImage" 
                class="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full"
              >
                支持参考图
              </span>
            </div>
            <p v-if="model.description" class="text-sm text-gray-500 mt-1">
              {{ model.description }}
            </p>
          </div>
        </label>
      </div>
    </div>

    <!-- 视频模型 -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">视频生成模型</h3>
      <div class="grid gap-2">
        <label 
          v-for="model in videoModels" 
          :key="model.model"
          class="flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
          :class="{ 'border-blue-500 bg-blue-50': selectedModels.video === model.model }"
        >
          <input 
            type="radio" 
            :value="model.model" 
            :checked="selectedModels.video === model.model"
            @change="switchModel('video', model.model)"
            class="mt-1 mr-3"
          />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ model.displayName }}</span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full"
                :class="getProviderColor(model.provider)"
              >
                {{ getProviderName(model.provider) }}
              </span>
              <span 
                v-if="model.maxDuration" 
                class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full"
              >
                最长{{ model.maxDuration }}秒
              </span>
            </div>
            <p v-if="model.description" class="text-sm text-gray-500 mt-1">
              {{ model.description }}
            </p>
            <div class="flex gap-2 mt-1">
              <span 
                v-if="model.supportTextToVideo" 
                class="text-xs text-gray-400"
              >文生视频</span>
              <span 
                v-if="model.supportImageToVideo" 
                class="text-xs text-gray-400"
              >图生视频</span>
              <span 
                v-if="model.supportFirstLastFrame" 
                class="text-xs text-gray-400"
              >首尾帧</span>
            </div>
          </div>
        </label>
      </div>
    </div>

    <!-- TTS 模型 -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">语音合成模型 (TTS)</h3>
      <div class="grid gap-2">
        <label 
          v-for="model in voiceModels.filter(m => m.type === 'tts')" 
          :key="model.model"
          class="flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
          :class="{ 'border-blue-500 bg-blue-50': selectedModels.tts === model.model }"
        >
          <input 
            type="radio" 
            :value="model.model" 
            :checked="selectedModels.tts === model.model"
            @change="switchModel('tts', model.model)"
            class="mt-1 mr-3"
          />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ model.displayName }}</span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full"
                :class="getProviderColor(model.provider)"
              >
                {{ getProviderName(model.provider) }}
              </span>
            </div>
            <p v-if="model.description" class="text-sm text-gray-500 mt-1">
              {{ model.description }}
            </p>
          </div>
        </label>
      </div>
    </div>

    <!-- ASR 模型 -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">语音识别模型 (ASR)</h3>
      <div class="grid gap-2">
        <label 
          v-for="model in voiceModels.filter(m => m.type === 'asr')" 
          :key="model.model"
          class="flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
          :class="{ 'border-blue-500 bg-blue-50': selectedModels.asr === model.model }"
        >
          <input 
            type="radio" 
            :value="model.model" 
            :checked="selectedModels.asr === model.model"
            @change="switchModel('asr', model.model)"
            class="mt-1 mr-3"
          />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ model.displayName }}</span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full"
                :class="getProviderColor(model.provider)"
              >
                {{ getProviderName(model.provider) }}
              </span>
            </div>
            <p v-if="model.description" class="text-sm text-gray-500 mt-1">
              {{ model.description }}
            </p>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>

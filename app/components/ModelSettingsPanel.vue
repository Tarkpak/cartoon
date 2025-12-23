<script setup lang="ts">
import { Settings2 } from 'lucide-vue-next'
import type { TextModelConfig, ImageModelConfig, VideoModelConfig, VoiceModelConfig, SelectedModels } from '#shared/types/provider'

interface ModelsData {
  text: TextModelConfig[]
  image: ImageModelConfig[]
  video: VideoModelConfig[]
  voice: VoiceModelConfig[]
}

const props = defineProps<{
  selectedModels: SelectedModels
}>()

const emit = defineEmits<{
  'update:selectedModels': [value: SelectedModels]
}>()

const open = ref(false)
const loading = ref(false)
const models = ref<ModelsData | null>(null)

// 加载模型列表
async function loadModels() {
  if (models.value) return
  loading.value = true
  try {
    const response = await $fetch<{
      success: boolean
      models: ModelsData
    }>('/api/models/list')
    if (response.success) {
      models.value = response.models
    }
  } catch (e) {
    console.error('加载模型列表失败:', e)
  } finally {
    loading.value = false
  }
}

// 切换模型
async function selectModel(type: keyof SelectedModels, modelId: string) {
  try {
    await $fetch('/api/models/select', {
      method: 'POST',
      body: { type, modelId }
    })
    emit('update:selectedModels', {
      ...props.selectedModels,
      [type]: modelId
    })
  } catch (e) {
    console.error('切换模型失败:', e)
  }
}

// 打开时加载模型
watch(open, (isOpen) => {
  if (isOpen) {
    loadModels()
  }
})

// 分离 TTS 模型
const ttsModels = computed(() => 
  models.value?.voice.filter(v => v.type === 'tts') || []
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="ghost" size="sm" class="gap-2">
        <Settings2 class="h-4 w-4" />
        <span class="hidden sm:inline">模型设置</span>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Settings2 class="h-5 w-5" />
          AI模型设置
        </DialogTitle>
        <DialogDescription>
          为不同任务选择合适的AI模型，设置会自动保存
        </DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="py-8 text-center text-muted-foreground">
        加载模型列表...
      </div>

      <div v-else-if="models" class="space-y-4 py-4">
        <!-- 文本模型 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">文本生成模型</label>
          <p class="text-xs text-muted-foreground">用于大纲生成、剧本解析、角色提取等</p>
          <ModelSelector
            type="text"
            :model-id="selectedModels.text"
            :models="models.text"
            @update:model-id="selectModel('text', $event)"
          />
        </div>

        <!-- 图片模型 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">图片生成模型</label>
          <p class="text-xs text-muted-foreground">用于角色立绘、场景背景、首尾帧生成</p>
          <ModelSelector
            type="image"
            :model-id="selectedModels.image"
            :models="models.image"
            @update:model-id="selectModel('image', $event)"
          />
        </div>

        <!-- 视频模型 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">视频生成模型</label>
          <p class="text-xs text-muted-foreground">用于场景视频、转场视频生成</p>
          <ModelSelector
            type="video"
            :model-id="selectedModels.video"
            :models="models.video"
            @update:model-id="selectModel('video', $event)"
          />
        </div>

        <!-- TTS 模型 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">语音合成模型</label>
          <p class="text-xs text-muted-foreground">用于角色配音</p>
          <ModelSelector
            type="tts"
            :model-id="selectedModels.tts || ''"
            :models="ttsModels"
            @update:model-id="selectModel('tts', $event)"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">关闭</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

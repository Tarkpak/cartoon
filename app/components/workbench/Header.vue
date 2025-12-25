<script setup lang="ts">
import { Loader2, Play, Palette } from 'lucide-vue-next'
import type { PipelineStatus } from '~/composables/useWorkbench'
import { getStyleById, type StylePreset } from '#shared/types/styles'

const props = defineProps<{
  projectId?: string
  projectName: string
  projectDescription: string
  sceneCount: number
  charCount: number
  totalCost: string
  totalTime: number
  pipelineStatus: PipelineStatus
  saving: boolean
  canStart: boolean
  selectedStyleId?: string
}>()

const emit = defineEmits<{
  'update:projectName': [value: string]
  'update:projectDescription': [value: string]
  'update:selectedStyleId': [value: string]
  'save': []
  'startPipeline': []
}>()

const localName = computed({
  get: () => props.projectName,
  set: v => emit('update:projectName', v)
})

const localDescription = computed({
  get: () => props.projectDescription,
  set: v => emit('update:projectDescription', v)
})

// 风格选择
const styleDialogOpen = ref(false)
const selectedStyle = computed(() =>
  props.selectedStyleId ? getStyleById(props.selectedStyleId) : null
)

function handleStyleSelect(style: StylePreset) {
  emit('update:selectedStyleId', style.id)
  styleDialogOpen.value = false
}
</script>

<template>
  <div class="flex justify-between items-start mb-8">
    <div class="space-y-2">
      <div class="flex items-center space-x-3">
        <Input
          v-model="localName"
          class="text-2xl font-bold h-auto py-1 px-2 w-64 border-transparent hover:border-input focus:border-primary"
          placeholder="输入项目名称..."
        />
        <Badge v-if="projectId" variant="secondary" class="text-xs">{{ projectId }}</Badge>
      </div>
      <Input
        v-model="localDescription"
        class="text-sm text-muted-foreground h-auto py-1 px-2 w-96 border-transparent hover:border-input focus:border-primary"
        placeholder="添加项目描述..."
      />
    </div>

    <div class="flex items-center space-x-4">
      <!-- 视觉风格选择 -->
      <div
        class="flex items-center space-x-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-accent transition"
        @click="styleDialogOpen = true"
      >
        <Palette class="w-4 h-4 text-muted-foreground" />
        <div v-if="selectedStyle" class="text-sm">
          <span class="font-medium">{{ selectedStyle.name }}</span>
        </div>
        <div v-else class="text-sm text-muted-foreground">
          选择风格
        </div>
      </div>

      <!-- 成本预估 -->
      <div v-if="sceneCount > 0" class="text-right text-sm space-y-1">
        <div class="flex items-center space-x-2 text-muted-foreground">
          <span>{{ sceneCount }} 场景</span>
          <span>·</span>
          <span>{{ charCount }} 角色</span>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-xs text-muted-foreground">预估:</span>
          <Badge variant="outline" class="text-xs">~${{ totalCost }}</Badge>
          <Badge variant="outline" class="text-xs">~{{ totalTime }}分钟</Badge>
        </div>
      </div>

      <!-- 流水线进度 -->
      <div v-if="pipelineStatus.running" class="flex items-center space-x-2 text-sm">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span>{{ pipelineStatus.currentStep }}</span>
        <span class="text-muted-foreground">{{ pipelineStatus.progress }}%</span>
      </div>

      <Button variant="outline" :disabled="pipelineStatus.running || saving" @click="$emit('save')">
        <Loader2 v-if="saving" class="w-4 h-4 mr-2 animate-spin" />
        {{ saving ? '保存中...' : '保存草稿' }}
      </Button>

      <Button :disabled="!canStart || pipelineStatus.running" @click="$emit('startPipeline')">
        <Play v-if="!pipelineStatus.running" class="w-4 h-4 mr-2" />
        <Loader2 v-else class="w-4 h-4 mr-2 animate-spin" />
        {{ pipelineStatus.running ? '生成中...' : '开始生成' }}
      </Button>
    </div>

    <!-- 风格选择对话框 -->
    <Dialog v-model:open="styleDialogOpen">
      <DialogContent class="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Palette class="w-5 h-5" />
            选择视觉风格
          </DialogTitle>
          <DialogDescription>
            选择一种风格预设，将应用于角色立绘和视频生成
          </DialogDescription>
        </DialogHeader>
        <div class="flex-1 overflow-y-auto py-4">
          <StyleSelector
            :model-value="selectedStyleId || ''"
            @select="handleStyleSelect"
          />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

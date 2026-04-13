<script setup lang="ts">
import { Loader2, Play, Palette, ArrowLeft } from 'lucide-vue-next'
import type { PipelineStatus } from '~/composables/useWorkbench'
import type { StylePreset } from '#shared/types/styles'

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
const { resolveStyleById, loadStylePresets } = useStylePresets()
const selectedStyle = computed(() => (
  props.selectedStyleId
    ? (resolveStyleById(props.selectedStyleId) || null)
    : null
))

function handleStyleSelect(style: StylePreset) {
  emit('update:selectedStyleId', style.id)
  styleDialogOpen.value = false
}

onMounted(() => {
  loadStylePresets()
})
</script>

<template>
  <div class="mb-4 rounded-xl border bg-card/60 p-3">
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div class="min-w-0 flex flex-1 items-center gap-2">
        <NuxtLink to="/projects" class="shrink-0">
          <Button variant="outline" size="icon" class="h-8 w-8" title="返回项目列表">
            <ArrowLeft class="w-4 h-4" />
          </Button>
        </NuxtLink>
        <Input
          v-model="localName"
          class="h-9 w-44 md:w-56 text-lg font-semibold border-transparent hover:border-input focus:border-primary"
          placeholder="输入项目名称..."
        />
        <Badge v-if="projectId" variant="secondary" class="text-xs shrink-0">{{ projectId }}</Badge>
        <Input
          v-model="localDescription"
          class="h-9 min-w-0 flex-1 text-sm text-muted-foreground border-transparent hover:border-input focus:border-primary"
          placeholder="添加项目描述..."
        />
      </div>

      <div class="flex items-center gap-2 flex-wrap xl:justify-end">
      <!-- 视觉风格选择 -->
      <div
        class="h-9 flex items-center space-x-2 px-3 rounded-lg border cursor-pointer hover:bg-accent transition shrink-0"
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
      <div v-if="sceneCount > 0" class="flex items-center gap-1.5 shrink-0">
        <Badge variant="secondary" class="h-7 text-xs">{{ sceneCount }} 场景</Badge>
        <Badge variant="secondary" class="h-7 text-xs">{{ charCount }} 角色</Badge>
        <Badge variant="outline" class="h-7 text-xs">~${{ totalCost }}</Badge>
        <Badge variant="outline" class="h-7 text-xs">~{{ totalTime }}分钟</Badge>
      </div>

      <!-- 流水线进度 -->
      <div v-if="pipelineStatus.running" class="h-9 px-3 rounded-lg border bg-muted/30 flex items-center space-x-2 text-xs shrink-0">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span class="max-w-40 truncate">{{ pipelineStatus.currentStep }}</span>
        <span class="text-muted-foreground">{{ pipelineStatus.progress }}%</span>
      </div>

      <Button variant="outline" size="sm" :disabled="pipelineStatus.running || saving" @click="$emit('save')">
        <Loader2 v-if="saving" class="w-4 h-4 mr-2 animate-spin" />
        {{ saving ? '保存中...' : '保存草稿' }}
      </Button>

      <Button size="sm" class="px-4" :disabled="!canStart || pipelineStatus.running" @click="$emit('startPipeline')">
        <Play v-if="!pipelineStatus.running" class="w-4 h-4 mr-2" />
        <Loader2 v-else class="w-4 h-4 mr-2 animate-spin" />
        {{ pipelineStatus.running ? '生成中...' : '开始生成' }}
      </Button>
    </div>
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

<script setup lang="ts">
import { Loader2, Move, ScanSearch } from 'lucide-vue-next'
import { toImageSrc } from '~/lib/media'
import {
  buildCropSelectionFromCoverage,
  buildDefaultCropSelection,
  loadCropImageMetrics,
  normalizeCropSelection,
  resolveCropSelectionCoverage,
  type EnvironmentCropAspectRatio
} from '~/lib/asset-workbench-environment-panorama'
import type { EnvironmentCropSelection } from '~/lib/asset-workbench-types'

const props = defineProps<{
  open: boolean
  targetLabel: string
  sourceImage?: string
  aspectRatio: EnvironmentCropAspectRatio
  initialSelection?: EnvironmentCropSelection
  loading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'submit': [selection: EnvironmentCropSelection]
}>()

const imageWrapperRef = ref<HTMLDivElement | null>(null)
const loadingMetrics = ref(false)
const imageMetrics = ref<{ width: number, height: number } | null>(null)
const selection = ref<EnvironmentCropSelection | null>(null)

const dragState = reactive({
  active: false,
  startPointerX: 0,
  startPointerY: 0,
  startX: 0,
  startY: 0
})

const aspectRatioLabel = computed(() => {
  if (props.aspectRatio === '9:16') return '9:16'
  if (props.aspectRatio === '1:1') return '1:1'
  return '16:9'
})

const aspectRatioStyle = computed(() => {
  if (props.aspectRatio === '9:16') return '9 / 16'
  if (props.aspectRatio === '1:1') return '1 / 1'
  return '16 / 9'
})

const imageSrc = computed(() => toImageSrc(props.sourceImage))

const selectionStyle = computed(() => {
  if (!selection.value) return {}

  return {
    left: `${selection.value.x * 100}%`,
    top: `${selection.value.y * 100}%`,
    width: `${selection.value.width * 100}%`,
    height: `${selection.value.height * 100}%`
  }
})

const previewImageStyle = computed(() => {
  if (!selection.value) return {}

  return {
    width: `${100 / selection.value.width}%`,
    height: `${100 / selection.value.height}%`,
    left: `${-(selection.value.x / selection.value.width) * 100}%`,
    top: `${-(selection.value.y / selection.value.height) * 100}%`
  }
})

const hasSelection = computed(() => !!selection.value && !!imageMetrics.value && !!imageSrc.value)

function stopDragging() {
  dragState.active = false
}

function clampSelectionPosition(nextX: number, nextY: number) {
  if (!selection.value) return

  selection.value = {
    ...selection.value,
    x: Math.max(0, Math.min(1 - selection.value.width, nextX)),
    y: Math.max(0, Math.min(1 - selection.value.height, nextY))
  }
}

function resolveSelectionCenter() {
  if (!selection.value) {
    return { x: 0.5, y: 0.5 }
  }

  return {
    x: selection.value.x + (selection.value.width / 2),
    y: selection.value.y + (selection.value.height / 2)
  }
}

function applyCoverage(coverage: number) {
  if (!imageMetrics.value) return

  const center = resolveSelectionCenter()
  selection.value = buildCropSelectionFromCoverage({
    imageWidth: imageMetrics.value.width,
    imageHeight: imageMetrics.value.height,
    aspectRatio: props.aspectRatio,
    centerX: center.x,
    centerY: center.y,
    coverage
  })
}

function applyCenter(centerX: number, centerY: number) {
  if (!imageMetrics.value) return

  const coverage = resolveCropSelectionCoverage(
    selection.value || undefined,
    imageMetrics.value.width,
    imageMetrics.value.height,
    props.aspectRatio
  )

  selection.value = buildCropSelectionFromCoverage({
    imageWidth: imageMetrics.value.width,
    imageHeight: imageMetrics.value.height,
    aspectRatio: props.aspectRatio,
    centerX,
    centerY,
    coverage
  })
}

function updateCoverage(event: Event) {
  const target = event.target as HTMLInputElement | null
  applyCoverage(Number(target?.value || 100) / 100)
}

function updateHorizontalPosition(event: Event) {
  const target = event.target as HTMLInputElement | null
  applyCenter(Number(target?.value || 50) / 100, resolveSelectionCenter().y)
}

function updateVerticalPosition(event: Event) {
  const target = event.target as HTMLInputElement | null
  applyCenter(resolveSelectionCenter().x, Number(target?.value || 50) / 100)
}

function startDragging(event: PointerEvent) {
  if (!selection.value || !imageWrapperRef.value) return

  dragState.active = true
  dragState.startPointerX = event.clientX
  dragState.startPointerY = event.clientY
  dragState.startX = selection.value.x
  dragState.startY = selection.value.y
}

function handlePointerMove(event: PointerEvent) {
  if (!dragState.active || !imageWrapperRef.value || !selection.value) return

  const bounds = imageWrapperRef.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const deltaX = (event.clientX - dragState.startPointerX) / bounds.width
  const deltaY = (event.clientY - dragState.startPointerY) / bounds.height
  clampSelectionPosition(dragState.startX + deltaX, dragState.startY + deltaY)
}

function handleWrapperClick(event: MouseEvent) {
  if (dragState.active || !imageWrapperRef.value || !selection.value) return
  if ((event.target as HTMLElement | null)?.dataset.selectionBox === 'true') return

  const bounds = imageWrapperRef.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const centerX = (event.clientX - bounds.left) / bounds.width
  const centerY = (event.clientY - bounds.top) / bounds.height
  applyCenter(centerX, centerY)
}

function submit() {
  if (!selection.value) return
  emit('submit', selection.value)
}

async function initializeSelection() {
  if (!props.open || !props.sourceImage?.trim()) {
    imageMetrics.value = null
    selection.value = null
    return
  }

  loadingMetrics.value = true

  try {
    const metrics = await loadCropImageMetrics(props.sourceImage)
    imageMetrics.value = metrics
    selection.value = normalizeCropSelection(
      props.initialSelection,
      metrics.width,
      metrics.height,
      props.aspectRatio
    ) || buildDefaultCropSelection({
      imageWidth: metrics.width,
      imageHeight: metrics.height,
      aspectRatio: props.aspectRatio
    })
  } catch {
    imageMetrics.value = null
    selection.value = null
  } finally {
    loadingMetrics.value = false
  }
}

const coveragePercent = computed(() => {
  if (!imageMetrics.value || !selection.value) return 100
  return Math.round(resolveCropSelectionCoverage(
    selection.value,
    imageMetrics.value.width,
    imageMetrics.value.height,
    props.aspectRatio
  ) * 100)
})

const horizontalPercent = computed(() => {
  return Math.round(resolveSelectionCenter().x * 100)
})

const verticalPercent = computed(() => {
  return Math.round(resolveSelectionCenter().y * 100)
})

watch(
  () => [props.open, props.sourceImage, props.aspectRatio, props.initialSelection] as const,
  () => {
    void initializeSelection()
  },
  { immediate: true }
)

watch(() => props.open, (open) => {
  if (!open) {
    stopDragging()
  }
})

watchEffect((onCleanup) => {
  if (typeof window === 'undefined' || !props.open) return

  const handleUp = () => stopDragging()
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handleUp)

  onCleanup(() => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handleUp)
  })
})
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-h-[92vh] overflow-hidden sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>环境截图区域</DialogTitle>
        <DialogDescription>
          目标：{{ targetLabel || '-' }}。基于环境全景源图选择当前要用于视频的截图区域。
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-3 overflow-hidden">
          <div class="rounded-xl border bg-muted/20 p-3">
            <div
              v-if="loadingMetrics"
              class="flex h-[52vh] items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              正在加载环境全景图
            </div>

            <div
              v-else-if="!imageSrc"
              class="flex h-[52vh] items-center justify-center text-sm text-muted-foreground"
            >
              暂无可用的环境全景图
            </div>

            <div
              v-else
              class="flex max-h-[52vh] justify-center overflow-auto"
            >
              <div
                ref="imageWrapperRef"
                class="relative inline-block max-w-full overflow-hidden rounded-lg"
                @click="handleWrapperClick"
              >
                <img
                  :src="imageSrc"
                  :alt="`${targetLabel} 环境全景图`"
                  class="block max-h-[52vh] max-w-full rounded-lg object-contain"
                  draggable="false"
                >

                <div
                  v-if="selection"
                  class="absolute inset-0"
                >
                  <div
                    class="absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(15,23,42,0.5)]"
                    :style="selectionStyle"
                    data-selection-box="true"
                    @click.stop
                    @pointerdown.stop.prevent="startDragging"
                  >
                    <div class="absolute left-2 top-2 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                      <Move class="h-3 w-3" />
                      {{ aspectRatioLabel }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-xs text-muted-foreground">
            拖动取景框或用右侧滑杆微调。保存后会自动替换当前环境图，但全景源图会保留，方便继续重选。
          </p>
        </div>

        <div class="space-y-4">
          <div class="space-y-2 rounded-xl border bg-card p-3">
            <div class="flex items-center gap-2 text-sm font-medium">
              <ScanSearch class="h-4 w-4" />
              当前截图预览
            </div>
            <div
              class="relative overflow-hidden rounded-lg border bg-muted/30"
              :style="{ aspectRatio: aspectRatioStyle }"
            >
              <img
                v-if="selection && imageSrc"
                :src="imageSrc"
                :alt="`${targetLabel} 当前截图预览`"
                class="absolute max-w-none"
                :style="previewImageStyle"
              >
            </div>
          </div>

          <div class="space-y-4 rounded-xl border bg-card p-3">
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>取景范围</span>
                <span>{{ coveragePercent }}%</span>
              </div>
              <input
                type="range"
                min="35"
                max="100"
                :value="coveragePercent"
                class="w-full"
                :disabled="!hasSelection"
                @input="updateCoverage"
              >
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>水平位置</span>
                <span>{{ horizontalPercent }}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                :value="horizontalPercent"
                class="w-full"
                :disabled="!hasSelection"
                @input="updateHorizontalPosition"
              >
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>垂直位置</span>
                <span>{{ verticalPercent }}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                :value="verticalPercent"
                class="w-full"
                :disabled="!hasSelection"
                @input="updateVerticalPosition"
              >
            </div>

            <p
              v-if="error"
              class="text-xs text-destructive"
            >
              {{ error }}
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          :disabled="loading || !selection"
          @click="submit"
        >
          <Loader2
            v-if="loading"
            class="mr-2 h-4 w-4 animate-spin"
          />
          保存截图区域
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

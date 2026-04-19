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

const previewFrameStyle = computed(() => {
  if (props.aspectRatio === '9:16') {
    return {
      aspectRatio: aspectRatioStyle.value,
      width: 'min(100%, 224px)'
    }
  }

  if (props.aspectRatio === '1:1') {
    return {
      aspectRatio: aspectRatioStyle.value,
      width: 'min(100%, 260px)'
    }
  }

  return {
    aspectRatio: aspectRatioStyle.value,
    width: '100%'
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

function updateCoverageValue(values: number[] | undefined) {
  applyCoverage(Number(values?.[0] ?? 100) / 100)
}

function updateHorizontalPositionValue(values: number[] | undefined) {
  applyCenter(Number(values?.[0] ?? 50) / 100, resolveSelectionCenter().y)
}

function updateVerticalPositionValue(values: number[] | undefined) {
  applyCenter(resolveSelectionCenter().x, Number(values?.[0] ?? 50) / 100)
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
    <DialogContent class="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-6xl xl:max-w-7xl">
      <DialogHeader class="space-y-2 pr-8">
        <DialogTitle>环境截图区域</DialogTitle>
        <DialogDescription>
          目标：{{ targetLabel || '-' }}。基于环境全景源图选择当前要用于视频的截图区域。
        </DialogDescription>
      </DialogHeader>

      <div class="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-3 overflow-hidden">
          <div class="rounded-2xl border bg-muted/15 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium text-foreground">
                <Move class="h-4 w-4 text-primary" />
                环境全景截图区域
              </div>
              <div class="inline-flex items-center rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                输出比例 {{ aspectRatioLabel }}
              </div>
            </div>

            <div
              v-if="loadingMetrics"
              class="flex h-[min(52vh,440px)] items-center justify-center gap-2 rounded-xl border border-dashed bg-background/70 text-sm text-muted-foreground"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              正在加载环境全景图
            </div>

            <div
              v-else-if="!imageSrc"
              class="flex h-[min(52vh,440px)] items-center justify-center rounded-xl border border-dashed bg-background/70 text-sm text-muted-foreground"
            >
              暂无可用的环境全景图
            </div>

            <div
              v-else
              class="flex h-[min(52vh,440px)] items-center justify-center overflow-auto rounded-xl border bg-background/70 p-4"
            >
              <div
                ref="imageWrapperRef"
                class="relative inline-block max-w-full overflow-hidden rounded-xl shadow-sm"
                @click="handleWrapperClick"
              >
                <img
                  :src="imageSrc"
                  :alt="`${targetLabel} 环境全景图`"
                  class="block max-h-[400px] max-w-full rounded-xl object-contain"
                  draggable="false"
                >

                <div
                  v-if="selection"
                  class="absolute inset-0"
                >
                  <div
                    class="absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
                    :style="selectionStyle"
                    data-selection-box="true"
                    @click.stop
                    @pointerdown.stop.prevent="startDragging"
                  >
                    <div class="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground shadow-sm">
                      <Move class="h-3 w-3" />
                      {{ aspectRatioLabel }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <div class="rounded-full border bg-background px-2.5 py-1">
                拖动取景框移动区域
              </div>
              <div class="rounded-full border bg-background px-2.5 py-1">
                点击全景图快速居中
              </div>
              <div class="rounded-full border bg-background px-2.5 py-1">
                右下方滑杆可精细微调
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="rounded-2xl border bg-card p-4">
            <div class="mb-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium">
                <ScanSearch class="h-4 w-4 text-primary" />
                当前截图预览
              </div>
              <div class="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                {{ aspectRatioLabel }}
              </div>
            </div>

            <div class="grid min-h-[280px] place-items-center rounded-xl border bg-muted/25 p-4">
              <div
                class="relative overflow-hidden rounded-xl border bg-background shadow-sm"
                :style="previewFrameStyle"
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

            <p class="mt-3 text-xs leading-5 text-muted-foreground">
              保存后会自动替换当前环境图，但全景源图会保留，方便继续重选。
            </p>
          </div>
        </div>

        <div class="rounded-2xl border bg-card p-4 lg:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-sm font-medium">
                截图微调
              </div>
              <p class="text-xs text-muted-foreground">
                用滑杆快速调整取景范围和中心位置，适合在拖动后做精细修正。
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-xs">
              <div class="rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                取景范围 {{ coveragePercent }}%
              </div>
              <div class="rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                水平位置 {{ horizontalPercent }}%
              </div>
              <div class="rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                垂直位置 {{ verticalPercent }}%
              </div>
            </div>
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-3">
            <div class="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>取景范围</span>
                <span class="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">{{ coveragePercent }}%</span>
              </div>
              <Slider
                :model-value="[coveragePercent]"
                :min="35"
                :max="100"
                :step="1"
                :disabled="!hasSelection"
                class="w-full"
                @update:model-value="updateCoverageValue"
              />
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>更聚焦 35%</span>
                <span>更完整 100%</span>
              </div>
            </div>

            <div class="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>水平位置</span>
                <span class="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">{{ horizontalPercent }}%</span>
              </div>
              <Slider
                :model-value="[horizontalPercent]"
                :min="0"
                :max="100"
                :step="1"
                :disabled="!hasSelection"
                class="w-full"
                @update:model-value="updateHorizontalPositionValue"
              />
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>左侧 0%</span>
                <span>右侧 100%</span>
              </div>
            </div>

            <div class="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>垂直位置</span>
                <span class="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">{{ verticalPercent }}%</span>
              </div>
              <Slider
                :model-value="[verticalPercent]"
                :min="0"
                :max="100"
                :step="1"
                :disabled="!hasSelection"
                class="w-full"
                @update:model-value="updateVerticalPositionValue"
              />
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>顶部 0%</span>
                <span>底部 100%</span>
              </div>
            </div>
          </div>

          <p
            v-if="error"
            class="mt-3 text-xs text-destructive"
          >
            {{ error }}
          </p>
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

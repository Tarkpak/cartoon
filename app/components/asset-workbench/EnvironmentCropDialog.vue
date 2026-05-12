<script setup lang="ts">
import { Loader2, ZoomIn, ZoomOut } from 'lucide-vue-next'
import {
  buildDefaultCropSelection,
  disposePanoramaCanvas,
  loadPanoramaImage,
  normalizePanoramaSelectionForAspectRatio,
  resolveEnvironmentCropCaptureMode,
  resolvePanoramaOutputAspectRatioValue,
  resolvePanoramaSelectionHeightForAspectRatio,
  renderPanoramaSelectionToCanvas
} from '~/lib/asset-workbench-environment-panorama'
import type {
  EnvironmentCropCaptureMode,
  EnvironmentCropSelection
} from '~/lib/asset-workbench-types'

const MIN_VIEW_WIDTH = 0.08
const MAX_VIEW_WIDTH = 1
const MIN_VIEW_FOV_DEGREES = 35
const MAX_VIEW_FOV_DEGREES = 150
const DEFAULT_VIEW_FOV_DEGREES = 80
const DEFAULT_VIEW_WIDTH = DEFAULT_VIEW_FOV_DEGREES / 360

const props = defineProps<{
  open: boolean
  targetLabel: string
  sourceImage?: string
  sourceAspectRatio?: string
  initialSelection?: EnvironmentCropSelection
  initialCaptureMode?: EnvironmentCropCaptureMode
  aspectRatio?: string
  loading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'submit': [payload: { selection: EnvironmentCropSelection, captureMode: EnvironmentCropCaptureMode }]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
const imageMetrics = ref<{ width: number, height: number } | null>(null)
const selection = ref<EnvironmentCropSelection | null>(null)
const panoramaImage = shallowRef<HTMLImageElement | null>(null)
const loadingPreview = ref(false)
const previewError = ref<string | null>(null)
const previewCssSize = ref({ width: 960, height: 540 })
const captureMode = ref<EnvironmentCropCaptureMode>('single')
let renderFrameId = 0

const dragState = reactive({
  active: false,
  pointerId: 0,
  lastX: 0,
  lastY: 0
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return ((value % 1) + 1) % 1
}

const previewAspectRatio = computed(() => resolvePanoramaOutputAspectRatioValue(props.aspectRatio))

const previewCanvasStyle = computed(() => ({
  width: `${previewCssSize.value.width}px`,
  height: `${previewCssSize.value.height}px`
}))

function resolveSelectionHeight(width: number): number {
  return clamp(
    resolvePanoramaSelectionHeightForAspectRatio(width, previewAspectRatio.value),
    0.06,
    0.95
  )
}

const viewFovDegrees = computed({
  get: () => [
    Math.round((selection.value?.width || DEFAULT_VIEW_WIDTH) * 360)
  ],
  set: (value: number[] | undefined) => {
    const nextDegrees = value?.[0]
    if (!Number.isFinite(nextDegrees)) return
    setSelectionWidth(clamp((nextDegrees as number) / 360, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH))
  }
})

function resolvePreviewCanvasCssSize(): { width: number, height: number } {
  const bounds = viewportRef.value?.getBoundingClientRect()
  const availableWidth = Math.max(1, Math.floor(bounds?.width || 960))
  const availableHeight = Math.max(1, Math.floor(bounds?.height || 540))
  const aspectRatio = previewAspectRatio.value

  let width = availableWidth
  let height = width / aspectRatio
  if (height > availableHeight) {
    height = availableHeight
    width = height * aspectRatio
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height))
  }
}

function normalizeViewSelection(raw?: EnvironmentCropSelection): EnvironmentCropSelection {
  const metrics = imageMetrics.value
  const fallback = metrics
    ? buildDefaultCropSelection({
        imageWidth: metrics.width,
        imageHeight: metrics.height,
        outputAspectRatio: previewAspectRatio.value
      })
    : (() => {
        const width = DEFAULT_VIEW_WIDTH
        const height = resolveSelectionHeight(width)
        return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
      })()
  const source = raw || fallback
  const width = clamp(
    source.width || fallback.width || DEFAULT_VIEW_WIDTH,
    MIN_VIEW_FOV_DEGREES / 360,
    MAX_VIEW_FOV_DEGREES / 360
  )
  const height = resolveSelectionHeight(width)
  const centerX = source.x + source.width / 2
  const centerY = source.y + source.height / 2

  return {
    x: wrapUnit(centerX - width / 2),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height
  }
}

function setSelectionCenter(centerX: number, centerY: number) {
  if (!selection.value) return

  selection.value = {
    ...selection.value,
    x: wrapUnit(centerX - selection.value.width / 2),
    y: clamp(centerY - selection.value.height / 2, 0, 1 - selection.value.height)
  }
}

function setSelectionWidth(width: number) {
  if (!selection.value) return

  const normalizedWidth = clamp(width, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH)
  const height = resolveSelectionHeight(normalizedWidth)
  const centerX = selection.value.x + selection.value.width / 2
  const centerY = selection.value.y + selection.value.height / 2

  selection.value = {
    x: wrapUnit(centerX - normalizedWidth / 2),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width: normalizedWidth,
    height
  }
}

function disposePreviewRenderer() {
  disposePanoramaCanvas(canvasRef.value)
}

function renderPreview() {
  renderFrameId = 0
  const canvas = canvasRef.value
  const image = panoramaImage.value
  const currentSelection = selection.value
  if (!canvas || !image || !currentSelection) return

  const nextSize = resolvePreviewCanvasCssSize()
  previewCssSize.value = nextSize
  const dpr = Math.min(2, window.devicePixelRatio || 1)

  try {
    renderPanoramaSelectionToCanvas({
      image,
      canvas,
      selection: currentSelection,
      sourceAspectRatio: props.sourceAspectRatio,
      width: nextSize.width * dpr,
      height: nextSize.height * dpr
    })
    previewError.value = null
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : '360 预览生成失败'
  }
}

function scheduleRenderPreview() {
  if (typeof window === 'undefined' || renderFrameId) return
  renderFrameId = requestAnimationFrame(() => renderPreview())
}

async function initializePreview() {
  if (!props.open || !props.sourceImage?.trim()) {
    imageMetrics.value = null
    selection.value = null
    panoramaImage.value = null
    previewError.value = null
    disposePreviewRenderer()
    return
  }

  loadingPreview.value = true
  previewError.value = null
  captureMode.value = resolveEnvironmentCropCaptureMode(props.initialCaptureMode)

  try {
    const loaded = await loadPanoramaImage(props.sourceImage, {
      sourceAspectRatio: props.sourceAspectRatio
    })
    imageMetrics.value = {
      width: loaded.width,
      height: loaded.height
    }
    const normalizedInitialSelection = normalizePanoramaSelectionForAspectRatio(
      props.initialSelection,
      loaded.width,
      loaded.height,
      previewAspectRatio.value
    )
    selection.value = normalizeViewSelection(normalizedInitialSelection)
    panoramaImage.value = loaded.image

    await nextTick()
    scheduleRenderPreview()
  } catch (error) {
    imageMetrics.value = null
    selection.value = null
    panoramaImage.value = null
    previewError.value = error instanceof Error ? error.message : '360 全景图加载失败'
  } finally {
    loadingPreview.value = false
  }
}

function startDragging(event: PointerEvent) {
  if (!selection.value) return

  dragState.active = true
  dragState.pointerId = event.pointerId
  dragState.lastX = event.clientX
  dragState.lastY = event.clientY
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function moveView(event: PointerEvent) {
  if (!dragState.active || !selection.value || !canvasRef.value) return

  const bounds = canvasRef.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const deltaX = (event.clientX - dragState.lastX) / bounds.width
  const deltaY = (event.clientY - dragState.lastY) / bounds.height
  dragState.lastX = event.clientX
  dragState.lastY = event.clientY

  const centerX = selection.value.x + selection.value.width / 2 - deltaX * selection.value.width
  const centerY = selection.value.y + selection.value.height / 2 + deltaY * selection.value.height

  setSelectionCenter(centerX, centerY)
}

function stopDragging(event?: PointerEvent) {
  if (event && dragState.pointerId) {
    ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(dragState.pointerId)
  }
  dragState.active = false
  dragState.pointerId = 0
}

function submit() {
  if (!selection.value) return
  emit('submit', {
    selection: selection.value,
    captureMode: captureMode.value
  })
}

watch(
  () => [props.open, props.sourceImage, props.sourceAspectRatio, props.initialSelection, props.initialCaptureMode, props.aspectRatio] as const,
  () => {
    void initializePreview()
  },
  { immediate: true }
)

watch(
  () => selection.value ? { ...selection.value } : null,
  () => {
    if (!props.open || typeof window === 'undefined') return
    scheduleRenderPreview()
  },
  { deep: true }
)

watch(() => props.open, (open) => {
  if (!open) {
    stopDragging()
    if (renderFrameId) {
      cancelAnimationFrame(renderFrameId)
      renderFrameId = 0
    }
    disposePreviewRenderer()
    previewError.value = null
  }
})

watchEffect((onCleanup) => {
  if (typeof window === 'undefined' || !props.open) return

  const handleResize = () => scheduleRenderPreview()
  window.addEventListener('resize', handleResize)
  onCleanup(() => window.removeEventListener('resize', handleResize))
})

onBeforeUnmount(() => {
  stopDragging()
  if (renderFrameId) {
    cancelAnimationFrame(renderFrameId)
    renderFrameId = 0
  }
  disposePreviewRenderer()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div class="sr-only">
        环境取景区域
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden bg-black">
        <div
          ref="viewportRef"
          class="absolute inset-0 flex items-center justify-center"
        >
          <canvas
            ref="canvasRef"
            class="block cursor-grab touch-none active:cursor-grabbing"
            :style="previewCanvasStyle"
            :aria-label="`${targetLabel} 360 全景取景预览`"
            @pointerdown.prevent="startDragging"
            @pointermove.prevent="moveView"
            @pointerup.prevent="stopDragging"
            @pointercancel.prevent="stopDragging"
          />
        </div>

        <div
          v-if="loadingPreview"
          class="absolute inset-0 flex items-center justify-center bg-background/80"
        >
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <div
          v-else-if="previewError || error"
          class="absolute inset-0 flex items-center justify-center bg-background/80 px-6 text-center text-sm text-destructive"
        >
          {{ previewError || error }}
        </div>
      </div>

      <div class="flex shrink-0 items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div class="min-w-0 truncate text-sm font-medium">
          {{ targetLabel || '环境取景区域' }}
        </div>
        <div class="min-w-0 flex-1 flex-col items-center justify-center gap-2 px-2">
          <div class="flex items-center gap-2">
            <Button
              size="sm"
              :variant="captureMode === 'single' ? 'default' : 'outline'"
              :disabled="loadingPreview || !selection"
              @click="captureMode = 'single'"
            >
              单视图
            </Button>
            <Button
              size="sm"
              :variant="captureMode === 'four_view' ? 'default' : 'outline'"
              :disabled="loadingPreview || !selection"
              @click="captureMode = 'four_view'"
            >
              四视图
            </Button>
            <span class="text-xs text-muted-foreground">
              四视图拼图顺序：前 / 后 / 左 / 右
            </span>
          </div>
          <div class="flex items-center gap-2">
            <ZoomOut class="h-4 w-4 shrink-0 text-muted-foreground" />
            <Slider
              v-model="viewFovDegrees"
              class="max-w-56"
              :min="MIN_VIEW_FOV_DEGREES"
              :max="MAX_VIEW_FOV_DEGREES"
              :step="1"
              :disabled="loadingPreview || !selection"
            />
            <ZoomIn class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="w-12 shrink-0 text-right text-xs text-muted-foreground">
              {{ viewFovDegrees[0] }}°
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            @click="emit('update:open', false)"
          >
            取消
          </Button>
          <Button
            :disabled="loading || loadingPreview || !selection || !!previewError"
            @click="submit"
          >
            <Loader2
              v-if="loading"
              class="mr-2 h-4 w-4 animate-spin"
            />
            保存取景区域
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

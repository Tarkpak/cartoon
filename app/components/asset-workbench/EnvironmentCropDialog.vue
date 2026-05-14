<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
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
const WHEEL_ZOOM_SENSITIVITY = 0.0015
const WHEEL_LINE_HEIGHT_PIXELS = 16
const WHEEL_PAGE_HEIGHT_PIXELS = 800

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

const zoomFovDegrees = computed(() => {
  const width = selection.value?.width || DEFAULT_VIEW_WIDTH
  return clamp(width * 360, MIN_VIEW_FOV_DEGREES, MAX_VIEW_FOV_DEGREES)
})

const zoomFovLabel = computed(() => `${Math.round(zoomFovDegrees.value)}°`)

function resolveSelectionHeight(width: number): number {
  return clamp(
    resolvePanoramaSelectionHeightForAspectRatio(width, previewAspectRatio.value),
    0.06,
    0.95
  )
}

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

function resolveWheelDeltaPixels(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_HEIGHT_PIXELS
  if (event.deltaMode === 2) return event.deltaY * WHEEL_PAGE_HEIGHT_PIXELS
  return event.deltaY
}

function handleWheelZoom(event: WheelEvent) {
  if (!selection.value || loadingPreview.value) return

  const deltaPixels = resolveWheelDeltaPixels(event)
  if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return

  const scale = Math.exp(deltaPixels * WHEEL_ZOOM_SENSITIVITY)
  setSelectionWidth(selection.value.width * scale)
}

function handleZoomSliderChange(value?: number[]) {
  if (!selection.value || loadingPreview.value) return
  const nextFov = Number(value?.[0])
  if (!Number.isFinite(nextFov)) return
  setSelectionWidth(nextFov / 360)
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
            @wheel.prevent="handleWheelZoom"
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

      <div class="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div class="flex flex-wrap items-center gap-2">
          <div class="h-9 min-w-0 max-w-[320px] shrink-0 rounded-md border bg-muted/25 px-3">
            <p class="truncate text-sm font-semibold leading-9 tracking-tight">
              {{ targetLabel || '环境取景区域' }}
            </p>
          </div>

          <div class="flex h-9 shrink-0 items-center gap-1 rounded-md border bg-muted/20 px-1">
            <Button
              size="sm"
              class="h-7"
              :variant="captureMode === 'single' ? 'default' : 'outline'"
              :disabled="loadingPreview || !selection"
              @click="captureMode = 'single'"
            >
              单视图
            </Button>
            <Button
              size="sm"
              class="h-7"
              :variant="captureMode === 'four_view' ? 'default' : 'outline'"
              :disabled="loadingPreview || !selection"
              @click="captureMode = 'four_view'"
            >
              四视图
            </Button>
          </div>

          <div class="flex h-9 min-w-[260px] flex-1 items-center gap-2 rounded-md border bg-muted/20 px-3">
            <span class="w-8 shrink-0 text-[11px] text-muted-foreground">缩放</span>
            <Slider
              :model-value="[zoomFovDegrees]"
              :min="MIN_VIEW_FOV_DEGREES"
              :max="MAX_VIEW_FOV_DEGREES"
              :step="1"
              class="min-w-0 flex-1"
              :disabled="loadingPreview || !selection"
              @update:model-value="handleZoomSliderChange"
            />
            <span class="w-10 shrink-0 text-right text-[11px] font-medium">
              {{ zoomFovLabel }}
            </span>
          </div>

          <div class="ml-auto flex shrink-0 items-center justify-end gap-2">
            <Button
              variant="outline"
              class="h-9"
              @click="emit('update:open', false)"
            >
              取消
            </Button>
            <Button
              class="h-9"
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
    </div>
  </Teleport>
</template>

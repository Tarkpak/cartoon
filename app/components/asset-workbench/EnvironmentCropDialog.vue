<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import {
  buildDefaultCropSelection,
  loadPanoramaImage,
  normalizePanoramaSelection,
  resolvePanoramaSelectionHeightForAspectRatio,
  renderPanoramaSelectionToCanvas
} from '~/lib/asset-workbench-environment-panorama'
import type { EnvironmentCropSelection } from '~/lib/asset-workbench-types'

const PREVIEW_ASPECT_RATIO = 16 / 9
const MIN_VIEW_WIDTH = 0.08
const MAX_VIEW_WIDTH = 1

const props = defineProps<{
  open: boolean
  targetLabel: string
  sourceImage?: string
  initialSelection?: EnvironmentCropSelection
  loading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'submit': [selection: EnvironmentCropSelection]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const imageMetrics = ref<{ width: number, height: number } | null>(null)
const selection = ref<EnvironmentCropSelection | null>(null)
const panoramaImage = shallowRef<HTMLImageElement | null>(null)
const loadingPreview = ref(false)
const previewError = ref<string | null>(null)
let renderFrameId = 0

const dragState = reactive({
  active: false,
  pointerId: 0,
  startX: 0,
  startY: 0,
  startSelectionX: 0,
  startSelectionY: 0
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return ((value % 1) + 1) % 1
}

function resolveSelectionHeight(width: number): number {
  return clamp(
    resolvePanoramaSelectionHeightForAspectRatio(width, PREVIEW_ASPECT_RATIO),
    0.06,
    0.95
  )
}

function normalizeViewSelection(raw?: EnvironmentCropSelection): EnvironmentCropSelection {
  const metrics = imageMetrics.value
  const fallback = metrics
    ? buildDefaultCropSelection({ imageWidth: metrics.width, imageHeight: metrics.height })
    : (() => {
        const width = 0.22
        const height = resolveSelectionHeight(width)
        return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
      })()
  const source = raw || fallback
  const width = clamp(source.width || fallback.width, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH)
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

function resizeSelection(deltaScale: number) {
  if (!selection.value) return

  const centerX = selection.value.x + selection.value.width / 2
  const centerY = selection.value.y + selection.value.height / 2
  const width = clamp(selection.value.width * deltaScale, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH)
  const height = resolveSelectionHeight(width)
  selection.value = {
    x: wrapUnit(centerX - width / 2),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height
  }
}

function renderPreview() {
  renderFrameId = 0
  const canvas = canvasRef.value
  const image = panoramaImage.value
  const currentSelection = selection.value
  if (!canvas || !image || !currentSelection) return

  const rect = canvas.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.round(rect.width || 960))
  const cssHeight = Math.max(1, Math.round(rect.height || 540))
  const dpr = Math.min(2, window.devicePixelRatio || 1)

  try {
    renderPanoramaSelectionToCanvas({
      image,
      canvas,
      selection: currentSelection,
      width: cssWidth * dpr,
      height: cssHeight * dpr
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
    return
  }

  loadingPreview.value = true
  previewError.value = null

  try {
    const loaded = await loadPanoramaImage(props.sourceImage)
    imageMetrics.value = {
      width: loaded.width,
      height: loaded.height
    }
    const normalizedInitialSelection = normalizePanoramaSelection(
      props.initialSelection,
      loaded.width,
      loaded.height
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
  dragState.startX = event.clientX
  dragState.startY = event.clientY
  dragState.startSelectionX = selection.value.x
  dragState.startSelectionY = selection.value.y
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function moveView(event: PointerEvent) {
  if (!dragState.active || !selection.value || !canvasRef.value) return

  const bounds = canvasRef.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const centerX = dragState.startSelectionX
    + selection.value.width / 2
    - ((event.clientX - dragState.startX) / bounds.width) * selection.value.width
  const centerY = dragState.startSelectionY
    + selection.value.height / 2
    + ((event.clientY - dragState.startY) / bounds.height) * selection.value.height

  setSelectionCenter(centerX, centerY)
}

function stopDragging(event?: PointerEvent) {
  if (event && dragState.pointerId) {
    ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(dragState.pointerId)
  }
  dragState.active = false
  dragState.pointerId = 0
}

function handleWheel(event: WheelEvent) {
  if (!selection.value) return
  event.preventDefault()
  resizeSelection(event.deltaY > 0 ? 1.08 : 0.92)
}

function submit() {
  if (!selection.value) return
  emit('submit', selection.value)
}

watch(
  () => [props.open, props.sourceImage, props.initialSelection] as const,
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
    previewError.value = null
  }
})

watchEffect((onCleanup) => {
  if (typeof window === 'undefined' || !props.open) return

  const handleResize = () => scheduleRenderPreview()
  window.addEventListener('resize', handleResize)
  onCleanup(() => window.removeEventListener('resize', handleResize))
})
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-5xl">
      <DialogHeader class="sr-only">
        <DialogTitle>环境取景区域</DialogTitle>
      </DialogHeader>

      <div class="relative min-h-[min(72vh,720px)] overflow-hidden rounded-lg border bg-background">
        <canvas
          ref="canvasRef"
          class="block h-full min-h-[min(72vh,720px)] w-full cursor-grab touch-none active:cursor-grabbing"
          :aria-label="`${targetLabel} 360 全景取景预览`"
          @pointerdown.prevent="startDragging"
          @pointermove.prevent="moveView"
          @pointerup.prevent="stopDragging"
          @pointercancel.prevent="stopDragging"
          @wheel="handleWheel"
        />

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

      <DialogFooter>
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
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

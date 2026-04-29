<script setup lang="ts">
import { Download, Loader2, Move, ScanSearch } from 'lucide-vue-next'
import { toImageSrc } from '~/lib/media'
import {
  buildDefaultCropSelection,
  loadCropImageMetrics,
  normalizeCropSelection,
  renderCropSelectionToDataUrl,
  resolveCropSelectionAspectRatio,
  resolveCropSelectionOutputSize,
  resolveMaxCropSelection
} from '~/lib/asset-workbench-environment-panorama'
import type { EnvironmentCropSelection } from '~/lib/asset-workbench-types'

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'
type DragMode = 'move' | 'resize'

const MIN_SELECTION_WIDTH = 0.08
const MIN_SELECTION_HEIGHT = 0.08

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

const imageWrapperRef = ref<HTMLDivElement | null>(null)
const loadingMetrics = ref(false)
const imageMetrics = ref<{ width: number, height: number } | null>(null)
const selection = ref<EnvironmentCropSelection | null>(null)
const previewDownloading = ref(false)
const previewDownloadError = ref<string | null>(null)

const dragState = reactive({
  active: false,
  mode: 'move' as DragMode,
  handle: null as ResizeHandle | null,
  startPointerX: 0,
  startPointerY: 0,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0
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

const maxSelection = computed(() => {
  if (!imageMetrics.value) {
    return { width: 1, height: 1 }
  }

  return resolveMaxCropSelection(imageMetrics.value.width, imageMetrics.value.height)
})

const selectionAspectRatio = computed(() => {
  return resolveCropSelectionAspectRatio(
    selection.value || undefined,
    imageMetrics.value?.width ?? 1,
    imageMetrics.value?.height ?? 1
  )
})

const outputSize = computed(() => {
  if (!selection.value) return null

  return resolveCropSelectionOutputSize({
    selection: selection.value,
    sourceWidth: imageMetrics.value?.width ?? 1,
    sourceHeight: imageMetrics.value?.height ?? 1
  })
})

const previewFrameStyle = computed(() => {
  const aspectRatio = selectionAspectRatio.value
  const width = aspectRatio < 0.75
    ? 'min(100%, 240px)'
    : aspectRatio > 1.35
      ? '100%'
      : 'min(100%, 320px)'

  return {
    aspectRatio: String(aspectRatio),
    width
  }
})

const selectionRatioLabel = computed(() => formatRatio(selectionAspectRatio.value))

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value >= 1) return `${value.toFixed(2)} : 1`
  return `1 : ${(1 / value).toFixed(2)}`
}

function stopDragging() {
  dragState.active = false
  dragState.handle = null
  dragState.mode = 'move'
}

function clampSelectionPosition(nextX: number, nextY: number) {
  if (!selection.value) return

  selection.value = {
    ...selection.value,
    x: Math.max(0, Math.min(1 - selection.value.width, nextX)),
    y: Math.max(0, Math.min(1 - selection.value.height, nextY))
  }
}

function applyCenter(centerX: number, centerY: number) {
  if (!selection.value) return

  clampSelectionPosition(
    centerX - (selection.value.width / 2),
    centerY - (selection.value.height / 2)
  )
}

function startDragSession(mode: DragMode, event: PointerEvent, handle?: ResizeHandle) {
  if (!selection.value || !imageWrapperRef.value) return

  dragState.active = true
  dragState.mode = mode
  dragState.handle = handle ?? null
  dragState.startPointerX = event.clientX
  dragState.startPointerY = event.clientY
  dragState.startX = selection.value.x
  dragState.startY = selection.value.y
  dragState.startWidth = selection.value.width
  dragState.startHeight = selection.value.height
}

function startDragging(event: PointerEvent) {
  startDragSession('move', event)
}

function startResizing(handle: ResizeHandle, event: PointerEvent) {
  startDragSession('resize', event, handle)
}

function handleResize(deltaX: number, deltaY: number) {
  if (!selection.value || !dragState.handle) return

  const leftEdge = dragState.startX
  const rightEdge = dragState.startX + dragState.startWidth
  const topEdge = dragState.startY
  const bottomEdge = dragState.startY + dragState.startHeight

  let left = leftEdge
  let right = rightEdge
  let top = topEdge
  let bottom = bottomEdge

  if (dragState.handle.includes('w')) {
    left = Math.min(
      right - MIN_SELECTION_WIDTH,
      Math.max(Math.max(0, right - maxSelection.value.width), leftEdge + deltaX)
    )
  }

  if (dragState.handle.includes('e')) {
    right = Math.max(
      leftEdge + MIN_SELECTION_WIDTH,
      Math.min(Math.min(1, leftEdge + maxSelection.value.width), rightEdge + deltaX)
    )
  }

  if (dragState.handle.includes('n')) {
    top = Math.min(
      bottom - MIN_SELECTION_HEIGHT,
      Math.max(Math.max(0, bottom - maxSelection.value.height), topEdge + deltaY)
    )
  }

  if (dragState.handle.includes('s')) {
    bottom = Math.max(
      topEdge + MIN_SELECTION_HEIGHT,
      Math.min(Math.min(1, topEdge + maxSelection.value.height), bottomEdge + deltaY)
    )
  }

  selection.value = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

function handlePointerMove(event: PointerEvent) {
  if (!dragState.active || !imageWrapperRef.value || !selection.value) return

  const bounds = imageWrapperRef.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const deltaX = (event.clientX - dragState.startPointerX) / bounds.width
  const deltaY = (event.clientY - dragState.startPointerY) / bounds.height

  if (dragState.mode === 'resize') {
    handleResize(deltaX, deltaY)
    return
  }

  clampSelectionPosition(dragState.startX + deltaX, dragState.startY + deltaY)
}

function handleWrapperClick(event: MouseEvent) {
  if (dragState.active || !imageWrapperRef.value || !selection.value) return
  if ((event.target as HTMLElement | null)?.closest('[data-selection-control="true"]')) return

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

function resolvePreviewFilename() {
  const normalizedLabel = (props.targetLabel || 'environment-crop')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${normalizedLabel || 'environment-crop'}-preview-${Date.now()}.png`
}

async function downloadPreviewImage() {
  if (!selection.value || !props.sourceImage?.trim()) return

  previewDownloading.value = true
  previewDownloadError.value = null

  try {
    const dataUrl = await renderCropSelectionToDataUrl({
      sourceImage: props.sourceImage,
      selection: selection.value,
      outputSize: outputSize.value || undefined
    })
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = resolvePreviewFilename()
    link.click()
  } catch (error) {
    previewDownloadError.value = error instanceof Error
      ? error.message
      : '下载预览失败，请稍后重试'
  } finally {
    previewDownloading.value = false
  }
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
      metrics.height
    ) || buildDefaultCropSelection({
      imageWidth: metrics.width,
      imageHeight: metrics.height
    })
  } catch {
    imageMetrics.value = null
    selection.value = null
  } finally {
    loadingMetrics.value = false
  }
}

watch(
  () => [props.open, props.sourceImage, props.initialSelection] as const,
  () => {
    void initializeSelection()
  },
  { immediate: true }
)

watch(() => props.open, (open) => {
  if (!open) {
    stopDragging()
    previewDownloadError.value = null
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
        <DialogTitle>环境取景区域</DialogTitle>
        <DialogDescription>
          目标：{{ targetLabel || '-' }}。直接拖动选窗移动区域，拖动四角缩放选窗，环境取景不再锁定项目比例。
        </DialogDescription>
      </DialogHeader>

      <div class="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-3 overflow-hidden">
          <div class="rounded-2xl border bg-muted/15 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium text-foreground">
                <Move class="h-4 w-4 text-primary" />
                环境全景取景区域
              </div>
              <div class="inline-flex items-center rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                自由比例 · {{ selectionRatioLabel }}
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
                    class="absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] touch-none"
                    :style="selectionStyle"
                    data-selection-control="true"
                    @click.stop
                    @pointerdown.stop.prevent="startDragging"
                  >
                    <div class="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground shadow-sm">
                      <Move class="h-3 w-3" />
                      {{ selectionRatioLabel }}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm cursor-nwse-resize"
                      data-selection-control="true"
                      @pointerdown.stop.prevent="startResizing('nw', $event)"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="absolute -right-2 -top-2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm cursor-nesw-resize"
                      data-selection-control="true"
                      @pointerdown.stop.prevent="startResizing('ne', $event)"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm cursor-nwse-resize"
                      data-selection-control="true"
                      @pointerdown.stop.prevent="startResizing('se', $event)"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="absolute -bottom-2 -left-2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm cursor-nesw-resize"
                      data-selection-control="true"
                      @pointerdown.stop.prevent="startResizing('sw', $event)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <div class="rounded-full border bg-background px-2.5 py-1">
                拖动选窗可移动区域
              </div>
              <div class="rounded-full border bg-background px-2.5 py-1">
                拖动四角可直接缩放
              </div>
              <div class="rounded-full border bg-background px-2.5 py-1">
                点击全景图可快速居中
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="rounded-2xl border bg-card p-4">
            <div class="mb-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium">
                <ScanSearch class="h-4 w-4 text-primary" />
                当前取景预览
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1.5 px-2 text-xs"
                  :disabled="!selection || !imageSrc || previewDownloading"
                  @click="downloadPreviewImage"
                >
                  <Loader2
                    v-if="previewDownloading"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  <Download
                    v-else
                    class="h-3.5 w-3.5"
                  />
                  下载预览
                </Button>
                <div class="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                  {{ selectionRatioLabel }}
                </div>
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
                  :alt="`${targetLabel} 当前取景预览`"
                  class="absolute max-w-none"
                  :style="previewImageStyle"
                >
              </div>
            </div>

            <p class="mt-3 text-xs leading-5 text-muted-foreground">
              保存后会自动替换当前环境图，但全景源图会保留，方便继续重选。
            </p>

            <p
              v-if="previewDownloadError"
              class="mt-2 text-xs text-destructive"
            >
              {{ previewDownloadError }}
            </p>
          </div>

          <div class="rounded-2xl border bg-card p-4">
            <div class="text-sm font-medium">
              当前选窗信息
            </div>
            <div class="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div class="rounded-xl border bg-muted/20 p-3">
                <div>选窗比例</div>
                <div class="mt-1 text-sm font-medium text-foreground">
                  {{ selectionRatioLabel }}
                </div>
              </div>
              <div class="rounded-xl border bg-muted/20 p-3">
                <div>导出尺寸</div>
                <div class="mt-1 text-sm font-medium text-foreground">
                  {{ outputSize ? `${outputSize.width} × ${outputSize.height}` : '-' }}
                </div>
              </div>
              <div class="rounded-xl border bg-muted/20 p-3">
                <div>选窗宽度</div>
                <div class="mt-1 text-sm font-medium text-foreground">
                  {{ selection ? `${Math.round(selection.width * 100)}%` : '-' }}
                </div>
              </div>
              <div class="rounded-xl border bg-muted/20 p-3">
                <div>选窗高度</div>
                <div class="mt-1 text-sm font-medium text-foreground">
                  {{ selection ? `${Math.round(selection.height * 100)}%` : '-' }}
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
          保存取景区域
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

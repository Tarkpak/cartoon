<script setup lang="ts">
import { Check, Copy, Music2, X } from 'lucide-vue-next'
import type { ModelDebugLogEntry, ModelDebugMediaRef } from '@/composables/useModelDebugLogs'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  activeLog: ModelDebugLogEntry | null
  formatDate: (value: string) => string
  formatDuration: (value: number) => string
  toPrettyJson: (value: unknown) => string
  toReadableText: (value: unknown) => string
}>()

type CopySectionKey = 'request-readable' | 'response-readable' | 'request-raw' | 'response-raw'

const viewMode = ref<'readable' | 'raw' | 'media'>('readable')
const copyingSection = ref<CopySectionKey | ''>('')
const copiedSection = ref<CopySectionKey | ''>('')

const requestReadable = computed(() => props.toReadableText(props.activeLog?.request))
const responseReadable = computed(() => props.toReadableText(props.activeLog?.response))
const requestRaw = computed(() => props.toPrettyJson(props.activeLog?.requestRaw ?? props.activeLog?.request))
const responseRaw = computed(() => props.toPrettyJson(props.activeLog?.responseRaw ?? props.activeLog?.response))

function hasMeaningfulError(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(hasMeaningfulError)
  if (typeof value === 'object') return Object.values(value).some(hasMeaningfulError)
  return true
}

const errorDetails = computed(() => {
  const error = props.activeLog?.error
  return hasMeaningfulError(error) ? props.toPrettyJson(error) : ''
})

function isRenderableMediaType(type: ModelDebugMediaRef['mediaType']): type is 'image' | 'audio' | 'video' {
  return type === 'image' || type === 'audio' || type === 'video'
}

function normalizeMediaUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const normalized = trimmed.startsWith('url:') ? trimmed.slice(4).trim() : trimmed
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (/^data:(image|audio|video)\//i.test(normalized)) return normalized
  if (/^\/(?!\/)/.test(normalized)) return normalized
  return null
}

function mediaFileName(item: ModelDebugMediaRef): string {
  if (!item.url || item.url.startsWith('data:')) return '内嵌参考音频'
  try {
    const pathname = new URL(item.url, 'http://local').pathname
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '参考音频')
  } catch {
    return '参考音频'
  }
}

function inferMediaType(path: string, url: string): 'image' | 'audio' | 'video' | null {
  const lowerPath = path.toLowerCase()
  const lowerUrl = url.toLowerCase()

  if (lowerUrl.startsWith('data:image/')) return 'image'
  if (lowerUrl.startsWith('data:audio/')) return 'audio'
  if (lowerUrl.startsWith('data:video/')) return 'video'

  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(pathname)) return 'image'
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(pathname)) return 'audio'
    if (/\.(mp4|webm|mov|mkv|avi|m3u8)$/.test(pathname)) return 'video'
  } catch {
    // ignore invalid URL and fallback to key-based inference below
  }

  if (/(audio_url|reference_audio|audio|voice|speech|tts|sound)/.test(lowerPath)) return 'audio'
  if (/(image_url|reference_image|image|avatar|thumbnail|cover|poster|picture|photo|frame|first_frame|last_frame)/.test(lowerPath)) return 'image'
  if (/(video_url|reference_video|video|movie|clip)/.test(lowerPath)) return 'video'
  return null
}

function collectSanitizedMediaObject(
  current: Record<string, unknown>,
  path: string,
  direction: 'request' | 'response',
  refs: ModelDebugMediaRef[],
  seenUrls: Set<string>
): boolean {
  const kind = typeof current.kind === 'string' ? current.kind : ''
  if (kind !== 'data-url' && kind !== 'large-media-or-inline-string') return false

  const preview = typeof current.preview === 'string' ? current.preview : ''
  const chars = typeof current.chars === 'number' ? current.chars : preview.length
  const mediaType = preview.startsWith('data:image/')
    ? 'image'
    : preview.startsWith('data:audio/')
      ? 'audio'
      : preview.startsWith('data:video/')
        ? 'video'
        : inferMediaType(path, preview) || 'binary'
  const key = `${direction}|${mediaType}|${path}|${kind}|${chars}`
  if (seenUrls.has(key)) return true
  seenUrls.add(key)
  refs.push({
    id: `media_${direction}_sanitized_${refs.length + 1}`,
    direction,
    path,
    mediaType,
    mimeType: preview.match(/^data:([^;,]+)/)?.[1],
    originalLength: chars,
    status: 'skipped',
    note: '日志中该媒体内容已脱敏，无法直接预览；新日志会优先使用 URL 展示。'
  })
  return true
}

function collectMediaRefsFromValue(
  value: unknown,
  direction: 'request' | 'response'
): ModelDebugMediaRef[] {
  const refs: ModelDebugMediaRef[] = []
  const seenObjects = new WeakSet<object>()
  const seenUrls = new Set<string>()

  function visit(current: unknown, path: string, depth: number) {
    if (current === null || current === undefined || depth > 8) return

    if (typeof current === 'string') {
      const url = normalizeMediaUrl(current)
      if (!url) return
      const mediaType = inferMediaType(path, url)
      if (!mediaType) return
      const key = `${direction}|${mediaType}|${url}`
      if (seenUrls.has(key)) return
      seenUrls.add(key)
      refs.push({
        id: `media_${direction}_inline_${refs.length + 1}`,
        direction,
        path,
        mediaType,
        mimeType: undefined,
        originalLength: current.length,
        url,
        status: 'ready',
        note: '从请求/响应 URL 自动识别'
      })
      return
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, `${path}[${index}]`, depth + 1)
      })
      return
    }

    if (typeof current === 'object') {
      const objectValue = current as Record<string, unknown>
      if (seenObjects.has(objectValue)) return
      seenObjects.add(objectValue)
      if (collectSanitizedMediaObject(objectValue, path, direction, refs, seenUrls)) return

      Object.entries(objectValue).forEach(([key, item]) => {
        const childPath = path === '$' ? `$.${key}` : `${path}.${key}`
        visit(item, childPath, depth + 1)
      })
    }
  }

  visit(value, '$', 0)
  return refs
}

const mediaRefs = computed<ModelDebugMediaRef[]>(() => {
  const persistedRefs = props.activeLog?.mediaRefs || []
  const requestInlineRefs = [
    ...collectMediaRefsFromValue(props.activeLog?.request, 'request'),
    ...collectMediaRefsFromValue(props.activeLog?.requestRaw, 'request')
  ]
  const responseInlineRefs = [
    ...collectMediaRefsFromValue(props.activeLog?.response, 'response'),
    ...collectMediaRefsFromValue(props.activeLog?.responseRaw, 'response')
  ]

  const mergedRefs = [...persistedRefs]
  const dedupe = new Set(
    persistedRefs
      .filter(item => Boolean(item.url) && isRenderableMediaType(item.mediaType))
      .map(item => `${item.direction}|${item.mediaType}|${item.url}`)
  )

  for (const ref of [...requestInlineRefs, ...responseInlineRefs]) {
    const key = `${ref.direction}|${ref.mediaType}|${ref.url}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    mergedRefs.push(ref)
  }

  return mergedRefs
})
const requestAudioRefs = computed(() => mediaRefs.value.filter(item => (
  item.direction === 'request'
  && item.mediaType === 'audio'
  && Boolean(item.url)
)))
const showAudioReferenceStatus = computed(() => (
  requestAudioRefs.value.length > 0
  || props.activeLog?.operation === 'generateVideo'
))
const requestReadableMedia = computed(() => mediaRefs.value.filter(item => (
  item.direction === 'request'
  && item.mediaType !== 'audio'
  && Boolean(item.url)
  && isRenderableMediaType(item.mediaType)
)))
const responseReadableMedia = computed(() => mediaRefs.value.filter(item => (
  item.direction === 'response'
  && Boolean(item.url)
  && isRenderableMediaType(item.mediaType)
)))

async function copySection(section: CopySectionKey, content: string) {
  if (!import.meta.client) return

  const text = content.trim()
  if (!text || copyingSection.value === section) return

  copyingSection.value = section
  copiedSection.value = ''

  try {
    await navigator.clipboard.writeText(content)
    copiedSection.value = section
    window.setTimeout(() => {
      if (copiedSection.value === section) {
        copiedSection.value = ''
      }
    }, 1600)
  } catch (error) {
    console.warn('[ModelLogsDetailDrawer] 复制日志内容失败:', error)
  } finally {
    if (copyingSection.value === section) {
      copyingSection.value = ''
    }
  }
}

watch(open, (value) => {
  if (value) {
    viewMode.value = 'readable'
    copyingSection.value = ''
    copiedSection.value = ''
  }
})
</script>

<template>
  <Drawer
    v-model:open="open"
    direction="right"
    :handle-only="true"
    :should-scale-background="false"
  >
    <DrawerContent
      class="mt-0 h-screen max-h-screen w-[95vw] max-w-none overflow-hidden rounded-none border-l border-border p-0 sm:w-[820px] data-[vaul-drawer-direction=right]:top-0 data-[vaul-drawer-direction=right]:bottom-auto data-[vaul-drawer-direction=right]:left-auto data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:inset-y-0 [&>div:first-child]:hidden"
    >
      <div
        class="flex h-full min-h-0 flex-col"
        data-log-detail-drawer-content
      >
        <DrawerHeader class="border-b px-5 py-4 pr-12 text-left">
          <DrawerTitle>日志详情</DrawerTitle>
          <DrawerDescription v-if="props.activeLog">
            {{ props.activeLog.provider }} · {{ props.activeLog.operation }} · {{ props.formatDate(props.activeLog.timestamp) }}
          </DrawerDescription>
          <DrawerDescription v-else>
            当前日志已不存在（可能被筛选或清空）
          </DrawerDescription>
        </DrawerHeader>

        <DrawerClose as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="absolute right-4 top-4 h-8 w-8 opacity-70 transition-opacity hover:opacity-100"
            aria-label="关闭"
          >
            <X class="h-4 w-4" />
          </Button>
        </DrawerClose>

        <div
          v-if="props.activeLog"
          class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 overscroll-contain"
        >
          <div class="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                时间
              </p>
              <p class="mt-1">
                {{ props.formatDate(props.activeLog.timestamp) }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                Provider
              </p>
              <p class="mt-1">
                {{ props.activeLog.provider }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                操作
              </p>
              <p class="mt-1 break-all">
                {{ props.activeLog.operation }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                模型
              </p>
              <p class="mt-1 break-all">
                {{ props.activeLog.model || '-' }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                状态
              </p>
              <p class="mt-1">
                {{ props.activeLog.status }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                耗时
              </p>
              <p class="mt-1">
                {{ props.formatDuration(props.activeLog.durationMs) }}
              </p>
            </div>
            <div
              v-if="props.activeLog.requestId"
              class="rounded border p-3 md:col-span-2"
            >
              <p class="text-xs text-muted-foreground">
                Request ID
              </p>
              <p class="mt-1 break-all font-mono text-xs">
                {{ props.activeLog.requestId }}
              </p>
            </div>
            <div
              v-if="props.activeLog.projectId"
              class="rounded border p-3"
            >
              <p class="text-xs text-muted-foreground">
                Project ID
              </p>
              <p class="mt-1 break-all font-mono text-xs">
                {{ props.activeLog.projectId }}
              </p>
            </div>
            <div
              v-if="props.activeLog.sceneId"
              class="rounded border p-3"
            >
              <p class="text-xs text-muted-foreground">
                Scene ID
              </p>
              <p class="mt-1 break-all font-mono text-xs">
                {{ props.activeLog.sceneId }}
              </p>
            </div>
            <div
              v-if="props.activeLog.taskId"
              class="rounded border p-3 md:col-span-2"
            >
              <p class="text-xs text-muted-foreground">
                Task ID
              </p>
              <p class="mt-1 break-all font-mono text-xs">
                {{ props.activeLog.taskId }}
              </p>
            </div>
            <div
              v-if="props.activeLog.endpoint"
              class="rounded border p-3 md:col-span-2"
            >
              <p class="text-xs text-muted-foreground">
                Endpoint
              </p>
              <p class="mt-1 break-all">
                {{ props.activeLog.endpoint }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              :variant="viewMode === 'readable' ? 'default' : 'outline'"
              @click="viewMode = 'readable'"
            >
              可读视图
            </Button>
            <Button
              type="button"
              size="sm"
              :variant="viewMode === 'raw' ? 'default' : 'outline'"
              @click="viewMode = 'raw'"
            >
              原始 JSON
            </Button>
            <Button
              type="button"
              size="sm"
              :variant="viewMode === 'media' ? 'default' : 'outline'"
              @click="viewMode = 'media'"
            >
              媒体引用（{{ mediaRefs.length }}）
            </Button>
          </div>

          <div
            v-if="showAudioReferenceStatus"
            class="space-y-3 rounded border p-3"
            :class="requestAudioRefs.length > 0 ? 'border-primary/30 bg-primary/5' : 'border-dashed bg-muted/20'"
          >
            <div class="flex items-center gap-2">
              <Music2 class="h-4 w-4 shrink-0 text-primary" />
              <div>
                <p class="text-sm font-medium">
                  {{ requestAudioRefs.length > 0
                    ? `本次模型请求已引用 ${requestAudioRefs.length} 个参考音频`
                    : '本次模型请求未检测到参考音频' }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ requestAudioRefs.length > 0
                    ? '可直接播放，核对实际提交给模型的音色样本'
                    : '该日志记录的上游请求中没有音频引用字段' }}
                </p>
              </div>
            </div>
            <div
              v-for="item in requestAudioRefs"
              :key="item.id"
              class="space-y-2 rounded border bg-background p-2.5"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{ mediaFileName(item) }}
                  </p>
                  <p class="break-all text-xs text-muted-foreground">
                    请求位置：{{ item.path }}
                  </p>
                </div>
                <a
                  v-if="item.url"
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="shrink-0 text-xs text-primary underline underline-offset-4"
                >
                  打开音频
                </a>
              </div>
              <audio
                v-if="item.url"
                :src="item.url"
                controls
                preload="metadata"
                class="w-full"
              />
            </div>
          </div>

          <template v-if="viewMode === 'readable'">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-medium">
                  请求参数（可读）
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-7 gap-1.5 px-2 text-xs"
                  :disabled="!requestReadable || copyingSection === 'request-readable'"
                  @click="copySection('request-readable', requestReadable)"
                >
                  <Check
                    v-if="copiedSection === 'request-readable'"
                    class="h-3.5 w-3.5"
                  />
                  <Copy
                    v-else
                    class="h-3.5 w-3.5"
                  />
                  {{ copiedSection === 'request-readable' ? '已复制' : '复制' }}
                </Button>
              </div>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs select-text">{{ requestReadable || '无' }}</pre>
              <div
                v-if="requestReadableMedia.length > 0"
                class="space-y-2"
              >
                <p class="text-xs text-muted-foreground">
                  媒体引用预览
                </p>
                <div
                  v-for="item in requestReadableMedia"
                  :key="item.id"
                  class="space-y-2 rounded border bg-muted/20 p-2"
                >
                  <p class="text-xs text-muted-foreground break-all">
                    {{ item.path }} · {{ item.mediaType }} · {{ item.mimeType || '-' }}
                  </p>
                  <img
                    v-if="item.url && item.mediaType === 'image'"
                    :src="item.url"
                    alt="请求媒体图片引用"
                    class="max-h-64 rounded border"
                    loading="lazy"
                  >
                  <audio
                    v-else-if="item.url && item.mediaType === 'audio'"
                    :src="item.url"
                    controls
                    class="w-full"
                  />
                  <video
                    v-else-if="item.url && item.mediaType === 'video'"
                    :src="item.url"
                    controls
                    class="max-h-64 w-full rounded border bg-black"
                  />
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-medium">
                  响应结果（可读）
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-7 gap-1.5 px-2 text-xs"
                  :disabled="!responseReadable || copyingSection === 'response-readable'"
                  @click="copySection('response-readable', responseReadable)"
                >
                  <Check
                    v-if="copiedSection === 'response-readable'"
                    class="h-3.5 w-3.5"
                  />
                  <Copy
                    v-else
                    class="h-3.5 w-3.5"
                  />
                  {{ copiedSection === 'response-readable' ? '已复制' : '复制' }}
                </Button>
              </div>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs select-text">{{ responseReadable || '无' }}</pre>
              <div
                v-if="responseReadableMedia.length > 0"
                class="space-y-2"
              >
                <p class="text-xs text-muted-foreground">
                  媒体引用预览
                </p>
                <div
                  v-for="item in responseReadableMedia"
                  :key="item.id"
                  class="space-y-2 rounded border bg-muted/20 p-2"
                >
                  <p class="text-xs text-muted-foreground break-all">
                    {{ item.path }} · {{ item.mediaType }} · {{ item.mimeType || '-' }}
                  </p>
                  <img
                    v-if="item.url && item.mediaType === 'image'"
                    :src="item.url"
                    alt="响应媒体图片引用"
                    class="max-h-64 rounded border"
                    loading="lazy"
                  >
                  <audio
                    v-else-if="item.url && item.mediaType === 'audio'"
                    :src="item.url"
                    controls
                    class="w-full"
                  />
                  <video
                    v-else-if="item.url && item.mediaType === 'video'"
                    :src="item.url"
                    controls
                    class="max-h-64 w-full rounded border bg-black"
                  />
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="viewMode === 'raw'">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-medium">
                  请求参数（原始 JSON）
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-7 gap-1.5 px-2 text-xs"
                  :disabled="!requestRaw || copyingSection === 'request-raw'"
                  @click="copySection('request-raw', requestRaw)"
                >
                  <Check
                    v-if="copiedSection === 'request-raw'"
                    class="h-3.5 w-3.5"
                  />
                  <Copy
                    v-else
                    class="h-3.5 w-3.5"
                  />
                  {{ copiedSection === 'request-raw' ? '已复制' : '复制' }}
                </Button>
              </div>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs select-text">{{ requestRaw || '无' }}</pre>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-medium">
                  响应结果（原始 JSON）
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-7 gap-1.5 px-2 text-xs"
                  :disabled="!responseRaw || copyingSection === 'response-raw'"
                  @click="copySection('response-raw', responseRaw)"
                >
                  <Check
                    v-if="copiedSection === 'response-raw'"
                    class="h-3.5 w-3.5"
                  />
                  <Copy
                    v-else
                    class="h-3.5 w-3.5"
                  />
                  {{ copiedSection === 'response-raw' ? '已复制' : '复制' }}
                </Button>
              </div>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs select-text">{{ responseRaw || '无' }}</pre>
            </div>
          </template>

          <template v-else>
            <div
              v-if="mediaRefs.length === 0"
              class="rounded border border-dashed p-4 text-sm text-muted-foreground"
            >
              本次请求/响应没有媒体引用
            </div>

            <div
              v-for="item in mediaRefs"
              :key="item.id"
              class="space-y-3 rounded border p-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm">
                  <p class="font-medium">
                    {{ item.mediaType }} · {{ item.direction }} · {{ item.status }}
                  </p>
                  <p class="text-xs text-muted-foreground break-all">
                    路径: {{ item.path }} · MIME: {{ item.mimeType || '-' }} · 原始长度: {{ item.originalLength }}
                  </p>
                </div>
                <a
                  v-if="item.url"
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-primary underline underline-offset-4"
                >
                  打开 CDN 链接
                </a>
              </div>

              <p
                v-if="item.note"
                class="text-xs text-muted-foreground"
              >
                {{ item.note }}
              </p>

              <img
                v-if="item.url && item.mediaType === 'image'"
                :src="item.url"
                alt="日志图片引用"
                class="max-h-64 rounded border"
                loading="lazy"
              >

              <audio
                v-else-if="item.url && item.mediaType === 'audio'"
                :src="item.url"
                controls
                class="w-full"
              />

              <video
                v-else-if="item.url && item.mediaType === 'video'"
                :src="item.url"
                controls
                class="max-h-64 w-full rounded border bg-black"
              />

              <div
                v-else
                class="rounded border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground"
              >
                没有可直接预览的媒体 URL
              </div>
            </div>
          </template>

          <div
            v-if="errorDetails"
            class="space-y-2"
          >
            <h4 class="text-sm font-medium text-destructive">
              错误信息
            </h4>
            <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-3 text-xs">{{ errorDetails }}</pre>
          </div>
        </div>

        <div
          v-else
          class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          未找到日志详情
        </div>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<style scoped>
:deep([data-log-detail-drawer-content]),
:deep([data-log-detail-drawer-content] *) {
  user-select: text !important;
  -webkit-user-select: text !important;
}
</style>

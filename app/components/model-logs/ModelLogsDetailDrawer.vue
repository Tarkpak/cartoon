<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { ModelDebugLogEntry } from '@/composables/useModelDebugLogs'
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

const viewMode = ref<'readable' | 'raw' | 'media'>('readable')

const requestReadable = computed(() => props.toReadableText(props.activeLog?.request))
const responseReadable = computed(() => props.toReadableText(props.activeLog?.response))
const requestRaw = computed(() => props.toPrettyJson(props.activeLog?.requestRaw ?? props.activeLog?.request))
const responseRaw = computed(() => props.toPrettyJson(props.activeLog?.responseRaw ?? props.activeLog?.response))
const mediaRefs = computed(() => props.activeLog?.mediaRefs || [])

watch(open, (value) => {
  if (value) {
    viewMode.value = 'readable'
  }
})
</script>

<template>
  <Drawer
    v-model:open="open"
    direction="right"
    :should-scale-background="false"
  >
    <DrawerContent
      class="mt-0 h-screen max-h-screen w-[95vw] max-w-none overflow-hidden rounded-none border-l border-border p-0 sm:w-[820px] data-[vaul-drawer-direction=right]:top-0 data-[vaul-drawer-direction=right]:bottom-auto data-[vaul-drawer-direction=right]:left-auto data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:inset-y-0 [&>div:first-child]:hidden"
    >
      <div class="flex h-full min-h-0 flex-col">
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

          <template v-if="viewMode === 'readable'">
            <div class="space-y-2">
              <h4 class="text-sm font-medium">
                请求参数（可读）
              </h4>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ requestReadable || '无' }}</pre>
            </div>

            <div class="space-y-2">
              <h4 class="text-sm font-medium">
                响应结果（可读）
              </h4>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ responseReadable || '无' }}</pre>
            </div>
          </template>

          <template v-else-if="viewMode === 'raw'">
            <div class="space-y-2">
              <h4 class="text-sm font-medium">
                请求参数（原始 JSON）
              </h4>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ requestRaw || '无' }}</pre>
            </div>

            <div class="space-y-2">
              <h4 class="text-sm font-medium">
                响应结果（原始 JSON）
              </h4>
              <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ responseRaw || '无' }}</pre>
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
            </div>
          </template>

          <div
            v-if="props.activeLog.error"
            class="space-y-2"
          >
            <h4 class="text-sm font-medium text-destructive">
              错误信息
            </h4>
            <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-3 text-xs">{{ props.toPrettyJson(props.activeLog.error) }}</pre>
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

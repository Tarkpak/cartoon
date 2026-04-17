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

defineProps<{
  activeLog: ModelDebugLogEntry | null
  formatDate: (value: string) => string
  formatDuration: (value: number) => string
  toPrettyJson: (value: unknown) => string
}>()
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
          <DrawerDescription v-if="activeLog">
            {{ activeLog.provider }} · {{ activeLog.operation }} · {{ formatDate(activeLog.timestamp) }}
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
          v-if="activeLog"
          class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 overscroll-contain"
        >
          <div class="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                时间
              </p>
              <p class="mt-1">
                {{ formatDate(activeLog.timestamp) }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                Provider
              </p>
              <p class="mt-1">
                {{ activeLog.provider }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                操作
              </p>
              <p class="mt-1 break-all">
                {{ activeLog.operation }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                模型
              </p>
              <p class="mt-1 break-all">
                {{ activeLog.model || '-' }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                状态
              </p>
              <p class="mt-1">
                {{ activeLog.status }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                耗时
              </p>
              <p class="mt-1">
                {{ formatDuration(activeLog.durationMs) }}
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <h4 class="text-sm font-medium">
              请求参数
            </h4>
            <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ toPrettyJson(activeLog.request) || '无' }}</pre>
          </div>

          <div class="space-y-2">
            <h4 class="text-sm font-medium">
              响应结果
            </h4>
            <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{{ toPrettyJson(activeLog.response) || '无' }}</pre>
          </div>

          <div
            v-if="activeLog.error"
            class="space-y-2"
          >
            <h4 class="text-sm font-medium text-destructive">
              错误信息
            </h4>
            <pre class="overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-3 text-xs">{{ toPrettyJson(activeLog.error) }}</pre>
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

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { AppLogEntry } from '@/composables/useAppLogs'
import { logCategoryLabel, logLevelLabel, logSourceLabel } from '#shared/utils/display-labels'
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
  activeLog: AppLogEntry | null
  formatDate: (value: string) => string
  formatDuration: (value?: number) => string
  toPrettyJson: (value: unknown) => string
}>()
</script>

<template>
  <Drawer
    v-model:open="open"
    direction="right"
    :handle-only="true"
    :should-scale-background="false"
  >
    <DrawerContent
      class="mt-0 h-screen max-h-screen w-[95vw] max-w-none overflow-hidden rounded-none border-l border-border p-0 sm:w-[680px] data-[vaul-drawer-direction=right]:top-0 data-[vaul-drawer-direction=right]:bottom-auto data-[vaul-drawer-direction=right]:left-auto data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:inset-y-0 [&>div:first-child]:hidden"
    >
      <div
        class="flex h-full min-h-0 flex-col"
        data-log-detail-drawer-content
      >
        <DrawerHeader class="border-b px-5 py-4 pr-12 text-left">
          <DrawerTitle>日志详情</DrawerTitle>
          <DrawerDescription v-if="props.activeLog">
            {{ logSourceLabel(props.activeLog.source) }} · {{ logCategoryLabel(props.activeLog.category) }} · {{ props.formatDate(props.activeLog.timestamp) }}
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
                级别
              </p>
              <p class="mt-1">
                {{ logLevelLabel(props.activeLog.level) }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                来源
              </p>
              <p class="mt-1">
                {{ logSourceLabel(props.activeLog.source) }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                类别
              </p>
              <p class="mt-1 break-all">
                {{ logCategoryLabel(props.activeLog.category) }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                方法
              </p>
              <p class="mt-1">
                {{ props.activeLog.method || '-' }}
              </p>
            </div>
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                状态
              </p>
              <p class="mt-1">
                {{ props.activeLog.status || '-' }}
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
            <div class="rounded border p-3">
              <p class="text-xs text-muted-foreground">
                Request ID
              </p>
              <p class="mt-1 break-all font-mono text-xs">
                {{ props.activeLog.requestId || '-' }}
              </p>
            </div>
          </div>

          <div class="rounded border p-3 text-sm">
            <p class="text-xs text-muted-foreground">
              路径
            </p>
            <p class="mt-1 break-all">
              {{ props.activeLog.path || '-' }}
            </p>
          </div>

          <div class="rounded border p-3 text-sm">
            <p class="text-xs text-muted-foreground">
              信息
            </p>
            <p class="mt-1 whitespace-pre-wrap break-words">
              {{ props.activeLog.message }}
            </p>
          </div>

          <div
            v-if="props.activeLog.metadata"
            class="rounded border p-3"
          >
            <p class="text-xs text-muted-foreground">
              元数据
            </p>
            <pre class="mt-2 max-h-80 overflow-auto rounded border bg-muted/40 p-3 text-xs">{{ props.toPrettyJson(props.activeLog.metadata) }}</pre>
          </div>

          <div
            v-if="props.activeLog.error"
            class="rounded border p-3"
          >
            <p class="text-xs text-muted-foreground">
              错误
            </p>
            <pre class="mt-2 max-h-80 overflow-auto rounded border bg-muted/40 p-3 text-xs">{{ props.toPrettyJson(props.activeLog.error) }}</pre>
          </div>
        </div>

        <div
          v-else
          class="p-5 text-sm text-muted-foreground"
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

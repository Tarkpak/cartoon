<script setup lang="ts">
import { useCompletionNotificationSettings } from '@/composables/useCompletionNotificationSettings'

const {
  completionNotificationOptions,
  saving,
  systemNotificationStatus,
  systemNotificationSupported,
  systemNotificationTesting,
  completionNotificationHint,
  systemNotificationPermissionLabel,
  systemNotificationDescription,
  updateCompletionSound,
  updateCompletionSystemNotification,
  triggerSystemNotificationTest
} = useCompletionNotificationSettings()
</script>

<template>
  <div class="space-y-4 rounded-xl bg-muted/25 p-5">
    <div>
      <h3 class="text-sm font-medium">
        生成完成提醒
      </h3>
      <p class="mt-1 text-xs text-muted-foreground">
        用于模型任务完成时提醒你返回页面（解析、出图、出视频等）。
      </p>
    </div>

    <div class="space-y-2">
      <label class="flex items-center justify-between gap-3 rounded-xl bg-muted/20 px-3 py-2.5">
        <span class="text-sm text-foreground">播放提示音</span>
        <Switch
          :checked="completionNotificationOptions.sound"
          :disabled="saving"
          @update:checked="updateCompletionSound"
        />
      </label>

      <label class="flex items-center justify-between gap-3 rounded-xl bg-muted/20 px-3 py-2.5">
        <span class="text-sm text-foreground">系统通知</span>
        <Switch
          :checked="completionNotificationOptions.systemNotification"
          :disabled="saving || !systemNotificationSupported"
          @update:checked="updateCompletionSystemNotification"
        />
      </label>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted-foreground">
        当前权限：{{ systemNotificationPermissionLabel }}
      </p>
      <Button
        v-if="systemNotificationStatus.supported"
        variant="outline"
        size="sm"
        class="h-7 px-2 text-xs"
        :disabled="saving || systemNotificationTesting || !systemNotificationStatus.secureContext"
        @click="triggerSystemNotificationTest"
      >
        {{ systemNotificationTesting ? '发送中...' : '测试通知' }}
      </Button>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ systemNotificationDescription }}
    </p>

    <p
      v-if="completionNotificationHint"
      class="text-xs"
      :class="systemNotificationStatus.canNotify ? 'text-emerald-600' : 'text-amber-600'"
    >
      {{ completionNotificationHint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import SettingsDownloadDirectory from '@/components/settings/SettingsDownloadDirectory.vue'
import SettingsCompletionNotification from '@/components/settings/SettingsCompletionNotification.vue'
import SettingsDesktopFfmpeg from '@/components/settings/SettingsDesktopFfmpeg.vue'
import SettingsDesktopUpdate from '@/components/settings/SettingsDesktopUpdate.vue'
</script>

<template>
  <div class="@container h-full overflow-y-auto px-4 pb-6 md:px-6">
    <div class="space-y-4 pt-4">
      <SettingsDownloadDirectory />
      <SettingsCompletionNotification />
      <SettingsDesktopFfmpeg />
      <SettingsDesktopUpdate />
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/25 p-5">
        <div>
          <h3 class="text-sm font-medium">
            新手引导
          </h3>
          <p class="mt-1 text-xs text-muted-foreground">
            重新检查账号、模型和 FFmpeg 是否就绪，并查看创作流程说明。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          @click="$router.push('/welcome')"
        >
          查看引导
          <ArrowRight class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>

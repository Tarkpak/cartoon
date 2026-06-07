<script setup lang="ts">
import SettingsSectionHeader from '@/components/settings/SettingsSectionHeader.vue'
import SettingsCompletionNotification from '@/components/settings/SettingsCompletionNotification.vue'
import SettingsDesktopFfmpeg from '@/components/settings/SettingsDesktopFfmpeg.vue'
import SettingsDesktopUpdate from '@/components/settings/SettingsDesktopUpdate.vue'
</script>

<template>
  <div class="@container h-full overflow-y-auto p-6">
    <div class="mx-auto max-w-3xl space-y-4">
      <SettingsSectionHeader
        title="通用"
        description="全局偏好设置，应用于所有项目与工作流程。"
      />

      <SettingsCompletionNotification />
      <SettingsDesktopUpdate />
      <SettingsDesktopFfmpeg />
    </div>
  </div>
</template>

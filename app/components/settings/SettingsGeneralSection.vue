<script setup lang="ts">
import SettingsCompletionNotification from '@/components/settings/SettingsCompletionNotification.vue'
import SettingsDesktopFfmpeg from '@/components/settings/SettingsDesktopFfmpeg.vue'
import SettingsDesktopUpdate from '@/components/settings/SettingsDesktopUpdate.vue'
</script>

<template>
  <div class="@container h-full overflow-y-auto px-4 pb-6 md:px-6">
    <div class="space-y-4 pt-4">
      <SettingsCompletionNotification />
      <SettingsDesktopFfmpeg />
      <SettingsDesktopUpdate />
    </div>
  </div>
</template>

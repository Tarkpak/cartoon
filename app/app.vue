<script setup lang="ts">
import DesktopFfmpegInstallDialog from '@/components/desktop/DesktopFfmpegInstallDialog.vue'
import DesktopUpdatePromptDialog from '@/components/desktop/DesktopUpdatePromptDialog.vue'
import DefaultLayout from '@/layouts/default.vue'
import Toaster from '@/components/ui/toast/Toaster.vue'
import ConfirmHost from '@/components/ui/confirm/ConfirmHost.vue'
import { useDesktopFfmpeg } from '@/composables/useDesktopFfmpeg'
import { useCloudAdmin } from '@/composables/useCloudAdmin'

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'zh-CN'
  }
})

const title = 'playlet - AI 影视生成系统'
const description = 'AI 驱动的影视创作平台。从文本到视频，生成专业级 AI 影视内容。'
const { ensureDesktopFfmpegStatus } = useDesktopFfmpeg()
const { heartbeat, loadStatus, authenticated } = useCloudAdmin()
let heartbeatTimer: number | null = null

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})

onMounted(() => {
  void ensureDesktopFfmpegStatus()
  void loadStatus().then((status) => {
    if (!status?.authenticated) return
    void heartbeat()
    heartbeatTimer = window.setInterval(() => {
      if (authenticated.value) {
        void heartbeat()
      }
    }, 60_000) as unknown as number
  })
})

onUnmounted(() => {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
})
</script>

<template>
  <DefaultLayout>
    <RouterView />
    <DesktopFfmpegInstallDialog />
    <DesktopUpdatePromptDialog />
    <Toaster />
    <ConfirmHost />
  </DefaultLayout>
</template>

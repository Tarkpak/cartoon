<script setup lang="ts">
import DesktopFfmpegInstallDialog from '@/components/desktop/DesktopFfmpegInstallDialog.vue'
import DesktopUpdatePromptDialog from '@/components/desktop/DesktopUpdatePromptDialog.vue'
import DefaultLayout from '@/layouts/default.vue'
import { useDesktopFfmpeg } from '@/composables/useDesktopFfmpeg'

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

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})

onMounted(() => {
  void ensureDesktopFfmpegStatus()
})
</script>

<template>
  <DefaultLayout>
    <RouterView />
    <DesktopFfmpegInstallDialog />
    <DesktopUpdatePromptDialog />
  </DefaultLayout>
</template>

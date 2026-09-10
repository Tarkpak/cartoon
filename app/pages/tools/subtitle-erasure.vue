<script setup lang="ts">
import { FileVideo, Loader2, Upload } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
definePageMeta({ layout: 'default' })
const { toast } = useToast()
const file = ref<File | null>(null); const input = ref<HTMLInputElement | null>(null)
const busy = ref(false); const error = ref('')
function choose() { input.value?.click() }
function changed(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] || null }
async function submit() {
  if (!file.value) return
  busy.value = true; error.value = ''
  try {
    const form = new FormData(); form.append('video', file.value)
    const upload = await $fetch<{ videoUrl: string }>('/api/tools/subtitle-erasure/upload-source', { method: 'POST', body: form })
    const result = await $fetch<{ taskId: string }>('/api/tools/subtitle-erasure', { method: 'POST', body: { videoUrl: upload.videoUrl, sourceFileName: file.value.name } })
    toast.success('字幕擦除任务已提交'); await navigateTo({ path: '/tools/subtitle-erasure-tasks', query: { taskId: result.taskId } })
  } catch (e) { error.value = e instanceof Error ? e.message : '提交失败' } finally { busy.value = false }
}
</script>
<template>
  <AppPageContent>
    <AppPageHeader title="字幕擦除" description="移除视频中的硬字幕，处理完成后可下载无字幕视频。" />
    <div class="mx-auto max-w-2xl space-y-6">
      <div class="rounded-xl border border-dashed p-10 text-center" @click="choose">
        <input ref="input" type="file" accept="video/*" class="hidden" @change="changed">
        <FileVideo class="mx-auto h-10 w-10 text-muted-foreground" />
        <p class="mt-3 text-sm">{{ file ? file.name : '点击选择视频文件' }}</p>
        <Button class="mt-5" variant="outline" type="button"><Upload class="mr-2 h-4 w-4" />选择视频</Button>
      </div>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <Button class="w-full" :disabled="!file || busy" @click="submit"><Loader2 v-if="busy" class="mr-2 h-4 w-4 animate-spin" />开始擦除字幕</Button>
      <NuxtLink to="/tools/subtitle-erasure-tasks" class="block text-center text-sm text-muted-foreground">查看历史任务</NuxtLink>
    </div>
  </AppPageContent>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { ProjectCollaborationClient } from '~/lib/project-collaboration-client'
import { collaborationRecord as record, collaborationText as text } from '~/lib/project-collaboration-editor'
import { mediaGenerationInput, parseCollaborationMediaResult, type CollaborationMediaResult } from '~/lib/project-collaboration-media'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const props = defineProps<{ projectId: string, actorId: string, episodeId: string, client: ProjectCollaborationClient, revision: number, editable: boolean, busy: boolean }>()
const emit = defineEmits<{ adopt: [result: CollaborationMediaResult] }>()
const sceneId = ref('')
const results = ref<CollaborationMediaResult[]>([])
const chosen = ref('')
const error = ref('')
const working = ref(false)
const refreshing = ref(false)
let sequence = 0
let refreshingVersion = -1
const scenes = computed(() => { void props.revision; const scenes = props.client.get('episode', props.episodeId)?.body?.scenes; return Array.isArray(scenes) ? scenes.map(record) : [] })
const visibleResults = computed(() => results.value.filter(item => item.collaboration.episodeId === props.episodeId))
const selected = computed(() => visibleResults.value.find(item => item.id === chosen.value) ?? visibleResults.value.at(-1))
const taskLabel = (status: string) => ({ pending: '等待生成', processing: '正在生成', running: '正在生成', completed: '已完成', failed: '生成失败', cancelled: '已取消' } as Record<string, string>)[status] || '正在处理'
async function refresh() {
  if (refreshing.value && refreshingVersion === sequence) return
  const version = sequence
  const projectId = props.projectId
  const actorId = props.actorId
  refreshingVersion = version
  refreshing.value = true
  try {
    // Poll only the selected remote task; other provider workers continue in the backend.
    const active = selected.value
    if (active?.kind === 'video' && !['completed', 'failed', 'cancelled'].includes(active.status)) {
      await $fetch(`/api/video/status/${encodeURIComponent(active.id)}`, { timeout: 30_000, retry: 0 })
    }
    const response = await $fetch<{ data: unknown[] }>(`/api/project/${encodeURIComponent(projectId)}/collaboration/media-results`, { timeout: 30_000, retry: 0 })
    if (version === sequence) {
      const incoming = response.data.filter(item => item && typeof item === 'object' && 'kind' in item && ['image', 'video'].includes(String(item.kind))).map(parseCollaborationMediaResult).filter(item => item.collaboration.projectId === projectId && item.collaboration.actorId === actorId)
      results.value = [...new Map([...results.value, ...incoming].map(item => [item.id, item])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50)
    }
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '媒体任务读取失败') }
  finally { if (version === sequence) refreshing.value = false }
}
watch(() => [props.projectId, props.actorId], () => { sequence++; results.value = []; sceneId.value = ''; error.value = ''; void refresh() }, { immediate: true })
watch(() => props.episodeId, () => { sceneId.value = ''; chosen.value = '' })
async function generate(kind: 'image' | 'video') {
  if (!props.editable || working.value || !sceneId.value) return
  const version = sequence
  working.value = true
  error.value = ''
  try {
    const input = mediaGenerationInput(props.client, props.episodeId, sceneId.value)
    if (kind === 'image') {
      const response = await $fetch<{ data: unknown }>(`/api/project/${encodeURIComponent(props.projectId)}/collaboration/scene-image`, {
        method: 'POST', timeout: 600_000, retry: 0, body: { sceneId: sceneId.value, collaborationInput: input }
      })
      if (version === sequence) { const result = parseCollaborationMediaResult(response.data); results.value.push(result); chosen.value = result.id }
    } else {
      const response = await $fetch<{ taskId: string }>('/api/video/generate', { method: 'POST', timeout: 60_000, retry: 0, body: { projectId: props.projectId, sceneId: sceneId.value, collaborationInput: input } })
      if (version === sequence) { chosen.value = response.taskId; await refresh() }
    }
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '生成失败，可刷新任务查看已完成结果') }
  finally { working.value = false }
}
async function retryVoice() {
  if (!selected.value || !props.editable || working.value) return
  const version = sequence
  working.value = true
  try {
    await $fetch(`/api/project/${encodeURIComponent(props.projectId)}/collaboration/voice-retry/${encodeURIComponent(selected.value.id)}`, { method: 'POST', retry: 0, timeout: 30_000 })
    if (version === sequence) await refresh()
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '语音提取重试失败') }
  finally { working.value = false }
}
function exportResult() {
  if (!selected.value) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(selected.value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `分镜媒体结果-${selected.value.id}.json`
  link.click()
  URL.revokeObjectURL(url)
}
const timer = setInterval(() => { if (selected.value?.kind === 'video' && (!['completed', 'failed', 'cancelled'].includes(selected.value.status) || selected.value.voiceExtraction?.status === 'running')) void refresh() }, 20_000)
onBeforeUnmount(() => { sequence++; clearInterval(timer) })
</script>

<template>
  <section aria-label="分镜图片与视频生成" class="space-y-3 rounded-md border p-3">
    <h2 class="text-sm font-medium">分镜图片与视频</h2>
    <p class="text-xs text-muted-foreground">使用当前流程模型生成首帧或视频。请先保存本集和项目设置。结果先预览，采用后再保存。</p>
    <label class="block space-y-2 text-sm"><span>生成目标分镜</span><select v-model="sceneId" aria-label="生成目标分镜" :disabled="working || !editable" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">选择分镜</option><option v-for="(scene, index) in scenes" :key="text(scene.id)" :value="text(scene.id)">{{ index + 1 }} · {{ text(scene.title) || '未命名分镜' }}</option></select></label>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" :disabled="!editable || busy || working || !sceneId" @click="generate('image')">生成首帧预览</Button>
      <Button size="sm" variant="outline" :disabled="!editable || busy || working || !sceneId" @click="generate('video')">生成视频预览</Button>
      <Button size="sm" variant="outline" :disabled="refreshing || busy" @click="refresh">刷新媒体任务</Button>
    </div>
    <p v-if="working" class="text-sm text-muted-foreground" role="status">正在提交或生成，请稍候…</p>
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <template v-if="selected">
      <label class="block space-y-2 text-sm"><span>已保存的媒体任务</span><select v-model="chosen" aria-label="已保存的媒体任务" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">最新任务</option><option v-for="item in visibleResults" :key="item.id" :value="item.id">{{ item.kind === 'image' ? '首帧' : '视频' }} · {{ taskLabel(item.status) }} · {{ new Date(item.createdAt).toLocaleString() }}</option></select></label>
      <p class="text-sm text-muted-foreground">{{ taskLabel(selected.status) }} · {{ selected.progress }}%</p>
      <p v-if="selected.error" class="text-sm text-destructive">{{ selected.error }}</p>
      <img v-if="selected.kind === 'image' && selected.url" :src="selected.url" alt="生成首帧预览" class="max-h-80 w-full rounded-md object-contain" />
      <video v-if="selected.kind === 'video' && selected.url" :src="selected.url" controls preload="metadata" class="max-h-80 w-full rounded-md" />
      <div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" :disabled="!editable || busy || selected.status !== 'completed'" @click="emit('adopt', selected)">采用媒体到本集草稿</Button><Button size="sm" variant="outline" @click="exportResult">导出媒体结果</Button></div>
      <p class="text-xs text-muted-foreground">已完成结果保留在本机。输入版本变化时不会自动覆盖；采用到协作项目需要共享存储地址。</p>
    </template>
    <div v-if="selected?.voiceExtraction" class="space-y-2 text-xs text-muted-foreground">
      <p>自动提取语音：{{ selected.voiceExtraction.status === 'completed' ? '已完成，请到公共角色或项目设置查看声音候选' : selected.voiceExtraction.status === 'failed' ? '失败，视频结果已保留' : '正在处理' }}</p>
      <p v-if="selected.voiceExtraction.error" role="alert">{{ selected.voiceExtraction.error }}</p>
      <Button v-if="selected.voiceExtraction.status !== 'completed'" size="sm" variant="outline" :disabled="!editable || busy || working" @click="retryVoice">重试语音提取</Button>
    </div>
  </section>
</template>

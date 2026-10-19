<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { ProjectCollaborationClient } from '~/lib/project-collaboration-client'
import { collaborationRecord as record, collaborationText as text } from '~/lib/project-collaboration-editor'
import { assetGenerationInput, parseCollaborationAssetResult, type CollaborationAssetResult } from '~/lib/project-collaboration-assets'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
const props = defineProps<{ projectId: string, actorId: string, resourceType: 'character' | 'settings', resourceId: string, client: ProjectCollaborationClient, revision: number, editable: boolean, busy: boolean }>()
const emit = defineEmits<{ adopt: [result: CollaborationAssetResult] }>()
const target = ref('')
const results = ref<CollaborationAssetResult[]>([])
const working = ref(false)
const error = ref('')
let sequence = 0
const kind = computed(() => props.resourceType === 'character' ? 'character' : 'prop')
const targets = computed(() => {
  void props.revision
  if (kind.value === 'character') return [{ id: props.resourceId, name: text(props.client.get('character', props.resourceId)?.body?.name) }]
  const items = record(record(props.client.get('settings', 'settings')?.body?.script).assetWorkflow).props
  return Array.isArray(items) ? items.map(record) : []
})
const visible = computed(() => results.value.filter(item => item.collaboration.resourceType === props.resourceType && item.collaboration.resourceId === props.resourceId))
async function refresh() {
  const version = sequence
  try {
    const response = await $fetch<{ data: unknown[] }>(`/api/project/${encodeURIComponent(props.projectId)}/collaboration/media-results`, { retry: 0, timeout: 30_000 })
    if (version !== sequence) return
    const incoming = response.data.filter(item => ['asset-image', 'asset-voice'].includes(String(record(item).kind))).map(parseCollaborationAssetResult).filter(item => item.collaboration.projectId === props.projectId && item.collaboration.actorId === props.actorId)
    results.value = [...new Map([...results.value, ...incoming].map(item => [item.id, item])).values()].slice(-20)
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '读取公共资产结果失败') }
}
watch(() => [props.projectId, props.actorId], () => { sequence++; results.value = []; error.value = ''; void refresh() }, { immediate: true })
watch(() => [props.resourceType, props.resourceId], () => { target.value = ''; error.value = '' })
async function generate() {
  if (!props.editable || props.busy || working.value) return
  const version = sequence
  working.value = true
  error.value = ''
  try {
    const assetId = kind.value === 'character' ? props.resourceId : target.value
    const input = assetGenerationInput(props.client, kind.value, assetId)
    const response = await $fetch<{ data: unknown }>(`/api/project/${encodeURIComponent(props.projectId)}/collaboration/asset-image`, { method: 'POST', retry: 0, timeout: 600_000, body: { kind: kind.value, assetId, collaborationInput: input } })
    if (version === sequence) results.value.push(parseCollaborationAssetResult(response.data))
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '生成失败，可刷新结果查看已完成图片') }
  finally { working.value = false }
}
function exportResult(item: CollaborationAssetResult) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `公共媒体结果-${item.id}.json`
  link.click()
  URL.revokeObjectURL(url)
}
onBeforeUnmount(() => { sequence++ })
</script>

<template>
  <section aria-label="公共资产图片与声音" class="space-y-3 rounded-md border p-3">
    <h2 class="text-sm font-medium">{{ kind === 'character' ? '公共角色图片与声音' : '公共道具图片与声音' }}</h2>
    <p class="text-xs text-muted-foreground">请先保存公共资产和项目设置。图片和自动提取的语音先预览，采用后再保存。</p>
    <select v-if="kind === 'prop'" v-model="target" aria-label="生成目标道具" :disabled="working || !editable" class="h-10 w-full rounded-md border bg-background px-3 text-sm">
      <option value="">选择道具</option><option v-for="item in targets" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) || text(item.id) }}</option>
    </select>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" :disabled="!editable || busy || working || (kind === 'prop' && !target)" @click="generate">{{ working ? '正在生成…' : '生成公共资产图片' }}</Button>
      <Button size="sm" variant="outline" @click="refresh">刷新公共媒体结果</Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <article v-for="item in visible" :key="item.id" class="space-y-2 rounded-md border p-2">
      <p class="break-all text-xs text-muted-foreground">{{ item.collaboration.assetId }} · {{ item.createdAt }}</p>
      <audio v-if="item.kind === 'asset-voice'" :src="item.url" controls preload="none" class="max-w-full" />
      <p v-if="item.kind === 'asset-voice'" class="text-xs text-muted-foreground">{{ text(item.voiceAsset?.transcript) }}</p>
      <img v-else :src="item.url" alt="公共资产生成图片" class="max-h-64 max-w-full rounded-md object-contain">
      <div class="flex flex-wrap gap-2">
        <a :href="item.url" target="_blank" rel="noopener noreferrer" class="text-sm underline">打开媒体</a>
        <Button size="sm" variant="outline" @click="exportResult(item)">导出公共媒体结果</Button>
        <Button size="sm" variant="outline" :disabled="!editable || busy || working" @click="emit('adopt', item)">采用到公共资产草稿</Button>
      </div>
    </article>
  </section>
</template>

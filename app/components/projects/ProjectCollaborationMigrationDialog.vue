<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Project } from '~/lib/projects-page'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
const props = defineProps<{ open: boolean, project: Project | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean], migrated: [id: string] }>()
interface Preview { expectedUpdatedAt: string, snapshotHash: string, projectName: string, episodes: number, scenes: number, characters: number }
const preview = ref<Preview>()
const busy = ref(false)
const error = ref('')
const confirmed = ref(false)
let sequence = 0
watch(() => [props.open, props.project?.id], () => { sequence++; preview.value = undefined; error.value = ''; confirmed.value = false })
async function inspect() {
  if (!props.project || busy.value) return
  const version = sequence
  const id = props.project.id
  busy.value = true
  error.value = ''
  preview.value = undefined
  confirmed.value = false
  try {
    const response = await $fetch<{ data: Preview & { enabled?: boolean } }>(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, timeout: 60_000, body: { action: 'migrationPreview' } })
    if (version !== sequence) return
    if (response.data.enabled) emit('migrated', id)
    else preview.value = response.data
  } catch (cause) { if (version === sequence) error.value = getDisplayErrorMessage(cause, '迁移预检失败') }
  finally { busy.value = false }
}
async function migrate() {
  if (!props.project || !preview.value || !confirmed.value || busy.value) return
  const id = props.project.id
  const version = sequence
  const reviewed = preview.value
  busy.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: { enabled: boolean } }>(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, timeout: 60_000, body: { action: 'enable', expectedUpdatedAt: reviewed.expectedUpdatedAt, snapshotHash: reviewed.snapshotHash } })
    if (version !== sequence) return
    if (!response.data.enabled) throw new Error('云端未确认迁移完成，请重新预检')
    emit('migrated', id)
  } catch (cause) {
    if (version === sequence) { preview.value = undefined; confirmed.value = false; error.value = getDisplayErrorMessage(cause, '迁移结果尚未确认，请重新预检；已完成的迁移不会重复执行') }
  } finally { busy.value = false }
}
</script>

<template>
  <Dialog :open="open" @update:open="value => { if (!busy) emit('update:open', value) }">
    <DialogContent class="max-w-lg" @interact-outside="event => { if (busy) event.preventDefault() }" @escape-key-down="event => { if (busy) event.preventDefault() }">
      <DialogHeader><DialogTitle>启用按集协作</DialogTitle><DialogDescription>为「{{ project?.title }}」预检并迁移。请先让其他成员保存修改、结束生成任务并更新客户端。</DialogDescription></DialogHeader>
      <p class="text-sm text-muted-foreground">迁移会保留云端原快照与本机备份。迁移后，各集和公共资源分别保存，旧编辑入口将停止写入；当前页面不提供退回整项目同步的操作。</p>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <div v-if="preview" class="space-y-3 rounded-md border p-3 text-sm">
        <p>{{ preview.projectName }}：{{ preview.episodes }} 集 · {{ preview.scenes }} 个分镜 · {{ preview.characters }} 个角色</p>
        <label class="flex items-start gap-2"><input v-model="confirmed" type="checkbox" :disabled="busy" class="mt-1"><span>已核对项目内容，并通知协作者保存修改、更新客户端。</span></label>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="inspect">{{ busy ? '正在处理…' : '重新预检' }}</Button>
        <Button :disabled="busy || !preview || !confirmed" @click="migrate">备份并启用按集协作</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

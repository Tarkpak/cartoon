<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  applyVideoImportRoleRenames,
  parseVideoImportRoleCandidates,
  type VideoImportRoleCandidate
} from '~/lib/video-import-role-naming'

const props = defineProps<{
  script: string
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  apply: [script: string]
}>()

const draft = ref<Array<VideoImportRoleCandidate & { name: string }>>([])

watch(open, (value) => {
  if (!value) return
  draft.value = parseVideoImportRoleCandidates(props.script).map(candidate => ({ ...candidate }))
})

function apply() {
  const mappings = draft.value
    .map(item => ({
      id: item.id,
      currentLabel: item.currentLabel,
      name: item.name.trim(),
      source: item.source,
      legacyPlaceholder: item.legacyPlaceholder
    }))
    .filter(item => item.name)
  if (mappings.length > 0) {
    emit('apply', applyVideoImportRoleRenames(props.script, mappings))
  }
  open.value = false
}
</script>

<template>
  <Dialog :open="open" @update:open="open = $event">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>命名角色</DialogTitle>
        <DialogDescription>
          字幕识别不出的人名会用编号代替。填写真实名称后，角色清单和剧本里的引用会一起更新。
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-[min(60vh,32rem)] space-y-3 overflow-y-auto py-1 pr-1">
        <div
          v-for="item in draft"
          :key="item.id"
          class="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-3"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-foreground" :title="item.currentLabel">
              {{ item.currentLabel }}
            </div>
            <div class="mt-0.5 truncate text-xs text-muted-foreground">
              {{ item.aliases.length > 0 ? `别名：${item.aliases.join('、')}` : '暂无别名' }}
            </div>
          </div>
          <Input v-model="item.name" :placeholder="`输入${item.currentLabel}的真实名称`" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button @click="apply">应用名称</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

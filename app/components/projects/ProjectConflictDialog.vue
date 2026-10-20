<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MergeChoices, MergeConflict } from '~/lib/collaboration-merge'

const props = defineProps<{ preview?: { conflicts: MergeConflict[] }, busy: boolean, error?: string | null }>()
const emit = defineEmits<{ cancel: [], apply: [choices: MergeChoices] }>()
const choices = ref<MergeChoices>({})
watch(() => props.preview, () => { choices.value = {} })
const ready = computed(() => props.preview?.conflicts.every(item => !!choices.value[item.key]))
const labels: Record<string, string> = { episode: '集数', character: '角色', settings: '项目设置', directory: '集数目录', scenes: '分镜', writing: '剧本', draft: '正文', description: '描述', dialogue: '对白', title: '标题', name: '名称', prompt: '提示词', plan: '集数规划', text: '文本', content: '内容', script: '剧本', project: '项目', characters: '角色', workbench: '素材设置', index: '序号', episodeIds: '集数顺序', outline: '大纲' }
const label = (item: MergeConflict) => item.path.map(part => labels[part] || part).join(' / ')
const display = (value: unknown) => value == null ? '（已删除或为空）' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const deleted = (item: MergeConflict) => item.path.length === 2 && item.remote === null
</script>

<template>
  <Dialog :open="!!preview" @update:open="value => { if (!value && !busy) emit('cancel') }">
    <DialogContent class="max-h-[85vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto]" @interact-outside="event => { if (busy) event.preventDefault() }" @escape-key-down="event => { if (busy) event.preventDefault() }">
      <DialogHeader>
        <DialogTitle>对比并合并修改</DialogTitle>
        <DialogDescription>不同位置的修改会自动合并。下面只列出需要你选择的内容，应用后会尝试保存；保存时仍会检查最新版本。</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 space-y-4 overflow-y-auto">
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <p v-if="!preview?.conflicts.length" class="rounded-lg bg-muted/40 p-4 text-sm">双方修改没有重叠，可以直接合并，保留各自的修改。</p>
        <section v-for="item in preview?.conflicts" :key="item.key" class="space-y-2 rounded-lg border p-3">
          <h3 class="break-all text-sm font-medium">{{ label(item) }}</h3>
          <p v-if="deleted(item)" class="text-xs text-muted-foreground">此对象已被删除，请保留云端状态；需要的本机内容可从下方复制。</p>
          <div class="grid gap-3 md:grid-cols-2">
            <label v-for="side in (['local', 'remote'] as const)" :key="side" class="min-w-0 space-y-2 rounded-md bg-muted/25 p-3">
              <span class="flex items-center gap-2 text-sm">
                <input v-model="choices[item.key]" type="radio" :name="item.key" :value="side" :disabled="busy || (side === 'local' && deleted(item))" class="accent-primary">
                {{ side === 'local' ? '保留我的修改' : '保留云端内容' }}
              </span>
              <textarea :value="display(item[side])" readonly :aria-label="side === 'local' ? '我的修改内容' : '云端内容'" class="min-h-32 w-full resize-y rounded-md bg-background p-2 text-sm leading-6" />
            </label>
          </div>
        </section>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="emit('cancel')">保留草稿，暂不处理</Button>
        <Button :disabled="busy || !ready" @click="emit('apply', { ...choices })">应用合并并保存</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

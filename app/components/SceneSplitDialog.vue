<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SceneSplitDraft } from '~/lib/scene-split'

const props = defineProps<{ draft: SceneSplitDraft | null, saving: boolean, error: string }>()
const emit = defineEmits<{ close: [], confirm: [] }>()
const totalDuration = ref(0)
watch(() => props.draft, (draft) => {
  if (draft) totalDuration.value = draft[0].duration + draft[1].duration
}, { immediate: true })
const valid = computed(() => props.draft
  && props.draft.every(part => part.description.trim() && Number.isFinite(part.duration) && part.duration >= 4)
  && Math.abs(props.draft[0].duration + props.draft[1].duration - totalDuration.value) < 0.01)
</script>

<template>
  <Dialog :open="!!draft" @update:open="value => { if (!value) emit('close') }">
    <DialogContent class="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>拆分场景预览</DialogTitle>
        <DialogDescription>请核对两段剧情、时间轴、旁白与素材。确认只保存场景，不调用模型或生成视频。原视频保留在历史中，不会裁切。</DialogDescription>
      </DialogHeader>
      <p class="text-xs text-muted-foreground">总时长 {{ totalDuration }} 秒，每段至少 4 秒。旁白暂放在上半，请按剧情移动；角色、环境与素材引用继承原场景，请在拆分后核对。</p>
      <div v-if="draft" class="grid gap-4 sm:grid-cols-2">
        <section v-for="(part, index) in draft" :key="index" class="space-y-3 rounded-lg border border-border p-3">
          <h3 class="text-sm font-medium">{{ index === 0 ? '上半场景' : '下半场景' }}</h3>
          <label class="block space-y-1 text-xs">时长（秒）
            <input v-model.number="part.duration" type="number" min="4" step="0.1" :disabled="saving" class="h-9 w-full rounded-md border bg-background px-3" />
          </label>
          <label class="block space-y-1 text-xs">场景描述
            <textarea v-model="part.description" rows="9" :disabled="saving" class="w-full rounded-md border bg-background p-3 text-sm leading-6" />
          </label>
          <label class="block space-y-1 text-xs">旁白
            <textarea v-model="part.narration" rows="3" :disabled="saving" class="w-full rounded-md border bg-background p-3 text-sm" />
          </label>
        </section>
      </div>
      <p class="text-xs text-muted-foreground">保存时会将各段时间范围换算为从 0 开始、覆盖该段时长。拆分后的两段需要分别手动生成视频。</p>
      <p v-if="!valid || error" role="alert" class="text-xs text-destructive">{{ error || '请填写两段描述，每段至少 4 秒，时长之和须与原场景一致。' }}</p>
      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="emit('close')">取消</Button>
        <Button :disabled="!valid || saving" @click="emit('confirm')">{{ saving ? '正在保存…' : '确认拆分并保存' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

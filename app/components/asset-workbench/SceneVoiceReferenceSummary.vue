<script setup lang="ts">
import type { SceneVoiceReferenceSummary } from '~/lib/asset-workbench-types'

const props = defineProps<{
  summary: SceneVoiceReferenceSummary
}>()

const label = computed(() => {
  if (props.summary.mode === 'explicit_audio') return '音频参考'
  if (props.summary.mode === 'prompt_only') return '声音一致性'
  return '暂无角色音频参考'
})
</script>

<template>
  <div
    v-if="summary.hasDialogue"
    class="flex flex-wrap items-center gap-1.5"
  >
    <Badge
      :variant="summary.mode === 'explicit_audio' ? 'secondary' : 'outline'"
      class="text-[10px]"
    >
      {{ label }}
    </Badge>
    <Badge
      v-for="character in summary.characters"
      :key="character.id"
      variant="outline"
      class="inline-flex max-w-[220px] items-center gap-1 text-[10px]"
    >
      <span class="truncate">
        {{ character.name }}
      </span>
      <span class="shrink-0 text-muted-foreground">
        {{ character.source === 'manual' ? '手动' : '自动' }}
      </span>
      <span
        v-if="character.locked"
        class="shrink-0 text-amber-600"
      >
        锁定
      </span>
    </Badge>
  </div>
</template>

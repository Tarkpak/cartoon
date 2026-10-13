<script setup lang="ts">
import { supportsTextReasoningEffort } from '#shared/utils/model-reasoning'
import { useModelReasoningSettings } from '@/composables/useModelReasoningSettings'

const props = defineProps<{ model: string, provider: string }>()
const { efforts, saving, error, load, save } = useModelReasoningSettings()
const supported = computed(() => props.provider !== 'gemini' && supportsTextReasoningEffort(props.model))
const effort = computed(() => efforts.value[`${props.provider}:${props.model}`] || 'low')
onMounted(() => { void load() })
</script>

<template>
  <div v-if="supported" class="mt-3 space-y-2">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm text-muted-foreground">推理强度</span>
      <Select :model-value="effort" :disabled="saving" @update:model-value="value => save(props.provider, props.model, value)">
        <SelectTrigger class="h-8 w-32 text-sm" :aria-label="`${props.model} 推理强度`">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="low">低</SelectItem>
          <SelectItem value="medium">中</SelectItem>
          <SelectItem value="high">高</SelectItem>
          <SelectItem value="default">服务默认</SelectItem>
        </SelectContent>
      </Select>
      <span class="text-xs text-muted-foreground">默认低；同一模型在各流程中共用此配置。</span>
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>

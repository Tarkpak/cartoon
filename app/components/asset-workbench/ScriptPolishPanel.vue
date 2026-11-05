<script setup lang="ts">
import { CircleHelp, Loader2, WandSparkles } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const text = defineModel<string>({ required: true })
const draft = defineModel<string | null>('draft', { required: true })
const props = defineProps<{ projectId?: string | null, disabled?: boolean, hasEpisodePlan: boolean }>()
const emit = defineEmits<{ (event: 'busy', value: boolean): void }>()
const busy = ref(false)
const original = ref('')
const error = ref('')
let controller: AbortController | undefined
let requestId = 0
const unavailable = computed(() => props.disabled || props.hasEpisodePlan || !props.projectId)

function invalidate() {
  requestId++
  controller?.abort()
  busy.value = false
  emit('busy', false)
  draft.value = null
  error.value = ''
}
watch(() => [props.projectId, props.disabled, props.hasEpisodePlan, text.value], invalidate)
onBeforeUnmount(invalidate)

async function polish() {
  if (unavailable.value || busy.value || !text.value.trim()) return
  if (Array.from(text.value.trim()).length > 6000) {
    error.value = '当前剧本超过 6000 字，请精简待润色稿后重试。'
    return
  }
  const id = ++requestId
  original.value = text.value
  error.value = ''
  draft.value = null
  busy.value = true
  emit('busy', true)
  controller = new AbortController()
  try {
    const response = await $fetch<{ success: boolean, data: { text: string } }>('/api/script/polish', {
      method: 'POST',
      body: { projectId: props.projectId, text: original.value, scriptParseMode: 'premium_drama' },
      signal: controller.signal
    })
    if (id !== requestId) return
    if (!response.success || !response.data?.text?.trim()) throw new Error('模型未返回润色稿')
    draft.value = response.data.text
  } catch (cause) {
    if (id === requestId) error.value = getDisplayErrorMessage(cause, '剧本润色失败，请重试')
  } finally {
    if (id === requestId) {
      busy.value = false
      emit('busy', false)
    }
  }
}

function adopt() {
  if (unavailable.value || busy.value || !draft.value?.trim() || text.value !== original.value) return
  text.value = draft.value
  draft.value = null
}
</script>

<template>
  <section class="absolute bottom-12 right-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2" aria-label="剧本与对白润色">
    <p v-if="error" role="alert" class="max-w-sm rounded-lg border border-destructive/25 bg-background px-3 py-2 text-sm text-destructive shadow-sm">{{ error }}</p>
    <div v-if="draft === null">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button size="icon" class="h-11 w-11 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.16),0_1px_2px_rgba(0,0,0,0.08)] transition-transform active:scale-[0.96] aria-disabled:cursor-not-allowed aria-disabled:opacity-50" :aria-label="busy ? '正在润色剧本' : '用技能润色剧本'" :aria-disabled="unavailable || busy || !text.trim()" @click="polish">
            <Loader2 v-if="busy" class="h-5 w-5 animate-spin" />
            <WandSparkles v-else class="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" class="w-64 max-w-[calc(100vw-2rem)] rounded-lg p-3 text-left leading-5">
          <p class="text-sm font-semibold">{{ busy ? '正在润色剧本…' : '用技能润色剧本' }}</p>
          <p v-if="hasEpisodePlan" class="mt-1.5 text-background/80">已有分集目录，请在新项目生成目录前润色。</p>
          <template v-else>
            <p class="mt-1.5 text-background/80">先在技能中心启用「剧本／对白润色」。</p>
            <p class="mt-2 border-t border-background/20 pt-2 text-background/70">最多 6000 字 · 采用后再生成目录</p>
          </template>
        </TooltipContent>
      </Tooltip>
    </div>
    <div v-else class="flex items-center gap-2 rounded-lg bg-background/95 p-1 shadow-[0_6px_20px_rgba(0,0,0,0.22),0_1px_4px_rgba(0,0,0,0.12)] ring-1 ring-border/70 backdrop-blur-sm">
      <Tooltip>
        <TooltipTrigger as-child><button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="润色稿核对说明"><CircleHelp class="h-4 w-4" /></button></TooltipTrigger>
        <TooltipContent side="top" align="end" class="w-56 rounded-lg p-3 text-left leading-5"><p class="font-semibold">核对润色稿</p><p class="mt-1 text-background/80">检查人物、剧情与线索；右侧草稿可直接修改。</p></TooltipContent>
      </Tooltip>
      <div class="flex gap-1">
        <Button :disabled="unavailable || !draft.trim()" @click="adopt">采用润色稿</Button>
        <Button variant="ghost" @click="draft = null">保留原稿</Button>
      </div>
    </div>
  </section>
</template>

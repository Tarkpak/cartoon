<script setup lang="ts">
import { Loader2, WandSparkles } from 'lucide-vue-next'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const text = defineModel<string>({ required: true })
const props = defineProps<{ projectId?: string | null, disabled?: boolean, hasEpisodePlan: boolean }>()
const emit = defineEmits<{ (event: 'busy', value: boolean): void }>()
const busy = ref(false)
const draft = ref<string | null>(null)
const original = ref('')
const error = ref('')
let controller: AbortController | undefined
let requestId = 0
const hint = computed(() => props.hasEpisodePlan
  ? '已有分集目录，请在新项目生成目录前润色，避免影响现有分集边界。'
  : '先在项目技能中启用“剧本／对白润色”技能；每次最多 6000 字，采用后再生成目录。')
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
  <section class="shrink-0 space-y-3 rounded-xl border p-4" aria-label="剧本与对白润色">
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="outline" class="gap-2" :disabled="unavailable || busy || !text.trim()" @click="polish">
        <Loader2 v-if="busy" class="h-4 w-4 animate-spin" />
        <WandSparkles v-else class="h-4 w-4" />
        {{ busy ? '正在润色剧本…' : '用技能润色剧本' }}
      </Button>
      <p class="flex-1 text-xs leading-relaxed text-muted-foreground">{{ hint }}</p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <div v-if="draft !== null" class="space-y-3">
      <p class="text-sm text-muted-foreground">请核对人物、剧情事实和关键线索。可直接修改润色稿，采用后用于后续分集与分镜。</p>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <p class="text-sm font-medium">原始剧本</p>
          <Textarea :model-value="original" readonly aria-label="原始剧本" class="min-h-[280px] resize-y" />
        </div>
        <div class="space-y-2">
          <p class="text-sm font-medium">润色草稿</p>
          <Textarea v-model="draft" aria-label="润色草稿" class="min-h-[280px] resize-y" />
        </div>
      </div>
      <div class="flex gap-2">
        <Button :disabled="unavailable || !draft.trim()" @click="adopt">采用润色稿</Button>
        <Button variant="ghost" @click="draft = null">保留原稿</Button>
      </div>
    </div>
  </section>
</template>

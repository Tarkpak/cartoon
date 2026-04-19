<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { SceneChatMentionCandidate, DisplayAsset } from '~/lib/asset-workbench-types'
import {
  applySceneChatMentionToText,
  buildSceneChatMentionCandidates,
  resolveSceneChatMentionState,
  resolveSceneChatTextareaElement
} from '~/lib/asset-workbench-scene-chat'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  open: boolean
  title: string
  description: string
  targetLabel: string
  prompt: string
  promptPlaceholder: string
  mentionAssets?: DisplayAsset[]
  mentionTokenMap?: Map<string, string>
  resolveDisplayAssetTypeLabel?: (type: DisplayAsset['type']) => string
  error?: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:prompt': [prompt: string]
  'submit': []
}>()

const promptModel = computed({
  get: () => props.prompt,
  set: value => emit('update:prompt', value)
})

const promptInputRef = ref<HTMLTextAreaElement | null>(null)
const mentionListRef = ref<HTMLDivElement | null>(null)
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref<number | null>(null)
const mentionActiveIndex = ref(0)

const mentionCandidates = computed<SceneChatMentionCandidate[]>(() => {
  return buildSceneChatMentionCandidates({
    assets: props.mentionAssets || [],
    query: mentionQuery.value,
    tokenMap: props.mentionTokenMap || new Map<string, string>(),
    resolveDisplayAssetTypeLabel: (type) => {
      return props.resolveDisplayAssetTypeLabel?.(type) || '资产'
    }
  })
})

watch(() => props.open, (open) => {
  if (open) return
  closeMention()
})

watch(mentionCandidates, (candidates) => {
  if (!mentionOpen.value) return

  if (candidates.length === 0) {
    closeMention()
    return
  }

  if (mentionActiveIndex.value >= candidates.length) {
    mentionActiveIndex.value = candidates.length - 1
  }
  syncMentionActiveItemIntoView()
})

function setPromptInputElement(target: unknown) {
  promptInputRef.value = resolveSceneChatTextareaElement(target)
}

function setMentionListElement(target: unknown) {
  mentionListRef.value = target instanceof HTMLDivElement ? target : null
}

function closeMention() {
  mentionOpen.value = false
  mentionQuery.value = ''
  mentionStart.value = null
  mentionActiveIndex.value = 0
}

function syncMentionActiveItemIntoView() {
  if (!mentionOpen.value) return

  nextTick(() => {
    const listElement = mentionListRef.value
    if (!listElement) return

    const target = listElement.querySelector<HTMLElement>(
      `[data-regenerate-mention-index="${mentionActiveIndex.value}"]`
    )
    target?.scrollIntoView({ block: 'nearest' })
  })
}

function updateMentionState() {
  const textarea = promptInputRef.value
  if (!textarea) {
    closeMention()
    return
  }

  const cursor = textarea.selectionStart ?? promptModel.value.length
  const state = resolveSceneChatMentionState({
    text: promptModel.value,
    cursor,
    allowInline: true
  })

  if (!state.open || state.start === null) {
    closeMention()
    return
  }

  mentionStart.value = state.start
  mentionQuery.value = state.query
  mentionOpen.value = mentionCandidates.value.length > 0

  if (!mentionOpen.value) {
    mentionActiveIndex.value = 0
    return
  }
  syncMentionActiveItemIntoView()
}

function applyMention(candidate: SceneChatMentionCandidate) {
  const textarea = promptInputRef.value
  const start = mentionStart.value
  if (!textarea || start === null) return

  const cursor = textarea.selectionStart ?? promptModel.value.length
  const nextState = applySceneChatMentionToText({
    text: promptModel.value,
    start,
    cursor,
    token: candidate.token
  })

  promptModel.value = nextState.text
  closeMention()

  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(nextState.cursor, nextState.cursor)
  })
}

function handlePromptInput() {
  updateMentionState()
}

function handlePromptCursor() {
  updateMentionState()
}

function handlePromptFocus() {
  updateMentionState()
}

function handlePromptBlur() {
  setTimeout(() => {
    closeMention()
  }, 120)
}

function handlePromptKeydown(event: KeyboardEvent) {
  if (!mentionOpen.value || mentionCandidates.value.length === 0) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    mentionActiveIndex.value = (mentionActiveIndex.value + 1) % mentionCandidates.value.length
    syncMentionActiveItemIntoView()
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    mentionActiveIndex.value = (
      mentionActiveIndex.value - 1 + mentionCandidates.value.length
    ) % mentionCandidates.value.length
    syncMentionActiveItemIntoView()
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    const candidate = mentionCandidates.value[mentionActiveIndex.value]
      || mentionCandidates.value[0]
    if (candidate) {
      applyMention(candidate)
    }
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeMention()
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div class="text-xs text-muted-foreground">
          目标：{{ targetLabel || '-' }}
        </div>
        <div class="relative">
          <Textarea
            :ref="setPromptInputElement"
            v-model="promptModel"
            class="min-h-[140px] text-sm"
            :placeholder="promptPlaceholder"
            @input="handlePromptInput"
            @click="handlePromptCursor"
            @keyup="handlePromptCursor"
            @focus="handlePromptFocus"
            @blur="handlePromptBlur"
            @keydown="handlePromptKeydown"
          />

          <div
            v-if="mentionOpen"
            :ref="setMentionListElement"
            class="absolute bottom-full left-0 right-0 mb-1 max-h-44 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            <button
              v-for="(item, mentionIndex) in mentionCandidates"
              :key="`regenerate_mention_${item.asset.id}`"
              type="button"
              :data-regenerate-mention-index="mentionIndex"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition"
              :class="mentionIndex === mentionActiveIndex ? 'bg-accent' : 'hover:bg-accent/60'"
              @mousedown.prevent="applyMention(item)"
            >
              <img
                v-if="item.asset.referenceImage"
                :src="toImageSrc(item.asset.referenceImage)"
                :alt="item.asset.name"
                class="h-5 w-5 rounded border object-cover"
              >
              <span
                v-else
                class="inline-flex h-5 w-5 items-center justify-center rounded border text-[10px]"
              >
                {{ (resolveDisplayAssetTypeLabel?.(item.asset.type) || '资产').slice(0, 1) }}
              </span>
              <span class="truncate">
                {{ item.asset.name }}
              </span>
              <span class="ml-auto text-[10px] text-muted-foreground">
                {{ item.token }}
              </span>
            </button>
          </div>
        </div>
        <p class="text-[11px] text-muted-foreground">
          输入 `@` 可引用角色 / 环境 / 道具 / 其他资产
        </p>
        <p
          v-if="error"
          class="text-xs text-destructive"
        >
          {{ error }}
        </p>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="loading"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          :disabled="!prompt.trim() || loading"
          @click="emit('submit')"
        >
          <Loader2
            v-if="loading"
            class="mr-2 h-4 w-4 animate-spin"
          />
          开始二次生成
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

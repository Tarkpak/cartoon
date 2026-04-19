<script setup lang="ts">
import { Loader2, Sparkles, Upload, X } from 'lucide-vue-next'
import type { DisplayAsset, SceneChatMentionCandidate, SceneChatMessage } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  sceneId: string
  sceneTitle: string
  messages: SceneChatMessage[]
  composerAssets: DisplayAsset[]
  composerText: string
  mentionOpen: boolean
  mentionCandidates: SceneChatMentionCandidate[]
  mentionActiveIndex: number
  uploading: boolean
  applying: boolean
  error: string | null
  canSubmit: boolean
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  setInputRef: (element: unknown) => void
  setMentionListRef: (element: unknown) => void
  setComposerText: (value: string) => void
  onComposerInput: () => void
  onComposerCursor: () => void
  onComposerKeydown: (event: KeyboardEvent) => void
  onApplyMention: (candidate: SceneChatMentionCandidate) => void
  onRemoveComposerAsset: (assetId: string) => void
  onHandleUpload: (event: Event) => void
  onSubmit: (sceneId: string) => void
  onClose: () => void
  onPreviewImage: (src: string | undefined, alt: string) => void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

const composerTextModel = computed({
  get: () => props.composerText,
  set: value => props.setComposerText(value)
})

function setInputElement(element: unknown) {
  props.setInputRef(element)
}

function setMentionListElement(element: unknown) {
  props.setMentionListRef(element)
}

function resolveMessageAsset(assetId: string) {
  return props.resolveDisplayAssetById(assetId)
}

function triggerUpload() {
  fileInputRef.value?.click()
}
</script>

<template>
  <div
    class="absolute right-2 top-12 z-30 w-[min(92vw,420px)] rounded-md border bg-background/95 p-3 shadow-xl backdrop-blur"
    @click.stop
  >
    <div class="flex items-center justify-between gap-2 border-b pb-2">
      <div class="min-w-0">
        <p class="truncate text-xs font-medium">
          对话修改场景
        </p>
        <p class="truncate text-[11px] text-muted-foreground">
          {{ sceneTitle }}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 p-0"
        @click.stop="onClose()"
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div class="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
        <div
          class="max-w-[92%] space-y-1 rounded-md border px-2 py-1.5 text-xs"
          :class="msg.role === 'user' ? 'border-primary/40 bg-primary/10' : 'bg-muted/40'"
        >
          <p class="whitespace-pre-wrap leading-relaxed">
            {{ msg.content }}
          </p>
          <div
            v-if="msg.assetIds.length > 0"
            class="flex flex-wrap gap-1"
          >
            <template
              v-for="assetId in msg.assetIds"
              :key="`${msg.id}_${assetId}`"
            >
              <Button
                v-if="resolveMessageAsset(assetId)?.referenceImage"
                type="button"
                variant="ghost"
                class="h-7 max-w-[140px] gap-1 rounded border bg-background px-1.5"
                @click.stop="onPreviewImage(resolveMessageAsset(assetId)?.referenceImage, resolveMessageAsset(assetId)?.name || '上传资产')"
              >
                <img
                  :src="toImageSrc(resolveMessageAsset(assetId)?.referenceImage)"
                  :alt="resolveMessageAsset(assetId)?.name || '上传资产'"
                  class="h-5 w-5 rounded border object-cover"
                >
                <span class="truncate text-[10px]">
                  {{ resolveMessageAsset(assetId)?.name || assetId }}
                </span>
              </Button>
              <Badge
                v-else
                variant="outline"
                class="max-w-[140px] text-[10px]"
              >
                <span class="truncate">
                  {{ resolveMessageAsset(assetId)?.name || assetId }}
                </span>
              </Badge>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="relative mt-2 space-y-2 border-t pt-2">
      <div
        v-if="composerAssets.length > 0"
        class="flex flex-wrap items-center gap-1"
      >
        <Badge
          v-for="asset in composerAssets"
          :key="`scene_chat_composer_${asset.id}`"
          variant="secondary"
          class="gap-1 text-[10px]"
        >
          <span class="max-w-[110px] truncate">
            {{ asset.name }}
          </span>
          <button
            type="button"
            class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm"
            @click.stop="onRemoveComposerAsset(asset.id)"
          >
            <X class="h-3 w-3" />
          </button>
        </Badge>
      </div>

      <Textarea
        :ref="setInputElement"
        v-model="composerTextModel"
        class="min-h-[100px] text-xs"
        placeholder="输入修改指令，支持 @资产，回车发送，Shift+回车换行"
        @input="onComposerInput()"
        @click="onComposerCursor()"
        @keyup="onComposerCursor()"
        @keydown="onComposerKeydown($event)"
      />

      <div
        v-if="mentionOpen && mentionCandidates.length > 0"
        :ref="setMentionListElement"
        class="absolute bottom-full left-0 right-0 mb-1 max-h-40 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
      >
        <button
          v-for="(item, mentionIndex) in mentionCandidates"
          :key="`scene_chat_mention_${item.asset.id}`"
          type="button"
          :data-scene-chat-mention-index="mentionIndex"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
          :class="mentionIndex === mentionActiveIndex ? 'bg-accent' : 'hover:bg-accent/60'"
          @mousedown.prevent="onApplyMention(item)"
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
            {{ resolveDisplayAssetTypeLabel(item.asset.type).slice(0, 1) }}
          </span>
          <span class="truncate">
            {{ item.asset.name }}
          </span>
          <span class="ml-auto text-[10px] text-muted-foreground">
            {{ item.token }}
          </span>
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-[10px] text-muted-foreground">
          可 @角色/@环境/@道具/@其他，上传图片后会自动归类到“其他”并加入可引用资产。
        </p>
        <div class="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :disabled="uploading || applying"
            @click.stop="triggerUpload"
          >
            <Loader2
              v-if="uploading"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            <Upload
              v-else
              class="mr-1 h-3.5 w-3.5"
            />
            上传图片资产
          </Button>
          <Button
            size="sm"
            class="h-7 px-2 text-xs"
            :disabled="!canSubmit"
            @click.stop="onSubmit(sceneId)"
          >
            <Loader2
              v-if="applying"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            <Sparkles
              v-else
              class="mr-1 h-3.5 w-3.5"
            />
            发送修改指令
          </Button>
        </div>
      </div>

      <p
        v-if="error"
        class="text-[11px] text-destructive"
      >
        {{ error }}
      </p>

      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onHandleUpload($event)"
      >
    </div>
  </div>
</template>

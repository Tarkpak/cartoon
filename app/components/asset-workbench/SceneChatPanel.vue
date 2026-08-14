<script setup lang="ts">
import { History, Info, Loader2, Sparkles, Upload, X } from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import type { DisplayAsset, SceneChatMentionCandidate, SceneChatMessage, SceneDescriptionVersion } from '~/lib/asset-workbench-types'

const props = defineProps<{
  sceneId: string
  sceneTitle: string
  messages: SceneChatMessage[]
  description: string
  descriptionHistory: SceneDescriptionVersion[]
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
  onSelectDescriptionVersion: (versionId: string) => void
  onPreviewImage: (src: string | undefined, alt: string) => void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const historyOpen = ref(false)

const sortedHistory = computed(() => [...props.descriptionHistory].sort((a, b) => b.createdAt - a.createdAt))

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

function formatVersionTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div
    class="absolute right-2 top-12 z-30 w-[min(92vw,420px)] rounded-xl bg-muted/25/95 p-3 shadow-xl backdrop-blur"
    @click.stop
  >
    <div class="flex items-center justify-between gap-2 pb-2">
      <div class="min-w-0">
        <p class="truncate text-xs font-medium">
          对话修改场景
        </p>
        <p class="truncate text-xs text-muted-foreground">
          {{ sceneTitle }}
        </p>
      </div>
      <div class="flex items-center gap-1">
        <Button
          v-if="descriptionHistory.length > 0"
          size="sm"
          variant="ghost"
          class="h-7 gap-1 px-1.5 text-[11px]"
          :class="historyOpen ? 'bg-accent' : ''"
          @click.stop="historyOpen = !historyOpen"
        >
          <History class="h-3.5 w-3.5" />
          历史 {{ descriptionHistory.length }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          class="h-7 w-7 p-0"
          @click.stop="onClose()"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <div
      v-if="historyOpen"
      class="mt-2 rounded-lg border bg-background/80 p-1.5 shadow-sm"
      @click.stop
    >
      <p class="px-1.5 pb-1 text-[11px] text-muted-foreground">选择一个描述版本恢复</p>
      <Button
        v-for="version in sortedHistory"
        :key="version.id"
        type="button"
        variant="ghost"
        class="h-auto w-full justify-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs"
        :class="version.description === description ? 'bg-primary/10 text-primary' : ''"
        @click.stop="onSelectDescriptionVersion(version.id); historyOpen = false"
      >
        <span class="min-w-0 flex-1 truncate">{{ version.label || '描述版本' }}</span>
        <span class="shrink-0 text-[10px] text-muted-foreground">{{ formatVersionTime(version.createdAt) }}</span>
      </Button>
    </div>

    <div class="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
        <div
          class="max-w-[92%] space-y-1 rounded-xl bg-muted/15 px-2 py-1.5 text-xs"
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
                <LazyImage
                  :image="resolveMessageAsset(assetId)?.referenceImage"
                  :alt="resolveMessageAsset(assetId)?.name || '上传资产'"
                  class="h-5 w-5 rounded border object-cover"
                />
                <span class="truncate text-xs">
                  {{ resolveMessageAsset(assetId)?.name || assetId }}
                </span>
              </Button>
              <Badge
                v-else
                variant="outline"
                class="max-w-[140px] text-xs"
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

    <div class="relative mt-2 space-y-2 pt-2">
      <div
        v-if="composerAssets.length > 0"
        class="flex flex-wrap items-center gap-1"
      >
        <Badge
          v-for="asset in composerAssets"
          :key="`scene_chat_composer_${asset.id}`"
          variant="secondary"
          class="gap-1 text-xs"
        >
          <span class="max-w-[110px] truncate">
            {{ asset.name }}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="h-3.5 w-3.5 rounded-sm p-0"
            @click.stop="onRemoveComposerAsset(asset.id)"
          >
            <X class="h-3 w-3" />
          </Button>
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
        class="absolute bottom-full left-0 right-0 mb-1 max-h-40 overflow-y-auto rounded-xl bg-popover shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] p-1 shadow-md"
      >
        <Button
          v-for="(item, mentionIndex) in mentionCandidates"
          :key="`scene_chat_mention_${item.asset.id}`"
          type="button"
          variant="ghost"
          :data-scene-chat-mention-index="mentionIndex"
          class="h-auto w-full justify-start gap-2 rounded px-2 py-1.5 text-left text-xs"
          :class="mentionIndex === mentionActiveIndex ? 'bg-accent' : 'hover:bg-accent/60'"
          @mousedown.prevent="onApplyMention(item)"
        >
          <LazyImage
            v-if="item.asset.referenceImage"
            :image="item.asset.referenceImage"
            :alt="item.asset.name"
            class="h-5 w-5 rounded border object-cover"
          />
          <span
            v-else
            class="inline-flex h-5 w-5 items-center justify-center rounded border text-xs"
          >
            {{ resolveDisplayAssetTypeLabel(item.asset.type).slice(0, 1) }}
          </span>
          <span class="truncate">
            {{ item.asset.name }}
          </span>
          <span class="ml-auto text-xs text-muted-foreground">
            {{ item.token }}
          </span>
        </Button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          class="h-7 w-7 text-muted-foreground"
          title="请输入二次改写指令，支持 @资产引用，也可以上传图片资产（自动归类到“其他”）后一起调整场景。"
          aria-label="查看场景二次改写提示"
          @click.stop
        >
          <Info class="h-3.5 w-3.5" />
        </Button>
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
        class="text-xs text-destructive"
      >
        {{ error }}
      </p>

      <Input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onHandleUpload($event)"
      />
    </div>
  </div>
</template>

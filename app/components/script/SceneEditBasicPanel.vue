<script setup lang="ts">
import { Loader2, Upload } from 'lucide-vue-next'
import type { ComponentPublicInstance } from 'vue'
import { toImageSrc } from '~/lib/media'
import type {
  AssetMentionCandidate,
  SceneEditData
} from '~/lib/scene-edit-dialog'
import {
  resolveAssetTypeLabel,
  timeOfDayOptions
} from '~/lib/scene-edit-dialog'

const editForm = defineModel<SceneEditData>('editForm', { required: true })

defineProps<{
  sceneDescriptionSupportsMention: boolean
  sceneDescriptionMentionOpen: boolean
  sceneDescriptionMentionActiveIndex: number
  sceneDescriptionMentionCandidates: AssetMentionCandidate[]
  sceneAssetUploading?: boolean
  sceneAssetUploadError?: string | null
  setSceneDescriptionEditorRef: (element: Element | ComponentPublicInstance | null) => void
  setSceneDescriptionMentionListRef: (element: Element | ComponentPublicInstance | null) => void
  setSceneAssetUploadInputRef: (element: Element | ComponentPublicInstance | null) => void
  triggerSceneAssetUpload: () => void
  handleSceneAssetUpload: (event: Event) => void
  insertSceneAssetMention: (assetId: string) => void
  handleSceneDescriptionInput: () => void
  handleSceneDescriptionCursorChange: () => void
  handleSceneDescriptionFocus: () => void
  handleSceneDescriptionCompositionStart: () => void
  handleSceneDescriptionCompositionEnd: () => void
  handleSceneDescriptionBlur: () => void
  handleSceneDescriptionKeydown: (event: KeyboardEvent) => void
}>()
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <label class="text-sm font-medium">场景标题</label>
      <Input
        v-model="editForm.title"
        placeholder="输入场景标题"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-medium">场景描述</label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="h-7 px-2 text-xs"
          :disabled="sceneAssetUploading"
          @click="triggerSceneAssetUpload()"
        >
          <Loader2
            v-if="sceneAssetUploading"
            class="mr-1 h-3.5 w-3.5 animate-spin"
          />
          <Upload
            v-else
            class="mr-1 h-3.5 w-3.5"
          />
          上传其他资产
        </Button>
      </div>
      <template v-if="sceneDescriptionSupportsMention">
        <div class="relative">
          <div
            :ref="setSceneDescriptionEditorRef"
            contenteditable="true"
            class="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring whitespace-pre-wrap break-words"
            @keydown="handleSceneDescriptionKeydown"
            @input="handleSceneDescriptionInput"
            @click="handleSceneDescriptionCursorChange"
            @keyup="handleSceneDescriptionCursorChange"
            @focus="handleSceneDescriptionFocus"
            @compositionstart="handleSceneDescriptionCompositionStart"
            @compositionend="handleSceneDescriptionCompositionEnd"
            @blur="handleSceneDescriptionBlur"
          />

          <p
            v-if="!editForm.description"
            class="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground/70"
          >
            直接写完整场景描述，例如：场景功能/情绪定位、镜头设计（含 0-3秒：...）、声音设计、台词节奏、表演关键点
          </p>
        </div>

        <p class="text-xs text-muted-foreground">
          输入 `@` 可直接引用角色/环境/道具/其他资产。上传图片会自动归类到“其他”，支持上传前命名（默认文件名）。
        </p>

        <div
          v-if="sceneDescriptionMentionOpen"
          :ref="setSceneDescriptionMentionListRef"
          class="max-h-44 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-sm"
        >
          <button
            v-for="(item, mentionIndex) in sceneDescriptionMentionCandidates"
            :key="`scene_asset_mention_${item.asset.id}`"
            type="button"
            :data-scene-description-mention-index="mentionIndex"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition"
            :class="mentionIndex === sceneDescriptionMentionActiveIndex ? 'bg-accent' : 'hover:bg-accent/60'"
            @mousedown.prevent="insertSceneAssetMention(item.asset.id)"
          >
            <img
              v-if="item.asset.referenceImage"
              :src="toImageSrc(item.asset.referenceImage)"
              :alt="`${item.asset.name} 参考图`"
              class="h-7 w-7 rounded border object-cover"
            >
            <div
              v-else
              class="flex h-7 w-7 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
            >
              {{ resolveAssetTypeLabel(item.asset.type) }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs">
                {{ item.token }}
              </p>
              <p class="truncate text-[10px] text-muted-foreground">
                {{ item.asset.name }}
              </p>
            </div>
            <Badge
              variant="outline"
              class="text-[10px]"
            >
              {{ resolveAssetTypeLabel(item.asset.type) }}
            </Badge>
          </button>

          <div
            v-if="sceneDescriptionMentionCandidates.length === 0"
            class="px-2 py-3 text-xs text-muted-foreground"
          >
            未匹配到资产
          </div>
        </div>
      </template>
      <Textarea
        v-else
        v-model="editForm.description"
        placeholder="输入完整场景描述：场景功能/情绪定位、镜头设计、声音设计、台词节奏、表演关键点..."
        class="min-h-[100px]"
      />

      <p
        v-if="sceneAssetUploadError"
        class="text-xs text-destructive"
      >
        {{ sceneAssetUploadError }}
      </p>

      <input
        :ref="setSceneAssetUploadInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="handleSceneAssetUpload($event)"
      >
    </div>

    <div class="space-y-2">
      <label class="text-sm font-medium">旁白（可选）</label>
      <Textarea
        v-model="editForm.narration"
        placeholder="输入场景旁白文本..."
        class="min-h-[80px]"
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <label class="text-sm font-medium">地点</label>
        <Input
          v-model="editForm.setting!.location"
          placeholder="场景地点"
        />
      </div>
      <div class="space-y-2">
        <label class="text-sm font-medium">时间</label>
        <Select v-model="editForm.setting!.timeOfDay">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择时间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in timeOfDayOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="space-y-2">
      <label class="text-sm font-medium">预计时长（秒）</label>
      <div class="flex items-center space-x-4">
        <Slider
          :model-value="[editForm.duration]"
          :min="2"
          :max="15"
          :step="0.5"
          class="flex-1"
          @update:model-value="editForm.duration = Number($event?.[0] ?? editForm.duration)"
        />
        <span class="w-16 text-center font-medium">{{ editForm.duration }}秒</span>
      </div>
      <p class="text-xs text-muted-foreground">
        支持 2-15 秒灵活时长
      </p>
    </div>
  </div>
</template>

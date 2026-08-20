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

const shotTypeOptions = ['大远景', '全景', '中全景', '中景', '中近景', '近景', '特写', '大特写', '细节镜头'] as const
const cameraAngleOptions = [
  { value: 'eye_level', label: '平视' },
  { value: 'low_angle', label: '仰拍' },
  { value: 'high_angle', label: '俯拍' },
  { value: 'top_down', label: '俯瞰' },
  { value: 'side_view', label: '侧面机位' },
  { value: 'front_view', label: '正面机位' },
  { value: 'rear_view', label: '背后机位' },
  { value: 'over_shoulder', label: '过肩镜头' },
  { value: 'pov', label: '主观视角' },
  { value: 'three_quarter', label: '三分之四侧前机位' }
] as const
const cameraMovementOptions = [
  '固定镜头', '推进', '拉远', '左摇', '右摇', '上摇', '下摇', '跟拍', '轨道移动',
  '变焦推进', '变焦拉远', '升降', '手持', '环绕', '甩镜', '荷兰角', '旋转', '焦点转移'
] as const
const speedEffectOptions = [
  { value: 'normal', label: '正常速度' },
  { value: 'slow_motion', label: '慢镜头' },
  { value: 'fast_motion', label: '快镜头 / 延时' },
  { value: 'freeze_frame', label: '定格' }
] as const
const transitionOptions = [
  { value: 'cut', label: '硬切' },
  { value: 'fade_to_black', label: '黑场转场' },
  { value: 'dissolve', label: '叠化' },
  { value: 'match_cut', label: '匹配剪辑' },
  { value: 'fade', label: '淡变' },
  { value: 'wipe', label: '划变' },
  { value: 'slide', label: '滑动' },
  { value: 'zoom', label: '缩放' },
  { value: 'blur', label: '模糊' },
  { value: 'flash', label: '闪白' },
  { value: 'none', label: '无' }
] as const

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
  handleSceneDescriptionBeforeInput: (event: InputEvent) => void
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
            class="min-h-[110px] w-full rounded-lg border-0 bg-muted/55 px-3 py-2 text-sm leading-6 outline-none transition-[background-color] hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55 whitespace-pre-wrap break-words"
            @keydown="handleSceneDescriptionKeydown"
            @beforeinput="handleSceneDescriptionBeforeInput"
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
          class="max-h-44 overflow-y-auto rounded-xl bg-popover shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] p-1 text-sm shadow-sm"
        >
          <Button
            v-for="(item, mentionIndex) in sceneDescriptionMentionCandidates"
            :key="`scene_asset_mention_${item.asset.id}`"
            type="button"
            variant="ghost"
            :data-scene-description-mention-index="mentionIndex"
            class="h-auto w-full justify-start gap-2 rounded px-2 py-1.5 text-left transition"
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
              class="flex h-7 w-7 items-center justify-center rounded border bg-muted/30 text-xs text-muted-foreground"
            >
              {{ resolveAssetTypeLabel(item.asset.type) }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs">
                {{ item.token }}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {{ item.asset.name }}
              </p>
            </div>
            <Badge
              variant="outline"
              class="text-xs"
            >
              {{ resolveAssetTypeLabel(item.asset.type) }}
            </Badge>
          </Button>

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

      <Input
        :ref="setSceneAssetUploadInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="handleSceneAssetUpload($event)"
      />
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
        <Input
          v-model="editForm.setting!.timeOfDay"
          list="scene-time-of-day-suggestions"
          placeholder="例如：深夜、黎明前、极夜"
        />
        <datalist id="scene-time-of-day-suggestions">
          <option
            v-for="opt in timeOfDayOptions"
            :key="opt.value"
            :value="opt.value"
          />
        </datalist>
      </div>
    </div>

    <div class="space-y-3">
      <label class="text-sm font-medium">镜头参数</label>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">景别</label>
          <Select v-model="editForm.shotType">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in shotTypeOptions" :key="option" :value="option">
                {{ option }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">机位角度</label>
          <Select v-model="editForm.cameraAngle">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in cameraAngleOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">运镜</label>
          <Select v-model="editForm.cameraMovement">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in cameraMovementOptions" :key="option" :value="option">
                {{ option }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">速度效果</label>
          <Select v-model="editForm.speedEffect">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in speedEffectOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5 sm:col-span-2">
          <label class="text-xs text-muted-foreground">入场转场</label>
          <Select v-model="editForm.transitionIn">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in transitionOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <label class="text-sm font-medium">预计时长（秒）</label>
      <div class="flex items-center space-x-4">
        <Slider
          :model-value="[editForm.duration]"
          :min="4"
          :max="15"
          :step="1"
          class="flex-1"
          @update:model-value="editForm.duration = Number($event?.[0] ?? editForm.duration)"
        />
        <span class="w-16 text-center font-medium">{{ editForm.duration }}秒</span>
      </div>
      <p class="text-xs text-muted-foreground">
        支持 4-15 秒整数时长，具体范围由当前视频模型决定
      </p>
    </div>
  </div>
</template>

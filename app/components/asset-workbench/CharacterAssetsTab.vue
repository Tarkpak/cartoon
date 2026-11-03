<script setup lang="ts">
import { AudioLines, ChevronDown, ChevronRight, CloudUpload, CopyPlus, Database, History, ImageUp, Loader2, Lock, Pencil, Sparkles, Trash2, Upload, User, WandSparkles } from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import SaveToPersonalLibraryButton from './SaveToPersonalLibraryButton.vue'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import { buildAssetUploadInputId, resolveCharacterRoleLabel } from '~/lib/asset-workbench-types'
import { useIncrementalList } from '~/composables/useIncrementalList'

const props = defineProps<{
  characters: CharacterData[]
  autoRunning: boolean
  savingLibraryAssetKey?: string | null
  editingCharacterId: string | null
  characterEditDraft: {
    id: string
    name: string
    appearance: string
    role: string
    language?: string
    languageNote?: string
  }
  uploadingCharacterId: string | null
  uploadingArkCharacterId: string | null
  uploadingCharacterVoiceId: string | null
  getCharacterSceneCount: (character: CharacterData) => number
  setCharacterEditDraft: (draft: { name: string, role: string, appearance: string, language?: string, languageNote?: string }) => void
}>()

const emit = defineEmits<{
  'save-to-library': [characterId: string]
  'remove-character': [characterId: string]
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'start-edit': [character: CharacterData]
  'add-variant': [character: CharacterData]
  'remove-variant': [characterId: string]
  'cancel-edit': []
  'save-edit': []
  'save-edit-regenerate': []
  'generate': [characterId: string]
  'open-regenerate': [character: CharacterData]
  'open-history': [characterId: string]
  'upload-image': [payload: { characterId: string, event: Event }]
  'ingest-ark-asset': [characterId: string]
  'select-ark-asset': [character: CharacterData]
  'upload-voice': [payload: { characterId: string, event: Event }]
  'update-voice-lock': [payload: { characterId: string, locked: boolean }]
}>()

function triggerUploadInput(characterId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('char', characterId)) as HTMLInputElement | null
  input?.click()
}

function triggerVoiceUploadInput(characterId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('char_voice', characterId)) as HTMLInputElement | null
  input?.click()
}

const LANGUAGE_OPTIONS = [
  { value: 'mandarin', label: '普通话' },
  { value: 'chongqing', label: '重庆方言' },
  { value: 'dongbei', label: '东北话' },
  { value: 'cantonese', label: '粤语' },
  { value: 'sichuan', label: '四川话' },
  { value: 'wu', label: '吴语' },
  { value: 'english', label: '英语' },
  { value: 'japanese', label: '日语' },
  { value: 'custom', label: '自定义' }
]

const localDraft = reactive({
  name: '',
  role: '配角',
  appearance: '',
  language: 'mandarin',
  languageNote: ''
})
const expandedVariantCharacterIds = ref<Set<string>>(new Set())

watch(
  () => [
    props.editingCharacterId,
    props.characterEditDraft.name,
    props.characterEditDraft.role,
    props.characterEditDraft.appearance
    , props.characterEditDraft.language, props.characterEditDraft.languageNote
  ],
  () => {
    localDraft.name = props.characterEditDraft.name
    localDraft.role = props.characterEditDraft.role
    localDraft.appearance = props.characterEditDraft.appearance
    localDraft.language = props.characterEditDraft.language || 'mandarin'
    localDraft.languageNote = props.characterEditDraft.languageNote || ''
  },
  { immediate: true }
)

watch(localDraft, (draft) => {
  if (
    draft.name === props.characterEditDraft.name
    && draft.role === props.characterEditDraft.role
    && draft.appearance === props.characterEditDraft.appearance
    && draft.language === (props.characterEditDraft.language || 'mandarin')
    && draft.languageNote === (props.characterEditDraft.languageNote || '')
  ) {
    return
  }

  props.setCharacterEditDraft({
    name: draft.name,
    role: draft.role,
    appearance: draft.appearance, language: draft.language, languageNote: draft.languageNote
  })
}, { deep: true })

function resolveStatusColor(char: CharacterData): string {
  if (char.generating) return 'bg-primary'
  if (char.baseImage) return 'bg-success'
  return 'bg-muted-foreground/40'
}

const expandedVoiceIds = ref<string[]>([])

function isVoiceExpanded(characterId: string): boolean {
  return expandedVoiceIds.value.includes(characterId)
}

function toggleVoiceExpanded(characterId: string) {
  expandedVoiceIds.value = isVoiceExpanded(characterId)
    ? expandedVoiceIds.value.filter(id => id !== characterId)
    : [...expandedVoiceIds.value, characterId]
}

function resolveVoiceChipLabel(char: CharacterData): string {
  if (!char.voiceAsset?.audioUrl) return '无声音参考'
  return char.voiceAsset.locked ? '声音参考 · 已锁定' : '声音参考'
}

function canSaveToLibrary(char: CharacterData): boolean {
  return !!(char.baseImage || Object.values(char.views || {}).some(Boolean) || char.voiceAsset?.audioUrl)
}

function isCharacterBusy(char: CharacterData): boolean {
  return props.autoRunning || char.generating
}

function resolveStatusText(char: CharacterData): string {
  if (char.generating) return '生成中'
  if (char.baseImage) return '已就绪'
  return '待生成'
}

function resolveVoiceSourceLabel(char: CharacterData): string {
  if (!char.voiceAsset?.audioUrl) return '暂无参考音频'
  if (char.voiceAsset.sourceSceneId || char.voiceAsset.sourceTaskId) return '自动提取'
  return '手动上传'
}

function resolveVoiceUpdatedText(char: CharacterData): string {
  const updatedAt = char.voiceAsset?.updatedAt
  if (!updatedAt) return ''

  const parsed = new Date(updatedAt)
  if (Number.isNaN(parsed.getTime())) return ''

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function resolveHistoryCount(char: CharacterData): number {
  return Array.isArray(char.assetHistory) ? char.assetHistory.length : 0
}

function resolveArkAssetLabel(char: CharacterData): string {
  const asset = char.arkAsset
  if (!asset?.assetId && asset?.status !== 'Processing') return '未入库'
  if (asset.status === 'Active') return '已入库'
  if (asset.status === 'Failed') return '入库失败'
  if (asset.status === 'Unknown') return '状态未知'
  if (asset.status === 'Stale') return '账号已变更'
  return '入库处理中'
}

function resolveArkAssetClass(char: CharacterData): string {
  const status = char.arkAsset?.status
  if (status === 'Active') return 'border-success/25 bg-success/10 text-success'
  if (status === 'Failed') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (status === 'Processing') return 'border-primary/25 bg-primary/10 text-primary'
  if (status === 'Unknown' || status === 'Stale') return 'border-warning/25 bg-warning/10 text-warning'
  return 'border-dashed bg-muted/20 text-muted-foreground'
}

const rootCharacters = computed(() => {
  const characterIds = new Set(props.characters.map(character => character.id))
  return props.characters.filter((character) => {
    return !character.parentCharacterId || !characterIds.has(character.parentCharacterId)
  })
})

const characterNameById = computed(() => {
  return new Map(props.characters.map(character => [character.id, character.name]))
})

const variantsByParentId = computed(() => {
  const map = new Map<string, CharacterData[]>()
  for (const character of props.characters) {
    if (!character.parentCharacterId) continue
    const list = map.get(character.parentCharacterId)
    if (list) {
      list.push(character)
    } else {
      map.set(character.parentCharacterId, [character])
    }
  }
  return map
})

const EMPTY_VARIANTS: CharacterData[] = []

const {
  sentinel: characterLoadMoreSentinel,
  visibleItems: visibleRootCharacters,
  total: rootCharacterTotal,
  hasMore: hasMoreRootCharacters,
  loadMore: loadMoreRootCharacters,
  ensureIndexVisible: ensureRootCharacterVisible
} = useIncrementalList(() => rootCharacters.value, { getKey: character => character.id })

function resolveParentCharacterName(char: CharacterData): string {
  if (!char.parentCharacterId) return ''
  return characterNameById.value.get(char.parentCharacterId) || ''
}

function resolveCharacterVariants(char: CharacterData): CharacterData[] {
  return variantsByParentId.value.get(char.id) || EMPTY_VARIANTS
}

function resolveVariantCount(char: CharacterData): number {
  return resolveCharacterVariants(char).length
}

function isVariantSectionExpanded(characterId: string): boolean {
  return expandedVariantCharacterIds.value.has(characterId)
}

function setVariantSectionExpanded(characterId: string, expanded: boolean) {
  const next = new Set(expandedVariantCharacterIds.value)
  if (expanded) {
    next.add(characterId)
  } else {
    next.delete(characterId)
  }
  expandedVariantCharacterIds.value = next
}

function toggleVariantSection(characterId: string) {
  setVariantSectionExpanded(characterId, !isVariantSectionExpanded(characterId))
}

function resolveVariantReadyCount(variants: CharacterData[]): number {
  return variants.filter(variant => !!variant.baseImage).length
}

function resolveVariantArkReadyCount(variants: CharacterData[]): number {
  return variants.filter(variant => variant.arkAsset?.status === 'Active').length
}

watch(
  () => props.editingCharacterId,
  (editingCharacterId) => {
    if (!editingCharacterId) return
    const editingVariant = props.characters.find(character => character.id === editingCharacterId)
    if (editingVariant?.parentCharacterId) {
      setVariantSectionExpanded(editingVariant.parentCharacterId, true)
    }
    const rootId = editingVariant?.parentCharacterId && characterNameById.value.has(editingVariant.parentCharacterId)
      ? editingVariant.parentCharacterId
      : editingCharacterId
    const rootIndex = rootCharacters.value.findIndex(character => character.id === rootId)
    if (rootIndex >= 0) ensureRootCharacterVisible(rootIndex)
  },
  { immediate: true }
)
</script>

<template>
  <EmptyState
    v-if="characters.length === 0"
    :icon="User"
    title="暂无角色资产"
    description="解析剧本后会自动提取登场角色；也可以点击右上角「添加角色」手动创建。"
    class="rounded-xl bg-muted/15"
  />
  <div
    v-else
    class="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3"
  >
    <div
      v-for="char in visibleRootCharacters"
      :key="char.id"
      class="group rounded-xl bg-muted/25 transition-colors hover:bg-muted/35"
    >
      <!-- Card body -->
      <div class="flex items-start gap-3 p-3">
        <!-- Character sheet: shown whole, never cropped -->
        <div class="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-muted/40 sm:w-48">
          <LazyImage
            v-if="char.baseImage"
            :image="char.baseImage"
            :alt="`${char.name} 角色图`"
            class="h-full w-full cursor-zoom-in object-contain"
            @click="emit('preview-image', { src: char.baseImage, alt: `${char.name} 角色图` })"
          />
          <div
            v-else
            class="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground/70"
          >
            <Loader2
              v-if="char.generating"
              class="h-5 w-5 animate-spin text-primary"
            />
            <User
              v-else
              class="h-7 w-7 opacity-50"
            />
            <span class="text-xs">{{ char.generating ? '正在生成角色图…' : '还没有角色图' }}</span>
          </div>
          <div
            v-if="char.generating && char.baseImage"
            class="absolute inset-0 flex items-center justify-center bg-background/60 text-xs text-foreground backdrop-blur-[1px]"
          >
            <Loader2 class="mr-1.5 h-4 w-4 animate-spin text-primary" />
            重新生成中…
          </div>
        </div>

        <!-- Info -->
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span class="truncate text-sm font-medium">{{ char.name }}</span>
            <span class="shrink-0 text-xs text-muted-foreground/70">{{ resolveCharacterRoleLabel(char.role) }}</span>
            <span
              v-if="!char.parentCharacterId && resolveVariantCount(char) > 0"
              class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {{ resolveVariantCount(char) }} 个变体
            </span>
          </div>
          <div
            v-if="char.variantName || char.parentCharacterId"
            class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span class="rounded bg-primary/10 px-1.5 py-0.5 text-primary">变体</span>
            <span v-if="char.variantName">{{ char.variantName }}</span>
            <span v-if="resolveParentCharacterName(char)">源自 {{ resolveParentCharacterName(char) }}</span>
          </div>

          <template v-if="editingCharacterId === char.id">
            <div class="mt-2 space-y-2">
              <Input
                v-model="localDraft.name"
                class="h-8 text-xs"
                placeholder="角色名称"
              />
              <Input
                v-model="localDraft.role"
                class="h-8 text-xs"
                placeholder="角色定位，如关键证人"
              />
              <SelectField v-model="localDraft.language" size="sm" aria-label="角色语言" :options="LANGUAGE_OPTIONS" />
              <Input v-if="localDraft.language === 'custom' || localDraft.languageNote" v-model="localDraft.languageNote" class="h-8 text-xs" placeholder="语言补充要求" />
              <Textarea
                v-model="localDraft.appearance"
                class="min-h-[72px] text-xs"
                placeholder="角色外观描述（可人工补充）"
              />
            </div>
          </template>
          <template v-else>
            <p
              class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground"
              :title="char.appearance"
            >
              {{ char.appearance || '暂无外观描述' }}
            </p>
            <div class="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground/80">
              <span class="flex items-center gap-1">
                <span
                  class="inline-block h-1.5 w-1.5 rounded-full"
                  :class="resolveStatusColor(char)"
                />
                {{ resolveStatusText(char) }}
              </span>
              <span>{{ getCharacterSceneCount(char) }} 个场景</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <!-- data-asset-tab: only reveals the player, so read-only viewers keep it -->
              <button
                type="button"
                data-asset-tab
                class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="char.voiceAsset?.audioUrl ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'bg-muted text-muted-foreground hover:text-foreground'"
                :aria-expanded="isVoiceExpanded(char.id)"
                @click="toggleVoiceExpanded(char.id)"
              >
                <AudioLines class="h-3 w-3" />
                {{ resolveVoiceChipLabel(char) }}
                <ChevronDown
                  class="h-3 w-3 transition-transform"
                  :class="isVoiceExpanded(char.id) ? 'rotate-180' : ''"
                />
              </button>
              <span
                v-if="char.arkAsset?.status"
                class="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
                :class="resolveArkAssetClass(char)"
                :title="char.arkAsset?.assetId || char.arkAsset?.errorMessage || ''"
              >
                <Database class="h-3 w-3 shrink-0" />
                火山素材 · {{ resolveArkAssetLabel(char) }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <div
        v-if="isVoiceExpanded(char.id)"
        class="border-t px-3 py-2.5"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-muted-foreground">
            {{ resolveVoiceSourceLabel(char) }}
            <span v-if="resolveVoiceUpdatedText(char)"> · {{ resolveVoiceUpdatedText(char) }}</span>
          </p>
          <IconActionButton
            :label="char.voiceAsset?.audioUrl ? '替换参考音频' : '上传参考音频'"
            :disabled="isCharacterBusy(char) || !!uploadingCharacterVoiceId"
            :loading="uploadingCharacterVoiceId === char.id"
            @click="triggerVoiceUploadInput(char.id)"
          >
            <Upload class="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
        <div
          v-if="char.voiceAsset?.audioUrl"
          class="mt-2 space-y-2"
        >
          <audio
            :src="char.voiceAsset.audioUrl"
            class="w-full"
            controls
            preload="none"
          />
          <div class="flex flex-col gap-2 rounded-md bg-muted/35 px-2.5 py-2 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0">
              <p class="text-xs font-medium">
                后续分镜视频生成时自动作为该角色声音参考
              </p>
              <p
                v-if="char.voiceAsset.transcript"
                class="mt-0.5 line-clamp-2 text-xs text-muted-foreground"
              >
                {{ char.voiceAsset.transcript }}
              </p>
            </div>
            <div class="shrink-0">
              <p class="mb-1 text-xs text-muted-foreground">
                锁定后不会被自动提取结果覆盖
              </p>
              <div class="flex items-center justify-end gap-2">
                <span class="text-xs text-muted-foreground">锁定参考</span>
                <Switch
                  :checked="!!char.voiceAsset.locked"
                  :disabled="autoRunning || uploadingCharacterVoiceId === char.id"
                  @update:checked="emit('update-voice-lock', { characterId: char.id, locked: !!$event })"
                />
              </div>
            </div>
          </div>
        </div>
        <p
          v-else
          class="mt-1 text-xs text-muted-foreground"
        >
          生成带对白的视频后会自动抽取人物声音，也可以直接上传现有配音作为参考。
        </p>
      </div>

      <div
        v-if="resolveCharacterVariants(char).length > 0"
        class="border-t"
      >
        <button
          type="button"
          class="flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors hover:bg-muted/30"
          :aria-expanded="isVariantSectionExpanded(char.id)"
          @click="toggleVariantSection(char.id)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <ChevronDown
              v-if="isVariantSectionExpanded(char.id)"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <ChevronRight
              v-else
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <p class="text-xs font-medium text-foreground">
                  角色变体
                </p>
                <span
                  v-if="resolveVariantArkReadyCount(resolveCharacterVariants(char)) > 0"
                  class="rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success"
                >
                  {{ resolveVariantArkReadyCount(resolveCharacterVariants(char)) }} 已入库
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ resolveVariantReadyCount(resolveCharacterVariants(char)) }}/{{ resolveVariantCount(char) }} 已就绪
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <div class="flex -space-x-1.5">
              <div
                v-for="variant in resolveCharacterVariants(char).slice(0, 5)"
                :key="variant.id"
                class="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-muted/30 ring-2 ring-card"
                :title="variant.name"
              >
                <LazyImage
                  v-if="variant.baseImage"
                  :image="variant.baseImage"
                  :alt="`${variant.name} 角色图`"
                  class="h-full w-full object-cover"
                />
                <User
                  v-else
                  class="h-4 w-4 text-muted-foreground/45"
                />
                <span
                  class="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-card"
                  :class="resolveStatusColor(variant)"
                />
                <span
                  v-if="variant.arkAsset?.status"
                  class="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border bg-card shadow-sm"
                  :class="resolveArkAssetClass(variant)"
                  :title="`火山素材：${resolveArkAssetLabel(variant)}`"
                >
                  <Database class="h-3 w-3" />
                </span>
              </div>
            </div>
            <span
              v-if="resolveVariantCount(char) > 5"
              class="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              +{{ resolveVariantCount(char) - 5 }}
            </span>
            <span class="text-xs text-muted-foreground">{{ resolveVariantCount(char) }} 个</span>
          </div>
        </button>
        <Transition name="character-variant-collapse">
          <div
            v-if="resolveCharacterVariants(char).length > 0 && isVariantSectionExpanded(char.id)"
            class="character-variant-collapse-panel divide-y"
          >
            <div
              v-for="variant in resolveCharacterVariants(char)"
              :key="variant.id"
              class="px-3 py-2.5"
            >
              <div class="flex items-start gap-3">
                <div class="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                  <LazyImage
                    v-if="variant.baseImage"
                    :image="variant.baseImage"
                    :alt="`${variant.name} 角色图`"
                    class="h-full w-full cursor-zoom-in object-cover transition-transform hover:scale-105"
                    @click="emit('preview-image', { src: variant.baseImage, alt: `${variant.name} 角色图` })"
                  />
                  <User
                    v-else
                    class="h-6 w-6 text-muted-foreground/40"
                  />
                  <span
                    class="absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-card"
                    :class="resolveStatusColor(variant)"
                    :title="resolveStatusText(variant)"
                  />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span class="truncate text-xs font-medium">{{ variant.name }}</span>
                      <span
                        v-if="variant.variantName"
                        class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                      >
                        {{ variant.variantName }}
                      </span>
                      <span class="text-xs text-muted-foreground">{{ resolveStatusText(variant) }}</span>
                    </div>
                    <span
                      class="inline-flex max-w-[46%] shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium"
                      :class="resolveArkAssetClass(variant)"
                      :title="variant.arkAsset?.assetId || variant.arkAsset?.errorMessage || '未绑定虚拟人像'"
                    >
                      <Database class="h-3 w-3 shrink-0" />
                      <span class="shrink-0">{{ resolveArkAssetLabel(variant) }}</span>
                      <span
                        v-if="variant.arkAsset?.assetId"
                        class="max-w-[120px] truncate"
                      >
                        {{ variant.arkAsset.assetId }}
                      </span>
                    </span>
                  </div>

                  <template v-if="editingCharacterId === variant.id">
                    <div class="mt-2 space-y-2">
                      <Input
                        v-model="localDraft.name"
                        class="h-8 text-xs"
                        placeholder="变体名称"
                      />
                      <Input
                        v-model="localDraft.role"
                        class="h-8 text-xs"
                        placeholder="角色定位，如阶段性对手"
                      />
                      <Textarea
                        v-model="localDraft.appearance"
                        class="min-h-[64px] text-xs"
                        placeholder="变体外观描述"
                      />
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2.5 text-xs"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('save-edit')"
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        class="h-7 px-2.5 text-xs"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('save-edit-regenerate')"
                      >
                        <Loader2
                          v-if="variant.generating"
                          class="mr-1 h-3 w-3 animate-spin"
                        />
                        保存并生成
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('cancel-edit')"
                      >
                        取消
                      </Button>
                    </div>
                  </template>

                  <template v-else>
                    <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {{ variant.appearance || '暂无外观描述' }}
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        :variant="variant.baseImage ? 'outline' : 'default'"
                        class="h-7 px-2.5 text-xs"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('generate', variant.id)"
                      >
                        <Loader2
                          v-if="variant.generating"
                          class="mr-1 h-3 w-3 animate-spin"
                        />
                        <Sparkles
                          v-else
                          class="mr-1 h-3 w-3"
                        />
                        {{ variant.generating ? '生成中…' : variant.baseImage ? '重新生成' : '生成' }}
                      </Button>
                      <IconActionButton
                        v-if="variant.baseImage"
                        label="定向修改"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('open-regenerate', variant)"
                      >
                        <WandSparkles class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <IconActionButton
                        label="上传变体图"
                        :disabled="autoRunning || variant.generating || !!uploadingCharacterId"
                        :loading="uploadingCharacterId === variant.id"
                        @click="triggerUploadInput(variant.id)"
                      >
                        <ImageUp class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <IconActionButton
                        v-if="resolveHistoryCount(variant) > 1"
                        :label="`历史版本（${resolveHistoryCount(variant)}）`"
                        :badge="resolveHistoryCount(variant)"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('open-history', variant.id)"
                      >
                        <History class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
                      <IconActionButton
                        :label="variant.arkAsset?.status === 'Active' ? '重新入库虚拟人像' : '入库虚拟人像'"
                        :disabled="autoRunning || variant.generating || !variant.baseImage || !!uploadingArkCharacterId"
                        :loading="uploadingArkCharacterId === variant.id"
                        @click="emit('ingest-ark-asset', variant.id)"
                      >
                        <CloudUpload class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <IconActionButton
                        label="选择火山素材"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('select-ark-asset', variant)"
                      >
                        <Database class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <IconActionButton
                        label="编辑变体"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('start-edit', variant)"
                      >
                        <Pencil class="h-3.5 w-3.5" />
                      </IconActionButton>
                      <div class="ml-auto flex items-center">
                        <SaveToPersonalLibraryButton
                          icon-only
                          :asset-key="`characters:${variant.id}`"
                          :available="!!(variant.baseImage || Object.values(variant.views || {}).some(Boolean) || variant.voiceAsset?.audioUrl)"
                          :busy="!!savingLibraryAssetKey"
                          :saving="savingLibraryAssetKey === `characters:${variant.id}`"
                          @save="emit('save-to-library', variant.id)"
                        />
                        <IconActionButton
                          label="删除变体"
                          destructive
                          :disabled="autoRunning || variant.generating"
                          @click="emit('remove-variant', variant.id)"
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                        </IconActionButton>
                      </div>
                      <Input
                        :id="buildAssetUploadInputId('char', variant.id)"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="emit('upload-image', { characterId: variant.id, event: $event })"
                      />
                      <Input
                        :id="buildAssetUploadInputId('char_voice', variant.id)"
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac"
                        class="hidden"
                        @change="emit('upload-voice', { characterId: variant.id, event: $event })"
                      />
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
        <template v-if="editingCharacterId === char.id">
          <Button
            size="sm"
            variant="outline"
            class="h-7 px-2.5 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('save-edit')"
          >
            保存
          </Button>
          <Button
            size="sm"
            class="h-7 px-2.5 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('save-edit-regenerate')"
          >
            <Loader2
              v-if="char.generating"
              class="mr-1 h-3 w-3 animate-spin"
            />
            保存并重新生成
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('cancel-edit')"
          >
            取消
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            :variant="char.baseImage ? 'outline' : 'default'"
            class="h-7 px-2.5 text-xs"
            :disabled="isCharacterBusy(char)"
            @click="emit('generate', char.id)"
          >
            <Loader2
              v-if="char.generating"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <Sparkles
              v-else
              class="mr-1 h-3 w-3"
            />
            {{ char.generating ? '生成中…' : char.baseImage ? '重新生成' : '生成' }}
          </Button>
          <IconActionButton
            v-if="char.baseImage"
            label="定向修改"
            :disabled="isCharacterBusy(char)"
            @click="emit('open-regenerate', char)"
          >
            <WandSparkles class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label="上传角色图"
            :disabled="isCharacterBusy(char) || !!uploadingCharacterId"
            :loading="uploadingCharacterId === char.id"
            @click="triggerUploadInput(char.id)"
          >
            <ImageUp class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            v-if="resolveHistoryCount(char) > 1"
            :label="`历史版本（${resolveHistoryCount(char)}）`"
            :badge="resolveHistoryCount(char)"
            :disabled="isCharacterBusy(char)"
            @click="emit('open-history', char.id)"
          >
            <History class="h-3.5 w-3.5" />
          </IconActionButton>
          <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <IconActionButton
            :label="char.voiceAsset?.audioUrl ? '替换参考音频' : '上传参考音频'"
            :disabled="isCharacterBusy(char) || !!uploadingCharacterVoiceId"
            :loading="uploadingCharacterVoiceId === char.id"
            @click="triggerVoiceUploadInput(char.id)"
          >
            <AudioLines class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            :label="char.arkAsset?.status === 'Active' ? '重新入库虚拟人像' : '入库虚拟人像'"
            :disabled="isCharacterBusy(char) || !char.baseImage || !!uploadingArkCharacterId"
            :loading="uploadingArkCharacterId === char.id"
            @click="emit('ingest-ark-asset', char.id)"
          >
            <CloudUpload class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label="选择火山素材"
            :disabled="isCharacterBusy(char)"
            @click="emit('select-ark-asset', char)"
          >
            <Database class="h-3.5 w-3.5" />
          </IconActionButton>
          <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <IconActionButton
            label="编辑名称和描述"
            :disabled="isCharacterBusy(char)"
            @click="emit('start-edit', char)"
          >
            <Pencil class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            v-if="!char.parentCharacterId"
            label="添加变体"
            :disabled="isCharacterBusy(char)"
            @click="emit('add-variant', char)"
          >
            <CopyPlus class="h-3.5 w-3.5" />
          </IconActionButton>
          <!-- Library save stays usable for read-only viewers (data-library-save) -->
          <div class="ml-auto flex items-center">
            <SaveToPersonalLibraryButton
              icon-only
              :asset-key="`characters:${char.id}`"
              :available="canSaveToLibrary(char)"
              :busy="!!savingLibraryAssetKey"
              :saving="savingLibraryAssetKey === `characters:${char.id}`"
              @save="emit('save-to-library', char.id)"
            />
            <IconActionButton
              label="删除角色"
              destructive
              :disabled="isCharacterBusy(char) || char.generatingViews || !!uploadingCharacterId || !!uploadingArkCharacterId || !!uploadingCharacterVoiceId"
              @click="emit('remove-character', char.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
          <Input
            :id="buildAssetUploadInputId('char', char.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { characterId: char.id, event: $event })"
          />
          <Input
            :id="buildAssetUploadInputId('char_voice', char.id)"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.flac"
            class="hidden"
            @change="emit('upload-voice', { characterId: char.id, event: $event })"
          />
        </template>
      </div>
    </div>
  </div>
  <div
    v-if="characters.length > 0 && hasMoreRootCharacters"
    ref="characterLoadMoreSentinel"
    class="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
  >
    已显示 {{ visibleRootCharacters.length }} / {{ rootCharacterTotal }}
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="h-7 px-2 text-xs"
      @click="loadMoreRootCharacters"
    >
      加载更多
    </Button>
  </div>
</template>

<style scoped>
.character-variant-collapse-panel {
  overflow: hidden;
}

.character-variant-collapse-enter-active,
.character-variant-collapse-leave-active {
  transition:
    max-height 180ms ease,
    opacity 140ms ease,
    transform 180ms ease;
}

.character-variant-collapse-enter-from,
.character-variant-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.character-variant-collapse-enter-to,
.character-variant-collapse-leave-from {
  max-height: 720px;
  opacity: 1;
  transform: translateY(0);
}
</style>

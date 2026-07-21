<script setup lang="ts">
import { AudioLines, ChevronDown, ChevronRight, CloudUpload, Database, History, Loader2, Lock, Pencil, Plus, Sparkles, Trash2, Upload, User } from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import { buildAssetUploadInputId, resolveCharacterRoleLabel } from '~/lib/asset-workbench-types'

const props = defineProps<{
  characters: CharacterData[]
  autoRunning: boolean
  editingCharacterId: string | null
  characterEditDraft: {
    id: string
    name: string
    appearance: string
    role: string
  }
  uploadingCharacterId: string | null
  uploadingArkCharacterId: string | null
  uploadingCharacterVoiceId: string | null
  getCharacterSceneCount: (character: CharacterData) => number
  setCharacterEditDraft: (draft: { name: string, role: string, appearance: string }) => void
}>()

const emit = defineEmits<{
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

const localDraft = reactive({
  name: '',
  role: '配角',
  appearance: ''
})
const expandedVariantCharacterIds = ref<Set<string>>(new Set())

watch(
  () => [
    props.editingCharacterId,
    props.characterEditDraft.name,
    props.characterEditDraft.role,
    props.characterEditDraft.appearance
  ],
  () => {
    localDraft.name = props.characterEditDraft.name
    localDraft.role = props.characterEditDraft.role
    localDraft.appearance = props.characterEditDraft.appearance
  },
  { immediate: true }
)

watch(localDraft, (draft) => {
  if (
    draft.name === props.characterEditDraft.name
    && draft.role === props.characterEditDraft.role
    && draft.appearance === props.characterEditDraft.appearance
  ) {
    return
  }

  props.setCharacterEditDraft({
    name: draft.name,
    role: draft.role,
    appearance: draft.appearance
  })
}, { deep: true })

function resolveStatusColor(char: CharacterData): string {
  if (char.generating) return 'bg-blue-500'
  if (char.baseImage) return 'bg-emerald-500'
  return 'bg-amber-500'
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
  return '入库处理中'
}

function resolveArkAssetClass(char: CharacterData): string {
  const status = char.arkAsset?.status
  if (status === 'Active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'Failed') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (status === 'Processing') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'Unknown') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-dashed bg-muted/20 text-muted-foreground'
}

const rootCharacters = computed(() => {
  const characterIds = new Set(props.characters.map(character => character.id))
  return props.characters.filter((character) => {
    return !character.parentCharacterId || !characterIds.has(character.parentCharacterId)
  })
})

function resolveParentCharacterName(char: CharacterData): string {
  if (!char.parentCharacterId) return ''
  return props.characters.find(item => item.id === char.parentCharacterId)?.name || ''
}

function resolveCharacterVariants(char: CharacterData): CharacterData[] {
  return props.characters.filter(item => item.parentCharacterId === char.id)
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
  },
  { immediate: true }
)
</script>

<template>
  <div
    v-if="characters.length === 0"
    class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground"
  >
    <User class="h-8 w-8 opacity-40" />
    <p class="text-sm">
      暂未识别到角色
    </p>
    <p class="text-xs">
      返回"剧本解析"补充角色信息后重新解析
    </p>
  </div>
  <div
    v-else
    class="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3"
  >
    <div
      v-for="char in rootCharacters"
      :key="char.id"
      class="group rounded-lg border bg-card transition-colors hover:border-primary/30"
    >
      <!-- Card body -->
      <div class="flex items-start gap-3 p-3">
        <!-- Avatar -->
        <div class="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
          <LazyImage
            v-if="char.baseImage"
            :image="char.baseImage"
            :alt="`${char.name} 角色图`"
            class="h-full w-full cursor-zoom-in object-cover transition-transform hover:scale-105"
            @click="emit('preview-image', { src: char.baseImage, alt: `${char.name} 角色图` })"
          />
          <User
            v-else
            class="h-8 w-8 text-muted-foreground/40"
          />
          <!-- Status dot -->
          <span
            class="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-card"
            :class="resolveStatusColor(char)"
            :title="resolveStatusText(char)"
          />
        </div>

        <!-- Info -->
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm font-medium">{{ char.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground/70">{{ resolveCharacterRoleLabel(char.role) }}</span>
              <span
                v-if="!char.parentCharacterId && resolveVariantCount(char) > 0"
                class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {{ resolveVariantCount(char) }} 个变体
              </span>
            </div>
            <div
              class="flex max-w-[42%] shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]"
              :class="resolveArkAssetClass(char)"
              :title="char.arkAsset?.assetId || char.arkAsset?.errorMessage || '未绑定虚拟人像'"
            >
              <Database class="h-3 w-3 shrink-0" />
              <span class="shrink-0 font-medium">火山素材</span>
              <span class="truncate">
                <span v-if="char.arkAsset?.assetId">{{ char.arkAsset.assetId }}</span>
                <span v-else>{{ char.arkAsset?.errorMessage || '未绑定' }}</span>
              </span>
              <span class="shrink-0 font-medium">{{ resolveArkAssetLabel(char) }}</span>
            </div>
          </div>
          <div
            v-if="char.variantName || char.parentCharacterId"
            class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
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
              <Textarea
                v-model="localDraft.appearance"
                class="min-h-[72px] text-xs"
                placeholder="角色外观描述（可人工补充）"
              />
            </div>
          </template>
          <template v-else>
            <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {{ char.appearance || '暂无外观描述' }}
            </p>
            <div class="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground/70">
              <span>{{ getCharacterSceneCount(char) }} 个场景</span>
              <span class="flex items-center gap-1">
                <span
                  class="inline-block h-1.5 w-1.5 rounded-full"
                  :class="resolveStatusColor(char)"
                />
                {{ resolveStatusText(char) }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <div class="border-t px-3 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <AudioLines class="h-3.5 w-3.5" />
            </div>
            <div class="min-w-0">
              <p class="text-xs font-medium">
                角色参考音频
              </p>
              <p class="text-xs text-muted-foreground">
                {{ resolveVoiceSourceLabel(char) }}
                <span v-if="resolveVoiceUpdatedText(char)"> · {{ resolveVoiceUpdatedText(char) }}</span>
              </p>
            </div>
          </div>
          <div
            v-if="char.voiceAsset?.audioUrl"
            class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs text-muted-foreground"
          >
            <Lock
              v-if="char.voiceAsset.locked"
              class="h-3 w-3 text-primary"
            />
            {{ char.voiceAsset.locked ? '已锁定参考' : '未锁定' }}
          </div>
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
        <div
          v-else
          class="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          生成带对白的视频后会自动抽取人物声音，也可以直接上传现有配音作为参考。
        </div>
      </div>

      <div class="border-t">
        <button
          v-if="resolveCharacterVariants(char).length > 0"
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
                  class="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                >
                  {{ resolveVariantArkReadyCount(resolveCharacterVariants(char)) }} 已入库
                </span>
              </div>
              <p class="text-[11px] text-muted-foreground">
                {{ resolveVariantReadyCount(resolveCharacterVariants(char)) }}/{{ resolveVariantCount(char) }} 已就绪
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <div class="flex -space-x-1.5">
              <div
                v-for="variant in resolveCharacterVariants(char).slice(0, 5)"
                :key="variant.id"
                class="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border bg-muted ring-2 ring-card"
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
              class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              +{{ resolveVariantCount(char) - 5 }}
            </span>
            <span class="text-xs text-muted-foreground">{{ resolveVariantCount(char) }} 个</span>
          </div>
        </button>
        <div
          v-else
          class="flex min-h-[52px] items-center justify-between gap-3 px-3 py-1.5"
        >
          <div class="flex min-w-0 items-center gap-2">
            <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">
                角色变体
              </p>
              <p class="text-[11px] text-muted-foreground/70">
                暂无变体
              </p>
            </div>
          </div>
        </div>
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
                        class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                      >
                        {{ variant.variantName }}
                      </span>
                      <span class="text-[11px] text-muted-foreground">{{ resolveStatusText(variant) }}</span>
                    </div>
                    <span
                      class="inline-flex max-w-[46%] shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
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
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
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
                        {{ variant.baseImage ? '重新生成' : '生成' }}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating || !!uploadingCharacterId"
                        @click="triggerUploadInput(variant.id)"
                      >
                        <Loader2
                          v-if="uploadingCharacterId === variant.id"
                          class="mr-1 h-3 w-3 animate-spin"
                        />
                        <Upload
                          v-else
                          class="mr-1 h-3 w-3"
                        />
                        上传
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating || !variant.baseImage || !!uploadingArkCharacterId"
                        @click="emit('ingest-ark-asset', variant.id)"
                      >
                        <Loader2
                          v-if="uploadingArkCharacterId === variant.id"
                          class="mr-1 h-3 w-3 animate-spin"
                        />
                        <CloudUpload
                          v-else
                          class="mr-1 h-3 w-3"
                        />
                        {{ variant.arkAsset?.status === 'Active' ? '重新入库' : '入库' }}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('select-ark-asset', variant)"
                      >
                        <Database class="mr-1 h-3 w-3" />
                        素材
                      </Button>
                      <Button
                        v-if="variant.baseImage"
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('open-regenerate', variant)"
                      >
                        <Sparkles class="mr-1 h-3 w-3" />
                        定向修改
                      </Button>
                      <Button
                        v-if="resolveHistoryCount(variant) > 1"
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('open-history', variant.id)"
                      >
                        <History class="mr-1 h-3 w-3" />
                        历史 {{ resolveHistoryCount(variant) }}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('start-edit', variant)"
                      >
                        <Pencil class="mr-1 h-3 w-3" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 w-7 p-0 text-muted-foreground/60 hover:text-destructive"
                        :disabled="autoRunning || variant.generating"
                        @click="emit('remove-variant', variant.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
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
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
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
            {{ char.baseImage ? '重新生成' : '生成' }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating || !!uploadingCharacterId"
            @click="triggerUploadInput(char.id)"
          >
            <Loader2
              v-if="uploadingCharacterId === char.id"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <Upload
              v-else
              class="mr-1 h-3 w-3"
            />
            上传
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating || !char.baseImage || !!uploadingArkCharacterId"
            @click="emit('ingest-ark-asset', char.id)"
          >
            <Loader2
              v-if="uploadingArkCharacterId === char.id"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <CloudUpload
              v-else
              class="mr-1 h-3 w-3"
            />
            {{ char.arkAsset?.status === 'Active' ? '重新入库' : '入库虚拟人像' }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('select-ark-asset', char)"
          >
            <Database class="mr-1 h-3 w-3" />
            选择素材
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating || !!uploadingCharacterVoiceId"
            @click="triggerVoiceUploadInput(char.id)"
          >
            <Loader2
              v-if="uploadingCharacterVoiceId === char.id"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <AudioLines
              v-else
              class="mr-1 h-3 w-3"
            />
            {{ char.voiceAsset?.audioUrl ? '替换音频' : '上传音频' }}
          </Button>
          <Button
            v-if="!char.parentCharacterId"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('add-variant', char)"
          >
            <Plus class="mr-1 h-3 w-3" />
            添加变体
          </Button>
          <Button
            v-if="char.baseImage"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('open-regenerate', char)"
          >
            <Sparkles class="mr-1 h-3 w-3" />
            定向修改
          </Button>
          <Button
            v-if="resolveHistoryCount(char) > 1"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('open-history', char.id)"
          >
            <History class="mr-1 h-3 w-3" />
            历史 {{ resolveHistoryCount(char) }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || char.generating"
            @click="emit('start-edit', char)"
          >
            <Pencil class="mr-1 h-3 w-3" />
            编辑
          </Button>
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

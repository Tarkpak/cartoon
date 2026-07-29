<script setup lang="ts">
import { Plus, Trash2, Users } from 'lucide-vue-next'
import type { ComponentPublicInstance } from 'vue'
import { useSceneDescriptionMentionEditor } from '~/composables/useSceneDescriptionMentionEditor'
import type {
  AssetReferenceOption,
  SceneEditData
} from '~/lib/scene-edit-dialog'
import {
  buildSceneAssetMentionCandidates,
  mergeSceneEditAssetReferenceOptions,
  normalizeSceneDescriptionMentionsForSave,
  replaceSceneCharacterAssetMention,
  restoreSceneDescriptionMentionsForEdit,
  resolveUploadedSceneAssetMentionTokens,
  uniqueValues
} from '~/lib/scene-edit-dialog'
import { resetFileInput } from '~/lib/asset-workbench-upload'
import { resolveChatUploadAssetName } from '~/lib/asset-workbench-scene-chat'
import { toImageSrc } from '~/lib/media'
import { formatSceneDescriptionTimelineBreaks } from '~/lib/scene-description-format'

const props = defineProps<{
  open: boolean
  scene: SceneEditData | null
  assetReferenceOptions?: AssetReferenceOption[]
  selectedAssetReferenceIds?: string[]
  uploadOtherAssets?: (options: { sceneId: string, files: File[], names?: string[] }) => Promise<AssetReferenceOption[]>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [scene: SceneEditData]
  'save-asset-references': [payload: { sceneId: string, assetIds: string[] }]
}>()

// 本地编辑状态
const editForm = ref<SceneEditData>({
  id: '',
  title: '',
  description: '',
  narration: '',
  characters: [],
  duration: 8,
  setting: { location: '', timeOfDay: '白天' },
  shotType: '中景',
  cameraMovement: '固定镜头',
  cameraNote: '',
  transitionIn: 'cut',
  transitionOut: 'cut',
  transitionDuration: 0.5
})
const selectedAssetReferenceIdsInternal = ref<string[]>([])
const sceneEditScrollContainerRef = ref<HTMLDivElement | null>(null)
const pendingCharacterSelectScrollTop = ref<number | null>(null)
const sceneAssetUploadInputRef = ref<HTMLInputElement | null>(null)
const sceneAssetUploading = ref(false)
const sceneAssetUploadError = ref<string | null>(null)
const sceneAssetNameDialogOpen = ref(false)
const sceneAssetPendingFiles = ref<File[]>([])
const sceneAssetPendingNames = ref<string[]>([])
const uploadedAssetReferenceOptions = ref<AssetReferenceOption[]>([])
const AUTO_CHARACTER_STATE_VALUE = '__auto__'

const dialogOpen = toRef(props, 'open')

const assetReferenceOptions = computed<AssetReferenceOption[]>(() => {
  return mergeSceneEditAssetReferenceOptions(
    uploadedAssetReferenceOptions.value,
    Array.isArray(props.assetReferenceOptions) ? props.assetReferenceOptions : []
  )
})

function normalizeCharacterStateName(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/[\s\r\n\t/／·・-]+/g, '')
}

function resolveRawCharacterAssetId(assetId: string): string {
  return assetId.startsWith('char:') ? assetId.slice('char:'.length) : assetId
}

const characterStateGroups = computed(() => {
  const characterAssets = assetReferenceOptions.value.filter(asset => asset.type === 'character')
  const rootAssets = characterAssets.filter(asset => !asset.characterParentId)
  const rootAssetByRawId = new Map(rootAssets.map(asset => [resolveRawCharacterAssetId(asset.id), asset] as const))
  const variantsByParentId = new Map<string, AssetReferenceOption[]>()

  for (const asset of characterAssets) {
    if (!asset.characterParentId) continue
    const variants = variantsByParentId.get(asset.characterParentId) || []
    variants.push(asset)
    variantsByParentId.set(asset.characterParentId, variants)
  }

  return rootAssets.map((rootAsset) => {
    const rootId = resolveRawCharacterAssetId(rootAsset.id)
    const variants = (variantsByParentId.get(rootId) || [])
      .slice()
      .sort((left, right) => (left.characterVariantName || left.name).localeCompare(right.characterVariantName || right.name, 'zh-CN'))
    return {
      root: rootAssetByRawId.get(rootId) || rootAsset,
      assetIds: [rootAsset.id, ...variants.map(variant => variant.id)],
      options: [
        {
          asset: rootAsset,
          label: '默认形态'
        },
        ...variants.map(variant => ({
          asset: variant,
          label: variant.characterVariantName || variant.name
        }))
      ]
    }
  })
})

const sceneCharacterNameSet = computed(() => {
  return new Set(
    editForm.value.characters
      .map(character => normalizeCharacterStateName(character.name))
      .filter(Boolean)
  )
})

const availableSceneCharacterAssets = computed(() => {
  return characterStateGroups.value
    .map(group => group.root)
    .filter((asset) => {
      return !editForm.value.characters.some((character) => {
        return resolveSceneCharacterGroup(character.name)?.root.id === asset.id
      })
    })
})

function resolveSceneCharacterGroup(characterName: string) {
  const normalizedName = normalizeCharacterStateName(characterName)
  if (!normalizedName) return undefined

  return characterStateGroups.value.find((group) => {
    const rootName = normalizeCharacterStateName(group.root.name)
    return rootName === normalizedName
  }) || characterStateGroups.value.find((group) => {
    const rootName = normalizeCharacterStateName(group.root.name)
    return rootName.includes(normalizedName) || normalizedName.includes(rootName)
  })
}

const sceneCharacterRows = computed(() => {
  const selectedIds = new Set(selectedAssetReferenceIdsInternal.value)

  return editForm.value.characters.map((character, index) => {
    const group = resolveSceneCharacterGroup(character.name)
    const persistedAssetId = character.assetId?.trim()
    const selectedInGroup = persistedAssetId && group?.assetIds.includes(persistedAssetId)
      ? persistedAssetId
      : group?.assetIds.find(assetId => selectedIds.has(assetId))
    const selectedAsset = group?.options.find(option => option.asset.id === selectedInGroup)?.asset
      || group?.root
    return {
      character,
      index,
      key: `${normalizeCharacterStateName(character.name) || 'character'}_${index}`,
      group,
      selectedAsset,
      selectedValue: selectedInGroup || AUTO_CHARACTER_STATE_VALUE
    }
  })
})

function addSceneCharacter(asset: AssetReferenceOption) {
  const normalizedName = normalizeCharacterStateName(asset.name)
  if (!normalizedName || sceneCharacterNameSet.value.has(normalizedName)) return

  editForm.value.characters.push({ name: asset.name, assetId: asset.id })
  selectedAssetReferenceIdsInternal.value = uniqueValues([
    ...selectedAssetReferenceIdsInternal.value,
    asset.id
  ])
}

function removeSceneCharacter(index: number) {
  const character = editForm.value.characters[index]
  if (!character) return

  const group = resolveSceneCharacterGroup(character.name)
  editForm.value.characters.splice(index, 1)

  if (!group) return
  const rootName = normalizeCharacterStateName(group.root.name)
  const groupStillInScene = editForm.value.characters.some((item) => {
    return normalizeCharacterStateName(item.name) === rootName
  })
  if (groupStillInScene) return

  const groupAssetIds = new Set(group.assetIds)
  selectedAssetReferenceIdsInternal.value = selectedAssetReferenceIdsInternal.value
    .filter(assetId => !groupAssetIds.has(assetId))
}

const sceneDescription = computed({
  get: () => editForm.value.description || '',
  set: (value: string) => {
    editForm.value.description = value
  }
})

const {
  sceneDescriptionEditorRef,
  sceneDescriptionMentionListRef,
  sceneDescriptionMentionOpen,
  sceneDescriptionMentionActiveIndex,
  sceneDescriptionMentionCandidates,
  sceneDescriptionSupportsMention,
  closeSceneDescriptionMention,
  renderSceneDescriptionEditor,
  syncSceneDescriptionFromEditor,
  insertSceneAssetMention,
  handleSceneDescriptionInput,
  handleSceneDescriptionCursorChange,
  handleSceneDescriptionFocus,
  handleSceneDescriptionCompositionStart,
  handleSceneDescriptionCompositionEnd,
  handleSceneDescriptionBlur,
  handleSceneDescriptionKeydown,
  handleSceneDescriptionBeforeInput,
  extractMentionedAssetIdsFromDescription
} = useSceneDescriptionMentionEditor({
  description: sceneDescription,
  assetReferenceOptions,
  selectedAssetReferenceIds: selectedAssetReferenceIdsInternal,
  dialogOpen
})

// 监听 scene 变化，初始化表单
watch(() => props.scene, (newScene) => {
  if (newScene) {
    const mentionCandidates = buildSceneAssetMentionCandidates(assetReferenceOptions.value)
    const selectedAssetReferenceIds = Array.isArray(props.selectedAssetReferenceIds)
      ? props.selectedAssetReferenceIds.filter(Boolean)
      : []
    const restoredDescription = formatSceneDescriptionTimelineBreaks(restoreSceneDescriptionMentionsForEdit({
      text: newScene.description || '',
      candidates: mentionCandidates,
      selectedAssetReferenceIds
    }))

    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: restoredDescription,
      narration: newScene.narration || '',
      characters: newScene.characters.map(character => ({ ...character })),
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : { location: '', timeOfDay: '白天' },
      shotType: newScene.shotType || '中景',
      cameraMovement: newScene.cameraMovement || '固定镜头',
      cameraNote: newScene.cameraNote || '',
      transitionIn: newScene.transitionIn || 'cut',
      transitionOut: newScene.transitionOut || 'cut',
      transitionDuration: newScene.transitionDuration || 0.5
    }
    closeSceneDescriptionMention()
    nextTick(() => {
      renderSceneDescriptionEditor(editForm.value.description || '')
    })
  }
}, { immediate: true })

watch(
  () => props.open,
  (open) => {
    if (open) return
    sceneAssetUploadError.value = null
    sceneAssetUploading.value = false
    uploadedAssetReferenceOptions.value = []
    closeSceneAssetNameDialog()
  }
)

watch(
  () => [props.scene?.id, props.selectedAssetReferenceIds],
  () => {
    const ids = Array.isArray(props.selectedAssetReferenceIds)
      ? props.selectedAssetReferenceIds.filter(Boolean)
      : []
    selectedAssetReferenceIdsInternal.value = Array.from(new Set(ids))
  },
  { immediate: true, deep: true }
)

// 保存
function handleSave() {
  editForm.value.characters = editForm.value.characters
    .map(character => ({
      name: character.name.trim(),
      assetId: character.assetId?.trim() || undefined,
      appearance: character.appearance?.trim() || undefined,
      emotion: character.emotion?.trim() || undefined
    }))
    .filter(character => !!character.name)

  if (sceneDescriptionSupportsMention.value) {
    syncSceneDescriptionFromEditor()

    const normalized = normalizeSceneDescriptionMentionsForSave({
      text: editForm.value.description || '',
      candidates: buildSceneAssetMentionCandidates(assetReferenceOptions.value),
      selectedAssetReferenceIds: selectedAssetReferenceIdsInternal.value,
      preserveSelectedAssetReferenceIds: true
    })

    editForm.value.description = normalized.description
    selectedAssetReferenceIdsInternal.value = normalized.assetIds
  }

  emit('save', { ...editForm.value })
  if (editForm.value.id) {
    const ids = sceneDescriptionSupportsMention.value
      ? selectedAssetReferenceIdsInternal.value
      : uniqueValues([
          ...selectedAssetReferenceIdsInternal.value,
          ...extractMentionedAssetIdsFromDescription(editForm.value.description || '')
        ])
    emit('save-asset-references', {
      sceneId: editForm.value.id,
      assetIds: ids
    })
  }
  emit('update:open', false)
}

function updateCharacterStateReference(characterIndex: number, nextAssetId: string) {
  const sceneCharacter = editForm.value.characters[characterIndex]
  if (!sceneCharacter) return

  const group = resolveSceneCharacterGroup(sceneCharacter.name)
  if (!group) return

  const normalizedNextAssetId = nextAssetId && nextAssetId !== AUTO_CHARACTER_STATE_VALUE
    ? nextAssetId
    : ''
  sceneCharacter.assetId = normalizedNextAssetId || undefined

  const groupAssetIds = new Set(group.assetIds)
  const nextIds = selectedAssetReferenceIdsInternal.value.filter(assetId => !groupAssetIds.has(assetId))
  if (normalizedNextAssetId) {
    nextIds.push(normalizedNextAssetId)
  }
  selectedAssetReferenceIdsInternal.value = uniqueValues(nextIds)

  if (normalizedNextAssetId && sceneDescriptionSupportsMention.value) {
    syncSceneDescriptionFromEditor()
    const nextDescription = replaceSceneCharacterAssetMention({
      text: editForm.value.description || '',
      candidates: buildSceneAssetMentionCandidates(assetReferenceOptions.value),
      characterAssetIds: group.assetIds,
      nextAssetId: normalizedNextAssetId
    })
    editForm.value.description = nextDescription
    renderSceneDescriptionEditor(nextDescription)
  }
}

function rememberCharacterSelectScrollPosition() {
  pendingCharacterSelectScrollTop.value = sceneEditScrollContainerRef.value?.scrollTop ?? null
}

function restoreCharacterSelectScrollPosition(open: boolean) {
  if (!open) {
    pendingCharacterSelectScrollTop.value = null
    return
  }

  const scrollTop = pendingCharacterSelectScrollTop.value
  if (scrollTop === null) return

  const restore = () => {
    if (sceneEditScrollContainerRef.value) {
      sceneEditScrollContainerRef.value.scrollTop = scrollTop
    }
  }

  nextTick(() => {
    restore()
    window.requestAnimationFrame(restore)
  })
}

// 取消
function handleCancel() {
  closeSceneDescriptionMention()
  sceneAssetUploadError.value = null
  closeSceneAssetNameDialog()
  emit('update:open', false)
}

function setSceneDescriptionEditorElement(element: Element | ComponentPublicInstance | null) {
  sceneDescriptionEditorRef.value = element instanceof HTMLDivElement ? element : null
}

function setSceneDescriptionMentionListElement(element: Element | ComponentPublicInstance | null) {
  sceneDescriptionMentionListRef.value = element instanceof HTMLDivElement ? element : null
}

function setSceneAssetUploadInputElement(element: Element | ComponentPublicInstance | null) {
  const component = element as (ComponentPublicInstance & { inputElement?: HTMLInputElement }) | null
  sceneAssetUploadInputRef.value = element instanceof HTMLInputElement
    ? element
    : component?.inputElement instanceof HTMLInputElement ? component.inputElement : null
}

function triggerSceneAssetUpload() {
  sceneAssetUploadInputRef.value?.click()
}

function closeSceneAssetNameDialog() {
  sceneAssetNameDialogOpen.value = false
  sceneAssetPendingFiles.value = []
  sceneAssetPendingNames.value = []
}

function setSceneAssetNameDialogOpen(open: boolean) {
  if (open) {
    sceneAssetNameDialogOpen.value = true
    return
  }
  closeSceneAssetNameDialog()
}

function resolveSceneAssetDefaultNames(files: File[]): string[] {
  const existingNames = assetReferenceOptions.value.map(item => item.name)
  return files.map((file) => {
    const name = resolveChatUploadAssetName(file.name, existingNames)
    existingNames.push(name)
    return name
  })
}

function registerUploadedAssetReferenceOptions(createdAssets: AssetReferenceOption[]) {
  uploadedAssetReferenceOptions.value = mergeSceneEditAssetReferenceOptions(
    createdAssets,
    uploadedAssetReferenceOptions.value
  )
}

function applySceneAssetTokens(createdAssets: AssetReferenceOption[]) {
  const createdAssetIds = createdAssets.map(asset => asset.id)

  if (createdAssetIds.length > 0) {
    selectedAssetReferenceIdsInternal.value = uniqueValues([
      ...selectedAssetReferenceIdsInternal.value,
      ...createdAssetIds
    ])
  }

  if (createdAssetIds.length === 0) return

  const appendedTokens = resolveUploadedSceneAssetMentionTokens({
    createdAssets,
    assetReferenceOptions: assetReferenceOptions.value
  })

  if (appendedTokens.length === 0) return

  const base = (editForm.value.description || '').trimEnd()
  const nextDescription = base
    ? `${base}\n${appendedTokens.join(' ')} `
    : `${appendedTokens.join(' ')} `

  editForm.value.description = nextDescription
  renderSceneDescriptionEditor(nextDescription)
}

function resolveSceneAssetUploadNames(files: File[]): string[] {
  const existingNames = assetReferenceOptions.value.map(item => item.name)
  return files.map((file, index) => {
    const raw = (sceneAssetPendingNames.value[index] || '').trim()
    const preferred = raw || file.name
    const name = resolveChatUploadAssetName(preferred, existingNames)
    existingNames.push(name)
    return name
  })
}

async function submitSceneAssetUpload() {
  if (sceneAssetUploading.value) return

  const files = sceneAssetPendingFiles.value.slice()
  if (files.length === 0) {
    closeSceneAssetNameDialog()
    return
  }

  if (!editForm.value.id) {
    sceneAssetUploadError.value = '当前场景未初始化，无法上传资产'
    return
  }

  if (!props.uploadOtherAssets) {
    sceneAssetUploadError.value = '未配置资产上传能力'
    return
  }

  sceneAssetUploading.value = true
  sceneAssetUploadError.value = null

  try {
    if (sceneDescriptionSupportsMention.value) {
      syncSceneDescriptionFromEditor()
    }

    const names = resolveSceneAssetUploadNames(files)
    const createdAssets = await props.uploadOtherAssets({
      sceneId: editForm.value.id,
      files,
      names
    })

    registerUploadedAssetReferenceOptions(createdAssets)
    applySceneAssetTokens(createdAssets)
    closeSceneAssetNameDialog()
  } catch (error) {
    sceneAssetUploadError.value = error instanceof Error
      ? error.message
      : '上传资产失败'
  } finally {
    sceneAssetUploading.value = false
  }
}

function handleSceneAssetUpload(event: Event) {
  const input = event.target as HTMLInputElement | null
  const files = Array.from(input?.files || [])

  if (files.length === 0) {
    resetFileInput(event)
    return
  }

  if (!editForm.value.id) {
    sceneAssetUploadError.value = '当前场景未初始化，无法上传资产'
    resetFileInput(event)
    return
  }

  if (!props.uploadOtherAssets) {
    sceneAssetUploadError.value = '未配置资产上传能力'
    resetFileInput(event)
    return
  }

  sceneAssetUploadError.value = null
  sceneAssetPendingFiles.value = files
  sceneAssetPendingNames.value = resolveSceneAssetDefaultNames(files)
  sceneAssetNameDialogOpen.value = true
  resetFileInput(event)
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>编辑场景</DialogTitle>
        <DialogDescription>
          修改场景标题和时间轴描述
        </DialogDescription>
      </DialogHeader>

      <div
        ref="sceneEditScrollContainerRef"
        class="min-h-0 flex-1 space-y-6 overflow-y-auto py-4 pr-1"
      >
        <ScriptSceneEditBasicPanel
          v-model:edit-form="editForm"
          :scene-description-supports-mention="sceneDescriptionSupportsMention"
          :scene-description-mention-open="sceneDescriptionMentionOpen"
          :scene-description-mention-active-index="sceneDescriptionMentionActiveIndex"
          :scene-description-mention-candidates="sceneDescriptionMentionCandidates"
          :scene-asset-uploading="sceneAssetUploading"
          :scene-asset-upload-error="sceneAssetUploadError"
          :set-scene-description-editor-ref="setSceneDescriptionEditorElement"
          :set-scene-description-mention-list-ref="setSceneDescriptionMentionListElement"
          :set-scene-asset-upload-input-ref="setSceneAssetUploadInputElement"
          :trigger-scene-asset-upload="triggerSceneAssetUpload"
          :handle-scene-asset-upload="handleSceneAssetUpload"
          :insert-scene-asset-mention="insertSceneAssetMention"
          :handle-scene-description-input="handleSceneDescriptionInput"
          :handle-scene-description-before-input="handleSceneDescriptionBeforeInput"
          :handle-scene-description-cursor-change="handleSceneDescriptionCursorChange"
          :handle-scene-description-focus="handleSceneDescriptionFocus"
          :handle-scene-description-composition-start="handleSceneDescriptionCompositionStart"
          :handle-scene-description-composition-end="handleSceneDescriptionCompositionEnd"
          :handle-scene-description-blur="handleSceneDescriptionBlur"
          :handle-scene-description-keydown="handleSceneDescriptionKeydown"
        />

        <section class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h4 class="flex items-center gap-2 text-sm font-medium">
                <Users class="h-4 w-4" />
                场景人物
              </h4>
              <p class="mt-0.5 text-xs text-muted-foreground">
                管理本场景的登场人物、形态和表演状态。
              </p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-8 gap-1.5"
                  :disabled="availableSceneCharacterAssets.length === 0"
                >
                  <Plus class="h-3.5 w-3.5" />
                  添加人物
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                class="max-h-64 w-64 overflow-y-auto"
              >
                <DropdownMenuLabel>选择人物资产</DropdownMenuLabel>
                <DropdownMenuItem
                  v-for="asset in availableSceneCharacterAssets"
                  :key="`add_scene_character_${asset.id}`"
                  @select="addSceneCharacter(asset)"
                >
                  <img
                    v-if="asset.referenceImage"
                    :src="toImageSrc(asset.referenceImage)"
                    :alt="`${asset.name} 角色图`"
                    class="h-7 w-7 rounded border object-cover"
                  >
                  <div
                    v-else
                    class="flex h-7 w-7 items-center justify-center rounded border bg-muted text-xs text-muted-foreground"
                  >
                    人物
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm">
                      {{ asset.name }}
                    </p>
                    <p class="truncate text-xs text-muted-foreground">
                      {{ asset.description || '暂无人物描述' }}
                    </p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div
            v-if="sceneCharacterRows.length === 0"
            class="flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center"
          >
            <Users class="h-5 w-5 text-muted-foreground" />
            <p class="text-sm text-muted-foreground">
              本场景暂无登场人物
            </p>
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="row in sceneCharacterRows"
              :key="`scene_character_${row.key}`"
              class="space-y-3 rounded-md border bg-background p-3"
            >
              <div class="flex items-center gap-3">
                <img
                  v-if="row.selectedAsset?.referenceImage"
                  :src="toImageSrc(row.selectedAsset.referenceImage)"
                  :alt="`${row.character.name} 角色图`"
                  class="h-10 w-10 shrink-0 rounded border object-cover"
                >
                <div
                  v-else
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-muted text-xs text-muted-foreground"
                >
                  人物
                </div>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    {{ row.character.name }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ row.selectedAsset?.description || '未关联到现有人物资产' }}
                  </p>
                </div>

                <Select
                  v-if="row.group"
                  :model-value="row.selectedValue"
                  @update:open="restoreCharacterSelectScrollPosition"
                  @update:model-value="updateCharacterStateReference(row.index, String($event))"
                >
                  <SelectTrigger
                    class="h-8 w-[160px] text-xs"
                    @pointerdown="rememberCharacterSelectScrollPosition"
                  >
                    <SelectValue placeholder="选择人物形态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="AUTO_CHARACTER_STATE_VALUE">
                      自动匹配
                    </SelectItem>
                    <SelectItem
                      v-for="option in row.group.options"
                      :key="option.asset.id"
                      :value="option.asset.id"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  :title="`从场景移除${row.character.name}`"
                  @click="removeSceneCharacter(row.index)"
                >
                  <Trash2 class="h-4 w-4" />
                  <span class="sr-only">从场景移除{{ row.character.name }}</span>
                </Button>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <label class="text-xs font-medium text-muted-foreground">本场景情绪</label>
                  <Input
                    v-model="row.character.emotion"
                    placeholder="例如：紧张、克制"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-medium text-muted-foreground">本场景外观补充</label>
                  <Input
                    v-model="row.character.appearance"
                    placeholder="例如：外套被雨水打湿"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <DialogFooter class="flex-shrink-0">
        <Button
          variant="outline"
          @click="handleCancel"
        >
          取消
        </Button>
        <Button @click="handleSave">
          保存修改
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="sceneAssetNameDialogOpen"
    @update:open="setSceneAssetNameDialogOpen"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>上传其他资产</DialogTitle>
        <DialogDescription>
          可在上传前编辑资产名称，默认使用文件名。
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-[48vh] space-y-3 overflow-y-auto py-1">
        <div
          v-for="(file, index) in sceneAssetPendingFiles"
          :key="`${file.name}_${index}`"
          class="space-y-1"
        >
          <p class="truncate text-xs text-muted-foreground">
            文件：{{ file.name }}
          </p>
          <Input
            v-model="sceneAssetPendingNames[index]"
            placeholder="输入资产名称"
            :disabled="sceneAssetUploading"
          />
        </div>
      </div>

      <p
        v-if="sceneAssetUploadError"
        class="text-xs text-destructive"
      >
        {{ sceneAssetUploadError }}
      </p>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="sceneAssetUploading"
          @click="closeSceneAssetNameDialog"
        >
          取消
        </Button>
        <Button
          :disabled="sceneAssetUploading || sceneAssetPendingFiles.length === 0"
          @click="submitSceneAssetUpload"
        >
          {{ sceneAssetUploading ? '上传中...' : '确认上传' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

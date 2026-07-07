<script setup lang="ts">
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
  restoreSceneDescriptionMentionsForEdit,
  resolveUploadedSceneAssetMentionTokens,
  uniqueValues
} from '~/lib/scene-edit-dialog'
import { resetFileInput } from '~/lib/asset-workbench-upload'
import { resolveChatUploadAssetName } from '~/lib/asset-workbench-scene-chat'
import { toImageSrc } from '~/lib/media'

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
  shotType: 'medium',
  cameraMovement: 'static',
  cameraNote: '',
  transitionIn: 'cut',
  transitionOut: 'cut',
  transitionDuration: 0.5
})
const selectedAssetReferenceIdsInternal = ref<string[]>([])
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

const sceneCharacterStateRows = computed(() => {
  const selectedIds = new Set(selectedAssetReferenceIdsInternal.value)
  const normalizedSceneNames = editForm.value.characters
    .map(character => normalizeCharacterStateName(character.name))
    .filter(Boolean)
  const sceneNameSet = new Set(normalizedSceneNames)
  const includedRootIds = new Set<string>()
  const rows: Array<{
    key: string
    sceneName: string
    root: AssetReferenceOption
    options: Array<{ asset: AssetReferenceOption, label: string }>
    selectedValue: string
  }> = []

  for (const group of characterStateGroups.value) {
    const rootName = normalizeCharacterStateName(group.root.name)
    const selectedInGroup = group.assetIds.find(assetId => selectedIds.has(assetId))
    const appearsInScene = !!rootName && Array.from(sceneNameSet).some((sceneName) => {
      return sceneName === rootName || sceneName.includes(rootName) || rootName.includes(sceneName)
    })

    if (!appearsInScene && !selectedInGroup) continue

    const rootRawId = resolveRawCharacterAssetId(group.root.id)
    includedRootIds.add(rootRawId)
    rows.push({
      key: rootRawId,
      sceneName: group.root.name,
      root: group.root,
      options: group.options,
      selectedValue: selectedInGroup || AUTO_CHARACTER_STATE_VALUE
    })
  }

  for (const group of characterStateGroups.value) {
    const rootRawId = resolveRawCharacterAssetId(group.root.id)
    if (includedRootIds.has(rootRawId)) continue
    const hasVariant = group.options.length > 1
    if (!hasVariant) continue
    rows.push({
      key: rootRawId,
      sceneName: group.root.name,
      root: group.root,
      options: group.options,
      selectedValue: AUTO_CHARACTER_STATE_VALUE
    })
  }

  return rows
})

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
    const restoredDescription = restoreSceneDescriptionMentionsForEdit({
      text: newScene.description || '',
      candidates: mentionCandidates,
      selectedAssetReferenceIds
    })

    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: restoredDescription,
      narration: newScene.narration || '',
      characters: [...newScene.characters],
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : { location: '', timeOfDay: '白天' },
      shotType: newScene.shotType || 'medium',
      cameraMovement: newScene.cameraMovement || 'static',
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

function updateCharacterStateReference(rowKey: string, nextAssetId: string) {
  const group = characterStateGroups.value.find(item => resolveRawCharacterAssetId(item.root.id) === rowKey)
  if (!group) return

  const groupAssetIds = new Set(group.assetIds)
  const nextIds = selectedAssetReferenceIdsInternal.value.filter(assetId => !groupAssetIds.has(assetId))
  if (nextAssetId && nextAssetId !== AUTO_CHARACTER_STATE_VALUE) {
    nextIds.push(nextAssetId)
  }
  selectedAssetReferenceIdsInternal.value = uniqueValues(nextIds)
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

      <div class="min-h-0 flex-1 space-y-6 overflow-y-auto py-4 pr-1">
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

        <div
          v-if="sceneCharacterStateRows.length > 0"
          class="space-y-3 rounded-lg border bg-muted/15 p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <div>
              <h4 class="text-sm font-medium">
                角色状态
              </h4>
              <p class="mt-0.5 text-xs text-muted-foreground">
                为本场景指定主角色或变体；保存后会作为分镜生成的角色引用。
              </p>
            </div>
            <Badge
              variant="outline"
              class="text-xs"
            >
              {{ sceneCharacterStateRows.filter(row => row.selectedValue !== AUTO_CHARACTER_STATE_VALUE).length }} 已指定
            </Badge>
          </div>

          <div class="space-y-2">
            <div
              v-for="row in sceneCharacterStateRows"
              :key="`scene_character_state_${row.key}`"
              class="flex items-center gap-3 rounded-md border bg-background px-2.5 py-2"
            >
              <img
                v-if="row.root.referenceImage"
                :src="toImageSrc(row.root.referenceImage)"
                :alt="`${row.root.name} 角色图`"
                class="h-10 w-10 shrink-0 rounded border object-cover"
              >
              <div
                v-else
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-muted text-xs text-muted-foreground"
              >
                角色
              </div>

              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ row.sceneName }}
                </p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ row.root.description || '暂无角色描述' }}
                </p>
              </div>

              <Select
                :model-value="row.selectedValue"
                @update:model-value="updateCharacterStateReference(row.key, String($event))"
              >
                <SelectTrigger class="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="选择角色状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="AUTO_CHARACTER_STATE_VALUE">
                    自动匹配
                  </SelectItem>
                  <SelectItem
                    v-for="option in row.options"
                    :key="option.asset.id"
                    :value="option.asset.id"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
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

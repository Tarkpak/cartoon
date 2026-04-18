<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { useSceneAssetReferences } from '~/composables/useSceneAssetReferences'
import { useSceneDescriptionMentionEditor } from '~/composables/useSceneDescriptionMentionEditor'
import type {
  AssetReferenceOption,
  EditPanelKey,
  SceneEditData
} from '~/lib/scene-edit-dialog'
import {
  sceneEditPanelTabs,
  uniqueValues
} from '~/lib/scene-edit-dialog'

const props = defineProps<{
  open: boolean
  scene: SceneEditData | null
  assetReferenceOptions?: AssetReferenceOption[]
  selectedAssetReferenceIds?: string[]
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
  dialogues: [],
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
const activePanel = ref<EditPanelKey>('basic')

const panelTabs = sceneEditPanelTabs
const dialogOpen = toRef(props, 'open')

const assetReferenceOptions = computed<AssetReferenceOption[]>(() => {
  return Array.isArray(props.assetReferenceOptions) ? props.assetReferenceOptions : []
})

const sceneDescription = computed({
  get: () => editForm.value.description || '',
  set: (value: string) => {
    editForm.value.description = value
  }
})

const {
  draggingAssetId,
  activeDropZone,
  assetPoolReferences,
  poolCharacterAssets,
  poolEnvironmentAssets,
  poolPropAssets,
  selectedCharacterAssets,
  selectedEnvironmentAssets,
  selectedPropAssets,
  selectedUnknownAssets,
  handleAssetDragStart,
  handleAssetDragEnd,
  handleDropZoneDragOver,
  handleDropZoneDrop,
  handleDropZoneDragLeave
} = useSceneAssetReferences({
  assetReferenceOptions,
  selectedAssetReferenceIds: selectedAssetReferenceIdsInternal
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
  extractMentionedAssetIdsFromDescription
} = useSceneDescriptionMentionEditor({
  description: sceneDescription,
  assetReferenceOptions,
  selectedAssetReferenceIds: selectedAssetReferenceIdsInternal,
  dialogOpen,
  activePanel
})

// 监听 scene 变化，初始化表单
watch(() => props.scene, (newScene) => {
  if (newScene) {
    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: newScene.description,
      narration: newScene.narration || '',
      characters: [...newScene.characters],
      dialogues: newScene.dialogues.map(d => ({ ...d })),
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : { location: '', timeOfDay: '白天' },
      shotType: newScene.shotType || 'medium',
      cameraMovement: newScene.cameraMovement || 'static',
      cameraNote: newScene.cameraNote || '',
      transitionIn: newScene.transitionIn || 'cut',
      transitionOut: newScene.transitionOut || 'cut',
      transitionDuration: newScene.transitionDuration || 0.5
    }
    activePanel.value = 'basic'
    closeSceneDescriptionMention()
    nextTick(() => {
      renderSceneDescriptionEditor(editForm.value.description || '')
    })
  }
}, { immediate: true })

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
  }

  emit('save', { ...editForm.value })
  if (editForm.value.id) {
    const mentionedAssetIds = extractMentionedAssetIdsFromDescription(editForm.value.description || '')
    const ids = uniqueValues([
      ...selectedAssetReferenceIdsInternal.value,
      ...mentionedAssetIds
    ])
    emit('save-asset-references', {
      sceneId: editForm.value.id,
      assetIds: ids
    })
  }
  emit('update:open', false)
}

// 取消
function handleCancel() {
  closeSceneDescriptionMention()
  emit('update:open', false)
}

function setSceneDescriptionEditorElement(element: Element | ComponentPublicInstance | null) {
  sceneDescriptionEditorRef.value = element instanceof HTMLDivElement ? element : null
}

function setSceneDescriptionMentionListElement(element: Element | ComponentPublicInstance | null) {
  sceneDescriptionMentionListRef.value = element instanceof HTMLDivElement ? element : null
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>编辑场景</DialogTitle>
        <DialogDescription>
          修改场景标题和时间轴描述
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-4">
        <div class="rounded-md border bg-muted/30 p-1">
          <div class="grid grid-cols-2 gap-1">
            <Button
              v-for="tab in panelTabs"
              :key="tab.key"
              type="button"
              size="sm"
              :variant="activePanel === tab.key ? 'default' : 'ghost'"
              class="h-8 text-xs"
              @click="activePanel = tab.key"
            >
              {{ tab.label }}
            </Button>
          </div>
        </div>

        <ScriptSceneEditBasicPanel
          v-if="activePanel === 'basic'"
          v-model:edit-form="editForm"
          :scene-description-supports-mention="sceneDescriptionSupportsMention"
          :scene-description-mention-open="sceneDescriptionMentionOpen"
          :scene-description-mention-active-index="sceneDescriptionMentionActiveIndex"
          :scene-description-mention-candidates="sceneDescriptionMentionCandidates"
          :set-scene-description-editor-ref="setSceneDescriptionEditorElement"
          :set-scene-description-mention-list-ref="setSceneDescriptionMentionListElement"
          :insert-scene-asset-mention="insertSceneAssetMention"
          :handle-scene-description-input="handleSceneDescriptionInput"
          :handle-scene-description-cursor-change="handleSceneDescriptionCursorChange"
          :handle-scene-description-focus="handleSceneDescriptionFocus"
          :handle-scene-description-composition-start="handleSceneDescriptionCompositionStart"
          :handle-scene-description-composition-end="handleSceneDescriptionCompositionEnd"
          :handle-scene-description-blur="handleSceneDescriptionBlur"
          :handle-scene-description-keydown="handleSceneDescriptionKeydown"
        />

        <ScriptSceneAssetReferencePanel
          v-else-if="activePanel === 'assets'"
          :asset-reference-options="assetReferenceOptions"
          :selected-asset-reference-ids="selectedAssetReferenceIdsInternal"
          :active-drop-zone="activeDropZone"
          :dragging-asset-id="draggingAssetId"
          :asset-pool-references="assetPoolReferences"
          :pool-character-assets="poolCharacterAssets"
          :pool-environment-assets="poolEnvironmentAssets"
          :pool-prop-assets="poolPropAssets"
          :selected-character-assets="selectedCharacterAssets"
          :selected-environment-assets="selectedEnvironmentAssets"
          :selected-prop-assets="selectedPropAssets"
          :selected-unknown-assets="selectedUnknownAssets"
          :handle-asset-drag-start="handleAssetDragStart"
          :handle-asset-drag-end="handleAssetDragEnd"
          :handle-drop-zone-drag-over="handleDropZoneDragOver"
          :handle-drop-zone-drop="handleDropZoneDrop"
          :handle-drop-zone-drag-leave="handleDropZoneDragLeave"
        />
      </div>

      <DialogFooter>
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
</template>

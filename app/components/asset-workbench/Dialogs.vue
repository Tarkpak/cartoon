<script setup lang="ts">
import SceneVideoHistoryDialog from './SceneVideoHistoryDialog.vue'
import type { SceneData, CharacterData } from '~/composables/useAssetWorkbench'
import type {
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  DisplayAsset,
  EnvironmentCropSelection,
  EnvironmentAssetCard
} from '~/lib/asset-workbench-types'
import type { AssetReferenceOption } from '~/lib/scene-edit-dialog'

defineProps<{
  characterRegenerateDialogOpen: boolean
  characterRegeneratePrompt: string
  characterRegenerateError?: string | null
  characterRegenerateTarget: CharacterData | null
  setCharacterRegenerateDialogOpen: (open: boolean) => void
  setCharacterRegeneratePrompt: (prompt: string) => void
  submitCharacterRegeneration: () => void
  environmentRegenerateDialogOpen: boolean
  environmentRegeneratePrompt: string
  environmentRegenerateError?: string | null
  environmentRegenerateTarget: EnvironmentAssetCard | null
  setEnvironmentRegenerateDialogOpen: (open: boolean) => void
  setEnvironmentRegeneratePrompt: (prompt: string) => void
  submitEnvironmentRegeneration: () => void
  environmentCropDialogOpen: boolean
  environmentCropError?: string | null
  environmentCropTarget: EnvironmentAssetCard | null
  environmentCropSourceImage?: string
  environmentCropInitialSelection?: EnvironmentCropSelection
  environmentCropSaving?: boolean
  setEnvironmentCropDialogOpen: (open: boolean) => void
  submitEnvironmentCropSelection: (payload: { selection: EnvironmentCropSelection, previewImageData?: string }) => void | Promise<void>
  sceneEditDialogOpen: boolean
  setSceneEditDialogOpen: (open: boolean) => void
  editingScene: SceneData | null
  sceneEditAssetReferenceOptions: AssetReferenceOption[]
  sceneEditSelectedAssetIds: string[]
  allAssets: DisplayAsset[]
  resolveAssetMentionTokenMap: () => Map<string, string>
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  handleSceneSave: (scene: Partial<SceneData> & { id: string }) => void
  handleSceneAssetReferencesSave: (payload: { sceneId: string, assetIds: string[] }) => void | Promise<void>
  uploadSceneEditOtherAssets: (options: { sceneId: string, files: File[], names?: string[] }) => Promise<AssetReferenceOption[]>
  assetHistoryDialogOpen: boolean
  setAssetHistoryDialogOpen: (open: boolean) => void
  assetHistoryDialogTitle: string
  assetHistoryTargetType?: 'character' | 'environment' | 'prop' | null
  assetHistoryTargetLabel: string
  assetHistoryCurrentImage?: string
  assetHistoryEntries: AssetImageHistoryEntry[]
  assetHistoryApplying?: boolean
  handleAssetHistorySelect: (entry: AssetImageHistoryEntry) => void | Promise<void>
  sceneVideoHistoryDialogOpen: boolean
  setSceneVideoHistoryDialogOpen: (open: boolean) => void
  sceneVideoHistoryTargetLabel: string
  sceneVideoHistoryCurrentVideoUrl?: string
  sceneVideoHistoryEntries: AssetVideoHistoryEntry[]
  sceneVideoHistoryApplying?: boolean
  handleSceneVideoHistorySelect: (entry: AssetVideoHistoryEntry) => void | Promise<void>
  openImagePreview: (src: string | undefined, alt: string) => void
  imagePreviewOpen: boolean
  setImagePreviewOpen: (open: boolean) => void
  imagePreviewSrc: string
  imagePreviewAlt: string
}>()
</script>

<template>
  <AssetWorkbenchRegenerateDialog
    :open="characterRegenerateDialogOpen"
    title="角色定向修改"
    description="使用当前角色图作为参考图，按自定义提示词定向修改。"
    :target-label="characterRegenerateTarget?.name || ''"
    :prompt="characterRegeneratePrompt"
    prompt-placeholder="输入定向修改提示词"
    :mention-assets="allAssets"
    :mention-token-map="resolveAssetMentionTokenMap()"
    :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
    :error="characterRegenerateError"
    :loading="!!characterRegenerateTarget?.generating"
    @update:open="setCharacterRegenerateDialogOpen"
    @update:prompt="setCharacterRegeneratePrompt"
    @submit="submitCharacterRegeneration"
  />

  <AssetWorkbenchRegenerateDialog
    :open="environmentRegenerateDialogOpen"
    title="环境定向修改"
    description="基于当前环境资产，按输入的提示词重新生成环境图。"
    :target-label="environmentRegenerateTarget?.name || ''"
    :prompt="environmentRegeneratePrompt"
    prompt-placeholder="输入定向修改提示词"
    :mention-assets="allAssets"
    :mention-token-map="resolveAssetMentionTokenMap()"
    :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
    :error="environmentRegenerateError"
    :loading="environmentRegenerateTarget?.referenceStatus === 'generating'"
    @update:open="setEnvironmentRegenerateDialogOpen"
    @update:prompt="setEnvironmentRegeneratePrompt"
    @submit="submitEnvironmentRegeneration"
  />

  <AssetWorkbenchEnvironmentCropDialog
    :open="environmentCropDialogOpen"
    :target-label="environmentCropTarget?.name || ''"
    :source-image="environmentCropSourceImage"
    :initial-selection="environmentCropInitialSelection"
    :loading="environmentCropSaving"
    :error="environmentCropError"
    @update:open="setEnvironmentCropDialogOpen"
    @submit="submitEnvironmentCropSelection"
  />

  <ScriptSceneEditDialog
    :open="sceneEditDialogOpen"
    :scene="editingScene"
    :asset-reference-options="sceneEditAssetReferenceOptions"
    :selected-asset-reference-ids="sceneEditSelectedAssetIds"
    :upload-other-assets="uploadSceneEditOtherAssets"
    @update:open="setSceneEditDialogOpen"
    @save="handleSceneSave"
    @save-asset-references="handleSceneAssetReferencesSave"
  />

  <AssetWorkbenchAssetHistoryDialog
    :open="assetHistoryDialogOpen"
    :title="assetHistoryDialogTitle"
    :target-type="assetHistoryTargetType"
    :target-label="assetHistoryTargetLabel"
    :current-image="assetHistoryCurrentImage"
    :entries="assetHistoryEntries"
    :loading="assetHistoryApplying"
    @update:open="setAssetHistoryDialogOpen"
    @preview="openImagePreview($event.src, $event.alt)"
    @select="handleAssetHistorySelect"
  />

  <SceneVideoHistoryDialog
    :open="sceneVideoHistoryDialogOpen"
    :target-label="sceneVideoHistoryTargetLabel"
    :current-video-url="sceneVideoHistoryCurrentVideoUrl"
    :entries="sceneVideoHistoryEntries"
    :loading="sceneVideoHistoryApplying"
    @update:open="setSceneVideoHistoryDialogOpen"
    @select="handleSceneVideoHistorySelect"
  />

  <ImagePreview
    :open="imagePreviewOpen"
    :src="imagePreviewSrc"
    :alt="imagePreviewAlt"
    @update:open="setImagePreviewOpen"
  />
</template>

<script setup lang="ts">
import type { SceneData, CharacterData } from '~/composables/useAssetWorkbench'
import type { EnvironmentAssetCard } from '~/lib/asset-workbench-types'
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
  sceneEditDialogOpen: boolean
  setSceneEditDialogOpen: (open: boolean) => void
  editingScene: SceneData | null
  sceneEditAssetReferenceOptions: AssetReferenceOption[]
  sceneEditSelectedAssetIds: string[]
  handleSceneSave: (scene: Partial<SceneData> & { id: string }) => void
  handleSceneAssetReferencesSave: (payload: { sceneId: string, assetIds: string[] }) => void
  imagePreviewOpen: boolean
  setImagePreviewOpen: (open: boolean) => void
  imagePreviewSrc: string
  imagePreviewAlt: string
}>()
</script>

<template>
  <AssetWorkbenchRegenerateDialog
    :open="characterRegenerateDialogOpen"
    title="角色二次生成"
    description="使用当前角色图作为参考图，按自定义提示词定向修改。"
    :target-label="characterRegenerateTarget?.name || ''"
    :prompt="characterRegeneratePrompt"
    prompt-placeholder="输入二次生成提示词"
    :error="characterRegenerateError"
    :loading="!!characterRegenerateTarget?.generating"
    @update:open="setCharacterRegenerateDialogOpen"
    @update:prompt="setCharacterRegeneratePrompt"
    @submit="submitCharacterRegeneration"
  />

  <AssetWorkbenchRegenerateDialog
    :open="environmentRegenerateDialogOpen"
    title="环境二次生成"
    description="基于当前环境资产，按你输入的提示词重新生成环境图。"
    :target-label="environmentRegenerateTarget?.name || ''"
    :prompt="environmentRegeneratePrompt"
    prompt-placeholder="输入环境二次生成提示词"
    :error="environmentRegenerateError"
    :loading="environmentRegenerateTarget?.frameStatus === 'generating'"
    @update:open="setEnvironmentRegenerateDialogOpen"
    @update:prompt="setEnvironmentRegeneratePrompt"
    @submit="submitEnvironmentRegeneration"
  />

  <ScriptSceneEditDialog
    :open="sceneEditDialogOpen"
    :scene="editingScene"
    :asset-reference-options="sceneEditAssetReferenceOptions"
    :selected-asset-reference-ids="sceneEditSelectedAssetIds"
    @update:open="setSceneEditDialogOpen"
    @save="handleSceneSave"
    @save-asset-references="handleSceneAssetReferencesSave"
  />

  <ImagePreview
    :open="imagePreviewOpen"
    :src="imagePreviewSrc"
    :alt="imagePreviewAlt"
    @update:open="setImagePreviewOpen"
  />
</template>

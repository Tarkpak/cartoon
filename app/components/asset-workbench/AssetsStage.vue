<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { PropAsset, PropAssetCategory } from '~/composables/useAssetWorkflowMeta'
import type { AutoStageKey, AssetTab, CharacterRoleOption, EnvironmentAssetCard } from '~/lib/asset-workbench-types'

const props = defineProps<{
  scenesCount: number
  characters: CharacterData[]
  environmentAssetCards: EnvironmentAssetCard[]
  propAssets: PropAsset[]
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
  characterReadyCount: number
  characterGeneratingCount: number
  characterMissingCount: number
  assetsPrimaryActionLabel: string
  editingCharacterId: string | null
  characterEditDraft: {
    id: string
    name: string
    appearance: string
    role: string
  }
  characterRoleOptions: CharacterRoleOption[]
  uploadingCharacterId: string | null
  uploadingCharacterVoiceId: string | null
  uploadingEnvironmentAssetId: string | null
  uploadingPropId: string | null
  generatingPropId: string | null
  getCharacterSceneCount: (character: CharacterData) => number
  getEnvironmentSceneSummary: (asset: EnvironmentAssetCard) => string
  hasEnvironmentRepresentativeScene: (assetId: string) => boolean
  getPropUsageCount: (propId: string) => number
  setCharacterEditDraft: (draft: { name: string, role: string, appearance: string }) => void
}>()

const emit = defineEmits<{
  'run-assets': []
  'generate-characters': []
  'select-stage': [stage: AutoStageKey]
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'start-character-edit': [character: CharacterData]
  'cancel-character-edit': []
  'save-character-edit': []
  'save-character-edit-regenerate': []
  'generate-character': [characterId: string]
  'open-character-regenerate': [character: CharacterData]
  'open-character-history': [characterId: string]
  'upload-character-image': [payload: { characterId: string, event: Event }]
  'upload-character-voice': [payload: { characterId: string, event: Event }]
  'update-character-voice-lock': [payload: { characterId: string, locked: boolean }]
  'edit-environment-scene': [assetId: string]
  'upload-environment-image': [payload: { assetId: string, event: Event }]
  'open-environment-crop': [assetId: string]
  'open-environment-regenerate': [assetId: string]
  'open-environment-history': [assetId: string]
  'regenerate-environment': [assetId: string]
  'add-prop': [payload: { name: string, description: string, category: PropAssetCategory }]
  'remove-prop': [propId: string]
  'generate-prop': [propId: string]
  'upload-prop-image': [payload: { propId: string, event: Event }]
  'open-prop-history': [propId: string]
}>()

const assetTab = ref<AssetTab>('characters')

const propAssetsOfType = computed(() => {
  return props.propAssets.filter(item => item.category !== 'other')
})

const otherAssetsOfType = computed(() => {
  return props.propAssets.filter(item => item.category === 'other')
})

const tabs = computed(() => [
  { key: 'characters' as AssetTab, label: '角色', count: props.characters.length },
  { key: 'environments' as AssetTab, label: '环境', count: props.environmentAssetCards.length },
  { key: 'props' as AssetTab, label: '道具', count: propAssetsOfType.value.length },
  { key: 'others' as AssetTab, label: '其他', count: otherAssetsOfType.value.length }
])

const hasSeedAssets = computed(() => {
  return props.characters.length > 0
    || props.environmentAssetCards.length > 0
    || props.propAssets.length > 0
})
</script>

<template>
  <div
    v-if="scenesCount === 0 && !hasSeedAssets"
    class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
  >
    <p class="text-sm">
      请先完成"剧本解析"步骤
    </p>
  </div>
  <template v-else>
    <!-- Status bar & actions -->
    <div class="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            class="inline-block h-2 w-2 rounded-full"
            :class="characterReadyCount === characters.length ? 'bg-emerald-500' : 'bg-amber-500'"
          />
          角色图 {{ characterReadyCount }}/{{ characters.length }}
        </div>
        <div
          v-if="characterGeneratingCount > 0"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 class="h-3 w-3 animate-spin text-primary" />
          生成中 {{ characterGeneratingCount }}
        </div>
        <div
          v-if="characterMissingCount > 0"
          class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
        >
          <span class="inline-block h-2 w-2 rounded-full bg-amber-500" />
          待生成 {{ characterMissingCount }}
        </div>
        <div
          v-if="scenesCount === 0 && hasSeedAssets"
          class="text-xs text-muted-foreground/80"
        >
          当前展示的是分集目录提取的资产候选
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button
          size="sm"
          :disabled="autoRunning || scenesCount === 0"
          class="gap-2"
          @click="emit('run-assets')"
        >
          <Loader2
            v-if="autoRunning && autoRunCurrentStage === 'assets'"
            class="h-3.5 w-3.5 animate-spin"
          />
          {{ assetsPrimaryActionLabel }}
        </Button>
        <Button
          v-if="characterMissingCount > 0"
          size="sm"
          variant="outline"
          :disabled="autoRunning || characters.length === 0"
          @click="emit('generate-characters')"
        >
          仅生成角色图
        </Button>
      </div>
    </div>

    <!-- Asset type tabs (underline style) -->
    <div class="shrink-0 border-b">
      <div class="flex gap-0">
        <Button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          variant="ghost"
          class="relative h-auto rounded-none px-4 py-2 text-sm font-medium transition-colors"
          :class="assetTab === tab.key
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground/80'"
          @click="assetTab = tab.key"
        >
          {{ tab.label }}
          <span class="ml-1 text-xs text-muted-foreground/70">{{ tab.count }}</span>
          <span
            v-if="assetTab === tab.key"
            class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary"
          />
        </Button>
      </div>
    </div>

    <!-- Tab content -->
    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <AssetWorkbenchCharacterAssetsTab
        v-if="assetTab === 'characters'"
        :characters="characters"
        :auto-running="autoRunning"
        :editing-character-id="editingCharacterId"
        :character-edit-draft="characterEditDraft"
        :character-role-options="characterRoleOptions"
        :uploading-character-id="uploadingCharacterId"
        :uploading-character-voice-id="uploadingCharacterVoiceId"
        :get-character-scene-count="getCharacterSceneCount"
        :set-character-edit-draft="setCharacterEditDraft"
        @preview-image="emit('preview-image', $event)"
        @start-edit="emit('start-character-edit', $event)"
        @cancel-edit="emit('cancel-character-edit')"
        @save-edit="emit('save-character-edit')"
        @save-edit-regenerate="emit('save-character-edit-regenerate')"
        @generate="emit('generate-character', $event)"
        @open-regenerate="emit('open-character-regenerate', $event)"
        @open-history="emit('open-character-history', $event)"
        @upload-image="emit('upload-character-image', $event)"
        @upload-voice="emit('upload-character-voice', $event)"
        @update-voice-lock="emit('update-character-voice-lock', $event)"
      />

      <AssetWorkbenchEnvironmentAssetsTab
        v-else-if="assetTab === 'environments'"
        :environment-asset-cards="environmentAssetCards"
        :auto-running="autoRunning"
        :uploading-environment-asset-id="uploadingEnvironmentAssetId"
        :get-environment-scene-summary="getEnvironmentSceneSummary"
        :has-environment-representative-scene="hasEnvironmentRepresentativeScene"
        @go-videos="emit('select-stage', 'videos')"
        @preview-image="emit('preview-image', $event)"
        @edit-scene="emit('edit-environment-scene', $event)"
        @upload-image="emit('upload-environment-image', $event)"
        @open-crop="emit('open-environment-crop', $event)"
        @open-regenerate="emit('open-environment-regenerate', $event)"
        @open-history="emit('open-environment-history', $event)"
        @regenerate="emit('regenerate-environment', $event)"
      />

      <AssetWorkbenchPropAssetsTab
        v-else-if="assetTab === 'props'"
        :prop-assets="propAssetsOfType"
        :auto-running="autoRunning"
        :uploading-prop-id="uploadingPropId"
        :generating-prop-id="generatingPropId"
        :get-prop-usage-count="getPropUsageCount"
        add-category="prop"
        asset-label="道具"
        @add-prop="emit('add-prop', $event)"
        @remove-prop="emit('remove-prop', $event)"
        @generate-prop="emit('generate-prop', $event)"
        @upload-image="emit('upload-prop-image', $event)"
        @open-history="emit('open-prop-history', $event)"
        @preview-image="emit('preview-image', $event)"
      />

      <AssetWorkbenchPropAssetsTab
        v-else
        :prop-assets="otherAssetsOfType"
        :auto-running="autoRunning"
        :uploading-prop-id="uploadingPropId"
        :generating-prop-id="generatingPropId"
        :get-prop-usage-count="getPropUsageCount"
        add-category="other"
        asset-label="其他"
        empty-title="暂无其他资产"
        empty-description="可手动新增其他资产，或在场景编辑中上传图片自动归类到这里。"
        @add-prop="emit('add-prop', $event)"
        @remove-prop="emit('remove-prop', $event)"
        @generate-prop="emit('generate-prop', $event)"
        @upload-image="emit('upload-prop-image', $event)"
        @open-history="emit('open-prop-history', $event)"
        @preview-image="emit('preview-image', $event)"
      />
    </div>
  </template>
</template>

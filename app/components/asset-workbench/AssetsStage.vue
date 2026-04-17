<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type { AutoStageKey, AssetTab, CharacterRoleOption, EnvironmentAssetCard } from '~/lib/asset-workbench-types'

defineProps<{
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
  uploadingEnvironmentAssetId: string | null
  uploadingPropId: string | null
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
  'upload-character-image': [payload: { characterId: string, event: Event }]
  'edit-environment-scene': [assetId: string]
  'upload-environment-image': [payload: { assetId: string, event: Event }]
  'open-environment-regenerate': [assetId: string]
  'regenerate-environment': [assetId: string]
  'add-prop': [payload: { name: string, description: string }]
  'remove-prop': [propId: string]
  'upload-prop-image': [payload: { propId: string, event: Event }]
}>()

const assetTab = ref<AssetTab>('characters')
</script>

<template>
  <div
    v-if="scenesCount === 0"
    class="text-sm text-muted-foreground"
  >
    请先完成“剧本解析”步骤。
  </div>
  <template v-else>
    <div class="shrink-0 rounded-md border bg-muted/20 px-3 py-2">
      <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="secondary"
            class="text-[11px]"
          >
            角色图就绪 {{ characterReadyCount }}/{{ characters.length }}
          </Badge>
          <Badge
            v-if="characterGeneratingCount > 0"
            variant="outline"
            class="text-[11px]"
          >
            生成中 {{ characterGeneratingCount }}
          </Badge>
          <Badge
            v-if="characterMissingCount > 0"
            variant="outline"
            class="text-[11px]"
          >
            待生成 {{ characterMissingCount }}
          </Badge>
        </div>

        <div class="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            :disabled="autoRunning"
            @click="emit('run-assets')"
          >
            <Loader2
              v-if="autoRunning && autoRunCurrentStage === 'assets'"
              class="mr-2 h-4 w-4 animate-spin"
            />
            {{ assetsPrimaryActionLabel }}
          </Button>
          <Button
            v-if="characterMissingCount > 0"
            variant="outline"
            :disabled="autoRunning || characters.length === 0"
            @click="emit('generate-characters')"
          >
            仅生成角色图
          </Button>
        </div>
      </div>
    </div>

    <div class="shrink-0 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        class="h-8 rounded-md border px-3 text-xs font-medium transition"
        :class="assetTab === 'characters' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
        @click="assetTab = 'characters'"
      >
        角色资产（{{ characters.length }}）
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-8 rounded-md border px-3 text-xs font-medium transition"
        :class="assetTab === 'scenes' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
        @click="assetTab = 'scenes'"
      >
        环境资产（{{ environmentAssetCards.length }}）
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-8 rounded-md border px-3 text-xs font-medium transition"
        :class="assetTab === 'props' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
        @click="assetTab = 'props'"
      >
        道具资产（{{ propAssets.length }}）
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <AssetWorkbenchCharacterAssetsTab
        v-if="assetTab === 'characters'"
        :characters="characters"
        :auto-running="autoRunning"
        :editing-character-id="editingCharacterId"
        :character-edit-draft="characterEditDraft"
        :character-role-options="characterRoleOptions"
        :uploading-character-id="uploadingCharacterId"
        :get-character-scene-count="getCharacterSceneCount"
        :set-character-edit-draft="setCharacterEditDraft"
        @preview-image="emit('preview-image', $event)"
        @start-edit="emit('start-character-edit', $event)"
        @cancel-edit="emit('cancel-character-edit')"
        @save-edit="emit('save-character-edit')"
        @save-edit-regenerate="emit('save-character-edit-regenerate')"
        @generate="emit('generate-character', $event)"
        @open-regenerate="emit('open-character-regenerate', $event)"
        @upload-image="emit('upload-character-image', $event)"
      />

      <AssetWorkbenchEnvironmentAssetsTab
        v-else-if="assetTab === 'scenes'"
        :environment-asset-cards="environmentAssetCards"
        :auto-running="autoRunning"
        :uploading-environment-asset-id="uploadingEnvironmentAssetId"
        :get-environment-scene-summary="getEnvironmentSceneSummary"
        :has-environment-representative-scene="hasEnvironmentRepresentativeScene"
        @go-videos="emit('select-stage', 'videos')"
        @preview-image="emit('preview-image', $event)"
        @edit-scene="emit('edit-environment-scene', $event)"
        @upload-image="emit('upload-environment-image', $event)"
        @open-regenerate="emit('open-environment-regenerate', $event)"
        @regenerate="emit('regenerate-environment', $event)"
      />

      <AssetWorkbenchPropAssetsTab
        v-else
        :prop-assets="propAssets"
        :auto-running="autoRunning"
        :uploading-prop-id="uploadingPropId"
        :get-prop-usage-count="getPropUsageCount"
        @add-prop="emit('add-prop', $event)"
        @remove-prop="emit('remove-prop', $event)"
        @upload-image="emit('upload-prop-image', $event)"
        @preview-image="emit('preview-image', $event)"
      />
    </div>
  </template>
</template>

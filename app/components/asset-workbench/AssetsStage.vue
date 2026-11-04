<script setup lang="ts">
import { vReadOnlyFence } from '~/lib/read-only-fence'
import { useAssetsStageContext } from '~/lib/asset-workbench-assets-stage-context'
import { onActivated, onDeactivated, toRefs } from 'vue'
import type { LibraryAssetCategory } from '#shared/types/library'
import { Database, Download, Loader2, Plus } from 'lucide-vue-next'
import type { AssetTab } from '~/lib/asset-workbench-types'
import { isPropAssetMediaReady } from '~/lib/asset-workbench-prop-media'

const componentActive = ref(true)
onActivated(() => { componentActive.value = true })
onDeactivated(() => { componentActive.value = false })

// State and actions come from the workbench page (see asset-workbench-assets-stage-context).
const { state, actions } = useAssetsStageContext()
const {
  toolbarActive,
  characters,
  environmentAssetCards,
  autoRunning,
  savingLibraryAssetKey,
  editingCharacterId,
  characterEditDraft,
  uploadingCharacterId,
  uploadingArkCharacterId,
  uploadingCharacterVoiceId,
  uploadingEnvironmentAssetId,
  uploadingPropId,
  uploadingPropVoiceId,
  uploadingPropVideoId,
  videoReferenceSupported,
  generatingPropId,
  getCharacterSceneCount,
  getEnvironmentSceneSummary,
  getEnvironmentMotherCandidates,
  getEnvironmentSelectedMotherId,
  hasEnvironmentRepresentativeScene,
  getPropUsageCount,
  setCharacterEditDraft
} = toRefs(state)


const assetTab = ref<AssetTab>('characters')
function selectAssetTab(tab: AssetTab) {
  assetTab.value = tab
  actions.setAssistantAssetTab(tab)
}

function trackAssetInteraction(event: MouseEvent | PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const card = target.closest<HTMLElement>('[data-ai-asset-id][data-ai-asset-type]')
  const id = card?.dataset.aiAssetId
  const type = card?.dataset.aiAssetType
  if (id && (type === 'character' || type === 'environment' || type === 'prop' || type === 'other')) {
    actions.focusAssistantAsset(type, id)
  }
}
const libraryPickerOpen = ref(false)

const libraryPickerCategories = computed<LibraryAssetCategory[]>(() => {
  if (assetTab.value === 'characters') return ['character', 'character_voice']
  if (assetTab.value === 'environments') return ['environment']
  if (assetTab.value === 'props') return ['prop']
  return ['style', 'narration', 'bgm', 'sfx', 'other']
})

const libraryPickerTargets = computed(() => {
  if (assetTab.value === 'characters') return state.characters.map(item => ({ id: item.id, name: item.name }))
  if (assetTab.value === 'environments') return state.environmentAssetCards.map(item => ({ id: item.id, name: item.name }))
  return (assetTab.value === 'props' ? propAssetsOfType.value : otherAssetsOfType.value)
    .map(item => ({ id: item.id, name: item.name }))
})

const propAssetsOfType = computed(() => {
  return state.propAssets.filter(item => item.category !== 'other')
})

const otherAssetsOfType = computed(() => {
  return state.propAssets.filter(item => item.category === 'other')
})

const tabs = computed(() => [
  { key: 'characters' as AssetTab, label: '角色', count: state.characters.length },
  { key: 'environments' as AssetTab, label: '环境', count: state.environmentAssetCards.length },
  { key: 'props' as AssetTab, label: '道具', count: propAssetsOfType.value.length },
  { key: 'others' as AssetTab, label: '其他素材', count: otherAssetsOfType.value.length }
])

const assetSummary = computed(() => {
  if (assetTab.value === 'characters') {
    return { label: '角色图', total: state.characters.length, ready: state.characterReadyCount, generating: state.characterGeneratingCount, missing: state.characterMissingCount, error: 0 }
  }
  if (assetTab.value === 'environments') {
    const assets = state.environmentAssetCards
    const count = (status: string) => assets.filter(item => item.referenceStatus === status).length
    return { label: '环境图', total: assets.length, ready: count('done'), generating: count('generating'), missing: count('pending'), error: count('error') }
  }
  const assets = assetTab.value === 'props' ? propAssetsOfType.value : otherAssetsOfType.value
  const ready = assets.filter(isPropAssetMediaReady).length
  const generating = assets.filter(item => item.id === state.generatingPropId).length
  const missing = assets.filter(item => item.id !== state.generatingPropId && !isPropAssetMediaReady(item)).length
  return { label: assetTab.value === 'props' ? '道具图' : '其他素材', total: assets.length, ready, generating, missing, missingLabel: assetTab.value === 'props' ? '待生成' : '待补充', error: 0 }
})

// Personal-library exports do not change the project. Keep them and category
// navigation available while fencing editing controls in a read-only project.
const fenceOptions = computed(() => ({
  readOnly: !!state.readOnly,
  allow: ['[data-asset-tab]'],
  conditional: [{ selector: '[data-library-save]', enabled: state.canSaveToLibrary !== false }]
}))
</script>

<template>
  <div v-read-only-fence="fenceOptions" class="flex min-h-0 flex-1 flex-col gap-3">
    <Teleport to="#workbench-stage-toolbar">
      <div v-if="toolbarActive && componentActive" v-read-only-fence="fenceOptions" class="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div
          class="flex shrink-0 items-center gap-2 whitespace-nowrap"
          aria-live="polite"
        >
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="assetSummary.ready === assetSummary.total ? 'bg-success' : 'bg-warning'"
              aria-hidden="true"
            />
            {{ assetSummary.label }} {{ assetSummary.ready }}/{{ assetSummary.total }}
          </div>
          <div
            v-if="assetSummary.generating > 0"
            class="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2 class="h-3 w-3 animate-spin text-primary" />
            生成中 {{ assetSummary.generating }}
          </div>
          <div
            v-if="assetSummary.missing > 0"
            class="flex items-center gap-1.5 text-xs text-warning"
          >
            <span
              class="inline-block h-2 w-2 rounded-full bg-warning"
              aria-hidden="true"
            />
            {{ assetSummary.missingLabel || '待生成' }} {{ assetSummary.missing }}
          </div>
          <span v-if="assetSummary.error" class="text-xs text-destructive">失败 {{ assetSummary.error }}</span>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <Button v-if="assetTab === 'characters'" size="sm" class="h-7 gap-1 px-2 text-xs" :disabled="autoRunning" @click="actions.addCharacter()">
            <Plus class="h-3.5 w-3.5" />
            新增角色
          </Button>
          <Button size="sm" variant="outline" class="h-7 gap-1 px-2 text-xs" @click="libraryPickerOpen = true">
            <Database class="h-3.5 w-3.5" />
            从资源库选择
          </Button>
          <Button data-library-save size="sm" variant="outline" class="h-7 gap-1 px-2 text-xs" :disabled="!!savingLibraryAssetKey" @click="actions.saveAssetsToLibrary(assetTab)">
            <Download class="h-3.5 w-3.5" />
            全部存入个人库
          </Button>
        </div>
      </div>
    </Teleport>

    <LibraryAssetPickerDialog
      v-model:open="libraryPickerOpen"
      :categories="libraryPickerCategories"
      :targets="libraryPickerTargets"
      :allow-create="assetTab !== 'environments'"
      @select="actions.importLibraryAsset({ ...$event, tab: assetTab })"
    />

    <!-- Asset type tabs (underline style) -->
    <div class="shrink-0 border-b">
      <div class="flex gap-0">
        <Button
          v-for="tab in tabs"
          data-asset-tab
          :key="tab.key"
          type="button"
          variant="ghost"
          class="relative h-auto rounded-none px-4 py-2 text-sm font-medium transition-colors"
          :class="assetTab === tab.key
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground/80'"
          @click="selectAssetTab(tab.key)"
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
    <div class="min-h-0 flex-1 overflow-y-auto pr-1" @click.capture="trackAssetInteraction" @pointerover.capture="trackAssetInteraction">
      <AssetWorkbenchCharacterAssetsTab
        v-if="assetTab === 'characters'"
        :characters="characters"
        :saving-library-asset-key="savingLibraryAssetKey"
        @save-to-library="actions.saveAssetToLibrary({ tab: 'characters', targetId: $event })"
        :auto-running="autoRunning"
        :editing-character-id="editingCharacterId"
        :character-edit-draft="characterEditDraft"
        :uploading-character-id="uploadingCharacterId"
        :uploading-ark-character-id="uploadingArkCharacterId"
        :uploading-character-voice-id="uploadingCharacterVoiceId"
        :get-character-scene-count="getCharacterSceneCount"
        :set-character-edit-draft="setCharacterEditDraft"
        @preview-image="actions.previewImage($event)"
        @start-edit="actions.startCharacterEdit($event)"
        @remove-character="actions.removeCharacter($event)"
        @add-variant="actions.addCharacterVariant($event)"
        @remove-variant="actions.removeCharacterVariant($event)"
        @cancel-edit="actions.cancelCharacterEdit()"
        @save-edit="actions.saveCharacterEdit()"
        @save-edit-regenerate="actions.saveCharacterEditRegenerate()"
        @generate="actions.generateCharacter($event)"
        @open-regenerate="actions.openCharacterRegenerate($event)"
        @open-history="actions.openCharacterHistory($event)"
        @upload-image="actions.uploadCharacterImage($event)"
        @ingest-ark-asset="actions.ingestCharacterArkAsset($event)"
        @select-ark-asset="actions.selectCharacterArkAsset($event)"
        @upload-voice="actions.uploadCharacterVoice($event)"
        @update-voice-lock="actions.updateCharacterVoiceLock($event)"
      />

      <AssetWorkbenchEnvironmentAssetsTab
        v-else-if="assetTab === 'environments'"
        :environment-asset-cards="environmentAssetCards"
        :saving-library-asset-key="savingLibraryAssetKey"
        @save-to-library="actions.saveAssetToLibrary({ tab: 'environments', targetId: $event })"
        :auto-running="autoRunning"
        :uploading-environment-asset-id="uploadingEnvironmentAssetId"
        :get-environment-scene-summary="getEnvironmentSceneSummary"
        :get-environment-mother-candidates="getEnvironmentMotherCandidates"
        :get-environment-selected-mother-id="getEnvironmentSelectedMotherId"
        :has-environment-representative-scene="hasEnvironmentRepresentativeScene"
        @go-videos="actions.selectStage('videos')"
        @preview-image="actions.previewImage($event)"
        @edit-scene="actions.editEnvironmentScene($event)"
        @upload-image="actions.uploadEnvironmentImage($event)"
        @open-crop="actions.openEnvironmentCrop($event)"
        @open-regenerate="actions.openEnvironmentRegenerate($event)"
        @open-history="actions.openEnvironmentHistory($event)"
        @regenerate="actions.regenerateEnvironment($event)"
        @update-mother="actions.updateEnvironmentMother($event)"
      />

      <AssetWorkbenchPropAssetsTab
        v-else-if="assetTab === 'props'"
        :prop-assets="propAssetsOfType"
        :saving-library-asset-key="savingLibraryAssetKey"
        @save-to-library="actions.saveAssetToLibrary({ tab: 'props', targetId: $event })"
        :auto-running="autoRunning"
        :uploading-prop-id="uploadingPropId"
        :generating-prop-id="generatingPropId"
        :get-prop-usage-count="getPropUsageCount"
        add-category="prop"
        asset-label="道具"
        @add-prop="actions.addProp($event)"
        @remove-prop="actions.removeProp($event)"
        @generate-prop="actions.generateProp($event)"
        @upload-image="actions.uploadPropImage($event)"
        @open-history="actions.openPropHistory($event)"
        @preview-image="actions.previewImage($event)"
      />

      <AssetWorkbenchPropAssetsTab
        v-else
        :prop-assets="otherAssetsOfType"
        :saving-library-asset-key="savingLibraryAssetKey"
        @save-to-library="actions.saveAssetToLibrary({ tab: 'others', targetId: $event })"
        :auto-running="autoRunning"
        :uploading-prop-id="uploadingPropId"
        :uploading-prop-voice-id="uploadingPropVoiceId"
        :uploading-prop-video-id="uploadingPropVideoId"
        :video-reference-supported="videoReferenceSupported ?? null"
        :generating-prop-id="generatingPropId"
        :get-prop-usage-count="getPropUsageCount"
        :allow-voice-upload="true"
        :enable-media-sub-tabs="true"
        add-category="other"
        asset-label="其他素材"
        empty-title="暂无其他素材"
        empty-description="可新增图片、声音或视频素材，用于场景改写和分镜视频参考。"
        @add-prop="actions.addProp($event)"
        @remove-prop="actions.removeProp($event)"
        @generate-prop="actions.generateProp($event)"
        @upload-image="actions.uploadPropImage($event)"
        @upload-voice="actions.uploadPropVoice($event)"
        @upload-video="actions.uploadPropVideo($event)"
        @update-voice-lock="actions.updatePropVoiceLock($event)"
        @open-history="actions.openPropHistory($event)"
        @preview-image="actions.previewImage($event)"
      />
    </div>
  </div>
</template>

import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import {
  createInitialAssetWorkbenchParseProgressState,
  useAssetWorkbenchGeneration
} from '~/composables/useAssetWorkbenchGeneration'
import { useAssetWorkbenchSceneEditing } from '~/composables/useAssetWorkbenchSceneEditing'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'

export type {
  AssetWorkbenchTransitionType,
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'

export function useAssetWorkbench() {
  const route = useRoute()
  const router = useRouter()
  const {
    notifyGenerationCompleted,
    notifyGenerationFailed,
    loadCompletionNotificationOptions
  } = useGenerationCompletionNotification()
  const { resolveStyleById, loadStylePresets } = useStylePresets()
  void loadStylePresets()

  onMounted(() => {
    void loadCompletionNotificationOptions()
  })

  const projectId = computed(() => {
    const value = route.query.project
    return typeof value === 'string' && value.length > 0 ? value : undefined
  })

  const projectName = ref('新项目')
  const projectDescription = ref('')
  const projectStyleId = ref('')
  const projectAspectRatio = ref<'16:9' | '9:16' | '1:1'>('16:9')
  const projectAssetWorkflow = ref<unknown | null>(null)
  const scriptParseMode = ref<ScriptParseMode>(DEFAULT_SCRIPT_PARSE_MODE)
  const selectedStyleId = ref('')
  const novelText = ref('')

  const scenes = ref<SceneData[]>([])
  const characters = ref<CharacterData[]>([])
  const episodePlan = ref<ScriptEpisodePlanItem[]>([])

  const parsing = ref(false)
  const parseProgress = ref(createInitialAssetWorkbenchParseProgressState())

  const {
    loading,
    saving,
    saveError,
    saveProject,
    loadProject,
    refreshCharacterVoiceAssets,
    mergeAllVideos,
    mergeStatus,
    finalVideo,
    resolveProjectStatus
  } = useAssetWorkbenchProjectIO({
    route,
    router,
    projectId,
    projectName,
    projectDescription,
    projectStyleId,
    projectAspectRatio,
    projectAssetWorkflow,
    scriptParseMode,
    selectedStyleId,
    novelText,
    scenes,
    characters,
    episodePlan
  })

  const currentStylePrompt = computed(() => {
    const styleId = selectedStyleId.value || projectStyleId.value
    if (!styleId) return ''

    const style = resolveStyleById(styleId)
    if (!style) return `${styleId} style`

    return `${style.name}, ${style.prompt} style`
  })

  const {
    deleteScene,
    updateScene,
    mergeWithNextScene,
    splitScene
  } = useAssetWorkbenchSceneEditing({
    scenes,
    saveProject
  })

  const {
    prepareEpisodePlan,
    parseScript,
    generateCharacter,
    batchGenerateCharacters
  } = useAssetWorkbenchGeneration({
    projectName,
    novelText,
    scenes,
    characters,
    scriptParseMode,
    episodePlan,
    parsing,
    parseProgress,
    currentStylePrompt,
    saveProject,
    onModelTaskCompleted: notifyGenerationCompleted,
    onModelTaskFailed: notifyGenerationFailed
  })

  return {
    projectId,
    projectName,
    projectDescription,
    projectStyleId,
    projectAspectRatio,
    projectAssetWorkflow,
    scriptParseMode,
    selectedStyleId,
    novelText,
    scenes,
    characters,
    episodePlan,
    parsing,
    parseProgress,
    loading,
    saving,
    saveError,
    saveProject,
    loadProject,
    refreshCharacterVoiceAssets,
    deleteScene,
    mergeWithNextScene,
    prepareEpisodePlan,
    parseScript,
    splitScene,
    updateScene,
    generateCharacter,
    batchGenerateCharacters,
    mergeAllVideos,
    mergeStatus,
    finalVideo,
    resolveProjectStatus
  }
}

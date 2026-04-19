import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import { useAssetWorkbenchGeneration } from '~/composables/useAssetWorkbenchGeneration'
import { useAssetWorkbenchSceneEditing } from '~/composables/useAssetWorkbenchSceneEditing'

export type {
  AssetWorkbenchTransitionType,
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'

export function useAssetWorkbench() {
  const route = useRoute()
  const router = useRouter()
  const { notifyGenerationCompleted, loadCompletionNotificationOptions } = useGenerationCompletionNotification()
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
  const selectedStyleId = ref('')
  const novelText = ref('')

  const scenes = ref<SceneData[]>([])
  const characters = ref<CharacterData[]>([])

  const parsing = ref(false)
  const parsedTimelineText = ref('')

  const {
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
    selectedStyleId,
    novelText,
    scenes,
    characters,
    parsedTimelineText
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
    parseScript,
    generateCharacter,
    batchGenerateCharacters
  } = useAssetWorkbenchGeneration({
    projectName,
    novelText,
    scenes,
    characters,
    parsing,
    parsedTimelineText,
    currentStylePrompt,
    saveProject,
    onModelTaskCompleted: notifyGenerationCompleted
  })

  return {
    projectId,
    projectName,
    projectDescription,
    projectStyleId,
    projectAspectRatio,
    projectAssetWorkflow,
    selectedStyleId,
    novelText,
    scenes,
    characters,
    parsing,
    parsedTimelineText,
    saveError,
    saveProject,
    loadProject,
    refreshCharacterVoiceAssets,
    deleteScene,
    mergeWithNextScene,
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

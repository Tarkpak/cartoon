import type { ComputedRef, Ref } from 'vue'
import type { CharacterView, CharacterVoiceAsset } from '#shared/types/character'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { FinalMergeOptions, FinalVideoAsset } from '~/lib/asset-workbench-types'
import {
  applyScopedEntityIds,
  buildLoadedCharacters,
  buildLoadedScenes,
  buildSaveCharactersPayload,
  buildSaveScenesPayload
} from '~/lib/asset-workbench-project-serialization'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

interface UseAssetWorkbenchProjectIOOptions {
  route: ReturnType<typeof useRoute>
  router: ReturnType<typeof useRouter>
  projectId: ComputedRef<string | undefined>
  projectName: Ref<string>
  projectDescription: Ref<string>
  projectStyleId: Ref<string>
  projectAspectRatio: Ref<'16:9' | '9:16' | '1:1'>
  projectAssetWorkflow: Ref<unknown | null>
  scriptParseMode: Ref<ScriptParseMode>
  selectedStyleId: Ref<string>
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
}

export function useAssetWorkbenchProjectIO(options: UseAssetWorkbenchProjectIOOptions) {
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const loading = ref(false)
  const mergeStatus = ref<{
    running: boolean
    progress: number
    error?: string
  }>({
    running: false,
    progress: 0
  })
  const finalVideo = ref<FinalVideoAsset | null>(null)

  function resolveProjectStatus(): 'draft' | 'in_progress' | 'completed' {
    if (finalVideo.value?.videoUrl) {
      return 'completed'
    }

    if (
      options.novelText.value.trim()
      || options.scenes.value.length > 0
      || options.characters.value.length > 0
    ) {
      return 'in_progress'
    }

    return 'draft'
  }

  async function mergeAllVideos(input?: FinalMergeOptions) {
    const readyScenes = options.scenes.value.filter(scene => scene.videoStatus === 'done' && scene.videoUrl)
    if (readyScenes.length === 0) {
      alert('没有可合成的视频（请先生成分镜视频）')
      return null
    }

    const orderedReadyScenes = (() => {
      const order = Array.isArray(input?.sceneOrder) ? input.sceneOrder : []
      if (order.length === 0) return readyScenes

      const readyMap = new Map(readyScenes.map(scene => [scene.id, scene] as const))
      const ordered: typeof readyScenes = []
      const consumed = new Set<string>()

      for (const sceneId of order) {
        const scene = readyMap.get(sceneId)
        if (!scene || consumed.has(sceneId)) continue
        ordered.push(scene)
        consumed.add(sceneId)
      }

      for (const scene of readyScenes) {
        if (consumed.has(scene.id)) continue
        ordered.push(scene)
      }

      return ordered
    })()

    const pendingScenes = options.scenes.value.filter(scene => !(scene.videoStatus === 'done' && scene.videoUrl))
    if (pendingScenes.length > 0) {
      const previewTitles = pendingScenes
        .slice(0, 3)
        .map(scene => scene.title)
        .join('、')
      const hasMore = pendingScenes.length > 3 ? ' 等' : ''

      const shouldContinue = confirm(
        `当前仅 ${readyScenes.length}/${options.scenes.value.length} 个分镜视频可用。\n`
        + `未就绪场景：${previewTitles}${hasMore}。\n\n`
        + '继续合成将导致最终视频缺少部分剧情，是否继续？'
      )

      if (!shouldContinue) {
        return null
      }
    }

    mergeStatus.value = { running: true, progress: 10 }
    finalVideo.value = null

    try {
      mergeStatus.value.progress = 30

      const transitionType = input?.transitionType || 'none'
      const transitionDuration = Math.max(0.1, Math.min(2, Number(input?.transitionDuration) || 0.5))
      const addSubtitles = input?.addSubtitles === true
      const bgmUrl = (input?.bgmUrl || '').trim()
      const bgmVolume = Math.max(0, Math.min(1, Number(input?.bgmVolume) || 0.3))

      const response = await $fetch<{
        success: boolean
        data?: {
          videoUrl: string
          duration: number
          size: number
          sceneCount: number
        }
        error?: string
      }>('/api/video/merge', {
        method: 'POST',
        body: {
          projectId: options.projectId.value,
          scenes: orderedReadyScenes.map(scene => ({
            id: scene.id,
            title: scene.title,
            videoUrl: scene.videoUrl,
            duration: scene.duration,
            dialogues: scene.dialogues
          })),
          options: {
            transition: {
              type: transitionType,
              duration: transitionDuration
            },
            addSubtitles,
            bgm: bgmUrl
              ? {
                  url: bgmUrl,
                  volume: bgmVolume
                }
              : undefined
          }
        }
      })

      mergeStatus.value.progress = 90

      if (!response.success || !response.data) {
        throw new Error(response.error || '合成失败')
      }

      finalVideo.value = {
        videoUrl: response.data.videoUrl,
        duration: response.data.duration,
        size: response.data.size,
        updatedAt: new Date().toISOString()
      }
      mergeStatus.value.progress = 100
      return response.data
    } catch (error) {
      console.error('[useAssetWorkbenchProjectIO] 视频合成失败:', error)
      mergeStatus.value.error = error instanceof Error ? error.message : '合成失败'
      return null
    } finally {
      mergeStatus.value.running = false
    }
  }

  async function loadProject(id: string) {
    loading.value = true
    mergeStatus.value = { running: false, progress: 0 }
    finalVideo.value = null

    try {
      const response = await $fetch<{
        success: boolean
        data?: {
          project: {
            name: string
            description?: string | null
            scriptParseMode?: ScriptParseMode
            styleId: string
            aspectRatio: '16:9' | '9:16' | '1:1'
          }
          script?: {
            novelText?: string
            rawText?: string
            selectedStyleId?: string
            scriptParseMode?: ScriptParseMode
            episodePlan?: ScriptEpisodePlanItem[]
            assetWorkflow?: unknown
          } | null
          scenes: Array<{
            id: string
            episodeId?: string | null
            episodeTitle?: string | null
            episodeIndex?: number | null
            title?: string | null
            description: string
            setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string } | null
            characters?: Array<{ name: string, appearance?: string, emotion?: string }>
            dialogues?: Array<{ character: string, text: string, emotion?: string }>
            narration?: string | null
            duration: number
            firstFrame?: string | null
            lastFrame?: string | null
            videoUrl?: string | null
            shotType?: SceneData['shotType'] | null
            cameraMovement?: SceneData['cameraMovement'] | null
            cameraNote?: string | null
            transitionIn?: SceneData['transitionIn'] | null
            transitionOut?: SceneData['transitionOut'] | null
            transitionDuration?: number | null
          }>
          characters: Array<{
            id: string
            name: string
            role?: string | null
            appearance: string
            personality?: string | null
            traits?: string[] | null
            background?: string | null
            motivation?: string | null
            speakingStyle?: string | null
            catchphrase?: string | null
            voiceTone?: string | null
            voiceAsset?: CharacterVoiceAsset | null
            age?: number | null
            gender?: string | null
            imageUrl?: string | null
            baseImage?: string | null
            expressions?: Record<string, string> | null
            views?: Partial<Record<CharacterView, string>> | null
          }>
        }
      }>(`/api/project/${id}`)

      if (!response.success || !response.data) return

      options.projectName.value = response.data.project.name
      options.projectDescription.value = response.data.project.description || ''
      options.projectStyleId.value = response.data.project.styleId || ''
      options.projectAspectRatio.value = response.data.project.aspectRatio || '16:9'
      options.selectedStyleId.value = response.data.script?.selectedStyleId || response.data.project.styleId || ''
      options.novelText.value = response.data.script?.novelText || response.data.script?.rawText || ''
      options.scriptParseMode.value = response.data.project.scriptParseMode || response.data.script?.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE
      options.episodePlan.value = response.data.script?.episodePlan || []
      options.projectAssetWorkflow.value = response.data.script?.assetWorkflow ?? null

      options.scenes.value = buildLoadedScenes(response.data.scenes)
      options.characters.value = buildLoadedCharacters(response.data.characters)
    } catch (error) {
      console.error('[useAssetWorkbenchProjectIO] 加载项目失败:', error)
    } finally {
      loading.value = false
    }
  }

  async function saveProject() {
    saving.value = true
    saveError.value = null

    try {
      if (finalVideo.value) {
        finalVideo.value = null
      }

      let id = options.projectId.value

      if (!id) {
        if (!options.projectStyleId.value) {
          throw new Error('请先选择画风预设')
        }

        const createResponse = await $fetch<{
          success: boolean
          project?: { id: string }
        }>('/api/project/create', {
          method: 'POST',
          body: {
            title: options.projectName.value || '未命名项目',
            description: options.projectDescription.value,
            workflowType: 'asset_consistency',
            scriptParseMode: options.scriptParseMode.value,
            styleId: options.projectStyleId.value,
            aspectRatio: options.projectAspectRatio.value
          }
        })

        if (!createResponse.success || !createResponse.project?.id) {
          throw new Error('创建项目失败')
        }

        id = createResponse.project.id
        await options.router.replace({ query: { ...options.route.query, project: id } })
      }

      if (!id) {
        throw new Error('缺少项目ID')
      }

      applyScopedEntityIds(id, options.scenes.value, options.characters.value)

      await $fetch(`/api/project/${id}`, {
        method: 'PUT',
        body: {
          name: options.projectName.value,
          description: options.projectDescription.value,
          status: resolveProjectStatus(),
          styleId: options.projectStyleId.value,
          aspectRatio: options.projectAspectRatio.value,
          novelText: options.novelText.value,
          selectedStyleId: options.selectedStyleId.value || options.projectStyleId.value,
          scriptParseMode: options.scriptParseMode.value,
          episodePlan: options.episodePlan.value,
          scenes: buildSaveScenesPayload(options.scenes.value),
          characters: buildSaveCharactersPayload(options.characters.value)
        }
      })
      return true
    } catch (error) {
      const message = getDisplayErrorMessage(error, '未知错误')
      if (/413|payload too large|request entity too large/i.test(message)) {
        saveError.value = '图片数据过大，项目未完整保存。请增大反向代理请求体限制（例如 Nginx client_max_body_size 50m）后重试。'
      } else {
        saveError.value = message
      }
      console.error('[useAssetWorkbenchProjectIO] 保存项目失败:', error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function refreshCharacterVoiceAssets(input: {
    attempts?: number
    delayMs?: number
  } = {}) {
    const id = options.projectId.value
    if (!id || options.characters.value.length === 0) return

    const attempts = Math.max(1, input.attempts ?? 1)
    const delayMs = Math.max(200, input.delayMs ?? 1000)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      try {
        const response = await $fetch<{
          success: boolean
          data?: {
            characters: Array<{
              id: string
              voiceAsset?: CharacterVoiceAsset | null
            }>
          }
        }>(`/api/project/${id}`)

        if (!response.success || !response.data?.characters) return

        const incoming = new Map(response.data.characters.map(item => [item.id, item.voiceAsset || undefined]))
        let changed = false

        for (const character of options.characters.value) {
          const nextVoiceAsset = incoming.get(character.id)
          const currentSerialized = JSON.stringify(character.voiceAsset || null)
          const nextSerialized = JSON.stringify(nextVoiceAsset || null)
          if (currentSerialized === nextSerialized) continue

          character.voiceAsset = nextVoiceAsset
          changed = true
        }

        if (changed) return
      } catch (error) {
        console.warn('[useAssetWorkbenchProjectIO] 刷新角色音频资产失败:', error)
        return
      }
    }
  }

  return {
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
  }
}

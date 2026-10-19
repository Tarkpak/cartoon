import { patchWorkbenchFields } from '~/lib/workbench-collaboration'
import { parseCollaborationAssetResult } from '~/lib/project-collaboration-assets'
import type { CollaborationBody } from '#shared/types/project-collaboration'
import { useWorkbenchCollaborationSession } from './useWorkbenchCollaborationSession'
import { ref, watch, onBeforeUnmount, getCurrentInstance, type ComputedRef, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { CharacterView, CharacterVoiceAsset } from '#shared/types/character'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { FinalMergeOptions, FinalVideoAsset } from '~/lib/asset-workbench-types'
import { projectAccessCan, type ProjectAccess } from '#shared/types/project'
import {
  applyScopedEntityIds,
  buildLoadedCharacters,
  buildLoadedScenes,
  buildSaveCharactersPayload,
  buildSaveScenesPayload
} from '~/lib/asset-workbench-project-serialization'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
import {
  createEmptyScriptWritingStudio,
  normalizeScriptWritingStudio,
  type ScriptWritingStudio
} from '#shared/types/script-writing'

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
  writingStudio?: Ref<ScriptWritingStudio>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
}

interface ProjectCloudSyncResult {
  status?: string
  message?: string
  reason?: string
}

const CLOUD_SYNC_REASON_TEXT: Record<string, string> = {
  stale_local_update: '云端已有更新版本，已保留云端数据',
  cloud_not_configured: '未配置云端地址',
  cloud_not_authenticated: '未登录云端账号',
  unknown: '云端返回跳过同步，但未说明原因'
}

function resolveCloudSyncWarning(cloudSync?: ProjectCloudSyncResult): string | null {
  if (cloudSync?.status !== 'error') return null

  const rawMessage = (cloudSync.message || cloudSync.reason || '').trim()
  const normalized = rawMessage
    .replace(/^云端项目同步被跳过:\s*/u, '')
    .trim()
  const message = CLOUD_SYNC_REASON_TEXT[normalized] || rawMessage || '云端返回异常，请稍后重试'
  return `本地已保存，云端同步未完成：${message}`
}

export function useAssetWorkbenchProjectIO(options: UseAssetWorkbenchProjectIOOptions) {
  const writingStudio = options.writingStudio || ref(createEmptyScriptWritingStudio())
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const saveWarning = ref<string | null>(null)
  const loading = ref(false)
  const projectAccess = ref<ProjectAccess | null>(null)
  const collaboration = useWorkbenchCollaborationSession(() => saveProject(), {
    draft: () => !loading.value && lastSavedProjectSnapshot !== null ? { before: lastSavedWorkbenchBody, after: JSON.parse(JSON.stringify(buildProjectSaveBody())) } : undefined,
    apply: (baseline, current) => {
      const normalizedBaseline = normalizeCollaborationSnapshot(baseline)
      const normalizedCurrent = normalizeCollaborationSnapshot(current)
      lastSavedWorkbenchBody = JSON.parse(JSON.stringify(normalizedBaseline))
      lastSavedProjectSnapshot = buildProjectSaveSnapshot(activeProjectId.value, normalizedBaseline)
      applyCollaborationBody(normalizedCurrent)
    }
  })
  const { editSession, projectEditable, acquiring: acquiringEditSession, openEditSession, releaseEditSession } = collaboration
  let lastSavedWorkbenchBody: Record<string, unknown> = {}


  const activeProjectId = ref(options.projectId.value || '')
  let lastSavedProjectSnapshot: string | null = null
  let saveQueue: Promise<void> = Promise.resolve()
  let loadRequestSequence = 0
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

  function buildProjectSaveBody(input?: {
    scenes?: SceneData[]
    characters?: CharacterData[]
  }) {
    return {
      name: options.projectName.value,
      description: options.projectDescription.value,
      status: resolveProjectStatus(),
      styleId: options.projectStyleId.value,
      aspectRatio: options.projectAspectRatio.value,
      novelText: options.novelText.value,
      writingStudio: writingStudio.value,
      selectedStyleId: options.selectedStyleId.value || options.projectStyleId.value,
      scriptParseMode: options.scriptParseMode.value,
      episodePlan: options.episodePlan.value,
      assetWorkflow: options.projectAssetWorkflow.value,
      scenes: buildSaveScenesPayload(input?.scenes || options.scenes.value).map((scene, index) => editSession.value.collaboration
        ? { ...scene, videoHistory: (input?.scenes || options.scenes.value)[index]?.videoHistory?.length
          ? (input?.scenes || options.scenes.value)[index]?.videoHistory
          : undefined }
        : scene),
      characters: buildSaveCharactersPayload(input?.characters || options.characters.value)
    }
  }

  function normalizeCollaborationSnapshot(snapshot: CollaborationBody): ReturnType<typeof buildProjectSaveBody> {
    const project = snapshot.project as Record<string, any>
    const script = (snapshot.script || {}) as Record<string, any>
    const scenes = buildLoadedScenes(snapshot.scenes as Parameters<typeof buildLoadedScenes>[0])
    return {
      name: project.name, description: project.description || '', status: resolveProjectStatus(),
      styleId: project.styleId || '', aspectRatio: project.aspectRatio || '16:9',
      novelText: script.novelText || script.rawText || '',
      writingStudio: normalizeScriptWritingStudio(script.writingStudio),
      selectedStyleId: script.selectedStyleId || project.styleId || '',
      scriptParseMode: project.scriptParseMode || script.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
      episodePlan: script.episodePlan || [], assetWorkflow: script.assetWorkflow ?? null,
      scenes: buildSaveScenesPayload(scenes).map((scene, index) => ({ ...scene, videoHistory: scenes[index]?.videoHistory?.length ? scenes[index]?.videoHistory : undefined })),
      characters: buildSaveCharactersPayload(buildLoadedCharacters(snapshot.characters as Parameters<typeof buildLoadedCharacters>[0]))
    }
  }

  function applyCollaborationBody(body: ReturnType<typeof buildProjectSaveBody>) {
    const current = buildProjectSaveBody()
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    options.projectName.value = body.name
    options.projectDescription.value = body.description
    options.projectStyleId.value = body.styleId
    options.projectAspectRatio.value = body.aspectRatio
    options.selectedStyleId.value = body.selectedStyleId
    options.novelText.value = body.novelText
    if (!equal(current.writingStudio, body.writingStudio)) writingStudio.value = body.writingStudio
    options.scriptParseMode.value = body.scriptParseMode
    if (!equal(current.episodePlan, body.episodePlan)) options.episodePlan.value = body.episodePlan
    if (!equal(current.assetWorkflow, body.assetWorkflow)) options.projectAssetWorkflow.value = body.assetWorkflow
    const currentScenes = new Map(current.scenes.map((scene, i) => [scene.id, { data: scene, view: options.scenes.value[i]! }]))
    if (!equal(current.scenes, body.scenes)) options.scenes.value = buildLoadedScenes(body.scenes).map(scene => {
      const previous = currentScenes.get(scene.id)
      const incoming = body.scenes.find(item => item.id === scene.id)
      if (previous && equal(previous.data, incoming)) return previous.view
      return { ...scene, active: previous?.view.active ?? false }
    })
    const currentCharacters = new Map(current.characters.map((character, i) => [character.id, { data: character, view: options.characters.value[i]! }]))
    if (!equal(current.characters, body.characters)) options.characters.value = buildLoadedCharacters(body.characters).map(character => {
      const previous = currentCharacters.get(character.id)
      return previous && equal(previous.data, body.characters.find(item => item.id === character.id)) ? previous.view : character
    })
  }

  function acknowledgeWorkflowNormalization(raw: unknown, normalized: unknown) {
    if (!editSession.value.collaboration || lastSavedProjectSnapshot === null) return
    // Hydration defaults are a read transformation, not edits to every episode.
    lastSavedWorkbenchBody.assetWorkflow = patchWorkbenchFields(lastSavedWorkbenchBody.assetWorkflow, raw, normalized)
    const id = activeProjectId.value || options.projectId.value
    if (id) lastSavedProjectSnapshot = buildProjectSaveSnapshot(id, lastSavedWorkbenchBody as ReturnType<typeof buildProjectSaveBody>)
  }

  function buildProjectSaveSnapshot(projectId: string, body: ReturnType<typeof buildProjectSaveBody>): string {
    return JSON.stringify({
      projectId,
      ...body
    })
  }

  function buildNormalizedProjectSaveSnapshot(projectId: string): string {
    const scopedScenes = options.scenes.value.map(scene => ({ ...scene }))
    const scopedCharacters = options.characters.value.map(character => ({ ...character }))
    if (!editSession.value.collaboration) applyScopedEntityIds(projectId, scopedScenes, scopedCharacters)

    const body = buildProjectSaveBody({
      scenes: scopedScenes,
      characters: scopedCharacters
    })

    return buildProjectSaveSnapshot(projectId, body)
  }

  async function mergeAllVideos(input?: FinalMergeOptions) {
    const { toast } = useToast()
    const { confirm } = useConfirm()
    const readyScenes = options.scenes.value.filter(scene => scene.videoStatus === 'done' && scene.videoUrl)
    if (readyScenes.length === 0) {
      toast.warning('没有可合成的视频', { description: '请先生成分镜视频。' })
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

      const shouldContinue = await confirm({
        title: '部分场景尚未就绪',
        description: `当前仅 ${readyScenes.length}/${options.scenes.value.length} 个分镜视频可用。未就绪场景：${previewTitles}${hasMore}。继续合成将导致最终视频缺少部分剧情，是否继续？`,
        confirmText: '继续合成'
      })

      if (!shouldContinue) {
        return null
      }
    }

    mergeStatus.value = { running: true, progress: 10 }
    finalVideo.value = null
    projectAccess.value = null

    try {
      mergeStatus.value.progress = 30

      const transitionType = input?.transitionType || 'none'
      const transitionDuration = Math.max(0.1, Math.min(2, Number(input?.transitionDuration) || 0.5))
      const addSubtitles = input?.addSubtitles === true
      const bgmUrl = (input?.bgmUrl || '').trim()
      const bgmVolume = Math.max(0, Math.min(1, Number(input?.bgmVolume) || 0.3))
      const audioTracks = Array.isArray(input?.audioTracks) ? input.audioTracks : []
      const selectedBgm = audioTracks.find(track => track.kind === 'bgm' && track.url.trim())
      const soundEffects = audioTracks
        .filter(track => track.kind === 'sfx' && track.url.trim())
        .map((track) => {
          const volume = Number(track.volume)
          return {
            id: track.id,
            url: track.url.trim(),
            startTime: Math.max(0, Number(track.startTime) || 0),
            duration: Number.isFinite(Number(track.duration)) ? Math.max(0.1, Number(track.duration)) : undefined,
            volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6
          }
        })

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
            description: scene.description,
            videoUrl: scene.videoUrl,
            duration: scene.duration
          })),
          options: {
            transition: {
              type: transitionType,
              duration: transitionDuration
            },
            addSubtitles,
            bgm: selectedBgm?.url || bgmUrl
              ? {
                  url: selectedBgm?.url || bgmUrl,
                  volume: selectedBgm && Number.isFinite(Number(selectedBgm.volume))
                    ? Math.max(0, Math.min(1, Number(selectedBgm.volume)))
                    : bgmVolume
                }
              : undefined,
            soundEffects
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

  async function loadProject(id: string, skipLease = false) {
    const requestSequence = ++loadRequestSequence
    loading.value = true
    if (!skipLease) await openEditSession(id)
    if (requestSequence !== loadRequestSequence) return
    activeProjectId.value = id
    lastSavedProjectSnapshot = null
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
            writingStudio?: unknown
          } | null
          scenes: Array<{
            id: string
            episodeId?: string | null
            episodeTitle?: string | null
            episodeIndex?: number | null
            title?: string | null
            description: string
            setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string } | null
            characters?: Array<{ name: string, assetId?: string, appearance?: string, emotion?: string }>
            narration?: string | null
            duration: number
            firstFrame?: string | null
            lastFrame?: string | null
            videoUrl?: string | null
            shotType?: SceneData['shotType'] | null
            cameraAngle?: SceneData['cameraAngle'] | null
            cameraMovement?: SceneData['cameraMovement'] | null
            speedEffect?: SceneData['speedEffect'] | null
            cameraNote?: string | null
            transitionIn?: SceneData['transitionIn'] | null
            transitionOut?: SceneData['transitionOut'] | null
            transitionDuration?: number | null
          }>
          characters: Array<{
            id: string
            parentCharacterId?: string | null
            variantName?: string | null
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
            arkAsset?: CharacterData['arkAsset'] | null
            age?: number | null
            gender?: string | null
            imageUrl?: string | null
            baseImage?: string | null
            expressions?: Record<string, string> | null
            views?: Partial<Record<CharacterView, string>> | null
          }>
          access?: ProjectAccess
        }
      }>(`/api/project/${id}`)

      if (requestSequence !== loadRequestSequence) return
      if (!response.success || !response.data) return

      if ((collaboration.ready?.value ?? projectEditable.value) && editSession.value.collaboration) {
        response.data = { ...collaboration.snapshot(), access: response.data.access } as typeof response.data
      }

      options.projectName.value = response.data.project.name
      options.projectDescription.value = response.data.project.description || ''
      options.projectStyleId.value = response.data.project.styleId || ''
      options.projectAspectRatio.value = response.data.project.aspectRatio || '16:9'
      options.selectedStyleId.value = response.data.script?.selectedStyleId || response.data.project.styleId || ''
      options.novelText.value = response.data.script?.novelText || response.data.script?.rawText || ''
      writingStudio.value = normalizeScriptWritingStudio(response.data.script?.writingStudio)
      options.scriptParseMode.value = response.data.project.scriptParseMode || response.data.script?.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE
      options.episodePlan.value = response.data.script?.episodePlan || []
      options.projectAssetWorkflow.value = response.data.script?.assetWorkflow ?? null

      options.scenes.value = buildLoadedScenes(response.data.scenes)
      options.characters.value = buildLoadedCharacters(response.data.characters)
      projectAccess.value = response.data.access || null
      lastSavedProjectSnapshot = buildNormalizedProjectSaveSnapshot(id)
      lastSavedWorkbenchBody = collaboration.restoredBaseline?.() ?? JSON.parse(JSON.stringify(buildProjectSaveBody()))
      if (collaboration.restoredBaseline?.()) lastSavedProjectSnapshot = buildProjectSaveSnapshot(id, lastSavedWorkbenchBody as ReturnType<typeof buildProjectSaveBody>)
    } catch (error) {
      if (requestSequence !== loadRequestSequence) return
      saveError.value = getDisplayErrorMessage(error, '协作项目加载失败')
      console.error('[useAssetWorkbenchProjectIO] 加载项目失败:', error)
    } finally {
      if (requestSequence === loadRequestSequence) {
        loading.value = false
      }
    }
  }

  async function performSaveProject(expectedProjectId?: string) {
    if ((activeProjectId.value || options.projectId.value) && !projectEditable.value) {
      const id = activeProjectId.value || options.projectId.value
      if (id && lastSavedProjectSnapshot === buildNormalizedProjectSaveSnapshot(id)) return true
      saveError.value = '当前没有项目编辑权，未同步修改已保留，请重新取得编辑权。'
      return false
    }
    if (projectAccess.value && !projectAccessCan(projectAccess.value, 'edit')) {
      const id = activeProjectId.value || options.projectId.value
      if (id && lastSavedProjectSnapshot === buildNormalizedProjectSaveSnapshot(id)) return true
      saveError.value = '当前账号只有查看权限，不能保存修改。'
      return false
    }
    saving.value = true
    saveError.value = null
    saveWarning.value = null

    try {
      if (finalVideo.value) {
        finalVideo.value = null
      }

      let id = activeProjectId.value || options.projectId.value

      if (expectedProjectId && id !== expectedProjectId) {
        return false
      }

      if (expectedProjectId) {
        id = expectedProjectId
      }

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
            projectType: 'script_writing',
            scriptParseMode: options.scriptParseMode.value,
            styleId: options.projectStyleId.value,
            aspectRatio: options.projectAspectRatio.value
          }
        })

        if (!createResponse.success || !createResponse.project?.id) {
          throw new Error('创建项目失败')
        }

        id = createResponse.project.id
        activeProjectId.value = id
        await openEditSession(id)
        if (!projectEditable.value) throw new Error(editSession.value.reason || '未取得项目编辑权')
        await options.router.replace({ query: { ...options.route.query, project: id } })
      }

      if (!id) {
        throw new Error('缺少项目ID')
      }

      if (!editSession.value.collaboration) applyScopedEntityIds(id, options.scenes.value, options.characters.value)
      const saveBody = buildProjectSaveBody()
      const nextSnapshot = buildProjectSaveSnapshot(id, saveBody)
      if (nextSnapshot === lastSavedProjectSnapshot) {
        return true
      }

      if (editSession.value.collaboration) {
        await collaboration.saveSnapshot(lastSavedWorkbenchBody, JSON.parse(JSON.stringify(saveBody)))
        if ((activeProjectId.value || options.projectId.value) === id) {
          lastSavedWorkbenchBody = JSON.parse(JSON.stringify(saveBody))
          lastSavedProjectSnapshot = nextSnapshot
          collaboration.stashDraft?.(lastSavedWorkbenchBody, JSON.parse(JSON.stringify(buildProjectSaveBody())))
        }
        return true
      }

      const saveResponse = await $fetch<{
        success?: boolean
        cloudSync?: ProjectCloudSyncResult
      }>(`/api/project/${id}`, {
        method: 'PUT',
        body: saveBody
      })
      if (saveResponse.success === false) {
        throw new Error('保存项目失败')
      }
      const cloudSyncWarning = resolveCloudSyncWarning(saveResponse.cloudSync)
      if (cloudSyncWarning) {
        saveWarning.value = cloudSyncWarning
        console.warn('[useAssetWorkbenchProjectIO] 云端项目同步未完成:', saveResponse.cloudSync)
      }
      if ((activeProjectId.value || options.projectId.value) === id) {
        lastSavedProjectSnapshot = nextSnapshot
      }
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

  function saveProject(expectedProjectId?: string): Promise<boolean> {
    const runSave = () => performSaveProject(expectedProjectId)
    const pendingSave = saveQueue.then(runSave, runSave)
    saveQueue = pendingSave.then(
      () => undefined,
      () => undefined
    )
    return pendingSave
  }

  async function refreshCharacterVoiceAssets(input: {
    attempts?: number
    delayMs?: number
  } = {}) {
    const id = activeProjectId.value || options.projectId.value
    if (!id) return
    const collaborationMode = editSession.value.collaboration

    const attempts = Math.max(1, input.attempts ?? 1)
    const delayMs = Math.max(200, input.delayMs ?? 1000)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      if ((activeProjectId.value || options.projectId.value) !== id) return
      try {
        if (collaborationMode) {
          const response = await $fetch<{ data: unknown[] }>(`/api/project/${encodeURIComponent(id)}/collaboration/media-results`)
          if ((activeProjectId.value || options.projectId.value) !== id) return
          let changed = false
          const seen = new Set<string>()
          for (const value of Array.isArray(response.data) ? [...response.data].reverse() : []) {
            let candidate
            try { candidate = parseCollaborationAssetResult(value) } catch { continue }
            if (candidate.kind !== 'asset-voice' || !collaboration.canAdoptAsset(candidate)) continue
            const meta = candidate.collaboration
            const key = JSON.stringify([meta.assetKind, meta.assetId])
            if (seen.has(key)) continue
            seen.add(key)
            const url = new URL(candidate.url)
            if (!['https:', 'http:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) continue
            const workflow = options.projectAssetWorkflow.value as { props?: Array<{ id: string, voiceAsset?: CharacterVoiceAsset, mediaType?: string }> } | null
            const target = meta.assetKind === 'character' ? options.characters.value.find(item => item.id === meta.assetId) : workflow?.props?.find(item => item.id === meta.assetId)
            if (!target || target.voiceAsset?.locked) continue
            target.voiceAsset = { ...candidate.voiceAsset, locked: !target.voiceAsset?.audioUrl } as CharacterVoiceAsset
            if (meta.assetKind === 'prop') (target as { mediaType?: string }).mediaType = 'voice'
            changed = true
          }
          if (changed) { await saveProject(id); return }
          continue
        }
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

  async function requestProjectEditing(takeover = false) {
    loading.value = true
    try {
      const id = activeProjectId.value || options.projectId.value
      if (!id) return
      if (editSession.value.scopeConflict) {
        const { confirm } = useConfirm()
        if (!await confirm({ title: '读取最新协作内容', description: '本机草稿已保留。读取云端内容会替换当前页面，请先下载需要保留的草稿，之后可手动合并。', confirmText: '读取云端内容', cancelText: '保留当前草稿' })) return
        collaboration.discardDraft?.()
        await loadProject(id)
        return
      }
      if (lastSavedProjectSnapshot !== null) {
        const body = buildProjectSaveBody()
        if (buildProjectSaveSnapshot(id, body) !== lastSavedProjectSnapshot) {
          if (editSession.value.collaboration) collaboration.stashDraft(lastSavedWorkbenchBody, JSON.parse(JSON.stringify(body)))
          else {
            const response = await $fetch<{ backupId: string }>(`/api/project/${encodeURIComponent(id)}/edit-session/backup`, { method: 'POST', body })
            editSession.value.backupId = response.backupId
          }
        }
      }
      void takeover
      await openEditSession(id)
      if (projectEditable.value) await loadProject(id, true)
    } finally { loading.value = false }
  }

  async function downloadEditBackup() {
    const id = activeProjectId.value || options.projectId.value
    if (!id) return
    if (editSession.value.collaboration && !editSession.value.backupId) { collaboration.downloadDraft?.(); return }
    if (!editSession.value.backupId) return
    const data = await $fetch(`/api/project/${encodeURIComponent(id)}/edit-session/backup/${editSession.value.backupId}`)
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `未同步修改-${editSession.value.backupId}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (getCurrentInstance()) {
    let draftTimer: ReturnType<typeof setTimeout> | undefined
    const stash = () => {
      if (!loading.value && projectEditable.value && lastSavedProjectSnapshot !== null) {
        try { collaboration.stashDraft?.(lastSavedWorkbenchBody, JSON.parse(JSON.stringify(buildProjectSaveBody()))) }
        catch { saveWarning.value = '本机草稿备份失败，请保存修改后再关闭窗口。' }
      }
    }
    watch(buildProjectSaveBody, () => { clearTimeout(draftTimer); draftTimer = setTimeout(stash, 500) }, { deep: true })
    window.addEventListener('beforeunload', stash)
    onBeforeUnmount(() => { clearTimeout(draftTimer); stash(); window.removeEventListener('beforeunload', stash) })
  }

  if (getCurrentInstance()) onBeforeRouteLeave(async () => {
    const id = activeProjectId.value || options.projectId.value
    if (id && projectEditable.value) {
      if (!await saveProject(id)) return false
    } else if (id && lastSavedProjectSnapshot !== null) {
      const body = buildProjectSaveBody()
      if (buildProjectSaveSnapshot(id, body) !== lastSavedProjectSnapshot) {
        try {
          await $fetch(`/api/project/${encodeURIComponent(id)}/edit-session/backup`, { method: 'POST', body })
        } catch { saveError.value = '未同步修改尚未备份，暂时不能离开项目。'; return false }
      }
    }
    await releaseEditSession()
    return true
  })

  return {
    loading,
    saving,
    saveError,
    saveWarning,
    projectAccess,
    projectEditable,
    editSession,
    acquiringEditSession,
    requestProjectEditing,
    downloadEditBackup,
    releaseEditSession,
    saveProject,
    loadProject,
    refreshCharacterVoiceAssets,
    acknowledgeWorkflowNormalization,
    mergeAllVideos,
    mergeStatus,
    finalVideo,
    resolveProjectStatus
  }
}

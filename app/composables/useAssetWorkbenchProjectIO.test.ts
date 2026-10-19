import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { useAssetWorkbenchProjectIO } from './useAssetWorkbenchProjectIO'

const collaborationMock = vi.hoisted(() => ({ enabled: false, editable: true, sync: undefined as any, snapshot: vi.fn(), saveSnapshot: vi.fn(), canAdoptAsset: vi.fn() }))

vi.mock('./useWorkbenchCollaborationSession', () => ({
  useWorkbenchCollaborationSession: (_save: unknown, sync: unknown) => {
    collaborationMock.sync = sync
    return ({
    editSession: ref({ editable: collaborationMock.editable, canTakeover: false, collaboration: collaborationMock.enabled }),
    snapshot: collaborationMock.snapshot, saveSnapshot: collaborationMock.saveSnapshot,
    canAdoptAsset: collaborationMock.canAdoptAsset, ready: ref(collaborationMock.enabled),
    projectEditable: ref(collaborationMock.editable), acquiring: ref(false),
    openEditSession: vi.fn(async () => {}), releaseEditSession: vi.fn(async () => {})
  }) }
}))

interface FetchOptions {
  method?: string
  body?: unknown
}

const projectId = 'project_1'
const projectRoute = `/api/project/${projectId}`

function createScene(id: string): SceneData {
  return {
    id,
    title: '场景 1',
    description: '夜晚，主角推门进入。',
    characters: [],
    duration: 8,
    active: true,
    referenceStatus: 'pending',
    videoStatus: 'pending'
  }
}

function createCharacter(id: string): CharacterData {
  return {
    id,
    name: '主角',
    appearance: '黑色风衣，短发',
    role: 'protagonist',
    generating: false,
    generatingViews: false
  }
}

function createLoadResponse(input: { id?: string, name?: string } = {}) {
  const responseProjectId = input.id || projectId
  return {
    success: true,
    data: {
      project: {
        name: input.name || '项目 A',
        description: '测试描述',
        scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
        styleId: 'style_a',
        aspectRatio: '16:9' as const
      },
      script: {
        novelText: '这是测试剧本',
        selectedStyleId: 'style_a',
        scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
        episodePlan: [] as ScriptEpisodePlanItem[],
        assetWorkflow: null
      },
      scenes: [
        {
          id: `scene_${responseProjectId}_scene_1`,
          title: '场景 1',
          description: '夜晚，主角推门进入。',
          duration: 8,
          characters: []
        }
      ],
      characters: [
        {
          id: `char_${responseProjectId}_char_1`,
          name: '主角',
          appearance: '黑色风衣，短发'
        }
      ]
    }
  }
}

function createProjectIO(input: { routeProjectId?: ReturnType<typeof ref<string | undefined>> } = {}) {
  const route = { query: { project: projectId } } as never
  const router = {
    replace: vi.fn(async () => undefined)
  } as never
  const routeProjectId = input.routeProjectId || ref<string | undefined>(projectId)

  const projectName = ref('新项目')
  const projectDescription = ref('')
  const projectStyleId = ref('')
  const projectAspectRatio = ref<'16:9' | '9:16' | '1:1'>('16:9')
  const projectAssetWorkflow = ref<unknown | null>(null)
  const scriptParseMode = ref(DEFAULT_SCRIPT_PARSE_MODE)
  const selectedStyleId = ref('')
  const novelText = ref('')
  const scenes = ref<SceneData[]>([createScene('scene_1')])
  const characters = ref<CharacterData[]>([createCharacter('char_1')])
  const episodePlan = ref<ScriptEpisodePlanItem[]>([])

  const io = useAssetWorkbenchProjectIO({
    route,
    router,
    projectId: computed(() => routeProjectId.value),
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

  return {
    io,
    state: {
      routeProjectId,
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
    }
  }
}

describe('useAssetWorkbenchProjectIO', () => {
  const fetchMock = vi.fn(async (_url: string, _options?: FetchOptions) => {
    return { success: true }
  })
  const testGlobal = globalThis as typeof globalThis & { $fetch?: unknown }
  let hadOriginalFetch = false
  let originalFetch: unknown

  beforeEach(() => {
    fetchMock.mockReset()
    collaborationMock.enabled = false
    collaborationMock.editable = true
    collaborationMock.canAdoptAsset.mockReset().mockReturnValue(true)
    collaborationMock.snapshot.mockReset()
    collaborationMock.saveSnapshot.mockReset()
    hadOriginalFetch = Object.prototype.hasOwnProperty.call(testGlobal, '$fetch')
    originalFetch = testGlobal.$fetch
    testGlobal.$fetch = fetchMock
  })

  afterEach(() => {
    if (hadOriginalFetch) {
      testGlobal.$fetch = originalFetch
    } else {
      delete testGlobal.$fetch
    }
  })

  it('skips duplicate PUT when project payload is unchanged after load', async () => {
    fetchMock.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === projectRoute && options?.method === 'PUT') {
        return { success: true, cloudSync: { status: 'synced' } }
      }
      if (url === projectRoute) {
        return createLoadResponse()
      }
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { io } = createProjectIO()
    await io.loadProject(projectId)
    await io.saveProject()

    const putCalls = fetchMock.mock.calls.filter(([, options]) => {
      return (options as FetchOptions | undefined)?.method === 'PUT'
    })
    expect(putCalls).toHaveLength(0)
  })

  it('sends PUT when user edits project content', async () => {
    fetchMock.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === projectRoute && options?.method === 'PUT') {
        return { success: true, cloudSync: { status: 'synced' } }
      }
      if (url === projectRoute) {
        return createLoadResponse()
      }
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    state.projectName.value = '项目 A（已编辑）'
    await io.saveProject()

    const putCalls = fetchMock.mock.calls.filter(([, options]) => {
      return (options as FetchOptions | undefined)?.method === 'PUT'
    })
    expect(putCalls).toHaveLength(1)
  })

  it('ignores an older project response that arrives after the current project', async () => {
    let resolveOlderLoad: ((value: ReturnType<typeof createLoadResponse>) => void) | undefined
    const olderLoad = new Promise<ReturnType<typeof createLoadResponse>>((resolve) => {
      resolveOlderLoad = resolve
    })
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/project/project_old') return await olderLoad
      if (url === '/api/project/project_new') {
        return createLoadResponse({ id: 'project_new', name: '新项目' })
      }
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { io, state } = createProjectIO()
    const oldRequest = io.loadProject('project_old')
    await io.loadProject('project_new')
    resolveOlderLoad?.(createLoadResponse({ id: 'project_old', name: 'aaa' }))
    await oldRequest

    expect(state.projectName.value).toBe('新项目')
    expect(state.scenes.value[0]?.id).toBe('scene_project_new_scene_1')
  })

  it('serializes overlapping saves so an older snapshot cannot overwrite a generated video', async () => {
    type SaveResponse = { success: boolean, cloudSync?: { status: string } }
    let resolveFirstSave: ((value: SaveResponse) => void) | undefined
    const firstSave = new Promise<SaveResponse>((resolve) => {
      resolveFirstSave = resolve
    })
    fetchMock
      .mockImplementationOnce(async () => await firstSave)
      .mockImplementationOnce(async () => ({ success: true, cloudSync: { status: 'synced' } }))

    const { io, state } = createProjectIO()
    const olderSave = io.saveProject()
    await Promise.resolve()

    state.scenes.value[0]!.videoUrl = 'https://example.com/generated-video.mp4'
    state.scenes.value[0]!.videoStatus = 'done'
    const videoSave = io.saveProject()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFirstSave?.({ success: true, cloudSync: { status: 'synced' } })
    await olderSave
    await videoSave

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondSaveBody = (fetchMock.mock.calls[1]?.[1] as FetchOptions | undefined)?.body as {
      scenes?: Array<{ videoUrl?: string }>
    }
    expect(secondSaveBody.scenes?.[0]?.videoUrl)
      .toBe('https://example.com/generated-video.mp4')
  })

  it('keeps local save successful when cloud sync is skipped without a reason', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchMock.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === projectRoute && options?.method === 'PUT') {
        return {
          success: true,
          cloudSync: {
            status: 'error',
            message: '云端项目同步被跳过: unknown'
          }
        }
      }
      if (url === projectRoute) {
        return createLoadResponse()
      }
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    state.projectName.value = '项目 A（云端跳过）'

    const saved = await io.saveProject()

    expect(saved).toBe(true)
    expect(io.saveError.value).toBeNull()
    expect(io.saveWarning.value).toBe('本地已保存，云端同步未完成：云端返回跳过同步，但未说明原因')
    expect(warnSpy).toHaveBeenCalledWith(
      '[useAssetWorkbenchProjectIO] 云端项目同步未完成:',
      {
        status: 'error',
        message: '云端项目同步被跳过: unknown'
      }
    )

    await io.saveProject()
    const putCalls = fetchMock.mock.calls.filter(([url, options]) => {
      return url === projectRoute && (options as FetchOptions | undefined)?.method === 'PUT'
    })
    expect(putCalls).toHaveLength(1)
    warnSpy.mockRestore()
  })

  it('keeps saving the loaded project after route project query disappears', async () => {
    fetchMock.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === projectRoute && options?.method === 'PUT') {
        return { success: true, cloudSync: { status: 'synced' } }
      }
      if (url === projectRoute) {
        return createLoadResponse()
      }
      if (url === '/api/project/create') {
        throw new Error('saveProject should not create a duplicate project')
      }
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const routeProjectId = ref<string | undefined>(projectId)
    const { io, state } = createProjectIO({ routeProjectId })
    await io.loadProject(projectId)
    routeProjectId.value = undefined
    state.characters.value[0]!.arkAsset = {
      provider: 'volcengine',
      libraryType: 'virtual_human',
      projectName: 'default',
      groupId: 'group-1',
      assetId: 'asset-1',
      assetType: 'Image',
      status: 'Active'
    }
    await io.saveProject()

    const createCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/project/create')
    const putCalls = fetchMock.mock.calls.filter(([url, options]) => {
      return url === projectRoute && (options as FetchOptions | undefined)?.method === 'PUT'
    })
    expect(createCalls).toHaveLength(0)
    expect(putCalls).toHaveLength(1)
  })
  it('uses resource collaboration in the original workbench and keeps stable scene IDs', async () => {
    collaborationMock.enabled = true
    const loaded = createLoadResponse()
    loaded.data.scenes[0]!.id = 'stable-scene-id'
    collaborationMock.snapshot.mockReturnValue(loaded.data)
    collaborationMock.saveSnapshot.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    state.scenes.value[0]!.description = '只修改本集画面'
    expect(await io.saveProject()).toBe(true)
    expect(state.scenes.value[0]!.id).toBe('stable-scene-id')
    expect(collaborationMock.saveSnapshot).toHaveBeenCalledOnce()
    expect(collaborationMock.saveSnapshot.mock.calls[0]![0].scenes[0].description).toBe('夜晚，主角推门进入。')
    expect(collaborationMock.saveSnapshot.mock.calls[0]![1].scenes[0].description).toBe('只修改本集画面')
    expect(fetchMock.mock.calls.some(([, options]) => (options as FetchOptions | undefined)?.method === 'PUT')).toBe(false)
    expect(await io.saveProject()).toBe(true)
    expect(collaborationMock.saveSnapshot).toHaveBeenCalledOnce()
  })

  it('applies remote data without resaving it and keeps unchanged scene runtime state', async () => {
    collaborationMock.enabled = true
    const loaded = createLoadResponse()
    collaborationMock.snapshot.mockReturnValue(loaded.data)
    fetchMock.mockResolvedValue(loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    const scene = state.scenes.value[0]!
    scene.videoStatus = 'generating'
    const remote = structuredClone(loaded.data)
    remote.project.name = '其他成员修改标题'
    collaborationMock.sync.apply(remote, remote)
    expect(state.projectName.value).toBe('其他成员修改标题')
    expect(state.scenes.value[0]).toBe(scene)
    expect(state.scenes.value[0]!.videoStatus).toBe('generating')
    expect(await io.saveProject()).toBe(true)
    expect(collaborationMock.saveSnapshot).not.toHaveBeenCalled()
  })
  it('treats hydrated workflow defaults as the baseline rather than edits to every episode', async () => {
    collaborationMock.enabled = true
    const loaded = createLoadResponse()
    collaborationMock.snapshot.mockReturnValue(loaded.data)
    fetchMock.mockResolvedValue(loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    const normalized = { version: 8, props: [], sceneConfigs: { [state.scenes.value[0]!.id]: { consistencyLevel: 'lock' } } }
    state.projectAssetWorkflow.value = normalized
    io.acknowledgeWorkflowNormalization(null, normalized)
    expect(await io.saveProject()).toBe(true)
    expect(collaborationMock.saveSnapshot).not.toHaveBeenCalled()
    state.scenes.value[0]!.description = '用户的真实修改'
    expect(await io.saveProject()).toBe(true)
    expect(collaborationMock.saveSnapshot.mock.calls[0]![0].assetWorkflow).toEqual(normalized)
  })
  it('loads the canonical view for a viewer and allows leaving without a save', async () => {
    collaborationMock.enabled = true; collaborationMock.editable = false
    const loaded = createLoadResponse()
    const remote = structuredClone(loaded.data)
    remote.project.name = '云端最新标题'
    collaborationMock.snapshot.mockReturnValue(remote)
    fetchMock.mockResolvedValue(loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    expect(state.projectName.value).toBe('云端最新标题')
    expect(await io.saveProject()).toBe(true)
    expect(collaborationMock.saveSnapshot).not.toHaveBeenCalled()
  })
  it('adopts a version-checked voice candidate and preserves a locked voice', async () => {
    collaborationMock.enabled = true
    const loaded = createLoadResponse()
    collaborationMock.snapshot.mockReturnValue(loaded.data)
    const candidate = { id: 'voice-result', kind: 'asset-voice', status: 'completed', createdAt: '2026-10-20', url: 'https://shared.example/voice.mp3', voiceAsset: { audioUrl: 'https://shared.example/voice.mp3', transcript: '你好' }, collaboration: { projectId, actorId: 'owner', assetKind: 'character', assetId: loaded.data.characters[0]!.id, resourceType: 'character', resourceId: loaded.data.characters[0]!.id, revision: 1, settingsRevision: 1 } }
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/media-results') ? { success: true, data: [candidate] } : loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    await io.refreshCharacterVoiceAssets()
    expect(state.characters.value[0]!.voiceAsset).toMatchObject({ audioUrl: candidate.url, locked: true })
    expect(collaborationMock.saveSnapshot).toHaveBeenCalledOnce()
    await io.refreshCharacterVoiceAssets()
    expect(collaborationMock.saveSnapshot).toHaveBeenCalledOnce()
  })
  it('leaves stale voice candidates out of the shared project', async () => {
    collaborationMock.enabled = true
    const loaded = createLoadResponse()
    collaborationMock.snapshot.mockReturnValue(loaded.data)
    collaborationMock.canAdoptAsset.mockReturnValue(false)
    const candidate = { id: 'stale', kind: 'asset-voice', status: 'completed', createdAt: '2026-10-20', url: 'https://shared.example/voice.mp3', voiceAsset: { audioUrl: 'https://shared.example/voice.mp3', transcript: '你好' }, collaboration: { projectId, actorId: 'owner', assetKind: 'character', assetId: loaded.data.characters[0]!.id, resourceType: 'character', resourceId: loaded.data.characters[0]!.id, revision: 1, settingsRevision: 1 } }
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/media-results') ? { success: true, data: [candidate] } : loaded)
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    await io.refreshCharacterVoiceAssets()
    expect(state.characters.value[0]!.voiceAsset).toBeUndefined()
    expect(collaborationMock.saveSnapshot).not.toHaveBeenCalled()
  })
  it('retains the original UI draft and baseline after a resource conflict', async () => {
    collaborationMock.enabled = true
    collaborationMock.snapshot.mockReturnValue(createLoadResponse().data)
    collaborationMock.saveSnapshot.mockRejectedValue(new Error('此集版本已变化'))
    fetchMock.mockResolvedValue(createLoadResponse())
    const { io, state } = createProjectIO()
    await io.loadProject(projectId)
    state.scenes.value[0]!.description = '未保存草稿'
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await io.saveProject()).toBe(false)
    expect(io.saveError.value).toBe('此集版本已变化')
    expect(state.scenes.value[0]!.description).toBe('未保存草稿')
    expect(await io.saveProject()).toBe(false)
    expect(collaborationMock.saveSnapshot.mock.calls[1]![0].scenes[0].description).toBe('夜晚，主角推门进入。')
    quiet.mockRestore()
  })

})

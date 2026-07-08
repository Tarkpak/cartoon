import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { useAssetWorkbenchProjectIO } from './useAssetWorkbenchProjectIO'

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

function createLoadResponse() {
  return {
    success: true,
    data: {
      project: {
        name: '项目 A',
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
          id: `scene_${projectId}_scene_1`,
          title: '场景 1',
          description: '夜晚，主角推门进入。',
          duration: 8,
          characters: []
        }
      ],
      characters: [
        {
          id: `char_${projectId}_char_1`,
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
        return { success: true }
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
        return { success: true }
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
    warnSpy.mockRestore()
  })

  it('keeps saving the loaded project after route project query disappears', async () => {
    fetchMock.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === projectRoute && options?.method === 'PUT') {
        return { success: true }
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
})

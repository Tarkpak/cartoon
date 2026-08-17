import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  createInitialAssetWorkbenchParseProgressState,
  useAssetWorkbenchGeneration
} from './useAssetWorkbenchGeneration'
import {
  generateAssetWorkbenchCharacter,
  parseAssetWorkbenchScript,
  prepareAssetWorkbenchEpisodePlan,
  type ScriptEpisodePlanItem
} from '~/lib/asset-workbench-api'

vi.mock('~/lib/asset-workbench-api', () => ({
  prepareAssetWorkbenchEpisodePlan: vi.fn(),
  parseAssetWorkbenchScript: vi.fn(),
  generateAssetWorkbenchCharacter: vi.fn()
}))

function createEpisode(index: number): ScriptEpisodePlanItem {
  return {
    id: `episode_${String(index).padStart(3, '0')}`,
    title: `第${index}集`,
    index,
    startOffset: (index - 1) * 1000,
    endOffset: index * 1000,
    charCount: 1000
  }
}

function createGeneration(initialNovelText = '测试剧本正文') {
  const projectId = ref<string | undefined>('project_a')
  const projectName = ref('新项目')
  const novelText = ref(initialNovelText)
  const scenes = ref<SceneData[]>([])
  const characters = ref<CharacterData[]>([])
  const scriptParseMode = ref(DEFAULT_SCRIPT_PARSE_MODE)
  const episodePlan = ref<ScriptEpisodePlanItem[]>([])
  const parsing = ref(false)
  const parseProgress = ref(createInitialAssetWorkbenchParseProgressState())
  const currentStylePrompt = ref('动漫风格')
  const saveProject = vi.fn(async () => true)
  const onModelTaskCompleted = vi.fn(async () => undefined)

  const generation = useAssetWorkbenchGeneration({
    projectId,
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
    onModelTaskCompleted
  })

  return {
    generation,
    projectId,
    novelText,
    scriptParseMode,
    scenes,
    characters,
    episodePlan,
    onModelTaskCompleted,
    parsing,
    parseProgress,
    saveProject
  }
}

describe('useAssetWorkbenchGeneration', () => {
  const prepareEpisodePlanMock = prepareAssetWorkbenchEpisodePlan as unknown as {
    mockReset: () => void
    mockResolvedValue: (value: ScriptEpisodePlanItem[]) => void
  }
  const parseScriptMock = parseAssetWorkbenchScript as unknown as {
    mockReset: () => void
    mockResolvedValue: (value: unknown) => void
    mock: {
      calls: Array<[Record<string, unknown>]>
    }
  }
  const generateCharacterMock = generateAssetWorkbenchCharacter as unknown as {
    mockReset: () => void
    mockImplementation: (implementation: () => Promise<unknown>) => void
  }

  beforeEach(() => {
    prepareEpisodePlanMock.mockReset()
    parseScriptMock.mockReset()
    generateCharacterMock.mockReset()
  })

  it('notifies completion after generating episode plan', async () => {
    prepareEpisodePlanMock.mockResolvedValue([
      createEpisode(1),
      createEpisode(2)
    ])
    const { generation, episodePlan, onModelTaskCompleted } = createGeneration()

    const success = await generation.prepareEpisodePlan()

    expect(success).toBe(true)
    expect(episodePlan.value).toHaveLength(2)
    expect(onModelTaskCompleted).toHaveBeenCalledTimes(1)
    expect(onModelTaskCompleted).toHaveBeenCalledWith({
      title: '分集目录生成完成',
      body: '共生成 2 集分集目录'
    })
  })

  it('skips completion notice when no episode is generated', async () => {
    prepareEpisodePlanMock.mockResolvedValue([])
    const { generation, onModelTaskCompleted } = createGeneration()

    const success = await generation.prepareEpisodePlan()

    expect(success).toBe(false)
    expect(onModelTaskCompleted).not.toHaveBeenCalled()
  })

  it('creates a single local planning episode for origin explainer projects', async () => {
    const { generation, scriptParseMode, episodePlan, onModelTaskCompleted } = createGeneration('四冲程发动机工作原理')
    scriptParseMode.value = 'origin_explainer'

    const success = await generation.prepareEpisodePlan()

    expect(success).toBe(true)
    expect(prepareEpisodePlanMock).not.toHaveBeenCalled()
    expect(episodePlan.value).toEqual([
      expect.objectContaining({
        id: 'episode_origin_explainer',
        title: '科普拆解',
        index: 1,
        startOffset: 0,
        endOffset: 10,
        charCount: 10
      })
    ])
    expect(onModelTaskCompleted).not.toHaveBeenCalled()
  })

  it('parses only the selected episode text', async () => {
    parseScriptMock.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_001',
          title: '场景1',
          description: '场景说明',
          duration: 8
        }],
        characters: []
      }
    })
    const { generation, episodePlan, scenes } = createGeneration('0000TARGET9999')
    episodePlan.value = [{
      id: 'episode_002',
      title: '第2集',
      index: 2,
      startOffset: 4,
      endOffset: 10,
      charCount: 6
    }]

    const success = await generation.parseScript({
      targetEpisodeId: 'episode_002',
      scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
      style: '动漫风格',
      descriptionFormat: 'timeline'
    })

    expect(success).toBe(true)
    expect(scenes.value).toHaveLength(1)
    expect(parseScriptMock.mock.calls[0]?.[0]).toMatchObject({
      text: 'TARGET',
      targetEpisodeId: 'episode_002',
      episodePlan: [{
        id: 'episode_002',
        startOffset: 0,
        endOffset: 6
      }]
    })
  })

  it('ignores an old parse response after switching projects', async () => {
    let resolveParse: ((value: unknown) => void) | undefined
    parseScriptMock.mockResolvedValue(new Promise((resolve) => {
      resolveParse = resolve
    }))
    const {
      generation,
      projectId,
      episodePlan,
      scenes,
      parsing,
      parseProgress,
      saveProject
    } = createGeneration('项目 A 的剧本')
    episodePlan.value = [createEpisode(1)]

    const pendingParse = generation.parseScript({
      targetEpisodeId: 'episode_001',
      scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE
    })
    expect(parsing.value).toBe(true)

    projectId.value = 'project_b'
    await nextTick()

    expect(parsing.value).toBe(false)
    expect(parseProgress.value.active).toBe(false)

    resolveParse?.({
      success: true,
      data: {
        scenes: [{
          id: 'scene_001',
          title: '项目 A 的场景',
          description: '不应写入项目 B',
          duration: 8
        }],
        characters: []
      }
    })

    await expect(pendingParse).resolves.toBe(false)
    expect(scenes.value).toEqual([])
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('writes a generated image to the current character after re-hydration', async () => {
    const originalCharacter: CharacterData = {
      id: 'char_1',
      name: '主角',
      appearance: '黑色风衣',
      role: 'protagonist',
      generating: false,
      generatingViews: false
    }
    const currentCharacter = { ...originalCharacter }
    const { generation, characters, saveProject } = createGeneration()
    characters.value = [originalCharacter]
    generateCharacterMock.mockImplementation(async () => {
      characters.value = [currentCharacter]
      return {
        success: true,
        asset: { baseImage: 'https://example.com/generated-character.png' }
      }
    })

    await generation.generateCharacter(originalCharacter)

    expect(originalCharacter.baseImage).toBeUndefined()
    expect(currentCharacter.baseImage).toBe('https://example.com/generated-character.png')
    expect(currentCharacter.generating).toBe(false)
    expect(saveProject).toHaveBeenCalledTimes(1)
  })
})

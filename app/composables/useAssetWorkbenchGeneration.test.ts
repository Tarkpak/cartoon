import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  createInitialAssetWorkbenchParseProgressState,
  useAssetWorkbenchGeneration
} from './useAssetWorkbenchGeneration'
import {
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
    novelText,
    scriptParseMode,
    scenes,
    episodePlan,
    onModelTaskCompleted
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

  beforeEach(() => {
    prepareEpisodePlanMock.mockReset()
    parseScriptMock.mockReset()
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
})

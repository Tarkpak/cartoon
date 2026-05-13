import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  createInitialAssetWorkbenchParseProgressState,
  useAssetWorkbenchGeneration
} from './useAssetWorkbenchGeneration'
import {
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

function createGeneration() {
  const projectName = ref('新项目')
  const novelText = ref('测试剧本正文')
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
    episodePlan,
    onModelTaskCompleted
  }
}

describe('useAssetWorkbenchGeneration', () => {
  const prepareEpisodePlanMock = vi.mocked(prepareAssetWorkbenchEpisodePlan)

  beforeEach(() => {
    prepareEpisodePlanMock.mockReset()
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
})

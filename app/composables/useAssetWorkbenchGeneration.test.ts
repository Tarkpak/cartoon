import { effectScope, nextTick, ref } from 'vue'
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
    mockImplementationOnce: (implementation: (options: Parameters<typeof parseAssetWorkbenchScript>[0]) => Promise<unknown>) => void
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

  it.each([
    ['具体外观', '深蓝工装，短发', undefined, '深蓝工装，短发'],
    ['已有角色图', '成年男性，原文未明确', 'saved.png', '成年男性，原文未明确'],
    ['旧目录占位', '成年男性，原文未明确', undefined, '三十岁男性，短黑发、方脸，深蓝工装、灰色圆领衫、深色长裤、劳保鞋']
  ])('preserves %s while allowing legacy placeholders to be completed', async (_label, appearance, baseImage, expected) => {
    const { generation, characters, episodePlan } = createGeneration()
    episodePlan.value = [createEpisode(1)]
    characters.value = [{ id: 'char_plan_1', name: '主人公', appearance: appearance!, baseImage, role: '主角', generating: false, generatingViews: false }]
    parseScriptMock.mockResolvedValue({ success: true, data: {
      scenes: [{ id: 's1', description: '分镜', duration: 8, characters: [{ name: '主人公' }] }],
      characters: [{ name: '主人公', description: '三十岁男性，短黑发、方脸，深蓝工装、灰色圆领衫、深色长裤、劳保鞋' }]
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(characters.value[0]!.appearance).toBe(expected)
    expect(characters.value[0]!.baseImage).toBe(baseImage)
    const baselines = parseScriptMock.mock.calls.at(-1)![0].characterBaselines as unknown[]
    expect(baselines).toHaveLength(baseImage || appearance === '深蓝工装，短发' ? 1 : 0)
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

  it('plans assets using the project style and preserves existing visual settings and images', async () => {
    const { generation, characters } = createGeneration()
    characters.value = [{ id: 'char_plan_existing', name: '主人公', appearance: '用户指定的蓝色工装', baseImage: 'saved.png', role: '主角', generating: false, generatingViews: false }]
    prepareEpisodePlanMock.mockResolvedValue([{ ...createEpisode(1), episodeAssets: {
      characters: [{ name: '主人公', description: '模型改成了红色长袍', role: '主角', gender: '男' }],
      props: [], environments: []
    } }])
    expect(await generation.prepareEpisodePlan()).toBe(true)
    expect(prepareAssetWorkbenchEpisodePlan).toHaveBeenCalledWith('测试剧本正文', DEFAULT_SCRIPT_PARSE_MODE, expect.objectContaining({
      style: '动漫风格', characterBaselines: [expect.objectContaining({ name: '主人公', description: '用户指定的蓝色工装' })]
    }))
    expect(characters.value[0]).toMatchObject({ appearance: '用户指定的蓝色工装', baseImage: 'saved.png' })
  })

  it('skips completion notice when no episode is generated', async () => {
    prepareEpisodePlanMock.mockResolvedValue([])
    const { generation, onModelTaskCompleted, parseProgress } = createGeneration()

    const success = await generation.prepareEpisodePlan()

    expect(success).toBe(false)
    expect(parseProgress.value.step).toBe('error')
    expect(parseProgress.value.message).toContain('结果为空')
    expect(onModelTaskCompleted).not.toHaveBeenCalled()
  })

  it('retains the server error after generation stops and preserves the existing plan', async () => {
    vi.mocked(prepareAssetWorkbenchEpisodePlan).mockRejectedValueOnce({ data: { message: '模型连接超时' } })
    const { generation, episodePlan, parsing, parseProgress } = createGeneration()
    episodePlan.value = [createEpisode(1)]
    expect(await generation.prepareEpisodePlan()).toBe(false)
    expect(parsing.value).toBe(false)
    expect(parseProgress.value).toMatchObject({ active: false, step: 'error', message: '模型连接超时' })
    expect(episodePlan.value).toEqual([createEpisode(1)])
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

  it('keeps generation feedback visible when a heartbeat arrives', async () => {
    const { generation, episodePlan, parseProgress } = createGeneration('当前分集剧本内容')
    episodePlan.value = [createEpisode(1)]
    parseScriptMock.mockImplementationOnce(async (options) => {
      options.onProgress?.({ source: 'progress', step: 'generating', message: '模型正在生成解析结果，已接收 120 字' })
      options.onProgress?.({ source: 'heartbeat', step: 'heartbeat', message: '解析仍在进行，已等待 10 秒' })
      expect(parseProgress.value.step).toBe('generating')
      expect(parseProgress.value.message).toContain('120 字')
      expect(parseProgress.value.logs.at(-1)?.message).toContain('10 秒')
      return { success: true, data: { scenes: [], characters: [] } }
    })
    await generation.parseScript({ targetEpisodeId: 'episode_001', scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE })
  })

  it('retains batch counts during retries and freezes timing after a failure', async () => {
    const { generation, episodePlan, parseProgress } = createGeneration('当前分集剧本内容')
    episodePlan.value = [createEpisode(1)]
    parseScriptMock.mockImplementationOnce(async (options) => {
      expect(parseProgress.value.startedAt).toEqual(expect.any(Number))
      options.onProgress?.({ source: 'progress', step: 'batch_generating', message: '已完成 2 / 4 批', chunkIndex: 2, chunkCount: 4 })
      options.onProgress?.({ source: 'progress', step: 'batch_retry', message: '第 3 批正在重试' })
      throw new Error('第 3 批失败')
    })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(false)
    expect(parseProgress.value).toMatchObject({
      active: false, step: 'error', failedStep: 'batch_retry', chunkIndex: 2, chunkCount: 4
    })
    expect(parseProgress.value.finishedAt).toEqual(expect.any(Number))
    expect(parseProgress.value.finishedAt!).toBeGreaterThanOrEqual(parseProgress.value.startedAt!)
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
    expect((parseScriptMock.mock.calls.at(-1)?.[0]?.signal as AbortSignal).aborted).toBe(true)

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

  it('aborts pending model work when its Vue scope is disposed', async () => {
    const scope = effectScope()
    const { generation, episodePlan, saveProject } = scope.run(() => createGeneration('当前分集剧本'))!
    episodePlan.value = [createEpisode(1)]
    parseScriptMock.mockImplementationOnce(options => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('已取消')), { once: true })
    }))
    const pending = generation.parseScript({ targetEpisodeId: 'episode_001' })
    scope.stop()
    await expect(pending).resolves.toBe(false)
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('rejects empty scene results without replacing the existing episode', async () => {
    const { generation, episodePlan, scenes, saveProject, parseProgress } = createGeneration('当前分集剧本')
    episodePlan.value = [createEpisode(1)]
    const original = { id: 'existing', episodeId: 'episode_001', description: '原分镜', duration: 8 } as SceneData
    scenes.value = [original]
    parseScriptMock.mockResolvedValue({ success: true, data: { scenes: [] } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(false)
    expect(scenes.value).toEqual([original])
    expect(saveProject).not.toHaveBeenCalled()
    expect(parseProgress.value.step).toBe('error')
  })

  it('reports a save failure at the final phase and retains the generated result for recovery', async () => {
    const { generation, episodePlan, parseProgress, saveProject, onModelTaskCompleted, scenes } = createGeneration('当前分集剧本')
    episodePlan.value = [createEpisode(1)]
    parseScriptMock.mockResolvedValue({ success: true, data: { scenes: [{ id: 'scene_001', description: '生成结果', duration: 8 }] } })
    saveProject.mockResolvedValueOnce(false)
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(false)
    expect(parseProgress.value).toMatchObject({ step: 'error', failedStep: 'merging', targetEpisodeId: 'episode_001', active: false })
    expect(parseProgress.value.message).toContain('保存失败')
    expect(onModelTaskCompleted).not.toHaveBeenCalled()
    expect(scenes.value[0]?.description).toContain('生成结果')
  })

  it('allocates fresh IDs for parsed characters instead of reusing deleted sequential IDs', async () => {
    const { generation, episodePlan, characters } = createGeneration('当前分集剧本')
    episodePlan.value = [createEpisode(1)]
    characters.value = [{ id: 'char_1', name: '已有角色', appearance: '原设定', role: '配角', generating: false, generatingViews: false }]
    parseScriptMock.mockResolvedValue({ success: true, data: {
      scenes: [{ id: 'scene_001', description: '生成结果', duration: 8 }],
      characters: [{ id: 'char_2', name: '新角色甲' }, { id: 'char_3', name: '新角色乙' }]
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(characters.value[0]!.id).toBe('char_1')
    const added = characters.value.filter(character => character.id !== 'char_1')
    expect(added).toHaveLength(2)
    expect(added.every(character => /^char_parse_[0-9a-f-]{36}$/u.test(character.id))).toBe(true)
    expect(new Set(added.map(character => character.id)).size).toBe(2)
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

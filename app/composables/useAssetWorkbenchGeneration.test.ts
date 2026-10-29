import { applyScopedEntityIds, buildLoadedCharacters, buildLoadedScenes, buildSaveCharactersPayload, buildSaveScenesPayload } from '~/lib/asset-workbench-project-serialization'
import { resolveSceneVideoReferenceAssets } from '~/lib/asset-workbench-scene-references'
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

  it('keeps character references through parsing, save/load and media selection', async () => {
    const { generation, characters, scenes, episodePlan } = createGeneration()
    episodePlan.value = [createEpisode(1)]
    characters.value = [{ id: 'saved', name: '主角', appearance: '用户外观', baseImage: 'saved.png', role: '主角', generating: false, generatingViews: false }]
    parseScriptMock.mockResolvedValue({ success: true, data: {
      characters: [{ id: 'legacy_alias', name: '主角', description: '模型外观' }],
      scenes: [{ id: 's1', description: '主角走进房间', duration: 8, characters: [{ name: '主角', assetId: 'char:legacy_alias' }] }]
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(scenes.value[0]!.characters[0]!.assetId).toBe('char:saved')
    applyScopedEntityIds('project_a', scenes.value, characters.value)
    const loadedScenes = buildLoadedScenes(buildSaveScenesPayload(scenes.value))
    const loadedCharacters = buildLoadedCharacters(buildSaveCharactersPayload(characters.value))
    const references = resolveSceneVideoReferenceAssets({ scene: loadedScenes[0]!, characters: loadedCharacters, propAssets: [], sceneConfigs: {} })
    expect(references).toEqual(expect.arrayContaining([expect.objectContaining({ image: 'saved.png' })]))
    expect(loadedCharacters[0]!.appearance).toBe('用户外观')
  })

  it('gives replacement scenes fresh IDs while preserving model order and other episodes', async () => {
    const { generation, scenes, episodePlan } = createGeneration()
    episodePlan.value = [createEpisode(1), createEpisode(2)]
    const other = { id: 'scene_other', episodeId: 'episode_002', episodeIndex: 2, title: '另一集', description: '保留镜头', duration: 8, characters: [] }
    scenes.value = buildLoadedScenes([{ id: 'scene_1', episodeId: 'episode_001', description: '旧镜头', duration: 8 }, other])
    parseScriptMock.mockResolvedValue({ success: true, data: {
      characters: [], scenes: ['先', '后'].map((description, index) => ({ id: `s${index}`, description, duration: 8, characters: [] }))
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    const firstIds = scenes.value.slice(0, 2).map(scene => scene.id)
    expect(scenes.value.slice(0, 2).map(scene => scene.description)).toEqual(['先', '后'])
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(scenes.value.slice(0, 2).every(scene => scene.id !== 'scene_1' && !firstIds.includes(scene.id))).toBe(true)
    expect(scenes.value.slice(0, 2).map(scene => scene.description)).toEqual(['先', '后'])
    expect(scenes.value[2]).toMatchObject(other)
  })

  it('slices normalized episode text using browser UTF-16 offsets', async () => {
    const { generation, episodePlan } = createGeneration('  甲😀乙\r\n𠮷丙丁  ')
    episodePlan.value = [{ ...createEpisode(2), startOffset: 5, endOffset: 9 }]
    parseScriptMock.mockResolvedValue({ success: true, data: { characters: [], scenes: [{ description: '分镜', duration: 8, characters: [] }] } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_002' })).toBe(true)
    expect(parseScriptMock.mock.calls[0]![0].text).toBe('𠮷丙丁')
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
    expect(baselines).toHaveLength(1)
    expect(baselines[0]).toMatchObject({
      id: 'char_plan_1',
      name: '主人公',
      description: baseImage || appearance === '深蓝工装，短发' ? appearance : ''
    })
  })

  it('reuses directory identities across episodes and subsequent parsing', async () => {
    const { generation, characters, episodePlan } = createGeneration('测试剧本正文')
    const knownId = 'char_plan_known'
    const addedId = 'char_parse_12345678-1234-4234-8234-123456789abc'
    characters.value = [{ id: knownId, name: '田小花', appearance: '用户蓝衣', baseImage: 'saved.png', role: '配角', generating: false, generatingViews: false }]
    const assets = {
      characters: [
        { id: knownId, name: '田小花', description: '模型重新设计' },
        { id: addedId, name: '福林', description: '灰衣少年' }
      ], props: [], environments: []
    }
    prepareEpisodePlanMock.mockResolvedValue([
      { ...createEpisode(1), episodeAssets: assets },
      { ...createEpisode(2), episodeAssets: assets }
    ])
    expect(await generation.prepareEpisodePlan()).toBe(true)
    expect(characters.value.map(character => character.id)).toEqual([knownId, addedId])
    expect(characters.value[0]).toMatchObject({ name: '田小花', appearance: '用户蓝衣', baseImage: 'saved.png' })
    episodePlan.value = [{ ...createEpisode(1), startOffset: 0, endOffset: 6, episodeAssets: assets }]
    parseScriptMock.mockResolvedValue({ success: true, data: {
      characters: assets.characters,
      scenes: [{ id: 's1', description: '两人对话', duration: 8, characters: [{ name: '田小花' }, { name: '福林' }] }]
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(characters.value).toHaveLength(2)
    expect(characters.value[0]!.baseImage).toBe('saved.png')
    expect(characters.value[1]!.id).toBe(addedId)
    expect(parseScriptMock.mock.calls.at(-1)![0].characterBaselines).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: knownId, name: '田小花', description: '用户蓝衣' }),
      expect.objectContaining({ id: addedId, name: '福林' })
    ]))
  })

  it('does not confuse a legacy name-only result with an existing sequential ID', async () => {
    const { generation, characters, episodePlan } = createGeneration('测试剧本正文')
    episodePlan.value = [createEpisode(1)]
    characters.value = [{ id: 'char_1', name: '甲', appearance: '蓝衣', role: '配角', generating: false, generatingViews: false }]
    parseScriptMock.mockResolvedValue({ success: true, data: {
      characters: [{ name: '乙', description: '灰衣' }],
      scenes: [{ id: 's1', description: '乙出门', duration: 8, characters: [{ name: '乙' }] }]
    } })
    expect(await generation.parseScript({ targetEpisodeId: 'episode_001' })).toBe(true)
    expect(characters.value.map(character => character.name)).toEqual(['甲', '乙'])
    expect(characters.value[1]!.id).not.toBe('char_1')
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

  it('updates directory streaming feedback without flooding logs or replacing it with heartbeats', async () => {
    const { generation, parseProgress } = createGeneration('测试剧本正文')
    vi.mocked(prepareAssetWorkbenchEpisodePlan).mockImplementationOnce(async (_text, _mode, options) => {
      options?.onProgress?.({ source: 'progress', step: 'generating', message: '模型思考中', streamState: 'thinking', outputChars: 0 })
      options?.onProgress?.({ source: 'progress', step: 'generating', message: '已接收 120 字', streamState: 'receiving', outputChars: 120 })
      const logCount = parseProgress.value.logs.length
      options?.onProgress?.({ source: 'progress', step: 'generating', message: '已接收 240 字', streamState: 'receiving', outputChars: 240 })
      expect(parseProgress.value.logs).toHaveLength(logCount)
      options?.onProgress?.({ source: 'heartbeat', step: 'heartbeat', message: '连接保持中' })
      expect(parseProgress.value).toMatchObject({ streamState: 'receiving', outputChars: 240, message: '已接收 240 字' })
      expect(parseProgress.value.lastModelActivityAt).toEqual(expect.any(Number))
      return [createEpisode(1)]
    })
    expect(await generation.prepareEpisodePlan()).toBe(true)
    expect(parseProgress.value).toMatchObject({ active: false, step: 'episode-plan-completed' })
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

  it('rejects an old character image after switching projects and stops the batch', async () => {
    const { generation, projectId, characters, saveProject, onModelTaskCompleted } = createGeneration()
    const original: CharacterData = { id: 'shared_id', name: '旧项目角色', appearance: '蓝衣', role: '配角', generating: false, generatingViews: false }
    const current: CharacterData = { ...original, name: '新项目角色', generating: true }
    characters.value = [original, { ...original, id: 'second' }]
    generateCharacterMock.mockImplementation(async () => {
      projectId.value = 'project_b'
      characters.value = [current]
      return { success: true, asset: { baseImage: 'old-project.png' } }
    })
    const result = await generation.batchGenerateCharacters()
    expect(result).toMatchObject({ generated: 0, failed: 1 })
    expect(generateAssetWorkbenchCharacter).toHaveBeenCalledTimes(1)
    expect(current.baseImage).toBeUndefined()
    expect(current.generating).toBe(true)
    expect(saveProject).not.toHaveBeenCalled()
    expect(onModelTaskCompleted).not.toHaveBeenCalled()
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

import { getCurrentScope, onScopeDispose, watch, type Ref } from 'vue'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import {
  normalizeCharacterGenderText,
  normalizeCharacterRole,
  normalizeCharacterRoleText
} from '#shared/types/character'
import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import {
  generateAssetWorkbenchCharacter,
  parseAssetWorkbenchScript,
  prepareAssetWorkbenchEpisodePlan,
  type ScriptEpisodePlanItem,
  type ParseScriptProgressEvent
} from '~/lib/asset-workbench-api'
import {
  buildParsedCharacters,
  buildParsedScenes
} from '~/lib/asset-workbench-script-parsing'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
import { isNarrativePronounCharacterName } from '~/lib/asset-workbench-strings'

export interface AssetWorkbenchParseProgressLogItem {
  id: string
  message: string
  source: ParseScriptProgressEvent['source']
}

export interface AssetWorkbenchParseProgressState {
  streamState?: ParseScriptProgressEvent['streamState']
  outputChars?: number
  lastModelActivityAt?: number
  active: boolean
  step: string
  message: string
  progress: number
  chunkIndex: number | null
  chunkCount: number | null
  startedAt?: number | null
  finishedAt?: number | null
  failedStep?: string | null
  kind?: 'episode' | 'directory'
  targetEpisodeId?: string
  targetEpisodeTitle?: string
  logs: AssetWorkbenchParseProgressLogItem[]
}

export function createInitialAssetWorkbenchParseProgressState(): AssetWorkbenchParseProgressState {
  return {
    active: false,
    step: 'idle',
    message: '',
    progress: 0,
    chunkIndex: null,
    chunkCount: null,
    startedAt: null,
    finishedAt: null,
    failedStep: null,
    logs: []
  }
}

interface UseAssetWorkbenchGenerationOptions {
  projectId?: Readonly<Ref<string | undefined>>
  projectName: Ref<string>
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  scriptParseMode: Ref<ScriptParseMode>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  parsing: Ref<boolean>
  parseProgress: Ref<AssetWorkbenchParseProgressState>
  currentStylePrompt: Ref<string>
  saveProject: (expectedProjectId?: string) => Promise<unknown>
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
  onModelTaskFailed?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}

export function useAssetWorkbenchGeneration(
  options: UseAssetWorkbenchGenerationOptions
) {
  let parseOperationSequence = 0
  let parseController: AbortController | undefined
  if (getCurrentScope()) {
    onScopeDispose(() => {
      parseOperationSequence += 1
      parseController?.abort()
    })
  }

  function beginParseOperation() {
    parseController?.abort()
    parseController = new AbortController()
    return {
      signal: parseController.signal,
      sequence: ++parseOperationSequence,
      projectId: options.projectId?.value
    }
  }

  function isCurrentParseOperation(operation: {
    sequence: number
    projectId?: string
  }): boolean {
    return operation.sequence === parseOperationSequence
      && options.projectId?.value === operation.projectId
  }

  if (options.projectId) {
    watch(options.projectId, (nextProjectId, previousProjectId) => {
      if (nextProjectId === previousProjectId) return
      parseOperationSequence += 1
      parseController?.abort()
      options.parsing.value = false
      options.parseProgress.value = createInitialAssetWorkbenchParseProgressState()
    }, { flush: 'sync' })
  }

  async function notifyModelTaskCompleted(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskCompleted) return

    try {
      await options.onModelTaskCompleted(payload)
    } catch (error) {
      console.warn('[useAssetWorkbench] 模型任务完成通知失败:', error)
    }
  }

  async function notifyModelTaskFailed(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskFailed) return

    try {
      await options.onModelTaskFailed(payload)
    } catch (error) {
      console.warn('[useAssetWorkbench] 模型任务失败通知失败:', error)
    }
  }

  async function saveProjectOrThrow(context: string, expectedProjectId?: string): Promise<void> {
    const saved = await options.saveProject(expectedProjectId)
    if (saved === false) {
      throw new Error(`${context}，但项目保存失败，请查看页面顶部的保存错误提示后重试`)
    }
  }

  function normalizeScriptInputText(text: string): string {
    return text.replace(/\r\n?/g, '\n').trim()
  }

  function normalizeNameKey(value?: string): string {
    return (value || '').trim().toLowerCase()
  }

  function toSceneId(index: number): string {
    return `scene_${String(index + 1).padStart(3, '0')}`
  }

  function resolveEpisodeOrderMap(): Map<string, number> {
    const orderMap = new Map<string, number>()
    options.episodePlan.value.forEach((episode, index) => {
      const key = episode.id?.trim()
      if (!key) return
      const order = typeof episode.index === 'number' && Number.isFinite(episode.index)
        ? Math.max(1, Math.round(episode.index))
        : (index + 1)
      orderMap.set(key, order)
    })
    return orderMap
  }

  function resolveSceneEpisodeOrder(scene: SceneData, episodeOrderMap: Map<string, number>): number {
    const episodeId = scene.episodeId?.trim()
    if (episodeId && episodeOrderMap.has(episodeId)) {
      return episodeOrderMap.get(episodeId) || Number.MAX_SAFE_INTEGER
    }

    if (typeof scene.episodeIndex === 'number' && Number.isFinite(scene.episodeIndex)) {
      return Math.max(1, Math.round(scene.episodeIndex))
    }

    return Number.MAX_SAFE_INTEGER
  }

  function createSceneIdAllocator(existingScenes: SceneData[]) {
    const usedIds = new Set<string>()
    existingScenes.forEach((scene) => {
      usedIds.add(scene.id)
      const sequentialId = scene.id.match(/scene_\d{3}$/u)?.[0]
      if (sequentialId) {
        usedIds.add(sequentialId)
      }
    })
    let nextIndex = 0

    return () => {
      let id = toSceneId(nextIndex)
      while (usedIds.has(id)) {
        nextIndex += 1
        id = toSceneId(nextIndex)
      }
      usedIds.add(id)
      nextIndex += 1
      return id
    }
  }

  function mergeScenesForEpisode(
    episodeId: string,
    parsedEpisodeScenes: SceneData[]
  ): SceneData[] {
    const normalizedEpisodeId = episodeId.trim()
    const untouchedScenes = options.scenes.value.filter(scene => (scene.episodeId?.trim() || '') !== normalizedEpisodeId)
    const allocateSceneId = createSceneIdAllocator(untouchedScenes)
    const targetEpisode = options.episodePlan.value.find(episode => episode.id?.trim() === normalizedEpisodeId)
    const replacementScenes = parsedEpisodeScenes.map(scene => ({
      ...scene,
      id: allocateSceneId(),
      episodeId: normalizedEpisodeId,
      episodeTitle: targetEpisode?.title || scene.episodeTitle,
      episodeIndex: typeof targetEpisode?.index === 'number' && Number.isFinite(targetEpisode.index)
        ? targetEpisode.index
        : scene.episodeIndex
    }))
    const mergedScenes = [...untouchedScenes, ...replacementScenes]
    const episodeOrderMap = resolveEpisodeOrderMap()

    mergedScenes.sort((left, right) => {
      const orderDiff = resolveSceneEpisodeOrder(left, episodeOrderMap) - resolveSceneEpisodeOrder(right, episodeOrderMap)
      if (orderDiff !== 0) return orderDiff
      return left.id.localeCompare(right.id, 'zh-CN')
    })

    return mergedScenes.map((scene, index) => ({
      ...scene,
      active: index === 0
    }))
  }

  function isIncompletePlanCharacter(character: CharacterData): boolean {
    return character.id.startsWith('char_plan_') && !character.baseImage
      && /原文未明确|原文未提及|保持与剧本设定一致/u.test(character.appearance || '')
  }

  function characterBaselines() {
    return options.characters.value
      .filter(character => character.appearance?.trim() && !isIncompletePlanCharacter(character))
      .map(character => ({ name: character.name, description: character.appearance, role: character.role, gender: character.gender }))
  }

  function mergeCharactersFromPartialParse(parsedCharacters: CharacterData[]): CharacterData[] {
    const merged: CharacterData[] = options.characters.value.map(character => ({
      ...character,
      role: normalizeCharacterRoleText(character.role) || '配角'
    }))
    const nameMap = new Map<string, CharacterData>()
    const idSet = new Set<string>(merged.map(character => character.id))
    const createUniqueCharacterId = (): string => {
      // Deleted collaboration resources retain their IDs permanently. The
      // visible character count cannot tell us which historical IDs are taken.
      let id = `char_parse_${crypto.randomUUID()}`
      while (idSet.has(id)) id = `char_parse_${crypto.randomUUID()}`
      idSet.add(id)
      return id
    }

    for (const character of merged) {
      const key = normalizeNameKey(character.name)
      if (!key) continue
      nameMap.set(key, character)
    }

    for (const incoming of parsedCharacters) {
      const key = normalizeNameKey(incoming.name)
      if (!key) continue

      const existing = nameMap.get(key)
      if (existing) {
        const incomingAppearance = incoming.appearance?.trim() || ''
        const existingAppearance = existing.appearance?.trim() || ''
        // Compatibility for old directories containing placeholders only.
        // Concrete settings and generated images must never change on parsing.
        const canUpgradePlanAppearance = isIncompletePlanCharacter(existing) && !!incomingAppearance

        if ((!existingAppearance && incomingAppearance) || canUpgradePlanAppearance) {
          existing.appearance = incomingAppearance
        }
        if (!existing.gender && incoming.gender) {
          existing.gender = incoming.gender
        }
        const incomingRole = normalizeCharacterRoleText(incoming.role)
        const existingRole = normalizeCharacterRole(existing.role)
        if (
          incomingRole
          && incomingRole !== '配角'
          && (!existingRole || existingRole === '配角')
        ) {
          existing.role = incomingRole
        }
        continue
      }

      const nextCharacter: CharacterData = {
        ...incoming,
        role: normalizeCharacterRoleText(incoming.role) || '配角',
        id: createUniqueCharacterId(),
        generating: false,
        generatingViews: false
      }
      merged.push(nextCharacter)
      nameMap.set(key, nextCharacter)
    }

    return merged
  }

  function resolveEpisodeParsePayload(targetEpisodeId: string): {
    requestText: string
    requestEpisodePlan: Array<Pick<ScriptEpisodePlanItem, 'id' | 'title' | 'index' | 'startOffset' | 'endOffset' | 'episodeHook' | 'humiliationOrThreat' | 'reversalPoint' | 'emotionalCurve' | 'cliffhanger' | 'payoffType' | 'episodeAssets'>>
    targetEpisodeTitle?: string
    targetEpisodeId: string
  } {
    const normalizedTargetId = targetEpisodeId.trim()
    const targetEpisode = options.episodePlan.value.find(item => item.id === normalizedTargetId)
    if (!targetEpisode) {
      throw new Error('目标分集不存在，请先重新生成分集目录')
    }

    const normalizedText = normalizeScriptInputText(options.novelText.value)
    const startOffset = Math.max(0, Math.min(normalizedText.length, Math.floor(targetEpisode.startOffset || 0)))
    const endOffset = Math.max(startOffset, Math.min(normalizedText.length, Math.floor(targetEpisode.endOffset || 0)))
    const episodeText = normalizedText.slice(startOffset, endOffset).trim()
    if (!episodeText) {
      throw new Error('该分集正文为空，请调整分集边界后重试')
    }

    return {
      requestText: episodeText,
      requestEpisodePlan: [{
        id: targetEpisode.id,
        title: targetEpisode.title,
        index: targetEpisode.index,
        startOffset: 0,
        endOffset: episodeText.length,
        episodeHook: targetEpisode.episodeHook,
        humiliationOrThreat: targetEpisode.humiliationOrThreat,
        reversalPoint: targetEpisode.reversalPoint,
        emotionalCurve: targetEpisode.emotionalCurve,
        cliffhanger: targetEpisode.cliffhanger,
        payoffType: targetEpisode.payoffType,
        episodeAssets: targetEpisode.episodeAssets
      }],
      targetEpisodeTitle: targetEpisode.title,
      targetEpisodeId: targetEpisode.id
    }
  }

  function mergeCharactersFromEpisodeAssets(episodes: ScriptEpisodePlanItem[]) {
    const existingNameMap = new Map<string, CharacterData>(
      options.characters.value.map(character => [character.name.trim(), character] as const)
    )
    let changed = false

    for (const episode of episodes) {
      for (const item of episode.episodeAssets?.characters || []) {
        const name = item.name?.trim()
        if (!name) continue
        if (isNarrativePronounCharacterName(name)) continue

        const existing = existingNameMap.get(name)
        const description = item.description?.trim() || ''
        const role = normalizeCharacterRoleText(item.role) || '配角'
        const gender = normalizeCharacterGenderText(item.gender)
        if (existing) {
          if ((!existing.appearance || isIncompletePlanCharacter(existing)) && description) {
            existing.appearance = description
            changed = true
          }
          if (!existing.gender && gender) {
            existing.gender = gender
            changed = true
          }
          const existingRole = normalizeCharacterRole(existing.role) || '配角'
          if (role !== '配角' && existingRole === '配角') {
            existing.role = role
            changed = true
          }
          continue
        }

        const nextCharacter: CharacterData = {
          id: `char_plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          appearance: description || `${name}，保持与剧本设定一致`,
          role,
          gender,
          generating: false,
          generatingViews: false
        }
        options.characters.value.push(nextCharacter)
        existingNameMap.set(name, nextCharacter)
        changed = true
      }
    }

    return changed
  }

  function appendProgressLog(message: string, source: ParseScriptProgressEvent['source']) {
    const nextLogs = [
      ...options.parseProgress.value.logs,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        message,
        source
      }
    ]
    options.parseProgress.value.logs = nextLogs.slice(-20)
  }

  function applyProgressEvent(event: ParseScriptProgressEvent) {
    if (event.source === 'heartbeat') {
      appendProgressLog(event.message, event.source)
      return
    }
    const previousStreamState = options.parseProgress.value.streamState
    options.parseProgress.value.streamState = event.streamState
    if (event.streamState) {
      options.parseProgress.value.outputChars = event.outputChars
      options.parseProgress.value.lastModelActivityAt = Date.now()
    }
    options.parseProgress.value.step = event.step
    options.parseProgress.value.message = event.message
    if (typeof event.progress === 'number' && Number.isFinite(event.progress)) {
      options.parseProgress.value.progress = Math.max(
        0,
        Math.min(100, Math.round(event.progress))
      )
    }
    if (typeof event.chunkIndex === 'number') options.parseProgress.value.chunkIndex = event.chunkIndex
    if (typeof event.chunkCount === 'number') options.parseProgress.value.chunkCount = event.chunkCount
    // Keep the log readable while the live counter updates with every streamed chunk.
    if (!event.streamState || event.streamState !== previousStreamState) {
      appendProgressLog(event.message, event.source)
    }
  }

  async function prepareEpisodePlan(): Promise<boolean> {
    if (!options.novelText.value.trim()) return false

    if (options.scriptParseMode.value === 'origin_explainer') {
      const normalizedText = normalizeScriptInputText(options.novelText.value)
      const title = options.projectName.value && options.projectName.value !== '新项目'
        ? options.projectName.value
        : '科普拆解'
      options.episodePlan.value = [{
        id: 'episode_origin_explainer',
        title,
        index: 1,
        startOffset: 0,
        endOffset: normalizedText.length,
        charCount: normalizedText.length,
        episodeHook: '用多镜头视觉拆解讲清楚核心原理',
        emotionalCurve: '结构出现 -> 能量或力进入 -> 关键变化 -> 输出结果',
        episodeAssets: {
          characters: [],
          environments: [],
          props: []
        }
      }]
      await saveProjectOrThrow('科普拆解目录已创建')
      options.parseProgress.value = {
        ...createInitialAssetWorkbenchParseProgressState(),
        step: 'episode-plan-completed',
        message: '已创建科普拆解镜头规划入口',
        progress: 100
      }
      return true
    }

    const operation = beginParseOperation()
    options.parsing.value = true
    options.parseProgress.value = {
      ...createInitialAssetWorkbenchParseProgressState(),
      active: true,
      startedAt: Date.now(),
      kind: 'directory',
      step: 'episode-plan',
      message: '正在生成分集目录与统一资产设定',
      progress: 5
    }
    appendProgressLog('正在生成分集目录与统一资产设定', 'progress')

    try {
      const episodes = await prepareAssetWorkbenchEpisodePlan(
        options.novelText.value,
        options.scriptParseMode.value,
        {
          projectId: options.projectId?.value,
          signal: operation.signal,
          style: options.currentStylePrompt.value,
          characterBaselines: characterBaselines(),
          onProgress: (event) => {
            if (isCurrentParseOperation(operation)) applyProgressEvent(event)
          }
        }
      )
      if (!isCurrentParseOperation(operation)) return false
      if (!episodes.length) throw new Error('分集目录模型结果为空，请重试或检查模型配置')
      options.episodePlan.value = episodes
      mergeCharactersFromEpisodeAssets(episodes)
      await saveProjectOrThrow('分集目录生成完成', operation.projectId)
      if (!isCurrentParseOperation(operation)) return false
      options.parseProgress.value.step = 'episode-plan-completed'
      options.parseProgress.value.message = `分集目录已生成，共 ${episodes.length} 集`
      options.parseProgress.value.progress = 100
      appendProgressLog(`分集目录已生成，共 ${episodes.length} 集`, 'progress')
      if (episodes.length > 0) {
        await notifyModelTaskCompleted({
          title: '分集目录生成完成',
          body: `共生成 ${episodes.length} 集分集目录`
        })
      }
      return episodes.length > 0
    } catch (error) {
      if (!isCurrentParseOperation(operation)) return false
      console.error('[useAssetWorkbench] 生成分集目录失败:', error)
      const message = getDisplayErrorMessage(error, '分集目录生成失败')
      options.parseProgress.value.failedStep = options.parseProgress.value.step
      options.parseProgress.value.step = 'error'
      options.parseProgress.value.message = message
      appendProgressLog(message, 'progress')
      await notifyModelTaskFailed({
        title: '分集目录生成失败',
        body: message
      })
      return false
    } finally {
      if (isCurrentParseOperation(operation)) {
        options.parsing.value = false
        options.parseProgress.value.active = false
        options.parseProgress.value.finishedAt = Date.now()
      }
    }
  }

  async function parseScript(input: {
    style?: string
    scriptParseMode?: ScriptParseMode
    descriptionFormat?: 'visual' | 'timeline'
    targetEpisodeId: string
  }): Promise<boolean> {
    if (!options.novelText.value.trim()) return false
    if (!input.targetEpisodeId.trim()) {
      options.parseProgress.value = {
        ...createInitialAssetWorkbenchParseProgressState(),
        step: 'error',
        message: '请选择要解析的分集'
      }
      return false
    }
    if (options.episodePlan.value.length === 0) {
      options.parseProgress.value = {
        ...createInitialAssetWorkbenchParseProgressState(),
        step: 'error',
        message: '请先生成分集目录后再解析'
      }
      return false
    }

    const operation = beginParseOperation()
    options.parsing.value = true
    const parseModeText = '分集解析任务已创建，等待模型响应'
    options.parseProgress.value = {
      ...createInitialAssetWorkbenchParseProgressState(),
      active: true,
      startedAt: Date.now(),
      kind: 'episode',
      targetEpisodeId: input.targetEpisodeId,
      step: 'queued',
      message: parseModeText,
      progress: 1
    }
    appendProgressLog(parseModeText, 'progress')

    try {
      const parsePayload = resolveEpisodeParsePayload(input.targetEpisodeId)
      options.parseProgress.value.targetEpisodeId = parsePayload.targetEpisodeId
      options.parseProgress.value.targetEpisodeTitle = parsePayload.targetEpisodeTitle
      const response = await parseAssetWorkbenchScript({
        text: parsePayload.requestText,
        signal: operation.signal,
        projectId: options.projectId?.value,
        targetEpisodeId: parsePayload.targetEpisodeId,
        scriptParseMode: input?.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
        style: input?.style || options.currentStylePrompt.value || undefined,
        characterBaselines: characterBaselines(),
        episodePlan: parsePayload.requestEpisodePlan,
        onProgress: (event) => {
          if (isCurrentParseOperation(operation)) {
            applyProgressEvent(event)
          }
        }
      })

      if (!isCurrentParseOperation(operation)) return false

      if (!response.success || !Array.isArray(response.data?.scenes) || response.data.scenes.length === 0) {
        const message = '解析失败：模型未返回有效场景数据'
        options.parseProgress.value.failedStep = options.parseProgress.value.step
        options.parseProgress.value.step = 'error'
        options.parseProgress.value.message = message
        appendProgressLog(message, 'progress')
        await notifyModelTaskFailed({
          title: '分集解析失败',
          body: message
        })
        return false
      }

      if (response.data.title && options.projectName.value === '新项目') {
        options.projectName.value = response.data.title
      }

      options.parseProgress.value.step = 'merging'
      options.parseProgress.value.message = '正在校验分镜并保存到当前分集'
      appendProgressLog(options.parseProgress.value.message, 'progress')
      const parsedScenes = buildParsedScenes({
        scenes: response.data.scenes,
        descriptionFormat: input?.descriptionFormat
      })
      const parsedCharacters = buildParsedCharacters(response.data.characters, parsedScenes)

      options.scenes.value = mergeScenesForEpisode(parsePayload.targetEpisodeId, parsedScenes)
      const previousCharacterCount = options.characters.value.length
      options.characters.value = mergeCharactersFromPartialParse(parsedCharacters)
      const newCharacterCount = options.characters.value.length - previousCharacterCount

      await saveProjectOrThrow(`${parsePayload.targetEpisodeTitle || '当前分集'}解析完成`, operation.projectId)
      if (!isCurrentParseOperation(operation)) return false
      options.parseProgress.value.step = 'completed'
      options.parseProgress.value.message = `已完成 ${parsePayload.targetEpisodeTitle || '当前分集'} 解析${newCharacterCount ? `，新增 ${newCharacterCount} 个角色，请到资产准备检查` : ''}`
      options.parseProgress.value.progress = 100
      appendProgressLog(options.parseProgress.value.message, 'progress')
      await notifyModelTaskCompleted({
        title: '分集解析完成',
        body: `已生成 ${options.scenes.value.length} 个场景和 ${options.characters.value.length} 个角色`
      })
      return true
    } catch (error) {
      if (!isCurrentParseOperation(operation)) return false
      console.error('[useAssetWorkbench] 解析剧本失败:', error)
      const message = error instanceof Error ? error.message : '解析失败'
      options.parseProgress.value.failedStep = options.parseProgress.value.step
      options.parseProgress.value.step = 'error'
      options.parseProgress.value.message = message
      appendProgressLog(message, 'progress')
      await notifyModelTaskFailed({
        title: '分集解析失败',
        body: message
      })
      return false
    } finally {
      if (isCurrentParseOperation(operation)) {
        options.parsing.value = false
        options.parseProgress.value.active = false
        options.parseProgress.value.finishedAt = Date.now()
      }
    }
  }

  async function generateCharacter(
    char: CharacterData,
    input?: {
      regenerationPrompt?: string
      referenceImage?: string
      skipCompletionNotice?: boolean
    }
  ) {
    const regenerationPrompt = input?.regenerationPrompt?.trim()
    const referenceImage = input?.referenceImage?.trim() || char.baseImage?.trim()
    const previousImage = char.baseImage?.trim() || ''

    if (regenerationPrompt && !referenceImage) {
      throw new Error('二次生成需要参考图，请先生成角色图后再试')
    }

    char.generating = true

    try {
      const response = await generateAssetWorkbenchCharacter({
        character: char,
        projectId: options.projectId?.value,
        style: options.currentStylePrompt.value,
        regenerationPrompt,
        referenceImage
      })

      if (!response.success || !response.asset?.baseImage) {
        throw new Error(response.error || '角色图生成失败')
      }

      const currentCharacter = options.characters.value.find(item => item.id === char.id)
      if (!currentCharacter) {
        throw new Error('角色图已生成，但项目中的角色资产已不存在')
      }
      currentCharacter.baseImage = response.asset.baseImage
      await saveProjectOrThrow(`角色 ${currentCharacter.name} 生成完成`)

      const generatedImage = currentCharacter.baseImage?.trim() || ''
      if (generatedImage && generatedImage !== previousImage && !input?.skipCompletionNotice) {
        await notifyModelTaskCompleted({
          title: regenerationPrompt ? '角色二次生成完成' : '角色图生成完成',
          body: `角色：${currentCharacter.name}`
        })
      }
    } catch (error) {
      console.error('[useAssetWorkbench] 角色生成失败:', error)
      if (!input?.skipCompletionNotice) {
        const message = error instanceof Error ? error.message : '角色图生成失败'
        await notifyModelTaskFailed({
          title: regenerationPrompt ? '角色二次生成失败' : '角色图生成失败',
          body: `角色：${char.name}（${message}）`
        })
      }
      throw error
    } finally {
      char.generating = false
      const currentCharacter = options.characters.value.find(item => item.id === char.id)
      if (currentCharacter) currentCharacter.generating = false
    }
  }

  async function batchGenerateCharacters(
    onProgress?: (current: number, total: number, name: string) => void
  ) {
    const pendingCharacters = options.characters.value.filter(character => !character.baseImage)
    const total = pendingCharacters.length

    if (total === 0) {
      return { success: true, generated: 0, failed: 0, total: 0 }
    }

    let generated = 0
    let failed = 0

    for (let index = 0; index < pendingCharacters.length; index += 1) {
      const character = pendingCharacters[index]
      if (!character) continue

      onProgress?.(index + 1, total, character.name)

      try {
        await generateCharacter(character, {
          skipCompletionNotice: true
        })
        generated += 1
      } catch (error) {
        console.error(`[useAssetWorkbench] 角色 ${character.name} 生成失败:`, error)
        failed += 1
      }
    }

    await notifyModelTaskCompleted({
      title: '角色批量生成完成',
      body: `成功 ${generated} / ${total}${failed > 0 ? `，失败 ${failed}` : ''}`
    })

    return { success: true, generated, failed, total }
  }

  return {
    prepareEpisodePlan,
    parseScript,
    generateCharacter,
    batchGenerateCharacters
  }
}

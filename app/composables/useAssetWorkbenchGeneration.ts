import type { Ref } from 'vue'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import { normalizeCharacterGender, normalizeCharacterRole } from '#shared/types/character'
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

export interface AssetWorkbenchParseProgressLogItem {
  id: string
  message: string
  source: ParseScriptProgressEvent['source']
}

export interface AssetWorkbenchParseProgressState {
  active: boolean
  step: string
  message: string
  progress: number
  chunkIndex: number | null
  chunkCount: number | null
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
    logs: []
  }
}

interface UseAssetWorkbenchGenerationOptions {
  projectName: Ref<string>
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  scriptParseMode: Ref<ScriptParseMode>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  parsing: Ref<boolean>
  parseProgress: Ref<AssetWorkbenchParseProgressState>
  currentStylePrompt: Ref<string>
  saveProject: () => Promise<unknown>
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}

export function useAssetWorkbenchGeneration(
  options: UseAssetWorkbenchGenerationOptions
) {
  function notifyModelTaskCompleted(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskCompleted) return

    // 通知是附加能力，不应阻塞主流程（避免 loading 无法回收）
    void Promise.resolve(options.onModelTaskCompleted(payload))
      .catch((error) => {
        console.warn('[useAssetWorkbench] 模型任务完成通知失败:', error)
      })
  }

  async function saveProjectOrThrow(context: string): Promise<void> {
    const saved = await options.saveProject()
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

  function toCharacterId(index: number): string {
    return `char_${index + 1}`
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
    const replacementScenes = parsedEpisodeScenes.map(scene => ({
      ...scene,
      id: allocateSceneId()
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

  function mergeCharactersFromPartialParse(parsedCharacters: CharacterData[]): CharacterData[] {
    const merged: CharacterData[] = options.characters.value.map(character => ({
      ...character,
      role: normalizeCharacterRole(character.role) || 'supporting'
    }))
    const nameMap = new Map<string, CharacterData>()
    const idSet = new Set<string>(merged.map(character => character.id))
    let nextCharacterIndex = merged.length + 1

    const createUniqueCharacterId = (): string => {
      while (idSet.has(toCharacterId(nextCharacterIndex - 1))) {
        nextCharacterIndex += 1
      }
      const id = toCharacterId(nextCharacterIndex - 1)
      idSet.add(id)
      nextCharacterIndex += 1
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
        const canUpgradePlanAppearance = existing.id.startsWith('char_plan_')
          && !!incomingAppearance
          && incomingAppearance.length >= existingAppearance.length

        if ((!existingAppearance && incomingAppearance) || canUpgradePlanAppearance) {
          existing.appearance = incomingAppearance
        }
        if (!existing.gender && incoming.gender) {
          existing.gender = incoming.gender
        }
        const incomingRole = normalizeCharacterRole(incoming.role)
        const existingRole = normalizeCharacterRole(existing.role)
        if (
          incomingRole
          && incomingRole !== 'supporting'
          && (!existingRole || existingRole === 'supporting')
        ) {
          existing.role = incomingRole
        }
        continue
      }

      const nextCharacter: CharacterData = {
        ...incoming,
        role: normalizeCharacterRole(incoming.role) || 'supporting',
        id: createUniqueCharacterId(),
        generating: false,
        generatingViews: false
      }
      merged.push(nextCharacter)
      nameMap.set(key, nextCharacter)
    }

    return merged
  }

  function resolveEpisodeParsePayload(targetEpisodeId?: string): {
    requestText: string
    requestEpisodePlan: Array<Pick<ScriptEpisodePlanItem, 'id' | 'title' | 'index' | 'startOffset' | 'endOffset' | 'episodeHook' | 'humiliationOrThreat' | 'reversalPoint' | 'emotionalCurve' | 'cliffhanger' | 'payoffType' | 'episodeAssets'>>
    targetEpisodeTitle?: string
    targetEpisodeId?: string
  } {
    const normalizedTargetId = targetEpisodeId?.trim() || ''
    if (!normalizedTargetId) {
      return {
        requestText: options.novelText.value,
        requestEpisodePlan: options.episodePlan.value.map(item => ({
          id: item.id,
          title: item.title,
          index: item.index,
          startOffset: item.startOffset,
          endOffset: item.endOffset,
          episodeHook: item.episodeHook,
          humiliationOrThreat: item.humiliationOrThreat,
          reversalPoint: item.reversalPoint,
          emotionalCurve: item.emotionalCurve,
          cliffhanger: item.cliffhanger,
          payoffType: item.payoffType,
          episodeAssets: item.episodeAssets
        }))
      }
    }

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

        const existing = existingNameMap.get(name)
        const description = item.description?.trim() || ''
        const role = normalizeCharacterRole(item.role) || 'supporting'
        const gender = normalizeCharacterGender(item.gender)
        if (existing) {
          if (!existing.appearance && description) {
            existing.appearance = description
            changed = true
          }
          if (!existing.gender && gender) {
            existing.gender = gender
            changed = true
          }
          const existingRole = normalizeCharacterRole(existing.role) || 'supporting'
          if (role !== 'supporting' && existingRole === 'supporting') {
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
    options.parseProgress.value.step = event.step
    options.parseProgress.value.message = event.message
    if (typeof event.progress === 'number' && Number.isFinite(event.progress)) {
      options.parseProgress.value.progress = Math.max(
        0,
        Math.min(100, Math.round(event.progress))
      )
    }
    options.parseProgress.value.chunkIndex = typeof event.chunkIndex === 'number'
      ? event.chunkIndex
      : null
    options.parseProgress.value.chunkCount = typeof event.chunkCount === 'number'
      ? event.chunkCount
      : null
    appendProgressLog(event.message, event.source)
  }

  async function prepareEpisodePlan(): Promise<boolean> {
    if (!options.novelText.value.trim()) return false

    options.parsing.value = true
    options.parseProgress.value = {
      ...createInitialAssetWorkbenchParseProgressState(),
      active: true,
      step: 'episode-plan',
      message: '正在生成分集目录',
      progress: 5
    }
    appendProgressLog('正在生成分集目录', 'progress')

    try {
      const episodes = await prepareAssetWorkbenchEpisodePlan(
        options.novelText.value,
        options.scriptParseMode.value
      )
      options.episodePlan.value = episodes
      mergeCharactersFromEpisodeAssets(episodes)
      await saveProjectOrThrow('分集目录生成完成')
      options.parseProgress.value.step = 'episode-plan-completed'
      options.parseProgress.value.message = `分集目录已生成，共 ${episodes.length} 集`
      options.parseProgress.value.progress = 100
      appendProgressLog(`分集目录已生成，共 ${episodes.length} 集`, 'progress')
      if (episodes.length > 0) {
        notifyModelTaskCompleted({
          title: '分集目录生成完成',
          body: `共生成 ${episodes.length} 集分集目录`
        })
      }
      return episodes.length > 0
    } catch (error) {
      console.error('[useAssetWorkbench] 生成分集目录失败:', error)
      const message = error instanceof Error ? error.message : '分集目录生成失败'
      options.parseProgress.value.step = 'error'
      options.parseProgress.value.message = message
      appendProgressLog(message, 'progress')
      return false
    } finally {
      options.parsing.value = false
      options.parseProgress.value.active = false
    }
  }

  async function parseScript(input?: {
    style?: string
    scriptParseMode?: ScriptParseMode
    descriptionFormat?: 'visual' | 'timeline'
    targetEpisodeId?: string
  }): Promise<boolean> {
    if (!options.novelText.value.trim()) return false
    if (options.episodePlan.value.length === 0) {
      options.parseProgress.value = {
        ...createInitialAssetWorkbenchParseProgressState(),
        step: 'error',
        message: '请先生成分集目录后再解析'
      }
      return false
    }

    options.parsing.value = true
    const parseModeText = input?.targetEpisodeId ? '分集解析任务已创建，等待模型响应' : '解析任务已创建，等待模型响应'
    options.parseProgress.value = {
      ...createInitialAssetWorkbenchParseProgressState(),
      active: true,
      step: 'queued',
      message: parseModeText,
      progress: 1
    }
    appendProgressLog(parseModeText, 'progress')

    try {
      const parsePayload = resolveEpisodeParsePayload(input?.targetEpisodeId)
      const response = await parseAssetWorkbenchScript({
        text: parsePayload.requestText,
        scriptParseMode: input?.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
        style: input?.style || options.currentStylePrompt.value || undefined,
        episodePlan: parsePayload.requestEpisodePlan,
        onProgress: applyProgressEvent
      })

      if (!response.success || !response.data?.scenes) {
        options.parseProgress.value.message = '解析失败：模型未返回有效场景数据'
        return false
      }

      if (response.data.title && options.projectName.value === '新项目') {
        options.projectName.value = response.data.title
      }

      const parsedScenes = buildParsedScenes({
        scenes: response.data.scenes,
        descriptionFormat: input?.descriptionFormat
      })
      const parsedCharacters = buildParsedCharacters(response.data.characters, parsedScenes)

      if (parsePayload.targetEpisodeId) {
        options.scenes.value = mergeScenesForEpisode(parsePayload.targetEpisodeId, parsedScenes)
        options.characters.value = mergeCharactersFromPartialParse(parsedCharacters)
      } else {
        options.scenes.value = parsedScenes
        options.characters.value = parsedCharacters
      }

      await saveProjectOrThrow(parsePayload.targetEpisodeId
        ? `${parsePayload.targetEpisodeTitle || '当前分集'}解析完成`
        : '剧本解析完成')
      options.parseProgress.value.step = 'completed'
      options.parseProgress.value.message = parsePayload.targetEpisodeId
        ? `已完成 ${parsePayload.targetEpisodeTitle || '当前分集'} 解析`
        : '剧本解析完成'
      options.parseProgress.value.progress = 100
      appendProgressLog(options.parseProgress.value.message, 'progress')
      notifyModelTaskCompleted({
        title: parsePayload.targetEpisodeId ? '分集解析完成' : '剧本解析完成',
        body: `已生成 ${options.scenes.value.length} 个场景和 ${options.characters.value.length} 个角色`
      })
      return true
    } catch (error) {
      console.error('[useAssetWorkbench] 解析剧本失败:', error)
      const message = error instanceof Error ? error.message : '解析失败'
      options.parseProgress.value.step = 'error'
      options.parseProgress.value.message = message
      appendProgressLog(message, 'progress')
      return false
    } finally {
      options.parsing.value = false
      options.parseProgress.value.active = false
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
        style: options.currentStylePrompt.value,
        regenerationPrompt,
        referenceImage
      })

      if (response.success && response.asset?.baseImage) {
        char.baseImage = response.asset.baseImage
        await saveProjectOrThrow(`角色 ${char.name} 生成完成`)

        const generatedImage = char.baseImage?.trim() || ''
        if (generatedImage && generatedImage !== previousImage && !input?.skipCompletionNotice) {
          notifyModelTaskCompleted({
            title: regenerationPrompt ? '角色二次生成完成' : '角色图生成完成',
            body: `角色：${char.name}`
          })
        }
      }
    } catch (error) {
      console.error('[useAssetWorkbench] 角色生成失败:', error)
      throw error
    } finally {
      char.generating = false
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

    notifyModelTaskCompleted({
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

import type { Ref } from 'vue'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import {
  generateAssetWorkbenchCharacter,
  parseAssetWorkbenchScript,
  type ParseScriptProgressEvent,
  type AssetWorkbenchWorkflowType
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

  async function parseScript(input?: {
    workflowType?: AssetWorkbenchWorkflowType
    style?: string
    scriptParseMode?: ScriptParseMode
    descriptionFormat?: 'visual' | 'timeline'
  }): Promise<boolean> {
    if (!options.novelText.value.trim()) return false

    options.parsing.value = true
    options.parseProgress.value = {
      ...createInitialAssetWorkbenchParseProgressState(),
      active: true,
      step: 'queued',
      message: '解析任务已创建，等待模型响应',
      progress: 1
    }
    appendProgressLog('解析任务已创建，等待模型响应', 'progress')

    try {
      const response = await parseAssetWorkbenchScript({
        text: options.novelText.value,
        workflowType: input?.workflowType || 'asset_consistency',
        scriptParseMode: input?.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
        style: input?.style || options.currentStylePrompt.value || undefined,
        onProgress: applyProgressEvent
      })

      if (!response.success || !response.data?.scenes) {
        options.parseProgress.value.message = '解析失败：模型未返回有效场景数据'
        return false
      }

      if (response.data.title && options.projectName.value === '新项目') {
        options.projectName.value = response.data.title
      }

      options.scenes.value = buildParsedScenes({
        scenes: response.data.scenes,
        descriptionFormat: input?.descriptionFormat
      })
      options.characters.value = buildParsedCharacters(response.data.characters, options.scenes.value)

      await options.saveProject()
      options.parseProgress.value.step = 'completed'
      options.parseProgress.value.message = '剧本解析完成'
      options.parseProgress.value.progress = 100
      appendProgressLog('剧本解析完成', 'progress')
      await options.onModelTaskCompleted?.({
        title: '剧本解析完成',
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
      workflowType?: AssetWorkbenchWorkflowType
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
        workflowType: input?.workflowType || 'asset_consistency',
        regenerationPrompt,
        referenceImage
      })

      if (response.success && response.asset?.baseImage) {
        char.baseImage = response.asset.baseImage
        await options.saveProject()

        const generatedImage = char.baseImage?.trim() || ''
        if (generatedImage && generatedImage !== previousImage && !input?.skipCompletionNotice) {
          await options.onModelTaskCompleted?.({
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
    onProgress?: (current: number, total: number, name: string) => void,
    input?: { workflowType?: AssetWorkbenchWorkflowType }
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
          ...input,
          skipCompletionNotice: true
        })
        generated += 1
      } catch (error) {
        console.error(`[useAssetWorkbench] 角色 ${character.name} 生成失败:`, error)
        failed += 1
      }
    }

    await options.onModelTaskCompleted?.({
      title: '角色批量生成完成',
      body: `成功 ${generated} / ${total}${failed > 0 ? `，失败 ${failed}` : ''}`
    })

    return { success: true, generated, failed, total }
  }

  return {
    parseScript,
    generateCharacter,
    batchGenerateCharacters
  }
}

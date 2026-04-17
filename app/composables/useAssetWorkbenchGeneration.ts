import type { Ref } from 'vue'
import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import {
  generateAssetWorkbenchCharacter,
  parseAssetWorkbenchScript,
  type AssetWorkbenchWorkflowType
} from '~/lib/asset-workbench-api'
import {
  buildParsedCharacters,
  buildParsedScenes
} from '~/lib/asset-workbench-script-parsing'

interface UseAssetWorkbenchGenerationOptions {
  projectName: Ref<string>
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  parsing: Ref<boolean>
  parsedTimelineText: Ref<string>
  currentStylePrompt: Ref<string>
  saveProject: () => Promise<unknown>
}

export function useAssetWorkbenchGeneration(
  options: UseAssetWorkbenchGenerationOptions
) {
  async function parseScript(input?: {
    workflowType?: AssetWorkbenchWorkflowType
    style?: string
    descriptionFormat?: 'visual' | 'timeline'
  }): Promise<boolean> {
    if (!options.novelText.value.trim()) return false

    options.parsing.value = true
    options.parsedTimelineText.value = ''

    try {
      const response = await parseAssetWorkbenchScript({
        text: options.novelText.value,
        workflowType: input?.workflowType || 'asset_consistency',
        style: input?.style || options.currentStylePrompt.value || undefined
      })

      if (!response.success || !response.data?.scenes) {
        return false
      }

      const timelineLines = Array.isArray(response.formattedTimeline?.lines)
        ? response.formattedTimeline.lines
            .filter((line): line is string => typeof line === 'string')
            .map(line => line.trim())
        : []

      options.parsedTimelineText.value = response.formattedTimeline?.text?.trim() || ''

      if (response.data.title && options.projectName.value === '新项目') {
        options.projectName.value = response.data.title
      }

      options.scenes.value = buildParsedScenes({
        scenes: response.data.scenes,
        timelineLines,
        descriptionFormat: input?.descriptionFormat
      })
      options.characters.value = buildParsedCharacters(response.data.characters, options.scenes.value)

      await options.saveProject()
      return true
    } catch (error) {
      console.error('[useAssetWorkbench] 解析剧本失败:', error)
      return false
    } finally {
      options.parsing.value = false
    }
  }

  async function generateCharacter(
    char: CharacterData,
    input?: {
      workflowType?: AssetWorkbenchWorkflowType
      regenerationPrompt?: string
      referenceImage?: string
    }
  ) {
    const regenerationPrompt = input?.regenerationPrompt?.trim()
    const referenceImage = input?.referenceImage?.trim() || char.baseImage?.trim()

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
        await generateCharacter(character, input)
        generated += 1
      } catch (error) {
        console.error(`[useAssetWorkbench] 角色 ${character.name} 生成失败:`, error)
        failed += 1
      }
    }

    return { success: true, generated, failed, total }
  }

  return {
    parseScript,
    generateCharacter,
    batchGenerateCharacters
  }
}

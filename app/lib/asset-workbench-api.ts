import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  toOptionalNumber,
  toOptionalString,
  toOptionalStringArray
} from '~/lib/asset-workbench-values'

export type AssetWorkbenchWorkflowType = 'asset_consistency'

interface ParseScriptResponse {
  success: boolean
  data?: {
    title?: string
    scenes: Array<{
      id: string
      title?: string
      shotType?: SceneData['shotType']
      description: string
      characters: Array<{ name: string, appearance?: string, emotion?: string }>
      dialogues?: Array<{ character: string, text: string, emotion?: string }>
      narration?: string | null
      duration: number
      setting?: { location: string, timeOfDay: string, mood?: string, weather?: string }
    }>
    characters?: Array<{ name: string, description?: string, role?: string }>
  }
  formattedTimeline?: {
    lines?: string[]
    text?: string
  }
}

interface GenerateCharacterResponse {
  success: boolean
  asset?: { baseImage: string }
}

export async function parseAssetWorkbenchScript(options: {
  text: string
  workflowType?: AssetWorkbenchWorkflowType
  style?: string
}) {
  return await $fetch<ParseScriptResponse>('/api/script/parse', {
    method: 'POST',
    body: {
      text: options.text,
      workflowType: options.workflowType || 'asset_consistency',
      style: options.style || undefined
    }
  })
}

export async function generateAssetWorkbenchCharacter(options: {
  character: CharacterData
  style: string
  workflowType?: AssetWorkbenchWorkflowType
  regenerationPrompt?: string
  referenceImage?: string
}) {
  return await $fetch<GenerateCharacterResponse>('/api/character/generate', {
    method: 'POST',
    body: {
      character: {
        id: options.character.id,
        name: options.character.name,
        appearance: options.character.appearance || `${options.character.name}，动漫风格角色`,
        role: options.character.role || 'supporting',
        gender: toOptionalString(options.character.gender),
        age: toOptionalNumber(options.character.age),
        personality: toOptionalString(options.character.personality),
        traits: toOptionalStringArray(options.character.traits)
      },
      style: options.style,
      generateExpressions: false,
      workflowType: options.workflowType || 'asset_consistency',
      regeneration: options.regenerationPrompt
        ? {
            customPrompt: options.regenerationPrompt,
            referenceImage: options.referenceImage
          }
        : undefined
    }
  })
}

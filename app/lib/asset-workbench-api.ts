import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
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
      setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
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

interface ScriptDocxExportSceneInput {
  title?: string
  description?: string
  narration?: string | null
  duration?: number
  setting?: {
    location?: string
    timeOfDay?: string
  }
  characters?: Array<{ name?: string }>
  dialogues?: Array<{
    character?: string
    text?: string
  }>
}

interface ScriptDocxExportOptions {
  projectName?: string
  scenes: ScriptDocxExportSceneInput[]
  includeDialoguesFromDescription?: boolean
}

interface ScriptDocxExportResult {
  blob: Blob
  fileName: string
}

function resolveFileNameFromContentDisposition(raw: string | null): string | null {
  if (!raw) return null

  const encodedMatch = raw.match(/filename\*=UTF-8''([^;]+)/iu)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1])
    } catch {
      return encodedMatch[1]
    }
  }

  const plainMatch = raw.match(/filename="?([^";]+)"?/iu)
  if (!plainMatch?.[1]) return null
  return plainMatch[1]
}

function buildFallbackScriptDocxFileName(date = new Date()): string {
  return `剧本-格式化剧本-${date.toISOString().slice(0, 10)}.docx`
}

export async function parseAssetWorkbenchScript(options: {
  text: string
  workflowType?: AssetWorkbenchWorkflowType
  scriptParseMode?: ScriptParseMode
  style?: string
}) {
  return await $fetch<ParseScriptResponse>('/api/script/parse', {
    method: 'POST',
    body: {
      text: options.text,
      workflowType: options.workflowType || 'asset_consistency',
      scriptParseMode: options.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
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

export async function exportAssetWorkbenchScriptDocx(
  options: ScriptDocxExportOptions
): Promise<ScriptDocxExportResult> {
  const response = await fetch('/api/script/export-docx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      projectName: options.projectName,
      scenes: options.scenes,
      includeDialoguesFromDescription: options.includeDialoguesFromDescription
    })
  })

  if (!response.ok) {
    let message = '导出 DOCX 失败'

    try {
      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        const payload = await response.json() as {
          message?: string
          statusMessage?: string
        }
        message = payload?.message || payload?.statusMessage || message
      } else {
        const rawText = (await response.text()).trim()
        if (rawText) {
          message = rawText
        }
      }
    } catch {
      // Ignore parse errors and keep fallback message.
    }

    throw new Error(message)
  }

  const blob = await response.blob()
  const fileName = resolveFileNameFromContentDisposition(
    response.headers.get('content-disposition')
  ) || buildFallbackScriptDocxFileName()

  return {
    blob,
    fileName
  }
}

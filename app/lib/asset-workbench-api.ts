import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type SceneDramatic,
  type ScriptParseMode
} from '#shared/types/script'
import { normalizeCharacterRole } from '#shared/types/character'
import {
  toOptionalNumber,
  toOptionalString,
  toOptionalStringArray
} from '~/lib/asset-workbench-values'

export interface ScriptEpisodeAssetSummary {
  characters: Array<{
    name: string
    description?: string
    role?: string
    gender?: string
  }>
  props: Array<{
    name: string
    description?: string
  }>
  environments: Array<{
    location: string
    timeOfDay?: string
    mood?: string
  }>
}

export interface ScriptEpisodePlanItem {
  id: string
  title: string
  index: number
  startOffset: number
  endOffset: number
  charCount: number
  episodeHook?: string
  humiliationOrThreat?: string
  reversalPoint?: string
  emotionalCurve?: string
  cliffhanger?: string
  payoffType?: string
  episodeAssets?: ScriptEpisodeAssetSummary
}

export interface ParseScriptResponse {
  success: boolean
  data?: {
    title?: string
    scenes: Array<{
      id: string
      episodeId?: string
      episodeTitle?: string
      episodeIndex?: number
      title?: string
      shotType?: SceneData['shotType']
      description: string
      dramatic?: SceneDramatic
      characters: Array<{ name: string, appearance?: string, emotion?: string }>
      dialogues?: Array<{ character: string, text: string, emotion?: string }>
      narration?: string | null
      duration: number
      setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
    }>
    characters?: Array<{ name: string, description?: string, role?: string, gender?: string }>
  }
  formattedTimeline?: {
    lines?: string[]
    text?: string
  }
  parseStrategy?: {
    segmented?: boolean
    chunkCount?: number
    episodeCount?: number
    recommendedMinScenes?: number
    chunkRecommendedSceneHints?: number[]
  }
}

export interface ParseScriptProgressEvent {
  source: 'progress' | 'heartbeat'
  step: string
  message: string
  progress?: number
  chunkIndex?: number
  chunkCount?: number
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

interface JianyingExportSceneDialogueInput {
  character?: string
  text?: string
}

interface JianyingExportSceneInput {
  id: string
  title?: string
  videoUrl: string
  duration?: number
  narration?: string | null
  dialogues?: JianyingExportSceneDialogueInput[]
}

interface JianyingExportOptions {
  projectName?: string
  aspectRatio?: '16:9' | '9:16' | '1:1'
  sceneOrder?: string[]
  scenes: JianyingExportSceneInput[]
  options?: {
    addSubtitles?: boolean
    transition?: {
      type?: 'fade' | 'dissolve' | 'wipe' | 'none'
      duration?: number
    }
    bgm?: {
      url: string
      volume?: number
    }
  }
}

interface JianyingExportResult {
  blob: Blob
  fileName: string
}

interface EpisodePlanResponse {
  success: boolean
  data?: {
    episodes?: ScriptEpisodePlanItem[]
  }
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

function buildFallbackJianyingProjectFileName(date = new Date()): string {
  return `剧本-剪映工程-${date.toISOString().slice(0, 10)}.zip`
}

export async function parseAssetWorkbenchScript(options: {
  text: string
  scriptParseMode?: ScriptParseMode
  style?: string
  episodePlan: Array<Pick<ScriptEpisodePlanItem, 'id' | 'title' | 'index' | 'startOffset' | 'endOffset' | 'episodeHook' | 'humiliationOrThreat' | 'reversalPoint' | 'emotionalCurve' | 'cliffhanger' | 'payoffType'>>
  onProgress?: (event: ParseScriptProgressEvent) => void
}) {
  const requestBody = {
    text: options.text,
    scriptParseMode: options.scriptParseMode || DEFAULT_SCRIPT_PARSE_MODE,
    style: options.style || undefined,
    episodePlan: options.episodePlan
  }

  if (!options.onProgress) {
    return await $fetch<ParseScriptResponse>('/api/script/parse', {
      method: 'POST',
      body: requestBody
    })
  }

  const response = await fetch('/api/script/parse-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    let message = '剧本解析失败'
    try {
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await response.json() as { message?: string, statusMessage?: string }
        message = payload.message || payload.statusMessage || message
      } else {
        const rawText = (await response.text()).trim()
        if (rawText) message = rawText
      }
    } catch {
      // Ignore parse errors and keep fallback message.
    }
    throw new Error(message)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('解析流不可用，请稍后重试')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: ParseScriptResponse | null = null

  const emitProgress = (event: ParseScriptProgressEvent) => {
    options.onProgress?.(event)
  }

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const event = JSON.parse(trimmed) as {
      type?: string
      payload?: Record<string, unknown>
    }

    if (event.type === 'progress') {
      emitProgress({
        source: 'progress',
        step: String(event.payload?.step || 'progress'),
        message: String(event.payload?.message || '解析中'),
        progress: typeof event.payload?.progress === 'number' ? event.payload.progress : undefined,
        chunkIndex: typeof event.payload?.chunkIndex === 'number' ? event.payload.chunkIndex : undefined,
        chunkCount: typeof event.payload?.chunkCount === 'number' ? event.payload.chunkCount : undefined
      })
      return
    }

    if (event.type === 'heartbeat') {
      emitProgress({
        source: 'heartbeat',
        step: 'heartbeat',
        message: String(event.payload?.message || '解析中')
      })
      return
    }

    if (event.type === 'error') {
      throw new Error(String(event.payload?.message || '剧本解析失败'))
    }

    if (event.type === 'result') {
      finalResult = event.payload as unknown as ParseScriptResponse
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let lineBreakIndex = buffer.indexOf('\n')
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex)
      buffer = buffer.slice(lineBreakIndex + 1)
      handleLine(line)
      lineBreakIndex = buffer.indexOf('\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    handleLine(buffer)
  }

  if (!finalResult) {
    throw new Error('解析流已结束，但未收到结果')
  }

  return finalResult
}

export async function prepareAssetWorkbenchEpisodePlan(
  text: string,
  scriptParseMode: ScriptParseMode = DEFAULT_SCRIPT_PARSE_MODE
): Promise<ScriptEpisodePlanItem[]> {
  const response = await $fetch<EpisodePlanResponse>('/api/script/episode-plan', {
    method: 'POST',
    body: { text, scriptParseMode }
  })

  if (!response.success || !Array.isArray(response.data?.episodes)) {
    throw new Error('分集目录生成失败')
  }

  return response.data.episodes
}

export async function generateAssetWorkbenchCharacter(options: {
  character: CharacterData
  style: string
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
        role: normalizeCharacterRole(options.character.role) || 'supporting',
        gender: toOptionalString(options.character.gender),
        age: toOptionalNumber(options.character.age),
        personality: toOptionalString(options.character.personality),
        traits: toOptionalStringArray(options.character.traits)
      },
      style: options.style,
      generateExpressions: false,
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

export async function exportAssetWorkbenchJianyingProject(
  options: JianyingExportOptions
): Promise<JianyingExportResult> {
  const response = await fetch('/api/video/export-jianying', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(options)
  })

  if (!response.ok) {
    let message = '导出剪映工程失败'

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
  ) || buildFallbackJianyingProjectFileName()

  return {
    blob,
    fileName
  }
}

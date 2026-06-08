import defaultPromptTemplates from '../../src-tauri/assets/default-prompt-templates.json'

export type PromptCategory = 'text' | 'image' | 'video'

export const PROMPT_FLOW_STAGES = ['parse', 'assets', 'videos'] as const
export type PromptFlowStage = (typeof PROMPT_FLOW_STAGES)[number]

export const PROMPT_FLOW_STAGE_LABELS: Record<PromptFlowStage, string> = {
  parse: '剧本解析',
  assets: '资产准备',
  videos: '分镜视频'
}

export interface PromptVariable {
  name: string
  description: string
  example?: string
  optional?: boolean
}

export type PromptContent = string

export interface PromptTemplate {
  id: string
  name: string
  category: PromptCategory
  description: string
  content: PromptContent
  variables: PromptVariable[]
  isCustomized: boolean
  updatedAt: string
}

export const PROMPT_DEFAULT_PROFILE_ID = 'default'
export const PROMPT_READONLY_PROFILE_IDS = [
  PROMPT_DEFAULT_PROFILE_ID
] as const

export function isPromptReadonlyProfile(
  profileId: string | null | undefined
): boolean {
  if (!profileId) return false
  return PROMPT_READONLY_PROFILE_IDS.includes(profileId as (typeof PROMPT_READONLY_PROFILE_IDS)[number])
}

export interface PromptTemplateProfile {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface PromptVersion {
  id: string
  templateId: string
  content: PromptContent
  createdAt: string
  note?: string
}

export const PROMPT_TEMPLATE_IDS = {
  SCRIPT_PARSING: 'script_parsing',
  SCRIPT_PARSING_SHORT_DRAMA: 'script_parsing_short_drama',
  SCRIPT_EPISODE_PLAN: 'script_episode_plan',
  SCRIPT_PARSING_SEGMENT_CONTEXT: 'script_parsing_segment_context',
  SCRIPT_PARSING_EPISODE_DRAMA_CONTEXT: 'script_parsing_episode_drama_context',
  CHARACTER_SHEET: 'character_sheet',
  CHARACTER_REGENERATION: 'character_regeneration',
  ENVIRONMENT_REFERENCE_GENERATION: 'environment_reference_generation',
  ENVIRONMENT_REFERENCE_NEGATIVE_PROMPT: 'environment_reference_negative_prompt',
  PROP_ASSET_GENERATION: 'prop_asset_generation',
  PROP_ASSET_NEGATIVE_PROMPT: 'prop_asset_negative_prompt',
  SCENE_DESCRIPTION_REFINEMENT: 'scene_description_refinement',
  SCENE_VIDEO_GENERATION: 'scene_video_generation'
} as const

export type PromptTemplateId = typeof PROMPT_TEMPLATE_IDS[keyof typeof PROMPT_TEMPLATE_IDS]

export interface PromptTemplateMetadata {
  id: PromptTemplateId
  name: string
  category: PromptCategory
  stage: PromptFlowStage
  description: string
  variables: PromptVariable[]
}

type RawPromptTemplate = {
  id?: unknown
  name?: unknown
  category?: unknown
  description?: unknown
  variables?: unknown
}

type RawPromptVariable = {
  name?: unknown
  description?: unknown
  example?: unknown
  optional?: unknown
}

const PROMPT_TEMPLATE_STAGES: Record<PromptTemplateId, PromptFlowStage> = {
  script_episode_plan: 'parse',
  script_parsing: 'parse',
  script_parsing_short_drama: 'parse',
  script_parsing_segment_context: 'parse',
  script_parsing_episode_drama_context: 'parse',
  character_sheet: 'assets',
  character_regeneration: 'assets',
  environment_reference_generation: 'assets',
  environment_reference_negative_prompt: 'assets',
  prop_asset_generation: 'assets',
  prop_asset_negative_prompt: 'assets',
  scene_description_refinement: 'assets',
  scene_video_generation: 'videos'
}

const PROMPT_TEMPLATE_ID_SET = new Set<string>(Object.values(PROMPT_TEMPLATE_IDS))
const PROMPT_CATEGORY_SET = new Set<PromptCategory>(['text', 'image', 'video'])

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePromptVariable(value: unknown): PromptVariable | null {
  const variable = value as RawPromptVariable
  const name = normalizeString(variable.name)
  const description = normalizeString(variable.description)
  if (!name || !description) return null

  const normalized: PromptVariable = {
    name,
    description
  }
  const example = normalizeString(variable.example)
  if (example) normalized.example = example
  if (variable.optional === true) normalized.optional = true
  return normalized
}

function normalizePromptTemplateMetadata(template: RawPromptTemplate): PromptTemplateMetadata | null {
  const id = normalizeString(template.id) as PromptTemplateId
  if (!PROMPT_TEMPLATE_ID_SET.has(id)) return null

  const category = normalizeString(template.category) as PromptCategory
  if (!PROMPT_CATEGORY_SET.has(category)) return null

  const name = normalizeString(template.name)
  const description = normalizeString(template.description)
  const stage = PROMPT_TEMPLATE_STAGES[id]
  if (!name || !description || !stage) return null

  const variables = Array.isArray(template.variables)
    ? template.variables
        .map(normalizePromptVariable)
        .filter((variable): variable is PromptVariable => variable !== null)
    : []

  return {
    id,
    name,
    category,
    stage,
    description,
    variables
  }
}

export const PROMPT_TEMPLATE_METADATA: PromptTemplateMetadata[] = (defaultPromptTemplates as RawPromptTemplate[])
  .map(normalizePromptTemplateMetadata)
  .filter((template): template is PromptTemplateMetadata => template !== null)

export function isPromptTemplateVisibleForWorkflow(
  templateId: PromptTemplateId,
  _workflow?: unknown
): boolean {
  return PROMPT_TEMPLATE_METADATA.some(item => item.id === templateId)
}

export function getPromptTemplateMetadataForWorkflow(
  _workflow?: unknown
): PromptTemplateMetadata[] {
  return PROMPT_TEMPLATE_METADATA
}

export function applyPromptTemplateWorkflowDisplay(
  template: PromptTemplate,
  _workflow?: unknown
): PromptTemplate {
  return template
}

export const PROMPT_TEMPLATES_BY_CATEGORY: Record<PromptCategory, PromptTemplateMetadata[]> = {
  text: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'text'),
  image: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'image'),
  video: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'video')
}

export const CATEGORY_NAMES: Record<PromptCategory, string> = {
  text: '文本生成',
  image: '图片生成',
  video: '视频生成'
}

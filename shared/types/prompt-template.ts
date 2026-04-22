/**
 * 提示词模板类型定义
 * 仅保留当前工作台主流程：解析 → 资产 → 视频
 */
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from './project'

export type PromptCategory = 'text' | 'image' | 'video'

export const PROMPT_FLOW_STAGES = ['parse', 'assets', 'videos'] as const
export type PromptFlowStage = (typeof PROMPT_FLOW_STAGES)[number]

export const PROMPT_FLOW_STAGE_LABELS: Record<PromptFlowStage, string> = {
  parse: '解析',
  assets: '资产',
  videos: '场景视频'
}

export interface PromptVariable {
  name: string
  description: string
  example?: string
}

export interface BilingualContent {
  zh: string
  en: string
}

export interface PromptTemplate {
  id: string
  name: string
  category: PromptCategory
  description: string
  content: BilingualContent
  variables: PromptVariable[]
  isCustomized: boolean
  updatedAt: string
}

export const PROMPT_DEFAULT_PROFILE_ID = 'default'
export const PROMPT_SEEDANCE_PROFILE_ID = 'default_seedance'
export const PROMPT_READONLY_PROFILE_IDS = [
  PROMPT_DEFAULT_PROFILE_ID,
  PROMPT_SEEDANCE_PROFILE_ID
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
  content: BilingualContent
  createdAt: string
  note?: string
}

export const PROMPT_TEMPLATE_IDS = {
  SCRIPT_PARSING: 'script_parsing',
  CHARACTER_SHEET: 'character_sheet',
  CHARACTER_REGENERATION: 'character_regeneration',
  ENVIRONMENT_REFERENCE_GENERATION: 'environment_reference_generation',
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
  workflows?: ProjectWorkflowType[]
  workflowOverrides?: Partial<Record<ProjectWorkflowType, {
    name?: string
    description?: string
  }>>
}

export const PROMPT_TEMPLATE_METADATA: PromptTemplateMetadata[] = [
  {
    id: 'script_parsing',
    name: '剧本解析与资产规划',
    category: 'text',
    stage: 'parse',
    description: '将原文解析为结构化场景、角色和后续可直接生成的视频时间轴',
    variables: [
      { name: '{{novelText}}', description: '剧本/原文内容', example: '第一章 相遇...' },
      { name: '{{style}}', description: '项目画风描述', example: '电影写实风格' },
      { name: '{{textLength}}', description: '输入文本长度（字数）', example: '1580' },
      { name: '{{recommendedMinScenes}}', description: '建议最少场景数', example: '12' },
      { name: '{{sceneDurationMin}}', description: '场景最小时长（秒）', example: '2' },
      { name: '{{sceneDurationMax}}', description: '场景最大时长（秒）', example: '15' }
    ]
  },
  {
    id: 'character_sheet',
    name: '角色资产生成',
    category: 'image',
    stage: 'assets',
    description: '生成角色一致性所需的基准设定图',
    variables: [
      { name: '{{characterName}}', description: '角色名称', example: '陆哲' },
      { name: '{{appearance}}', description: '角色外貌描述', example: '黑色短发，戴眼镜的年轻男性...' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' }
    ]
  },
  {
    id: 'character_regeneration',
    name: '角色资产二次生成',
    category: 'image',
    stage: 'assets',
    description: '在保持角色身份稳定的前提下，对角色参考图做定向修改',
    variables: [
      { name: '{{characterName}}', description: '角色名称', example: '陆哲' },
      { name: '{{appearance}}', description: '角色外貌描述', example: '黑色短发，戴眼镜的年轻男性...' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' },
      { name: '{{activeStyleConstraint}}', description: '当前生效的修改要求', example: '将服装改为浅灰风衣，并增强冷色氛围' },
      { name: '{{customPrompt}}', description: '用户自定义修改要求（兼容空值）', example: '将服装改为浅灰风衣，并增强冷色氛围' }
    ]
  },
  {
    id: 'environment_reference_generation',
    name: '环境参考图生成',
    category: 'image',
    stage: 'assets',
    description: '生成单张可裁切的纯环境全景源图，作为场景一致性视频的空间基底',
    variables: [
      { name: '{{sceneTitle}}', description: '场景标题', example: '雨夜医院走廊' },
      { name: '{{sceneDescription}}', description: '环境摘要（已去除人物动作与对白）', example: '核心空间：医院走廊\n时间：夜晚\n环境细节：冷白灯照亮狭长走廊，地面有潮湿反光。' },
      { name: '{{setting}}', description: '场景设定文本', example: '医院-走廊 / 夜晚 / 紧绷 / 暴雨' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' },
      { name: '{{aspectRatio}}', description: '最终截图比例与全景取景约束', example: '先生成 AR 4:1（2880*720）360环绕等距柱状环境全景源图，避免鱼眼/桶形畸变，后续裁切为 9:16' },
      { name: '{{environmentConsistency}}', description: '环境连续性约束文本', example: '主环境：医院；与相邻场景保持同一建筑年代与材质语言。' },
      { name: '{{cameraNote}}', description: '镜头与资产备注', example: '引用资产：急诊大厅、手术室门牌' },
      { name: '{{customPrompt}}', description: '二次生成补充要求', example: '保留医院冷白灯，但把地面湿痕强化一些。' }
    ]
  },
  {
    id: 'scene_description_refinement',
    name: '场景描述二次改写',
    category: 'text',
    stage: 'assets',
    description: '根据编辑指令、上下文和资产引用，重写场景时间轴描述',
    variables: [
      { name: '{{style}}', description: '项目画风描述', example: '电影写实风格' },
      { name: '{{sceneTitle}}', description: '场景标题', example: '雨夜街头对峙' },
      { name: '{{sceneDescription}}', description: '当前场景描述', example: '0-3秒：，中景，固定镜头。护士站[图片1]人来人往...' },
      { name: '{{setting}}', description: '场景设定文本', example: '- 地点：医院-走廊\n- 时间：夜晚' },
      { name: '{{characters}}', description: '角色信息文本', example: '- 陆哲，外观：白大褂，情绪：得意' },
      { name: '{{narration}}', description: '旁白文本', example: '旁白：空气里弥漫着消毒水气味。' },
      { name: '{{dialogues}}', description: '对白文本', example: '- 陆哲：你们等着看。' },
      { name: '{{history}}', description: '最近的场景编辑对话', example: '用户：把节奏改快一些' },
      { name: '{{userMessage}}', description: '本次用户修改指令', example: '把镜头改得更压迫，突出门外闪电' },
      { name: '{{mentionedAssets}}', description: '本次提及资产文本', example: '- 环境：医院走廊，有参考图' },
      { name: '{{durationHint}}', description: '目标时长提示（秒）', example: '8' }
    ]
  },
  {
    id: 'scene_video_generation',
    name: '场景视频生成',
    category: 'video',
    stage: 'videos',
    description: '基于环境/角色参考素材与时间轴描述生成单场景视频',
    workflows: ['asset_consistency'],
    variables: [
      { name: '{{shotNumber}}', description: '镜头序号', example: '2' },
      { name: '{{sceneTitle}}', description: '场景标题', example: '雨夜街头对峙' },
      { name: '{{sceneSummary}}', description: '镜头摘要文本', example: '护士站，陆哲炫耀即将进行开颅手术' },
      { name: '{{sceneDescription}}', description: '场景描述', example: '主角在霓虹灯下缓慢走向镜头...' },
      { name: '{{setting}}', description: '场景设定文本', example: '城市天桥 / 夜晚 / 紧绷 / 暴雨' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' },
      { name: '{{timelineLines}}', description: '分段时间轴镜头描述', example: '0-3秒：，中景，固定镜头。...\n3-8秒：，近景，缓慢推近。...' },
      { name: '{{referenceMaterials}}', description: '参考素材列表文本', example: '图1：环境参考图...\n图2：角色参考图...' },
      { name: '{{executionConstraints}}', description: '执行约束列表文本', example: '- 输入模式：single_image\n- 严格保持角色一致性...' },
      { name: '{{referenceGuide}}', description: '参考图说明', example: '参考图说明：图1为角色，图2为环境。' },
      { name: '{{duration}}', description: '目标时长（秒）', example: '8' },
      { name: '{{aspectRatio}}', description: '输出画面比例', example: '16:9' },
      { name: '{{narration}}', description: '旁白文本', example: '雨势渐大，空气里弥漫着紧张。' }
    ]
  }
]

function resolveWorkflowOverride(
  metadata: PromptTemplateMetadata,
  workflow: ProjectWorkflowType
): { name?: string, description?: string } | undefined {
  return metadata.workflowOverrides?.[workflow]
}

function applyMetadataWorkflowOverride(
  metadata: PromptTemplateMetadata,
  workflow: ProjectWorkflowType
): PromptTemplateMetadata {
  const override = resolveWorkflowOverride(metadata, workflow)
  if (!override) return metadata

  return {
    ...metadata,
    name: override.name || metadata.name,
    description: override.description || metadata.description
  }
}

export function isPromptTemplateVisibleForWorkflow(
  templateId: PromptTemplateId,
  workflow: ProjectWorkflowType | string | null | undefined
): boolean {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
  const metadata = PROMPT_TEMPLATE_METADATA.find(item => item.id === templateId)
  if (!metadata) return false
  if (!metadata.workflows || metadata.workflows.length === 0) return true
  return metadata.workflows.includes(normalizedWorkflow)
}

export function getPromptTemplateMetadataForWorkflow(
  workflow: ProjectWorkflowType | string | null | undefined
): PromptTemplateMetadata[] {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)

  return PROMPT_TEMPLATE_METADATA
    .filter((item) => {
      if (!item.workflows || item.workflows.length === 0) return true
      return item.workflows.includes(normalizedWorkflow)
    })
    .map(item => applyMetadataWorkflowOverride(item, normalizedWorkflow))
}

export function applyPromptTemplateWorkflowDisplay(
  template: PromptTemplate,
  workflow: ProjectWorkflowType | string | null | undefined
): PromptTemplate {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
  const metadata = PROMPT_TEMPLATE_METADATA.find(item => item.id === template.id)
  if (!metadata) return template

  const override = resolveWorkflowOverride(metadata, normalizedWorkflow)
  if (!override) return template

  return {
    ...template,
    name: override.name || template.name,
    description: override.description || template.description
  }
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

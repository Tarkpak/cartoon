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
  SCRIPT_PARSING_SHORT_DRAMA: 'script_parsing_short_drama',
  PROMPT_TRANSLATION_SYSTEM: 'prompt_translation_system',
  PROMPT_TRANSLATION_USER: 'prompt_translation_user',
  CHARACTER_SHEET: 'character_sheet',
  CHARACTER_REGENERATION: 'character_regeneration',
  ENVIRONMENT_REFERENCE_GENERATION: 'environment_reference_generation',
  ENVIRONMENT_REFERENCE_NEGATIVE_PROMPT: 'environment_reference_negative_prompt',
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
      { name: '{{recommendedMinScenes}}', description: '可选场景数量提示（未提供时由模型自行决定，非硬限制）', example: '12' },
      { name: '{{sceneDurationMin}}', description: '场景最小时长（秒）', example: '2' },
      { name: '{{sceneDurationMax}}', description: '场景最大时长（秒）', example: '15' },
      { name: '{{scriptParseModeLabel}}', description: '解析模式标签', example: '短剧' },
      { name: '{{scriptParseModeRules}}', description: '解析模式策略文本', example: '时段\t秒数\t情绪曲线\t功能\n开场钩子\t0-8s\t震惊→冰冷\t抓住注意力...' },
      { name: '{{eraHint}}', description: '时代推断提示（如现代/民国/古代）', example: '现代' }
    ]
  },
  {
    id: 'script_parsing_short_drama',
    name: '短剧解析与爆点节奏规划',
    category: 'text',
    stage: 'parse',
    description: '将原文映射为短剧高节奏结构，优先强钩子、情绪暴击与结尾反击预告',
    variables: [
      { name: '{{novelText}}', description: '剧本/原文内容', example: '第一章 相遇...' },
      { name: '{{style}}', description: '项目画风描述', example: '电影写实风格' },
      { name: '{{textLength}}', description: '输入文本长度（字数）', example: '1580' },
      { name: '{{recommendedMinScenes}}', description: '可选场景数量提示（未提供时由模型自行决定，非硬限制）', example: '8' },
      { name: '{{sceneDurationMin}}', description: '场景最小时长（秒）', example: '2' },
      { name: '{{sceneDurationMax}}', description: '场景最大时长（秒）', example: '15' },
      { name: '{{eraHint}}', description: '时代推断提示（如现代/民国/古代）', example: '现代' }
    ]
  },
  {
    id: 'prompt_translation_system',
    name: '提示词翻译系统指令',
    category: 'text',
    stage: 'parse',
    description: '定义提示词翻译器的系统角色和规则',
    variables: [
      { name: '{{fromLang}}', description: '源语言名称', example: '中文' },
      { name: '{{toLang}}', description: '目标语言名称', example: 'English' }
    ]
  },
  {
    id: 'prompt_translation_user',
    name: '提示词翻译请求模板',
    category: 'text',
    stage: 'parse',
    description: '定义翻译请求正文结构',
    variables: [
      { name: '{{fromLang}}', description: '源语言名称', example: '中文' },
      { name: '{{toLang}}', description: '目标语言名称', example: 'English' },
      { name: '{{sourceText}}', description: '待翻译原文', example: '你是一位资深分镜师...' }
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
      { name: '{{aspectRatio}}', description: '目标输出与全景源图规格上下文', example: '目标输出画幅：9:16\n全景源图画幅：21:9\n全景源图尺寸：2100*900\n裁切策略：后续从全景源图裁切为 9:16' },
      { name: '{{environmentConsistency}}', description: '环境连续性上下文文本', example: '主环境锚点：医院\n母体参考场景：急诊大厅（医院-大厅）\n同组子空间：医院-走廊、医院-诊室' },
      { name: '{{cameraNote}}', description: '镜头与资产备注', example: '引用资产：急诊大厅、手术室门牌' },
      { name: '{{customPrompt}}', description: '二次生成补充要求', example: '保留医院冷白灯，但把地面湿痕强化一些。' }
    ]
  },
  {
    id: 'environment_reference_negative_prompt',
    name: '环境参考图负向约束',
    category: 'image',
    stage: 'assets',
    description: '环境参考图生成时的 negative prompt（排除项）',
    variables: []
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
      { name: '{{sceneDescription}}', description: '当前场景描述', example: '0-3秒：，中景，固定镜头。护士站@图片1人来人往...' },
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
    description: '基于环境/角色参考素材与场景详细描述生成单场景视频',
    workflows: ['asset_consistency'],
    variables: [
      { name: '{{shotNumber}}', description: '镜头序号', example: '2' },
      { name: '{{sceneTitle}}', description: '场景标题', example: '雨夜街头对峙' },
      { name: '{{sceneSummary}}', description: '镜头摘要文本', example: '护士站，陆哲炫耀即将进行开颅手术' },
      { name: '{{sceneDescription}}', description: '场景描述', example: '主角在霓虹灯下缓慢走向镜头...' },
      { name: '{{setting}}', description: '场景设定文本', example: '城市天桥 / 夜晚 / 紧绷 / 暴雨' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' },
      { name: '{{referenceMaterials}}', description: '参考素材列表文本', example: '图1：环境参考图...\n图2：角色参考图...' },
      { name: '{{executionConstraints}}', description: '执行上下文信息', example: '- 输入模式：single_image\n- 参考策略：多参考图模式（环境+角色）\n- 主参考图：环境（雨夜街头）' },
      { name: '{{referenceGuide}}', description: '参考图策略说明', example: '多参考图模式（环境+角色）' },
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

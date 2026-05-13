/**
 * 提示词模板类型定义
 * 仅保留当前工作台主流程：解析 → 资产 → 视频
 */

export type PromptCategory = 'text' | 'image' | 'video'

export const PROMPT_FLOW_STAGES = ['parse', 'assets', 'videos'] as const
export type PromptFlowStage = (typeof PROMPT_FLOW_STAGES)[number]

export const PROMPT_FLOW_STAGE_LABELS: Record<PromptFlowStage, string> = {
  parse: '解析',
  assets: '资产',
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

export const PROMPT_TEMPLATE_METADATA: PromptTemplateMetadata[] = [
  {
    id: 'script_parsing',
    name: '剧本解析与资产规划',
    category: 'text',
    stage: 'parse',
    description: '将原文解析为结构化场景、角色和后续可直接生成的分镜时间轴',
    variables: [
      { name: '{{novelText}}', description: '剧本/原文内容', example: '第一章 相遇...' },
      { name: '{{style}}', description: '项目画风描述', example: '电影写实风格' },
      { name: '{{textLength}}', description: '输入文本长度（字数）', example: '1580' },
      { name: '{{recommendedMinScenes}}', description: '可选场景数量提示（未提供时由模型自行决定，非硬限制）', example: '12', optional: true },
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
      { name: '{{recommendedMinScenes}}', description: '可选场景数量提示（未提供时由模型自行决定，非硬限制）', example: '8', optional: true },
      { name: '{{sceneDurationMin}}', description: '场景最小时长（秒）', example: '2' },
      { name: '{{sceneDurationMax}}', description: '场景最大时长（秒）', example: '15' },
      { name: '{{eraHint}}', description: '时代推断提示（如现代/民国/古代）', example: '现代' }
    ]
  },
  {
    id: 'script_episode_plan',
    name: '分集目录规划',
    category: 'text',
    stage: 'parse',
    description: '将长文本按剧情节点拆分为分集目录，并输出爆点与资产规划',
    variables: [
      { name: '{{novelText}}', description: '待拆分原文', example: '第一章...' },
      { name: '{{modeRule}}', description: '解析模式规则文本', example: '短剧模式额外约束：请由剧情节奏决定分集数量...' },
      { name: '{{chunkRule}}', description: '分段输入约束', example: '当前仅提供原文第 1/3 段，请严格基于本段文本拆分...' },
      { name: '{{firstAnchorRule}}', description: '首集锚点规则', example: '第1集 startAnchor 必须取“本段开头”的连续片段。' }
    ]
  },
  {
    id: 'script_parsing_segment_context',
    name: '剧本解析分段补充',
    category: 'text',
    stage: 'parse',
    description: '分段解析时追加系统上下文，约束模型只处理当前段并避免跨段补写',
    variables: [
      { name: '{{basePrompt}}', description: '基础解析提示词正文', example: '你是一位资深分镜师...' },
      { name: '{{chunkIndex}}', description: '当前分段序号（从 1 开始）', example: '2' },
      { name: '{{chunkCount}}', description: '总分段数', example: '5' },
      { name: '{{chunkLength}}', description: '当前分段文本长度', example: '18420' },
      { name: '{{chunkPercentage}}', description: '当前分段占比（百分比数字）', example: '23.6' }
    ]
  },
  {
    id: 'script_parsing_episode_drama_context',
    name: '剧本解析分集补充（爆点+资产锚点）',
    category: 'text',
    stage: 'parse',
    description: '把分集规划摘要（爆点与资产锚点）以系统补充方式追加到剧本解析提示词中',
    variables: [
      { name: '{{basePrompt}}', description: '基础解析提示词正文', example: '你是一位资深分镜师...' },
      { name: '{{episodeDramaBrief}}', description: '本集规划摘要（爆点 + 资产锚点）', example: '开场钩子：...\n压迫/羞辱：...\n反击/反转：...\n角色资产：...' }
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
      { name: '{{gender}}', description: '角色性别呈现约束', example: '男性。必须呈现明确男性特征...' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' }
    ]
  },
  {
    id: 'character_regeneration',
    name: '角色资产二次生成',
    category: 'image',
    stage: 'assets',
    description: '角色二次生成的规则模板（在保持身份稳定前提下执行定向修改）',
    variables: [
      { name: '{{characterName}}', description: '角色名称', example: '陆哲' },
      { name: '{{appearance}}', description: '角色外貌描述', example: '黑色短发，戴眼镜的年轻男性...' },
      { name: '{{gender}}', description: '角色性别呈现约束', example: '男性。必须呈现明确男性特征...' },
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
      { name: '{{aspectRatio}}', description: '目标裁切比例与 2:1 equirectangular 全景源图规格上下文', example: '目标输出画幅：9:16\n全景源图画幅：2:1\n全景源图尺寸：2048*1024\n裁切策略：后续从全景源图裁切为 9:16' },
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
    id: 'prop_asset_generation',
    name: '道具资产生成',
    category: 'image',
    stage: 'assets',
    description: '生成单张道具/其他资产参考图（纯资产主体），用于后续一致性视频',
    variables: [
      { name: '{{assetLabel}}', description: '资产类型标签', example: '道具资产' },
      { name: '{{style}}', description: '项目画风描述', example: '电影写实风格' },
      { name: '{{assetName}}', description: '资产名称', example: '青铜匕首' },
      { name: '{{assetDescription}}', description: '资产描述', example: '刀鞘有云纹，握把有磨损痕迹。' }
    ]
  },
  {
    id: 'prop_asset_negative_prompt',
    name: '道具资产负向约束',
    category: 'image',
    stage: 'assets',
    description: '道具/其他资产生成时的 negative prompt（排除项）',
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
      { name: '{{sceneDescription}}', description: '当前场景描述', example: '0-3秒：中景，固定镜头。护士站@图片1人来人往...' },
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
    name: '分镜视频生成',
    category: 'video',
    stage: 'videos',
    description: '基于环境/角色参考素材与场景详细描述生成单个分镜片段',
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

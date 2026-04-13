/**
 * 提示词模板类型定义
 * 支持中英双语、版本历史
 */
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from './project'

// 提示词分类
export type PromptCategory = 'text' | 'image' | 'video' | 'audio'

// 变量定义
export interface PromptVariable {
  name: string          // 变量名，如 {{storyIdea}}
  description: string   // 变量说明
  example?: string      // 示例值
}

// 双语内容（简化版：合并系统提示词和用户提示词）
export interface BilingualContent {
  zh: string   // 中文提示词
  en: string   // 英文提示词
}

// 提示词模板
export interface PromptTemplate {
  id: string                    // 唯一标识
  name: string                  // 显示名称
  category: PromptCategory      // 分类
  description: string           // 功能描述
  content: BilingualContent     // 中英双语内容
  variables: PromptVariable[]   // 可用变量列表
  isCustomized: boolean         // 是否已自定义
  updatedAt: string             // 更新时间
}

// 版本历史
export interface PromptVersion {
  id: string                    // 版本ID
  templateId: string            // 模板ID
  content: BilingualContent     // 版本内容
  createdAt: string             // 创建时间
  note?: string                 // 版本备注
}

// 提示词模板ID枚举
export const PROMPT_TEMPLATE_IDS = {
  OUTLINE_GENERATION: 'outline_generation',
  SCRIPT_PARSING: 'script_parsing',
  SCENE_GENERATION: 'scene_generation',
  STORYBOARD_GENERATION: 'storyboard_generation',
  CHARACTER_EXTRACTION: 'character_extraction',
  CHARACTER_FROM_OUTLINE: 'character_from_outline',
  CHARACTER_SHEET: 'character_sheet',
  CHARACTER_REGENERATION: 'character_regeneration',
  SCENE_VISUAL: 'scene_visual',
  FIRST_FRAME_GENERATION: 'first_frame_generation',
  LAST_FRAME_GENERATION: 'last_frame_generation',
  SCENE_VIDEO_GENERATION: 'scene_video_generation',
  TRANSITION: 'transition',
  BGM_GENERATION: 'bgm_generation'
} as const

export type PromptTemplateId = typeof PROMPT_TEMPLATE_IDS[keyof typeof PROMPT_TEMPLATE_IDS]

// 模板元数据（用于菜单显示）
export interface PromptTemplateMetadata {
  id: PromptTemplateId
  name: string
  category: PromptCategory
  description: string
  variables: PromptVariable[]
  workflows?: ProjectWorkflowType[]
  workflowOverrides?: Partial<Record<ProjectWorkflowType, {
    name?: string
    description?: string
  }>>
}

// 所有模板的元数据
export const PROMPT_TEMPLATE_METADATA: PromptTemplateMetadata[] = [
  // 文本生成类
  {
    id: 'outline_generation',
    name: '故事大纲生成',
    category: 'text',
    description: '根据故事创意生成完整的三幕结构故事大纲',
    workflows: ['classic'],
    variables: [
      { name: '{{storyIdea}}', description: '用户输入的故事创意', example: '一个程序员意外获得了预知未来的能力' },
      { name: '{{targetLength}}', description: '目标长度', example: 'medium' },
      { name: '{{genre}}', description: '故事类型（可选）', example: '科幻' }
    ]
  },
  {
    id: 'script_parsing',
    name: '剧本解析',
    category: 'text',
    description: '将小说文本解析为结构化的场景数据',
    variables: [
      { name: '{{novelText}}', description: '小说/剧本原文', example: '第一章 相遇...' },
      { name: '{{style}}', description: '画风描述', example: '日系动漫风格' }
    ]
  },
  {
    id: 'scene_generation',
    name: '场景生成',
    category: 'text',
    description: '根据故事大纲生成详细的分场剧本',
    workflows: ['classic'],
    variables: [
      { name: '{{outline}}', description: '故事大纲JSON', example: '{"title": "...", "acts": [...]}' },
      { name: '{{characters}}', description: '角色列表JSON', example: '[{"name": "...", "appearance": "..."}]' },
      { name: '{{targetSceneCount}}', description: '目标场景数量', example: '8' },
      { name: '{{style}}', description: '画风描述', example: '日系动漫风格' }
    ]
  },
  {
    id: 'storyboard_generation',
    name: '分镜脚本生成',
    category: 'text',
    description: '将场景描述转换为专业分镜脚本',
    workflows: ['classic'],
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '主角站在雨中的街道上...' },
      { name: '{{dialogues}}', description: '对话列表JSON', example: '[{"character": "...", "text": "..."}]' },
      { name: '{{narration}}', description: '场景旁白（可选）', example: '旁白：夜色渐深，街道空无一人。' },
      { name: '{{style}}', description: '画风描述', example: '赛博朋克风格' }
    ]
  },
  {
    id: 'character_extraction',
    name: '角色提取',
    category: 'text',
    description: '从剧本中提取角色并生成外貌描述',
    workflows: ['classic'],
    variables: [
      { name: '{{content}}', description: '剧本内容', example: '小明是一个20岁的大学生...' },
      { name: '{{style}}', description: '画风描述', example: '写实风格' }
    ]
  },
  {
    id: 'character_from_outline',
    name: '角色设计(大纲)',
    category: 'text',
    description: '为故事大纲中的角色设计详细外貌',
    workflows: ['classic'],
    variables: [
      { name: '{{outline}}', description: '故事大纲JSON', example: '{"title": "...", "characters": [...]}' },
      { name: '{{style}}', description: '画风描述', example: '日系动漫风格' }
    ]
  },
  {
    id: 'scene_visual',
    name: '场景视觉提取',
    category: 'text',
    description: '从场景描述中提取视觉元素，生成图片提示词',
    workflows: ['classic'],
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '夕阳下的海边，金色的阳光洒在沙滩上...' },
      { name: '{{setting}}', description: '场景设定JSON', example: '{"location": "海边", "timeOfDay": "evening"}' },
      { name: '{{style}}', description: '画风描述', example: '宫崎骏风格' }
    ]
  },
  // 图片生成类
  {
    id: 'character_sheet',
    name: '角色设定图',
    category: 'image',
    description: '生成角色设定图（三视图+表情）',
    variables: [
      { name: '{{characterName}}', description: '角色名称', example: '小明' },
      { name: '{{appearance}}', description: '角色外貌描述', example: '黑色短发，戴眼镜的年轻男性...' },
      { name: '{{style}}', description: '画风描述', example: '日系动漫风格' }
    ]
  },
  {
    id: 'character_regeneration',
    name: '角色二次生成',
    category: 'image',
    description: '基于已生成角色图进行定向二次修改',
    variables: [
      { name: '{{characterName}}', description: '角色名称', example: '小明' },
      { name: '{{appearance}}', description: '角色外貌描述', example: '黑色短发，戴眼镜的年轻男性...' },
      { name: '{{style}}', description: '画风描述', example: '彩铅真人风格' },
      { name: '{{activeStyleConstraint}}', description: '实际生效的风格约束（用户要求优先，否则回退默认约束）', example: '将服装改为浅灰风衣，并增强冷色氛围' },
      { name: '{{customPrompt}}', description: '用户自定义修改要求（兼容旧模板）', example: '将服装改为浅灰风衣，并增强冷色氛围' }
    ]
  },
  {
    id: 'first_frame_generation',
    name: '首帧生成',
    category: 'image',
    description: '生成场景的开始状态图片（首帧）',
    workflowOverrides: {
      asset_consistency: {
        name: '场景参考图生成',
        description: '生成单张场景参考图（用于资产一致性视频生成）'
      }
    },
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '夕阳下的海边，主角望向远方...' },
      { name: '{{characters}}', description: '场景中的角色JSON', example: '[{"name": "小明", "emotion": "sad", "appearance": "..."}]' },
      { name: '{{style}}', description: '画风描述', example: '宫崎骏风格' },
      { name: '{{setting}}', description: '场景设定JSON', example: '{"location": "海边", "timeOfDay": "evening"}' },
      { name: '{{storyboardShot}}', description: '分镜镜头信息JSON', example: '{"shotType": "wide", "cameraMovement": "static"}' }
    ]
  },
  {
    id: 'last_frame_generation',
    name: '尾帧生成',
    category: 'image',
    description: '基于首帧生成场景的结束状态图片（尾帧）',
    workflows: ['classic'],
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '夕阳下的海边，主角转身离开...' },
      { name: '{{characters}}', description: '场景中的角色JSON', example: '[{"name": "小明", "emotion": "determined"}]' },
      { name: '{{style}}', description: '画风描述', example: '宫崎骏风格' },
      { name: '{{setting}}', description: '场景设定JSON', example: '{"location": "海边", "timeOfDay": "evening"}' },
      { name: '{{storyboardShot}}', description: '分镜镜头信息JSON', example: '{"shotType": "medium", "cameraMovement": "pull"}' },
      { name: '{{initialEmotion}}', description: '首帧情绪', example: 'sad' },
      { name: '{{finalEmotion}}', description: '尾帧情绪', example: 'determined' }
    ]
  },
  // 视频生成类
  {
    id: 'scene_video_generation',
    name: '场景视频生成',
    category: 'video',
    description: '生成单场景视频片段（资产一致性流程）',
    workflows: ['asset_consistency'],
    variables: [
      { name: '{{sceneTitle}}', description: '场景标题', example: '雨夜街头对峙' },
      { name: '{{sceneDescription}}', description: '场景描述', example: '主角在霓虹灯下缓慢走向镜头...' },
      { name: '{{setting}}', description: '场景设定文本', example: '城市天桥 / night / tense / rain' },
      { name: '{{style}}', description: '画风描述', example: '电影写实风格' },
      { name: '{{referenceGuide}}', description: '参考图说明', example: '参考图说明：图1为角色，图2为环境。' },
      { name: '{{inputMode}}', description: '输入模式', example: 'first_last' },
      { name: '{{hasCharacterRef}}', description: '是否有角色参考图', example: 'yes' },
      { name: '{{hasEnvironmentRef}}', description: '是否有环境参考图', example: 'yes' },
      { name: '{{duration}}', description: '目标时长（秒）', example: '8' },
      { name: '{{aspectRatio}}', description: '输出画面比例', example: '16:9' },
      { name: '{{narration}}', description: '旁白文本', example: '雨势渐大，空气里弥漫着紧张。' },
      { name: '{{dialogues}}', description: '对白文本', example: '阿青: 你终于来了。' }
    ]
  },
  {
    id: 'transition',
    name: '转场视频',
    category: 'video',
    description: '生成场景间的转场视频',
    workflows: ['classic'],
    variables: [
      { name: '{{fromScene}}', description: '起始场景描述', example: '室内，温暖的灯光...' },
      { name: '{{toScene}}', description: '目标场景描述', example: '室外，阳光明媚...' },
      { name: '{{transitionType}}', description: '转场类型', example: 'dissolve' },
      { name: '{{style}}', description: '画风描述', example: '电影感' }
    ]
  },
  // 音频生成类
  {
    id: 'bgm_generation',
    name: '背景音乐',
    category: 'audio',
    description: '生成场景背景音乐',
    workflows: ['classic'],
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '紧张的追逐场面...' },
      { name: '{{mood}}', description: '情绪氛围', example: 'tense' },
      { name: '{{duration}}', description: '时长（秒）', example: '30' }
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
    .filter(item => {
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

// 按分类分组的模板
export const PROMPT_TEMPLATES_BY_CATEGORY: Record<PromptCategory, PromptTemplateMetadata[]> = {
  text: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'text'),
  image: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'image'),
  video: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'video'),
  audio: PROMPT_TEMPLATE_METADATA.filter(t => t.category === 'audio')
}

// 分类显示名称
export const CATEGORY_NAMES: Record<PromptCategory, string> = {
  text: '文本生成',
  image: '图片生成',
  video: '视频生成',
  audio: '音频生成'
}

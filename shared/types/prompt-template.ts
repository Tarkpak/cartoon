/**
 * 提示词模板类型定义
 * 支持中英双语、版本历史
 */

// 提示词分类
export type PromptCategory = 'text' | 'image' | 'video' | 'audio'

// 变量定义
export interface PromptVariable {
  name: string          // 变量名，如 {{storyIdea}}
  description: string   // 变量说明
  example?: string      // 示例值
}

// 双语内容
export interface BilingualContent {
  zh: {
    systemPrompt?: string   // 中文系统提示词
    userPrompt: string      // 中文用户提示词模板
  }
  en: {
    systemPrompt?: string   // 英文系统提示词
    userPrompt: string      // 英文用户提示词模板
  }
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
  SCENE_VISUAL: 'scene_visual',
  FRAME_GENERATION: 'frame_generation',
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
}

// 所有模板的元数据
export const PROMPT_TEMPLATE_METADATA: PromptTemplateMetadata[] = [
  // 文本生成类
  {
    id: 'outline_generation',
    name: '故事大纲生成',
    category: 'text',
    description: '根据故事创意生成完整的三幕结构故事大纲',
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
    variables: [
      { name: '{{outline}}', description: '故事大纲JSON', example: '{"title": "...", "acts": [...]}' },
      { name: '{{characters}}', description: '角色列表JSON', example: '[{"name": "...", "appearance": "..."}]' },
      { name: '{{targetSceneCount}}', description: '目标场景数量', example: '8' }
    ]
  },
  {
    id: 'storyboard_generation',
    name: '分镜脚本生成',
    category: 'text',
    description: '将场景描述转换为专业分镜脚本',
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '主角站在雨中的街道上...' },
      { name: '{{dialogues}}', description: '对话列表JSON', example: '[{"character": "...", "text": "..."}]' },
      { name: '{{style}}', description: '画风描述', example: '赛博朋克风格' }
    ]
  },
  {
    id: 'character_extraction',
    name: '角色提取',
    category: 'text',
    description: '从剧本中提取角色并生成外貌描述',
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
    variables: [
      { name: '{{outline}}', description: '故事大纲JSON', example: '{"title": "...", "characters": [...]}' },
      { name: '{{style}}', description: '画风描述', example: '日系动漫风格' }
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
    id: 'frame_generation',
    name: '首尾帧生成',
    category: 'image',
    description: '基于场景描述生成首帧和尾帧图片',
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '夕阳下的海边，主角望向远方...' },
      { name: '{{characters}}', description: '场景中的角色', example: '[{"name": "小明", "emotion": "sad"}]' },
      { name: '{{style}}', description: '画风描述', example: '宫崎骏风格' },
      { name: '{{isFirstFrame}}', description: '是否为首帧', example: 'true' }
    ]
  },
  // 视频生成类
  {
    id: 'transition',
    name: '转场视频',
    category: 'video',
    description: '生成场景间的转场视频',
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
    variables: [
      { name: '{{sceneDescription}}', description: '场景描述', example: '紧张的追逐场面...' },
      { name: '{{mood}}', description: '情绪氛围', example: 'tense' },
      { name: '{{duration}}', description: '时长（秒）', example: '30' }
    ]
  }
]

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

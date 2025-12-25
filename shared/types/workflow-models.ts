/**
 * 业务流程模型配置类型定义
 * 定义各业务流程所需的模型能力和配置
 */

import { z } from 'zod'

// ==================== 业务流程定义 ====================

/** 业务流程类型 */
export const WorkflowStepSchema = z.enum([
  // 文本生成类
  'outline_generation',      // 故事大纲生成
  'script_parsing',          // 剧本解析
  'character_extraction',    // 角色提取
  'storyboard_generation',   // 分镜脚本生成
  'scene_visual_extraction', // 场景视觉提取
  
  // 图片生成类
  'character_portrait',      // 角色立绘生成
  'character_views',         // 角色多视角生成
  'frame_generation',        // 首尾帧生成
  
  // 视频生成类
  'video_generation',        // 视频生成
  
  // 语音生成类
  'voice_synthesis'          // 语音合成
])
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

/** 模型能力要求 */
export const ModelCapabilitySchema = z.enum([
  'text_generation',         // 文本生成
  'reference_image',         // 支持参考图
  'require_reference_image', // 必须参考图
  'first_last_frame',        // 支持首尾帧
  'image_to_video',          // 图生视频
  'text_to_video',           // 文生视频
  'tts',                     // 语音合成
  'asr'                      // 语音识别
])
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>

/** 业务流程配置 */
export const WorkflowStepConfigSchema = z.object({
  id: WorkflowStepSchema,
  name: z.string(),
  description: z.string(),
  category: z.enum(['text', 'image', 'video', 'voice']),
  requiredCapabilities: z.array(ModelCapabilitySchema),
  optionalCapabilities: z.array(ModelCapabilitySchema).optional(),
  tips: z.string().optional()
})
export type WorkflowStepConfig = z.infer<typeof WorkflowStepConfigSchema>

/** 业务流程模型选择 */
export const WorkflowModelsSchema = z.object({
  // 文本生成类
  outline_generation: z.string().optional(),
  script_parsing: z.string().optional(),
  character_extraction: z.string().optional(),
  storyboard_generation: z.string().optional(),
  scene_visual_extraction: z.string().optional(),
  
  // 图片生成类
  character_portrait: z.string().optional(),
  character_views: z.string().optional(),
  frame_generation: z.string().optional(),
  
  // 视频生成类
  video_generation: z.string().optional(),
  
  // 语音生成类
  voice_synthesis: z.string().optional()
})
export type WorkflowModels = z.infer<typeof WorkflowModelsSchema>

// ==================== 业务流程配置常量 ====================

/** 所有业务流程配置 */
export const WORKFLOW_STEP_CONFIGS: WorkflowStepConfig[] = [
  // 文本生成类
  {
    id: 'outline_generation',
    name: '故事大纲生成',
    description: '从故事创意生成结构化的三幕式大纲',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '推荐使用支持深度思考的模型以获得更好的故事结构'
  },
  {
    id: 'script_parsing',
    name: '剧本解析',
    description: '将小说/剧本文本解析为场景列表',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要较强的文本理解能力，推荐使用大参数模型'
  },
  {
    id: 'character_extraction',
    name: '角色提取',
    description: '从文本中提取角色信息和外貌描述',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要准确提取角色特征，推荐使用指令遵循能力强的模型'
  },
  {
    id: 'storyboard_generation',
    name: '分镜脚本生成',
    description: '为场景生成详细的分镜描述',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要理解镜头语言，推荐使用创意能力强的模型'
  },
  {
    id: 'scene_visual_extraction',
    name: '场景视觉提取',
    description: '提取场景的视觉元素和氛围描述',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要丰富的视觉描述能力'
  },
  
  // 图片生成类
  {
    id: 'character_portrait',
    name: '角色立绘生成',
    description: '根据角色描述生成基础立绘',
    category: 'image',
    requiredCapabilities: [],
    optionalCapabilities: ['reference_image'],
    tips: '纯文生图即可，支持参考图可用于风格迁移'
  },
  {
    id: 'character_views',
    name: '角色多视角生成',
    description: '基于角色立绘生成不同视角的图片',
    category: 'image',
    requiredCapabilities: ['reference_image'],
    tips: '必须支持参考图，用于保持角色一致性'
  },
  {
    id: 'frame_generation',
    name: '首尾帧生成',
    description: '生成场景的首帧和尾帧图片，融合角色立绘',
    category: 'image',
    requiredCapabilities: ['reference_image'],
    tips: '必须支持参考图，用于融合角色到场景中'
  },
  
  // 视频生成类
  {
    id: 'video_generation',
    name: '视频生成',
    description: '从首尾帧生成场景视频',
    category: 'video',
    requiredCapabilities: ['first_last_frame'],
    optionalCapabilities: ['image_to_video'],
    tips: '必须支持首尾帧插值，确保场景连贯性'
  },
  
  // 语音生成类
  {
    id: 'voice_synthesis',
    name: '语音合成',
    description: '为角色对话生成配音',
    category: 'voice',
    requiredCapabilities: ['tts'],
    tips: '选择支持多音色的模型以区分不同角色'
  }
]

/** 根据ID获取业务流程配置 */
export function getWorkflowStepConfig(id: WorkflowStep): WorkflowStepConfig | undefined {
  return WORKFLOW_STEP_CONFIGS.find(c => c.id === id)
}

/** 根据分类获取业务流程配置 */
export function getWorkflowStepsByCategory(category: 'text' | 'image' | 'video' | 'voice'): WorkflowStepConfig[] {
  return WORKFLOW_STEP_CONFIGS.filter(c => c.category === category)
}

/**
 * 业务流程模型配置类型定义
 * 定义各业务流程所需的模型能力和配置
 */

import { z } from 'zod'

// ==================== 业务流程定义 ====================

/** 业务流程类型 */
export const WorkflowStepSchema = z.enum([
  // 文本生成类
  'outline_generation', // 故事大纲生成
  'script_parsing', // 剧本解析
  'character_extraction', // 角色提取
  'storyboard_generation', // 分镜脚本生成
  'scene_visual_extraction', // 场景视觉提取
  'text_translation', // 文本翻译

  // 图片生成类
  'character_portrait', // 角色立绘生成
  'character_views', // 角色多视角生成
  'frame_generation', // 场景参考图生成

  // 视频生成类
  'video_generation', // 视频生成

  // 语音生成类
  'voice_synthesis' // 语音合成
])
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

/** 模型能力要求 */
export const ModelCapabilitySchema = z.enum([
  'text_generation', // 文本生成
  'reference_image', // 支持参考图
  'require_reference_image', // 必须参考图
  'first_last_frame', // 支持首尾帧
  'image_to_video', // 图生视频
  'text_to_video', // 文生视频
  'tts', // 语音合成
  'asr' // 语音识别
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
  text_translation: z.string().optional(),

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

// ==================== 业务流程模型扩展配置 ====================

/** Gemini 图片画质档位（对应 imageConfig.imageSize） */
export const WorkflowGeminiImageSizeSchema = z.enum(['512', '1K', '2K', '4K'])
export type WorkflowGeminiImageSize = z.infer<typeof WorkflowGeminiImageSizeSchema>

/** 图片生成流程模型扩展配置 */
export const WorkflowImageGenerationModelOptionsSchema = z.object({
  geminiImageSize: WorkflowGeminiImageSizeSchema.default('1K')
})
export type WorkflowImageGenerationModelOptions = z.infer<typeof WorkflowImageGenerationModelOptionsSchema>

/** Kling v3 Omni 声音开关 */
export const KlingV3OmniSoundSchema = z.enum(['on', 'off'])
export type KlingV3OmniSound = z.infer<typeof KlingV3OmniSoundSchema>

/** Kling v3 Omni 生成模式 */
export const KlingV3OmniModeSchema = z.enum(['std', 'pro'])
export type KlingV3OmniMode = z.infer<typeof KlingV3OmniModeSchema>

/** Kling v3 Omni 视频配置 */
export const KlingV3OmniVideoOptionsSchema = z.object({
  sound: KlingV3OmniSoundSchema.default('off'),
  mode: KlingV3OmniModeSchema.default('pro')
})
export type KlingV3OmniVideoOptions = z.infer<typeof KlingV3OmniVideoOptionsSchema>

/** 视频生成流程模型扩展配置 */
export const WorkflowVideoGenerationModelOptionsSchema = z.object({
  klingV3Omni: KlingV3OmniVideoOptionsSchema.default({
    sound: 'off',
    mode: 'pro'
  })
})
export type WorkflowVideoGenerationModelOptions = z.infer<typeof WorkflowVideoGenerationModelOptionsSchema>

/** 业务流程模型扩展配置 */
export const WorkflowModelOptionsSchema = z.object({
  image_generation: WorkflowImageGenerationModelOptionsSchema.default({
    geminiImageSize: '1K'
  }),
  video_generation: WorkflowVideoGenerationModelOptionsSchema.default({
    klingV3Omni: {
      sound: 'off',
      mode: 'pro'
    }
  })
})
export type WorkflowModelOptions = z.infer<typeof WorkflowModelOptionsSchema>

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
  {
    id: 'text_translation',
    name: '文本翻译',
    description: '中英文提示词互译',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '用于提示词的中英文互译，推荐使用多语言能力强的模型'
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
    name: '场景参考图生成',
    description: '生成场景环境参考图，并作为过渡补帧的图片模型',
    category: 'image',
    requiredCapabilities: ['reference_image'],
    tips: '当前主要用于环境参考图与过渡补帧，优先选择出图稳定的图片模型'
  },

  // 视频生成类
  {
    id: 'video_generation',
    name: '视频生成',
    description: '从文本、参考图或多参考素材生成场景视频',
    category: 'video',
    requiredCapabilities: [],
    optionalCapabilities: ['first_last_frame', 'image_to_video', 'text_to_video'],
    tips: '优先选择支持 10-15 秒时长的模型；若强调角色一致性，再选择支持首尾帧的模型'
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

/**
 * 当前工作台主流程的模型配置类型定义
 * 保留：解析 → 资产 → 视频，以及提示词翻译辅助能力
 */

import { z } from 'zod'

export const WorkflowStepSchema = z.enum([
  // 文本流程
  'script_parsing',
  'scene_description_refinement',
  'text_translation',

  // 图片流程
  'character_portrait',
  'frame_generation',

  // 视频流程
  'video_generation'
])
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

export const ModelCapabilitySchema = z.enum([
  'text_generation',
  'reference_image',
  'require_reference_image',
  'first_last_frame',
  'image_to_video',
  'text_to_video'
])
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>

export const WorkflowStepConfigSchema = z.object({
  id: WorkflowStepSchema,
  name: z.string(),
  description: z.string(),
  category: z.enum(['text', 'image', 'video']),
  requiredCapabilities: z.array(ModelCapabilitySchema),
  optionalCapabilities: z.array(ModelCapabilitySchema).optional(),
  tips: z.string().optional()
})
export type WorkflowStepConfig = z.infer<typeof WorkflowStepConfigSchema>

export const WorkflowModelsSchema = z.object({
  script_parsing: z.string().optional(),
  scene_description_refinement: z.string().optional(),
  text_translation: z.string().optional(),
  character_portrait: z.string().optional(),
  frame_generation: z.string().optional(),
  video_generation: z.string().optional()
})
export type WorkflowModels = z.infer<typeof WorkflowModelsSchema>

export const WorkflowGeminiImageSizeSchema = z.enum(['512', '1K', '2K', '4K'])
export type WorkflowGeminiImageSize = z.infer<typeof WorkflowGeminiImageSizeSchema>

export const WorkflowImageGenerationModelOptionsSchema = z.object({
  geminiImageSize: WorkflowGeminiImageSizeSchema.default('1K')
})
export type WorkflowImageGenerationModelOptions = z.infer<typeof WorkflowImageGenerationModelOptionsSchema>

export const KlingV3OmniSoundSchema = z.enum(['on', 'off'])
export type KlingV3OmniSound = z.infer<typeof KlingV3OmniSoundSchema>

export const KlingV3OmniModeSchema = z.enum(['std', 'pro'])
export type KlingV3OmniMode = z.infer<typeof KlingV3OmniModeSchema>

export const KlingV3OmniVideoOptionsSchema = z.object({
  sound: KlingV3OmniSoundSchema.default('off'),
  mode: KlingV3OmniModeSchema.default('pro')
})
export type KlingV3OmniVideoOptions = z.infer<typeof KlingV3OmniVideoOptionsSchema>

export const WorkflowVideoGenerationModelOptionsSchema = z.object({
  klingV3Omni: KlingV3OmniVideoOptionsSchema.default({
    sound: 'off',
    mode: 'pro'
  })
})
export type WorkflowVideoGenerationModelOptions = z.infer<typeof WorkflowVideoGenerationModelOptionsSchema>

export const WorkflowModelOptionsSchema = z.object({
  image_options: WorkflowImageGenerationModelOptionsSchema.default({
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

export const WORKFLOW_STEP_CONFIGS: WorkflowStepConfig[] = [
  {
    id: 'script_parsing',
    name: '剧本解析与资产规划',
    description: '将原文解析为场景、角色与可直接用于生成的视频时间轴',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要稳定的长文本理解和结构化输出能力'
  },
  {
    id: 'scene_description_refinement',
    name: '场景描述二次改写',
    description: '按用户指令和资产引用重写场景时间轴描述',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '要求上下文保持能力强、指令遵循稳定'
  },
  {
    id: 'text_translation',
    name: '提示词翻译',
    description: '用于提示词中英文互译',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '推荐多语言能力稳定的文本模型'
  },
  {
    id: 'character_portrait',
    name: '角色资产生成',
    description: '根据角色描述生成角色基准资产图',
    category: 'image',
    requiredCapabilities: [],
    optionalCapabilities: ['reference_image'],
    tips: '纯文生图可用；支持参考图时可获得更稳定的二次生成'
  },
  {
    id: 'frame_generation',
    name: '环境参考图生成',
    description: '生成纯环境参考图，作为场景视频的空间基底',
    category: 'image',
    requiredCapabilities: [],
    optionalCapabilities: ['reference_image'],
    tips: '优先选择出图稳定、支持环境一致性的图片模型'
  },
  {
    id: 'video_generation',
    name: '场景视频生成',
    description: '基于文本和参考素材生成单场景视频',
    category: 'video',
    requiredCapabilities: [],
    optionalCapabilities: ['first_last_frame', 'image_to_video', 'text_to_video'],
    tips: '优先选择支持图生视频和多参考图的模型'
  }
]

export function getWorkflowStepConfig(id: WorkflowStep): WorkflowStepConfig | undefined {
  return WORKFLOW_STEP_CONFIGS.find(c => c.id === id)
}

export function getWorkflowStepsByCategory(category: 'text' | 'image' | 'video'): WorkflowStepConfig[] {
  return WORKFLOW_STEP_CONFIGS.filter(c => c.category === category)
}

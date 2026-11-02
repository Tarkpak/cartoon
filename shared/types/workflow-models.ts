/**
 * 当前工作台主流程的模型配置类型定义
 * 保留：解析 → 资产 → 视频
 */

import { z } from 'zod'

export const WorkflowStepSchema = z.enum([
  // 文本流程
  'script_writing',
  'script_parsing',
  'video_import_script_generation',
  'scene_description_refinement',

  // 图片流程
  'character_portrait',
  'frame_generation',
  'prop_generation',
  'other_asset_generation',

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
  script_writing: z.string().optional(),
  script_parsing: z.string().optional(),
  video_import_script_generation: z.string().optional(),
  scene_description_refinement: z.string().optional(),
  character_portrait: z.string().optional(),
  frame_generation: z.string().optional(),
  prop_generation: z.string().optional(),
  other_asset_generation: z.string().optional(),
  video_generation: z.string().optional()
})
export type WorkflowModels = z.infer<typeof WorkflowModelsSchema>

export const WorkflowGeminiImageSizeSchema = z.enum(['512', '1K', '2K', '4K'])
export type WorkflowGeminiImageSize = z.infer<typeof WorkflowGeminiImageSizeSchema>

export const OPENAI_IMAGE_RESOLUTIONS = ['2K', '4K'] as const
export const WorkflowOpenAIImageResolutionSchema = z.enum(OPENAI_IMAGE_RESOLUTIONS)
export type WorkflowOpenAIImageResolution = z.infer<typeof WorkflowOpenAIImageResolutionSchema>

export const WorkflowOpenAIImageQualitySchema = z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
export type WorkflowOpenAIImageQuality = z.infer<typeof WorkflowOpenAIImageQualitySchema>

export const WorkflowPanoramaSourceModeSchema = z.enum([
  'equirectangular_360',
  'equirectangular_180',
  'cubemap_3x2',
  'cubemap_6x1',
  'custom'
])
export type WorkflowPanoramaSourceMode = z.infer<typeof WorkflowPanoramaSourceModeSchema>

export const WorkflowPanoramaAspectRatioSchema = z.string().trim().regex(/^\d+\s*:\s*\d+$/)
export type WorkflowPanoramaAspectRatio = z.infer<typeof WorkflowPanoramaAspectRatioSchema>

export const WorkflowPanoramaImageSizeSchema = z.string().trim().regex(/^\d+\s*[*xX]\s*\d+$/)
export type WorkflowPanoramaImageSize = z.infer<typeof WorkflowPanoramaImageSizeSchema>

export const WORKFLOW_IMAGE_STEPS = [
  'character_portrait',
  'frame_generation',
  'prop_generation',
  'other_asset_generation'
] as const
export const WorkflowImageStepSchema = z.enum(WORKFLOW_IMAGE_STEPS)
export type WorkflowImageStep = z.infer<typeof WorkflowImageStepSchema>

/** 单个图片类型的画质/分辨率覆盖；缺省字段沿用全局配置 */
export const WorkflowImageStepOverrideSchema = z.object({
  geminiImageSize: WorkflowGeminiImageSizeSchema.optional(),
  openaiImageQuality: WorkflowOpenAIImageQualitySchema.optional(),
  openaiImageResolution: WorkflowOpenAIImageResolutionSchema.optional()
})
export type WorkflowImageStepOverride = z.infer<typeof WorkflowImageStepOverrideSchema>
export type WorkflowImageStepOverrideKey = keyof WorkflowImageStepOverride

export const WorkflowImageStepOverridesSchema = z.object({
  character_portrait: WorkflowImageStepOverrideSchema.optional(),
  frame_generation: WorkflowImageStepOverrideSchema.optional(),
  prop_generation: WorkflowImageStepOverrideSchema.optional(),
  other_asset_generation: WorkflowImageStepOverrideSchema.optional()
})
export type WorkflowImageStepOverrides = z.infer<typeof WorkflowImageStepOverridesSchema>

export const WorkflowImageGenerationModelOptionsSchema = z.object({
  geminiImageSize: WorkflowGeminiImageSizeSchema.default('1K'),
  openaiImageQuality: WorkflowOpenAIImageQualitySchema.default('auto'),
  openaiImageResolution: WorkflowOpenAIImageResolutionSchema.default('4K'),
  panoramaSourceMode: WorkflowPanoramaSourceModeSchema.default('equirectangular_360'),
  panoramaCustomAspectRatio: WorkflowPanoramaAspectRatioSchema.default('2:1'),
  panoramaCustomSize: WorkflowPanoramaImageSizeSchema.default('2048*1024'),
  stepOverrides: WorkflowImageStepOverridesSchema.default({})
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

export const SeedanceVideoQualitySchema = z.enum(['480p', '720p', '1080p', '4k'])
export type SeedanceVideoQuality = z.infer<typeof SeedanceVideoQualitySchema>

export const SeedanceVideoOptionsSchema = z.object({
  quality: SeedanceVideoQualitySchema.default('720p')
})
export type SeedanceVideoOptions = z.infer<typeof SeedanceVideoOptionsSchema>

export const WorkflowVideoAudioDefaultsSchema = z.object({
  qwen: z.boolean().default(true),
  kling: z.boolean().default(true),
  seedance: z.boolean().default(true)
})
export type WorkflowVideoAudioDefaults = z.infer<typeof WorkflowVideoAudioDefaultsSchema>

export const WorkflowVideoGenerationModelOptionsSchema = z.object({
  qwen: z.object({ quality: z.enum(['480p', '720p', '1080p']).default('720p') }).optional(),
  autodl: z.object({ quality: z.enum(['480p', '768p']).default('768p') }).default({ quality: '768p' }),
  klingV3Omni: KlingV3OmniVideoOptionsSchema.default({
    sound: 'off',
    mode: 'pro'
  }),
  seedance: SeedanceVideoOptionsSchema.default({
    quality: '720p'
  }),
  audioDefaults: WorkflowVideoAudioDefaultsSchema.default({
    qwen: true,
    kling: true,
    seedance: true
  })
})
export type WorkflowVideoGenerationModelOptions = z.infer<typeof WorkflowVideoGenerationModelOptionsSchema>

export const WorkflowCompletionNotificationOptionsSchema = z.object({
  sound: z.boolean().default(true),
  systemNotification: z.boolean().default(true)
})
export type WorkflowCompletionNotificationOptions = z.infer<typeof WorkflowCompletionNotificationOptionsSchema>

export const WorkflowModelOptionsSchema = z.object({
  image_options: WorkflowImageGenerationModelOptionsSchema.default({
    geminiImageSize: '1K',
    openaiImageQuality: 'auto',
    openaiImageResolution: '4K',
    panoramaSourceMode: 'equirectangular_360',
    panoramaCustomAspectRatio: '2:1',
    panoramaCustomSize: '2048*1024',
    stepOverrides: {}
  }),
  video_generation: WorkflowVideoGenerationModelOptionsSchema.default({
    autodl: { quality: '768p' },
    klingV3Omni: {
      sound: 'off',
      mode: 'pro'
    },
    seedance: {
      quality: '720p'
    },
    audioDefaults: {
      qwen: true,
      kling: true,
      seedance: true
    }
  }),
  completion_notification: WorkflowCompletionNotificationOptionsSchema.default({
    sound: true,
    systemNotification: true
  })
})
export type WorkflowModelOptions = z.infer<typeof WorkflowModelOptionsSchema>

export const WORKFLOW_STEP_CONFIGS: WorkflowStepConfig[] = [
  {
    id: 'script_writing',
    name: 'AI 剧本创作',
    description: '根据创作设定生成故事圣经、分集大纲、单集剧本并执行连贯性审校',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '优先选择长上下文、结构化输出和中文创作能力稳定的模型'
  },
  {
    id: 'script_parsing',
    name: '分集目录规划与剧本解析',
    description: '将原文先拆分为分集目录，再解析为场景、角色与可直接用于生成的分镜时间轴',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '需要稳定的长文本理解和结构化输出能力'
  },
  {
    id: 'video_import_script_generation',
    name: '视频转项目剧本整理',
    description: '将视频字幕整理为适合项目创建的分场剧本文本',
    category: 'text',
    requiredCapabilities: ['text_generation'],
    tips: '要求对白整理、分场归纳和结构化输出稳定'
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
    description: '生成纯环境参考图，作为分镜视频的空间基底',
    category: 'image',
    requiredCapabilities: [],
    optionalCapabilities: ['reference_image'],
    tips: '优先选择出图稳定、支持环境一致性的图片模型'
  },
  {
    id: 'prop_generation',
    name: '道具资产生成',
    description: '根据道具描述生成道具资产图',
    category: 'image',
    requiredCapabilities: [],
    tips: '可单独选择适合物品细节与材质表现的图片模型'
  },
  {
    id: 'other_asset_generation',
    name: '其他资产生成',
    description: '根据其他资产描述生成资产图',
    category: 'image',
    requiredCapabilities: [],
    tips: '可独立于角色和道具选择图片模型'
  },
  {
    id: 'video_generation',
    name: '分镜视频生成',
    description: '基于文本和参考素材生成单个分镜片段',
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

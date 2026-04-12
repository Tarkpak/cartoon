import { z } from 'zod'
import {
  IMAGE_MODELS,
  findImageModel,
  generateImage,
  type GenerateImageResult
} from '../../../utils/model-provider'
import { imageLimiter } from '../../../utils/concurrency'
import { getWorkflowModels } from '../../models/workflow.get'
import { getInterpolatedPrompt } from '../../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../../shared/types/prompt-template'

const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1'])

const SceneSettingSchema = z.object({
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  weather: z.string().optional()
}).optional()

const SceneCharacterSchema = z.object({
  name: z.string(),
  appearance: z.string().optional(),
  emotion: z.string().optional()
})

const SceneDialogueSchema = z.object({
  character: z.string(),
  text: z.string(),
  emotion: z.string().optional()
})

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string(),
  cameraNote: z.string().optional(),
  duration: z.number().optional(),
  setting: SceneSettingSchema,
  narration: z.string().optional(),
  characters: z.array(SceneCharacterSchema).optional().default([]),
  dialogues: z.array(SceneDialogueSchema).optional().default([])
})

const GenerateReferenceRequestSchema = z.object({
  scene: SceneSchema,
  style: z.string().optional().default(''),
  aspectRatio: AspectRatioSchema.optional().default('16:9'),
  // 兼容旧字段：资产一致性新流程下该字段将被忽略（场景资产必须为纯环境）
  characterReferenceImages: z.array(z.string()).optional().default([])
})

const ENVIRONMENT_ONLY_NEGATIVE_PROMPT = [
  '人物',
  '角色',
  '人脸',
  '人体',
  '手',
  '剪影',
  '人群',
  'human',
  'person',
  'people',
  'face',
  'portrait',
  'character',
  'body',
  'hands',
  'crowd',
  'watermark',
  'logo',
  'text'
].join(', ')

function resolveEnvironmentReferenceModel(preferredModelId: string): { modelId: string, reason: string } {
  const preferred = findImageModel(preferredModelId)

  if (!preferred) {
    const globalFallback = IMAGE_MODELS.find(model => !model.requireReferenceImage)
    return {
      modelId: globalFallback?.model || preferredModelId,
      reason: globalFallback ? `fallback-no-ref:not-found->${globalFallback.model}` : 'workflow-model-not-found'
    }
  }

  if (!preferred.requireReferenceImage) {
    return {
      modelId: preferred.model,
      reason: 'workflow-default'
    }
  }

  const providerFallback = IMAGE_MODELS.find(
    model => model.provider === preferred.provider && !model.requireReferenceImage
  )
  const globalFallback = IMAGE_MODELS.find(model => !model.requireReferenceImage)
  const fallback = providerFallback || globalFallback

  if (fallback) {
    return {
      modelId: fallback.model,
      reason: `fallback-no-ref:${preferred.model}->${fallback.model}`
    }
  }

  return {
    modelId: preferred.model,
    reason: 'no-no-ref-fallback'
  }
}

function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function resolveImageSizeByAspectRatio(aspectRatio: z.infer<typeof AspectRatioSchema>): string {
  switch (aspectRatio) {
    case '9:16':
      return '720*1280'
    case '1:1':
      return '960*960'
    case '16:9':
    default:
      return '1280*720'
  }
}

async function resolveGeneratedImage(result: GenerateImageResult): Promise<{ imageData: string, mimeType: string }> {
  if (result.imageData) {
    return {
      imageData: result.imageData,
      mimeType: result.mimeType || 'image/png'
    }
  }

  if (!result.imageUrl) {
    throw new Error('未返回可用图片数据')
  }

  try {
    const response = await fetch(result.imageUrl)
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`)
    }

    const buffer = await response.arrayBuffer()
    return {
      imageData: Buffer.from(buffer).toString('base64'),
      mimeType: 'image/png'
    }
  } catch {
    return {
      imageData: result.imageUrl,
      mimeType: 'image/url'
    }
  }
}

async function buildSceneReferencePrompt(
  scene: z.infer<typeof SceneSchema>,
  style: string,
  aspectRatio: z.infer<typeof AspectRatioSchema>
): Promise<string> {
  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.FIRST_FRAME_GENERATION,
    {
      sceneDescription: scene.description,
      // 场景资产图只生成环境底图，角色信息在该步骤必须忽略
      characters: '[]',
      style,
      setting: JSON.stringify(scene.setting || {}),
      storyboardShot: '{}'
    },
    undefined,
    'asset_consistency'
  )

  const narrationText = hasText(scene.narration)
    ? `【旁白】\n${scene.narration!.trim()}`
    : ''

  const dialogueText = (scene.dialogues || []).length > 0
    ? `【关键对白】\n${scene.dialogues.map(item => `${item.character}: ${item.text}`).join('\n')}`
    : ''

  const cameraNoteText = hasText(scene.cameraNote)
    ? `【镜头与资产备注】\n${scene.cameraNote!.trim()}`
    : ''

  const extraRules = [
    '【输出规则】',
    '仅生成 1 张环境资产参考图，不要拼图，不要分镜排版。',
    `画面比例必须为 ${aspectRatio}。`,
    '不要文字、水印、logo，不要画面边框。',
    '这是纯环境图：禁止出现任何人物/人脸/肢体/剪影。',
    '若原文包含人物动作或对白，仅提取地点、建筑、地形、道具、光照与天气信息。',
    '画面需覆盖场景核心空间关系，作为后续视频的环境基底参考。'
  ].join('\n')

  if (templatePrompt) {
    return [templatePrompt, cameraNoteText, narrationText, dialogueText, extraRules]
      .filter(Boolean)
      .join('\n\n')
  }

  const settingText = scene.setting
    ? [scene.setting.location, scene.setting.timeOfDay, scene.setting.mood, scene.setting.weather]
        .filter(Boolean)
        .join(' / ')
    : '未提供'

  return [
    '请生成一张用于视频生成的环境资产参考图（纯环境，无人物）。',
    `风格: ${style || '保持项目默认风格'}`,
    `场景标题: ${scene.title || '未命名场景'}`,
    `场景设定: ${settingText}`,
    `场景描述: ${scene.description}`,
    cameraNoteText,
    narrationText,
    dialogueText,
    extraRules
  ]
    .filter(Boolean)
    .join('\n\n')
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const body = await readBody(event)
  const parseResult = GenerateReferenceRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const { scene, style, aspectRatio } = parseResult.data

  try {
    const workflowModels = await getWorkflowModels()
    const modelDecision = resolveEnvironmentReferenceModel(workflowModels.frame_generation)
    const modelId = modelDecision.modelId
    const prompt = await buildSceneReferencePrompt(scene, style, aspectRatio)

    const generated = await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt,
        negativePrompt: ENVIRONMENT_ONLY_NEGATIVE_PROMPT,
        size: resolveImageSizeByAspectRatio(aspectRatio),
        maxRetries: 2
      })
    )

    const normalized = await resolveGeneratedImage(generated)

    return {
      success: true,
      referenceImage: normalized.imageData,
      mimeType: normalized.mimeType,
      latencyMs: Date.now() - startTime,
      usage: {
        modelId,
        modelDecision: modelDecision.reason,
        aspectRatio,
        characterReferences: 0
      }
    }
  } catch (error) {
    console.error('[AssetWorkflow/Reference] 生成失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '场景环境图生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

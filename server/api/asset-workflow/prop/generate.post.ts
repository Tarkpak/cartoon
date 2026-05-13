import { z } from 'zod'
import { imageLimiter } from '../../../utils/concurrency'
import { persistImageToPublic } from '../../../utils/image-storage'
import { findImageModel, generateImage } from '../../../utils/model-provider'
import { getDefaultPromptTemplates } from '../../../utils/prompt-defaults'
import { getInterpolatedPrompt, interpolateTemplate } from '../../../utils/prompt-template'
import { getWorkflowModels, getWorkflowModelOptions } from '../../models/workflow.get'
import { PROMPT_TEMPLATE_IDS } from '../../../../shared/types/prompt-template'

const GeneratePropRequestSchema = z.object({
  prop: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(['prop', 'other']).optional().default('prop')
  }),
  style: z.string().optional().default('')
})

async function buildPropPrompt(options: {
  name: string
  description?: string
  style?: string
  category: 'prop' | 'other'
}): Promise<string> {
  const variables = {
    assetLabel: options.category === 'other' ? '其他参考资产' : '道具资产',
    style: options.style?.trim() || '保持项目默认画风',
    assetName: options.name,
    assetDescription: options.description?.trim() || '无'
  }

  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.PROP_ASSET_GENERATION,
    variables
  )
  if (templatePrompt) {
    return templatePrompt
  }

  const fallbackTemplate = getDefaultPromptTemplates()
    .find(template => template.id === PROMPT_TEMPLATE_IDS.PROP_ASSET_GENERATION)
    ?.content
  if (fallbackTemplate) {
    try {
      console.warn('[AssetWorkflow/Prop] 道具资产模板缺失，已回退内置默认模板继续生成')
      return interpolateTemplate(fallbackTemplate, variables)
    } catch (error) {
      console.error('[AssetWorkflow/Prop] 道具资产模板回退插值失败:', error)
    }
  }

  throw new Error('无法获取道具资产生成模板，请在设置中检查提示词配置')
}

async function resolvePropNegativePrompt(): Promise<string> {
  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.PROP_ASSET_NEGATIVE_PROMPT,
    {}
  )
  if (templatePrompt?.trim()) {
    return templatePrompt.trim()
  }

  const fallbackTemplate = getDefaultPromptTemplates()
    .find(template => template.id === PROMPT_TEMPLATE_IDS.PROP_ASSET_NEGATIVE_PROMPT)
    ?.content
  if (fallbackTemplate?.trim()) {
    console.warn('[AssetWorkflow/Prop] 道具资产负向模板缺失，已回退内置默认负向约束')
    return fallbackTemplate.trim()
  }

  throw new Error('无法获取道具资产负向约束模板，请在设置中检查提示词配置')
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const body = await readBody(event)
  const parseResult = GeneratePropRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const { prop, style } = parseResult.data

  try {
    const [workflowModels, workflowModelOptions] = await Promise.all([
      getWorkflowModels(),
      getWorkflowModelOptions()
    ])
    const modelId = workflowModels.character_portrait || workflowModels.frame_generation
    const modelConfig = modelId ? findImageModel(modelId) : undefined
    const prompt = await buildPropPrompt({
      name: prop.name,
      description: prop.description,
      style,
      category: prop.category
    })
    const negativePrompt = await resolvePropNegativePrompt()

    const generated = await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt,
        imageSize: workflowModelOptions.image_options.geminiImageSize,
        quality: workflowModelOptions.image_options.openaiImageQuality,
        aspectRatio: '1:1',
        size: '1024*1024',
        negativePrompt,
        maxRetries: 2
      })
    )

    const imageSource = generated.imageData || generated.imageUrl || ''
    if (!imageSource) {
      throw new Error('道具图生成失败：未返回可用图片数据')
    }

    const imageUrl = await persistImageToPublic({
      source: imageSource,
      prefix: `${prop.category === 'other' ? 'other' : 'prop'}_${prop.id}`
    })

    return {
      success: true,
      imageUrl,
      latencyMs: Date.now() - startTime,
      usage: {
        modelId,
        modelProvider: modelConfig?.provider
      }
    }
  } catch (error) {
    console.error('[AssetWorkflow/Prop] 生成失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '道具图生成失败'
    })
  }
})

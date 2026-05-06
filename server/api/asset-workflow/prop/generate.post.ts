import { z } from 'zod'
import { imageLimiter } from '../../../utils/concurrency'
import { persistImageToPublic } from '../../../utils/image-storage'
import { findImageModel, generateImage } from '../../../utils/model-provider'
import { getWorkflowModels, getWorkflowModelOptions } from '../../models/workflow.get'

const GeneratePropRequestSchema = z.object({
  prop: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(['prop', 'other']).optional().default('prop')
  }),
  style: z.string().optional().default('')
})

function buildPropPrompt(options: {
  name: string
  description?: string
  style?: string
  category: 'prop' | 'other'
}) {
  const label = options.category === 'other' ? '其他参考资产' : '道具资产'
  return [
    `你正在为资产一致性分镜视频生成单张${label}参考图。请直接生成图片，不要输出文字说明。`,
    '',
    '【项目画风】',
    options.style?.trim() || '保持项目默认画风',
    '',
    '【资产名称】',
    options.name,
    '',
    '【资产描述】',
    options.description?.trim() || '无',
    '',
    '【执行要求】',
    `1. 只生成 1 张${label}参考图，不要拼图，不要多画面组合。`,
    '2. 画面主体必须是该资产本身，完整展示外形、材质、颜色、尺度和关键细节。',
    '3. 使用干净中性背景或透明感背景，不要生成复杂场景，不要让环境喧宾夺主。',
    '4. 禁止出现人物、人脸、手、身体部位、文字、水印、Logo、边框、界面元素。',
    '5. 避免把资产画成多个不同版本；如果需要展示细节，也必须保持同一个资产身份。',
    '6. 构图稳定，主体居中且完整，不裁切，不遮挡，适合作为后续视频生成参考图。'
  ].join('\n')
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
    const prompt = buildPropPrompt({
      name: prop.name,
      description: prop.description,
      style,
      category: prop.category
    })

    const generated = await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt,
        imageSize: workflowModelOptions.image_options.geminiImageSize,
        quality: workflowModelOptions.image_options.openaiImageQuality,
        aspectRatio: '1:1',
        size: '1024*1024',
        negativePrompt: '人物, 人脸, 人体, 手, 多个不同物体版本, 文字, 水印, logo, UI, human, person, face, hands, text, watermark',
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

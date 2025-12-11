import { generateImage, ImageModels, GeminiError } from '../../utils/gemini'
import { imageLimiter } from '../../utils/concurrency'
import { z } from 'zod'
import type { Emotion } from '../../../shared/types/script'

/**
 * 角色表情生成 API
 * POST /api/character/expression
 *
 * 基于角色基础立绘生成单个表情变体
 */

const RequestSchema = z.object({
  characterId: z.string(),
  baseImage: z.string(), // base64 编码的基础立绘
  emotion: z.enum(['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'excited', 'scared']),
  appearance: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { characterId, baseImage, emotion, appearance } = parseResult.data

  try {
    console.log(`[ExpressionGen] 开始生成表情: ${characterId} - ${emotion}`)

    // 2. 构建提示词
    const prompt = buildExpressionPrompt(emotion as Emotion, appearance)

    // 3. 调用图片生成 API（带并发控制）
    const result = await imageLimiter.execute(() =>
      generateImage({
        model: ImageModels.HIGH_QUALITY,
        prompt,
        referenceImage: {
          data: baseImage,
          mimeType: 'image/png'
        },
        maxRetries: 2
      })
    )

    console.log(`[ExpressionGen] 表情生成完成: ${characterId} - ${emotion}, 耗时: ${Date.now() - startTime}ms`)

    return {
      success: true,
      expressionImage: result.imageData,
      emotion,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[ExpressionGen] 生成失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `表情生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 构建表情生成提示词
 */
function buildExpressionPrompt(emotion: Emotion, appearance?: string): string {
  const emotionDescriptions: Record<Emotion, string> = {
    neutral: '平静、冷静、自然的表情，面无表情但不显得冷漠',
    happy: '开心、微笑、愉快的表情，眼睛弯曲，嘴角上扬',
    sad: '悲伤、难过、忧郁的表情，眉头微皱，眼神低垂',
    angry: '愤怒、生气、不满的表情，眉头紧锁，眼神锐利',
    surprised: '惊讶、震惊、意外的表情，眼睛睁大，嘴巴微张',
    confused: '困惑、疑惑、不解的表情，歪头，眉头微皱',
    excited: '兴奋、激动、热情的表情，眼睛发亮，充满活力',
    scared: '害怕、恐惧、紧张的表情，眼神闪躲，身体僵硬'
  }

  return `基于参考图中的动漫角色，生成一个表情变体。

目标表情: ${emotionDescriptions[emotion]}
${appearance ? `角色特征: ${appearance}` : ''}

严格要求:
1. 必须保持角色的外观、服装、发型、发色完全一致
2. 只改变面部表情，不改变其他任何部分
3. 保持完全相同的姿态、角度和构图
4. 保持相同的日式动漫画风和色彩风格
5. 背景保持纯白色
6. 表情要明显、夸张但符合动漫风格
7. 整体质量要与参考图一致`
}

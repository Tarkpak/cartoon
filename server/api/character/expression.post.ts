import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
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

  const { characterId, baseImage: _baseImage, emotion, appearance } = parseResult.data

  try {
    console.log(`[ExpressionGen] 开始生成表情: ${characterId} - ${emotion}`)

    // 2. 构建提示词
    const prompt = buildExpressionPrompt(emotion as Emotion, appearance)

    // 3. 调用图片生成 API（带并发控制）
    // 注意：千问不支持参考图
    const result = await imageLimiter.execute(() =>
      generateImage({
        prompt,
        maxRetries: 2
      })
    )

    // 处理千问返回的 URL 或 Gemini 返回的 base64
    let expressionImage = result.imageData || ''
    if (result.imageUrl) {
      const response = await fetch(result.imageUrl)
      const buffer = await response.arrayBuffer()
      expressionImage = Buffer.from(buffer).toString('base64')
    }

    console.log(`[ExpressionGen] 表情生成完成: ${characterId} - ${emotion}, 耗时: ${Date.now() - startTime}ms`)

    return {
      success: true,
      expressionImage,
      emotion,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[ExpressionGen] 生成失败:`, error)

    if (error instanceof GeminiError || error instanceof QwenError) {
      throw createError({
        statusCode: (error as GeminiError).status || 500,
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
    scared: '害怕、恐惧、紧张的表情，眼神闪躲，身体僵硬',
    worried: '担忧、焦虑、不安的表情，眉头紧蹙，嘴唇紧闭',
    concerned: '关切、担心、在意的表情，眉头微皱，眼神专注',
    determined: '坚定、果断、决心的表情，眼神坚毅，下巴微抬',
    thoughtful: '沉思、思考、若有所思的表情，眼神望向远方',
    nervous: '紧张、不安、局促的表情，眼神飘忽，微微冒汗',
    relieved: '如释重负、放松、松了一口气的表情，眉头舒展',
    hopeful: '充满希望、期待、憧憬的表情，眼中闪烁光芒',
    disappointed: '失望、沮丧、落寞的表情，眼神黯淡，肩膀下垂'
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

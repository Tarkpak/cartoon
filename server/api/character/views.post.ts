import { z } from 'zod'
import { _geminiGenerateImage, ImageModels, GeminiError } from '../../utils/gemini'
import { imageLimiter, batchExecute } from '../../utils/concurrency'
import { CharacterViewSchema, type CharacterView } from '../../../shared/types/character'

/**
 * 角色视角变体生成请求
 */
const GenerateCharacterViewsRequestSchema = z.object({
  characterName: z.string().describe('角色名'),
  baseImage: z.string().describe('基础立绘 base64'),
  baseMimeType: z.string().default('image/png'),
  style: z.string().optional().default('日式动漫').describe('画风'),
  views: z.array(CharacterViewSchema).optional().default(['front', 'three_quarter', 'side', 'back'])
})

/**
 * 角色视角变体生成 API
 * POST /api/character/views
 *
 * 基于飞书文档 2.7.2 的角色库创建流程
 * 通过图生图创建角色的各种视角图像，用于保持一致性
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = GenerateCharacterViewsRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { characterName, baseImage, baseMimeType, style, views } = parseResult.data

  try {
    console.log(`[CharacterViews] 开始生成角色视角变体: ${characterName}`)

    const results: Partial<Record<CharacterView, string>> = {}

    // 使用批量执行工具（带并发控制）
    const batchResult = await batchExecute({
      items: views,
      limiter: imageLimiter,
      continueOnError: true,
      processor: async (view) => {
        const prompt = buildViewPrompt(characterName, style, view)

        const result = await _geminiGenerateImage({
          model: ImageModels.HIGH_QUALITY,
          prompt,
          referenceImage: {
            data: baseImage,
            mimeType: baseMimeType
          },
          maxRetries: 1
        })

        return { view, imageData: result.imageData }
      },
      onProgress: (completed, total, result, error) => {
        if (error) {
          console.warn(`[CharacterViews] 视角生成失败 (${completed}/${total}):`, error.message)
        } else if (result) {
          console.log(`[CharacterViews] 视角生成完成: ${result.view} (${completed}/${total})`)
        }
      }
    })

    // 收集成功的结果
    for (const result of batchResult.results) {
      if (result) {
        results[result.view] = result.imageData
      }
    }

    console.log(`[CharacterViews] 视角生成统计: 成功 ${batchResult.successCount}, 失败 ${batchResult.errorCount}`)

    return {
      success: true,
      characterName,
      views: results,
      successCount: batchResult.successCount,
      errorCount: batchResult.errorCount,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[CharacterViews] 生成失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `角色视角生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 构建视角变体提示词
 */
function buildViewPrompt(characterName: string, style: string, view: CharacterView): string {
  const viewDescriptions: Record<CharacterView, string> = {
    front: '正面视角，面向镜头',
    three_quarter: '四分之三侧面视角，略微侧身',
    side: '侧面视角，完全侧身',
    back: '背面视角，背对镜头',
    top_down: '俯视视角，从上方看',
    bottom_up: '仰视视角，从下方看'
  }

  return `基于参考图中的角色 ${characterName}，生成一个视角变体。

目标视角: ${viewDescriptions[view]}

要求:
1. 保持角色外观、服装、发型、配饰完全一致
2. 只改变视角/角度
3. 保持相同的${style}画风
4. 背景保持白色/透明
5. 全身立绘，高清质量
6. 角色比例和细节要与参考图一致`
}

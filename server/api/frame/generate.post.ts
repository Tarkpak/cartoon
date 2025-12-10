import { z } from 'zod'
import { generateImage, ImageModels, GeminiError } from '../../utils/gemini'
import { imageLimiter } from '../../utils/concurrency'
import { SceneSchema } from '../../../shared/types/script'

/**
 * 首尾帧生成请求
 */
const GenerateFrameRequestSchema = z.object({
  scene: SceneSchema.describe('场景信息'),
  style: z.string().optional().default('日式动漫').describe('画风'),
  characterAssets: z.record(z.string(), z.string()).optional().describe('角色资产 (name -> base64)')
})

/**
 * 首尾帧生成 API
 * POST /api/frame/generate
 *
 * 基于场景描述生成首帧和尾帧，确保风格一致
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = GenerateFrameRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { scene, style, characterAssets } = parseResult.data

  try {
    console.log(`[FrameGen] 开始生成首尾帧: ${scene.id}`)

    // 2. 生成首帧
    const firstFrameResult = await generateFirstFrame(scene, style, characterAssets)
    console.log(`[FrameGen] 首帧生成完成`)

    // 3. 生成尾帧 (基于首帧保持一致性)
    const lastFrameResult = await generateLastFrame(
      scene,
      style,
      firstFrameResult.imageData,
      firstFrameResult.mimeType
    )
    console.log(`[FrameGen] 尾帧生成完成`)

    const latencyMs = Date.now() - startTime
    console.log(`[FrameGen] 首尾帧生成完成: ${scene.id}, 耗时: ${latencyMs}ms`)

    return {
      success: true,
      sceneId: scene.id,
      firstFrame: {
        imageData: firstFrameResult.imageData,
        mimeType: firstFrameResult.mimeType
      },
      lastFrame: {
        imageData: lastFrameResult.imageData,
        mimeType: lastFrameResult.mimeType
      },
      latencyMs
    }
  } catch (error) {
    console.error(`[FrameGen] 生成失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `首尾帧生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 生成首帧
 */
async function generateFirstFrame(
  scene: z.infer<typeof SceneSchema>,
  style: string,
  characterAssets?: Record<string, string>
): Promise<{ imageData: string, mimeType: string }> {
  const prompt = buildFirstFramePrompt(scene, style)

  // 如果有主角资产，使用参考图
  const mainCharacter = scene.characters[0]
  const referenceImage = mainCharacter && characterAssets?.[mainCharacter.name]
    ? { data: characterAssets[mainCharacter.name], mimeType: 'image/png' }
    : undefined

  // 使用并发限制器控制请求
  const result = await imageLimiter.execute(() =>
    generateImage({
      model: ImageModels.HIGH_QUALITY,
      prompt,
      referenceImage,
      maxRetries: 2
    })
  )

  return {
    imageData: result.imageData,
    mimeType: result.mimeType
  }
}

/**
 * 生成尾帧
 */
async function generateLastFrame(
  scene: z.infer<typeof SceneSchema>,
  style: string,
  firstFrameData: string,
  firstFrameMimeType: string
): Promise<{ imageData: string, mimeType: string }> {
  const prompt = buildLastFramePrompt(scene, style)

  // 使用并发限制器控制请求
  const result = await imageLimiter.execute(() =>
    generateImage({
      model: ImageModels.HIGH_QUALITY,
      prompt,
      referenceImage: {
        data: firstFrameData,
        mimeType: firstFrameMimeType
      },
      maxRetries: 2
    })
  )

  return {
    imageData: result.imageData,
    mimeType: result.mimeType
  }
}

/**
 * 构建首帧提示词
 */
function buildFirstFramePrompt(
  scene: z.infer<typeof SceneSchema>,
  style: string
): string {
  const { setting, characters, description, dialogues } = scene

  // 提取第一句对话的情绪
  const firstDialogue = dialogues?.[0]
  const initialMood = firstDialogue?.emotion || characters[0]?.emotion || 'neutral'

  // 构建角色描述
  const charactersDesc = characters.map((c) => {
    const parts = [c.name]
    if (c.appearance) parts.push(`(${c.appearance})`)
    if (c.emotion) parts.push(`表情${getEmotionChinese(c.emotion)}`)
    if (c.action) parts.push(c.action)
    return parts.join(' ')
  }).join('；')

  return `创作一幅${style}风格的场景首帧画面。

场景设定:
- 地点: ${setting.location}
- 时间: ${getTimeOfDayChinese(setting.timeOfDay)}
- 氛围: ${setting.mood || '正常'}
${setting.weather ? `- 天气: ${setting.weather}` : ''}

场景描述: ${description}

登场角色: ${charactersDesc}

这是场景的【开始状态】，画面要求:
1. ${style}画风，高清质量
2. 宽屏 16:9 比例
3. 角色表情和姿态符合场景开始时的状态
4. 环境细节丰富，光影效果自然
5. 画面构图清晰，主体突出
6. 情绪基调: ${getEmotionChinese(initialMood)}`
}

/**
 * 构建尾帧提示词
 */
function buildLastFramePrompt(
  scene: z.infer<typeof SceneSchema>,
  style: string
): string {
  const { setting, characters, dialogues } = scene

  // 提取最后一句对话的情绪
  const lastDialogue = dialogues?.[dialogues.length - 1]
  const finalMood = lastDialogue?.emotion || 'neutral'

  // 构建角色描述 - 最终状态
  const charactersDesc = characters.map((c) => {
    const parts = [c.name]
    if (c.appearance) parts.push(`(${c.appearance})`)
    // 使用最终情绪
    parts.push(`表情${getEmotionChinese(finalMood)}`)
    return parts.join(' ')
  }).join('；')

  return `基于参考图，创作场景的【结束状态】画面。

保持一致:
1. 相同的场景地点: ${setting.location}
2. 相同的时间段: ${getTimeOfDayChinese(setting.timeOfDay)}
3. 相同的角色外观和服装
4. 相同的${style}画风
5. 相同的构图视角

变化部分:
1. 角色表情变化为: ${getEmotionChinese(finalMood)}
2. 角色姿态可有轻微变化
3. 体现场景发展后的状态

角色: ${charactersDesc}

这是动画的结束帧，需要与首帧形成连贯的动作过渡。`
}

/**
 * 情绪中文映射
 */
function getEmotionChinese(emotion: string): string {
  const map: Record<string, string> = {
    neutral: '平静',
    happy: '开心',
    sad: '悲伤',
    angry: '愤怒',
    surprised: '惊讶',
    confused: '困惑',
    excited: '兴奋',
    scared: '害怕'
  }
  return map[emotion] || '平静'
}

/**
 * 时间段中文映射
 */
function getTimeOfDayChinese(timeOfDay: string): string {
  const map: Record<string, string> = {
    dawn: '黎明',
    morning: '上午',
    noon: '正午',
    afternoon: '下午',
    evening: '傍晚',
    night: '夜晚'
  }
  return map[timeOfDay] || '白天'
}

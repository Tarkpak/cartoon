import { z } from 'zod'
import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { imageLimiter } from '../../utils/concurrency'

// 定义本地的场景Schema，使 setting 可选
const SceneSettingSchema = z.object({
  location: z.string().describe('场景地点'),
  timeOfDay: z.string().describe('时间段'),
  mood: z.string().optional().describe('氛围描述'),
  weather: z.string().optional().describe('天气')
})

const SceneCharacterSchema = z.object({
  name: z.string().describe('角色名'),
  appearance: z.string().optional().describe('外观描述'),
  action: z.string().optional().describe('动作描述'),
  emotion: z.string().optional().describe('情绪')
})

const DialogueSchema = z.object({
  character: z.string().describe('说话角色名'),
  text: z.string().describe('对话内容'),
  emotion: z.string().optional().describe('情绪')
})

const LocalSceneSchema = z.object({
  id: z.string().describe('场景ID'),
  title: z.string().optional().describe('场景标题'),
  description: z.string().describe('场景描述'),
  setting: SceneSettingSchema.optional().describe('场景设定'),
  characters: z.array(SceneCharacterSchema).describe('登场角色'),
  dialogues: z.array(DialogueSchema).optional().describe('对话列表'),
  duration: z.number().optional().default(8).describe('视频时长(秒)')
})

/**
 * 首尾帧生成请求(基于飞书文档 2.6 优化)
 */
const GenerateFrameRequestSchema = z.object({
  scene: LocalSceneSchema.describe('场景信息'),
  style: z.string().optional().default('日式动漫').describe('画风'),
  characterAssets: z.record(z.string(), z.string()).optional().describe('角色资产 (name -> base64)'),
  sceneBackground: z.string().optional().describe('场景背景图(base64) - 用于角色+场景融合'),
  previousSceneLastFrame: z.string().optional().describe('上一场景的尾帧(base64) - 用于保持场景连续性'),
  fusionMode: z.enum(['character_scene', 'reference', 'text_only']).optional().default('reference').describe('融合模式')
})

/**
 * 首尾帧生成API
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

  const { scene, style, characterAssets, sceneBackground, previousSceneLastFrame, fusionMode } = parseResult.data

  try {
    console.log(`[FrameGen] 开始生成首尾帧: ${scene.id}, 融合模式: ${fusionMode}`)

    // 2. 生成首帧 (根据融合模式选择策略)
    const firstFrameResult = await generateFirstFrame(
      scene, style, characterAssets, sceneBackground, previousSceneLastFrame, fusionMode
    )
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

    if (error instanceof GeminiError || error instanceof QwenError) {
      throw createError({
        statusCode: (error as GeminiError).status || 500,
        statusMessage: `首尾帧生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})


/**
 * 生成首帧 (基于飞书文档 2.6.1.1 优化)
 * @param sceneBackground 场景背景图，用于角色+场景融合
 * @param previousSceneLastFrame 上一场景的尾帧，用于保持场景连续性
 * @param fusionMode 融合模式
 */
async function generateFirstFrame(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  characterAssets?: Record<string, string>,
  sceneBackground?: string,
  previousSceneLastFrame?: string,
  fusionMode: 'character_scene' | 'reference' | 'text_only' = 'reference'
): Promise<{ imageData: string, mimeType: string }> {
  let prompt: string
  let referenceImage: { data: string, mimeType: string } | undefined

  // 根据融合模式选择策略
  if (fusionMode === 'character_scene' && sceneBackground && characterAssets) {
    // 模式1: 角色+场景融合 (基于飞书文档 2.6.1.1)
    // 将角色立绘融合到场景背景中
    const mainCharacter = scene.characters[0]
    const characterImage = mainCharacter ? characterAssets[mainCharacter.name] : undefined

    if (characterImage) {
      prompt = buildCharacterSceneFusionPrompt(scene, style, mainCharacter)
      // 使用场景背景作为参考，提示词中描述角色融合
      referenceImage = { data: sceneBackground, mimeType: 'image/png' }
      console.log('[FrameGen] 使用角色+场景融合模式')
    } else {
      // 降级到场景背景参考模式
      prompt = buildFirstFramePrompt(scene, style, false)
      referenceImage = { data: sceneBackground, mimeType: 'image/png' }
    }
  } else if (previousSceneLastFrame) {
    // 模式2: 使用上一场景尾帧保持连续性(基于飞书文档 2.7.4)
    prompt = buildFirstFramePrompt(scene, style, true)
    referenceImage = { data: previousSceneLastFrame, mimeType: 'image/jpeg' }
    console.log('[FrameGen] 使用上一场景尾帧作为参考图')
  } else if (characterAssets) {
    // 模式3: 使用角色立绘作为参考
    const mainCharacter = scene.characters[0]
    const characterImage = mainCharacter ? characterAssets[mainCharacter.name] : undefined
    if (characterImage) {
      prompt = buildFirstFramePrompt(scene, style, false)
      referenceImage = { data: characterImage, mimeType: 'image/png' }
      console.log('[FrameGen] 使用角色立绘作为参考图')
    } else {
      prompt = buildFirstFramePrompt(scene, style, false)
    }
  } else {
    // 模式4: 纯文本生成
    prompt = buildFirstFramePrompt(scene, style, false)
    console.log('[FrameGen] 使用纯文本生成模式')
  }

  // 使用并发限制器控制请求，使用统一的 generateImage 函数
  // 注意：千问不支持参考图，所以这里不传 referenceImage
  const result = await imageLimiter.execute(() =>
    generateImage({
      prompt,
      maxRetries: 2
    })
  )

  // 处理千问返回的 URL 或 Gemini 返回的 base64
  if (result.imageUrl) {
    const response = await fetch(result.imageUrl)
    const buffer = await response.arrayBuffer()
    return {
      imageData: Buffer.from(buffer).toString('base64'),
      mimeType: 'image/png'
    }
  }

  return {
    imageData: result.imageData || '',
    mimeType: result.mimeType || 'image/png'
  }
}

/**
 * 构建角色+场景融合提示词(基于飞书文档 2.6.1.1)
 */
function buildCharacterSceneFusionPrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  mainCharacter: { name: string, appearance?: string, action?: string, emotion?: string }
): string {
  return `将角色融合到参考图的场景中。

角色信息:
- 名称: ${mainCharacter.name}
${mainCharacter.appearance ? `- 外观: ${mainCharacter.appearance}` : ''}
${mainCharacter.action ? `- 动作: ${mainCharacter.action}` : ''}
${mainCharacter.emotion ? `- 表情: ${getEmotionChinese(mainCharacter.emotion)}` : ''}

场景描述: ${scene.description}

要求:
1. 将角色自然地融入参考图的场景中
2. 保持${style}画风一致
3. 角色的位置、大小要与场景协调
4. 光影效果要与场景环境匹配
5. 16:9 宽屏比例，高清质量
6. 角色姿态要符合场景氛围`
}


/**
 * 生成尾帧
 */
async function generateLastFrame(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  _firstFrameData: string,
  _firstFrameMimeType: string
): Promise<{ imageData: string, mimeType: string }> {
  const prompt = buildLastFramePrompt(scene, style)

  // 使用并发限制器控制请求，使用统一的 generateImage 函数
  // 注意：千问不支持参考图
  const result = await imageLimiter.execute(() =>
    generateImage({
      prompt,
      maxRetries: 2
    })
  )

  // 处理千问返回的 URL 或 Gemini 返回的 base64
  if (result.imageUrl) {
    const response = await fetch(result.imageUrl)
    const buffer = await response.arrayBuffer()
    return {
      imageData: Buffer.from(buffer).toString('base64'),
      mimeType: 'image/png'
    }
  }

  return {
    imageData: result.imageData || '',
    mimeType: result.mimeType || 'image/png'
  }
}

/**
 * 构建首帧提示词
 * @param hasPreviousFrame 是否有上一场景的参考帧
 */
function buildFirstFramePrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  hasPreviousFrame: boolean = false
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
  }).join('、')

  // 如果有上一场景的参考帧，使用完全不同的提示词结构
  if (hasPreviousFrame) {
    return `【关键任务】基于参考图创作连续动画的下一帧。

⚠️ 严格要求 - 必须与参考图保持一致：
1. 角色的脸部特征、发型、发色必须完全相同
2. 角色的服装款式、颜色必须完全相同（如白色衬衫保持白色）
3. 咖啡厅场景的整体布局、装饰保持一致
4. 画风、色调、光影效果保持统一
5. 镜头角度/构图与参考图相似

允许变化的部分：
- 角色的表情变化
- 角色的姿势/动作变化
- 新增角色出场

新场景内容：
${description}

登场角色: ${charactersDesc}

画面要求: ${style}画风，16:9宽屏，高清质量
情绪基调: ${getEmotionChinese(initialMood)}`
  }

  // 处理可选的 setting 字段
  const location = setting?.location || '未知地点'
  const timeOfDay = setting?.timeOfDay || 'morning'
  const mood = setting?.mood || '正常'
  const weather = setting?.weather

  // 首个场景的提示词
  return `创作一幅${style}风格的场景首帧画面。

场景设定:
- 地点: ${location}
- 时间: ${getTimeOfDayChinese(timeOfDay)}
- 氛围: ${mood}
${weather ? `- 天气: ${weather}` : ''}

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
  scene: z.infer<typeof LocalSceneSchema>,
  style: string
): string {
  const { setting, characters, dialogues } = scene

  // 处理可选的 setting 字段
  const location = setting?.location || '未知地点'
  const timeOfDay = setting?.timeOfDay || 'morning'

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
  }).join('、')

  return `基于参考图，创作场景的【结束状态】画面。

保持一致:
1. 相同的场景地点: ${location}
2. 相同的时间段: ${getTimeOfDayChinese(timeOfDay)}
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

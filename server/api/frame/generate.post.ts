import { z } from 'zod'
import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { imageLimiter } from '../../utils/concurrency'
import { getWorkflowModels } from '../models/workflow.get'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import {
  SceneContinuityContextSchema,
  CharacterVisualAnchorSchema,
  type SceneContinuityContext,
  type CharacterVisualAnchor
} from '../../../shared/types/continuity'

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
 * 分镜镜头 Schema (宽松版本，接受 null 值)
 */
const StoryboardShotSchema = z.object({
  shotNumber: z.number(),
  shotType: z.string(),
  cameraMovement: z.string(),
  visualContent: z.string(),
  dialogue: z.string().nullable().optional(),
  character: z.string().nullable().optional(),
  emotion: z.string().nullable().optional(),
  duration: z.number(),
  notes: z.string().nullable().optional()
})

/**
 * 分镜脚本 Schema
 */
const StoryboardSchema = z.object({
  sceneId: z.string(),
  shots: z.array(StoryboardShotSchema),
  totalDuration: z.number(),
  style: z.string().optional()
})

/**
 * 场景视觉 Schema (宽松版本，兼容不同格式)
 */
const SceneVisualSchema = z.object({
  sceneId: z.string(),
  time: z.string().optional(),
  location: z.string().optional(),
  visualElements: z.union([
    z.array(z.string()),
    z.array(z.object({
      element: z.string(),
      description: z.string().optional(),
      detail: z.string().optional(),
      importance: z.string().optional()
    }))
  ]).optional(),
  atmosphere: z.string().optional(),
  sensoryDetails: z.union([
    z.string(),
    z.object({
      visual: z.string().optional(),
      auditory: z.string().optional(),
      tactile: z.string().optional(),
      olfactory: z.string().optional()
    })
  ]).optional().nullable(),
  imagePrompt: z.string().optional()
})

/**
 * 首尾帧生成请求(基于飞书文档 2.6 优化 + 连续性增强)
 */
const GenerateFrameRequestSchema = z.object({
  scene: LocalSceneSchema.describe('场景信息'),
  style: z.string().describe('画风 (必填，由项目配置决定)'),
  characterAssets: z.record(z.string(), z.string()).optional().describe('角色资产 (name -> base64)'),
  sceneBackground: z.string().optional().describe('场景背景图(base64) - 用于角色+场景融合'),
  previousSceneLastFrame: z.string().optional().describe('上一场景的尾帧(base64) - 用于保持场景连续性'),
  fusionMode: z.enum(['character_scene', 'reference', 'text_only', 'continuity']).optional().default('continuity').describe('融合模式'),
  // 分镜脚本和场景视觉数据 (必填，前端需要先生成这些数据)
  storyboard: StoryboardSchema.describe('分镜脚本数据'),
  sceneVisual: SceneVisualSchema.describe('场景视觉提取数据'),
  // 新增：连续性上下文
  continuityContext: SceneContinuityContextSchema.optional().describe('场景连续性上下文'),
  // 新增：角色视觉锚点
  characterAnchors: z.array(CharacterVisualAnchorSchema).optional().describe('角色视觉锚点'),
  // 新增：强制选项
  enforceCharacterConsistency: z.boolean().default(true).describe('是否强制角色一致性'),
  enforcePreviousFrameConnection: z.boolean().default(true).describe('是否强制与上一场景尾帧连接')
})

/**
 * 首尾帧生成API
 * POST /api/frame/generate
 *
 * 基于场景描述生成首帧和尾帧，确保风格一致
 *
 * 连续性增强功能：
 * 1. 强制尾帧连接：非首个场景必须传入上一场景尾帧
 * 2. 角色一致性锚定：通过角色视觉锚点强制保持角色外观一致
 * 3. 全局上下文：携带前后场景摘要信息，保持叙事连贯
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = GenerateFrameRequestSchema.safeParse(body)

  if (!parseResult.success) {
    console.error('[FrameGen] 请求验证失败:', parseResult.error.issues)
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
    })
  }

  const {
    scene,
    style,
    characterAssets,
    sceneBackground,
    previousSceneLastFrame,
    fusionMode,
    storyboard,
    sceneVisual,
    continuityContext,
    characterAnchors,
    enforceCharacterConsistency,
    enforcePreviousFrameConnection
  } = parseResult.data

  try {
    // 2. 连续性检查
    const sceneIndex = continuityContext?.sceneIndex ?? 0
    const isFirstScene = sceneIndex === 0

    console.log(`[FrameGen] 开始生成首尾帧: ${scene.id}`)
    console.log(`[FrameGen] 场景索引: ${sceneIndex}/${continuityContext?.totalScenes ?? '?'}, 是否首场景: ${isFirstScene}`)
    console.log(`[FrameGen] 融合模式: ${fusionMode}, 强制尾帧连接: ${enforcePreviousFrameConnection}, 强制角色一致性: ${enforceCharacterConsistency}`)
    console.log(`[FrameGen] 分镜数据: ${storyboard?.shots?.length || 0}个镜头`)
    console.log(`[FrameGen] 视觉提取: ${sceneVisual?.imagePrompt ? '有imagePrompt' : '无imagePrompt'}`)
    console.log(`[FrameGen] 上一场景尾帧: ${previousSceneLastFrame ? '有' : '无'}`)
    console.log(`[FrameGen] 角色锚点: ${characterAnchors?.length || 0}个`)

    // 3. 强制尾帧连接检查（非首场景必须有上一场景尾帧）
    if (enforcePreviousFrameConnection && !isFirstScene && !previousSceneLastFrame) {
      console.warn(`[FrameGen] ⚠️ 警告: 非首场景(${sceneIndex})缺少上一场景尾帧，可能导致画面不连续`)
      // 不抛错，但记录警告，让生成继续
    }

    // 4. 生成首帧 (根据融合模式选择策略)
    const firstFrameResult = await generateFirstFrame(
      scene,
      style,
      characterAssets,
      sceneBackground,
      previousSceneLastFrame,
      fusionMode || 'continuity',
      storyboard,
      sceneVisual,
      continuityContext,
      characterAnchors,
      enforceCharacterConsistency
    )
    console.log(`[FrameGen] 首帧生成完成`)

    // 5. 生成尾帧 (基于首帧保持一致性)
    const lastFrameResult = await generateLastFrame(
      scene,
      style,
      firstFrameResult.imageData,
      firstFrameResult.mimeType,
      storyboard,
      sceneVisual,
      characterAssets,
      characterAnchors,
      enforceCharacterConsistency
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
      // 返回连续性信息，供前端使用
      continuityInfo: {
        sceneIndex,
        hadPreviousFrame: !!previousSceneLastFrame,
        characterAnchorsUsed: characterAnchors?.length || 0
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
 * 生成首帧 (基于飞书文档 2.6.1.1 优化 + 连续性增强)
 * @param sceneBackground 场景背景图，用于角色+场景融合
 * @param previousSceneLastFrame 上一场景的尾帧，用于保持场景连续性
 * @param fusionMode 融合模式
 * @param storyboard 分镜脚本数据
 * @param sceneVisual 场景视觉提取数据
 * @param continuityContext 连续性上下文
 * @param characterAnchors 角色视觉锚点
 * @param enforceCharacterConsistency 是否强制角色一致性
 */
async function generateFirstFrame(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  characterAssets: Record<string, string> | undefined,
  sceneBackground: string | undefined,
  previousSceneLastFrame: string | undefined,
  fusionMode: 'character_scene' | 'reference' | 'text_only' | 'continuity' = 'continuity',
  storyboard: z.infer<typeof StoryboardSchema>,
  sceneVisual: z.infer<typeof SceneVisualSchema>,
  continuityContext?: SceneContinuityContext,
  characterAnchors?: CharacterVisualAnchor[],
  enforceCharacterConsistency: boolean = true
): Promise<{ imageData: string, mimeType: string }> {
  let prompt: string
  let referenceImages: string[] = []

  // 1. 构建角色一致性约束提示词
  const characterConsistencyPrompt = enforceCharacterConsistency
    ? buildCharacterConsistencyPrompt(scene.characters, characterAnchors, characterAssets)
    : ''

  // 2. 构建全局上下文提示词
  const contextPrompt = continuityContext
    ? buildContinuityContextPrompt(continuityContext, !!previousSceneLastFrame)
    : ''

  // 3. 收集参考图（优先级：上一场景尾帧 > 角色立绘）
  // 如果有上一场景尾帧，必须放在第一位作为主要参考
  if (previousSceneLastFrame) {
    referenceImages.push(previousSceneLastFrame)
    console.log('[FrameGen] 添加上一场景尾帧作为首要参考图')
  }

  // 收集角色立绘作为参考图
  if (characterAssets) {
    for (const char of scene.characters) {
      const charImage = characterAssets[char.name]
      if (charImage) {
        referenceImages.push(charImage)
        console.log(`[FrameGen] 添加角色立绘参考图: ${char.name}`)
      }
    }
  }

  // 尝试从数据库获取首帧提示词模板
  const firstShot = storyboard?.shots?.[0]
  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.FIRST_FRAME_GENERATION,
    {
      sceneDescription: scene.description,
      characters: JSON.stringify(scene.characters),
      style,
      setting: JSON.stringify(scene.setting || {}),
      storyboardShot: firstShot ? JSON.stringify({
        shotType: firstShot.shotType,
        cameraMovement: firstShot.cameraMovement,
        visualContent: firstShot.visualContent
      }) : '{}'
    }
  )

  // 4. 根据融合模式选择提示词构建策略
  if (fusionMode === 'continuity' && previousSceneLastFrame) {
    // 连续性模式：强制与上一场景连接
    console.log('[FrameGen] 使用连续性模式（强制尾帧连接）')
    prompt = buildContinuityFirstFramePrompt(
      scene,
      style,
      storyboard,
      sceneVisual,
      continuityContext,
      characterConsistencyPrompt,
      contextPrompt,
      characterAssets
    )
  } else if (sceneVisual?.imagePrompt) {
    // 优先使用场景视觉提取的 imagePrompt
    console.log('[FrameGen] 使用场景视觉提取的 imagePrompt')
    prompt = buildPromptFromSceneVisual(scene, style, sceneVisual, storyboard, false, characterAssets, characterConsistencyPrompt, contextPrompt)
  } else if (fusionMode === 'character_scene' && sceneBackground && characterAssets) {
    // 模式1: 角色+场景融合 (基于飞书文档 2.6.1.1)
    const mainCharacter = scene.characters[0]
    if (mainCharacter) {
      prompt = buildCharacterSceneFusionPrompt(scene, style, mainCharacter, characterConsistencyPrompt)
      // 场景背景也加入参考图
      referenceImages.unshift(sceneBackground)
      console.log('[FrameGen] 使用角色+场景融合模式')
    } else {
      prompt = templatePrompt || buildFirstFramePrompt(scene, style, false, storyboard, characterConsistencyPrompt, contextPrompt)
      referenceImages.unshift(sceneBackground)
    }
  } else if (previousSceneLastFrame) {
    // 模式2: 使用上一场景尾帧保持连续性(基于飞书文档 2.7.4)
    prompt = buildContinuityFirstFramePrompt(
      scene,
      style,
      storyboard,
      sceneVisual,
      continuityContext,
      characterConsistencyPrompt,
      contextPrompt,
      characterAssets
    )
    console.log('[FrameGen] 使用上一场景尾帧作为参考图')
  } else if (characterAssets && referenceImages.length > 0) {
    // 模式3: 使用角色立绘作为参考
    prompt = templatePrompt || buildFirstFramePrompt(scene, style, false, storyboard, characterConsistencyPrompt, contextPrompt)
    console.log(`[FrameGen] 使用${referenceImages.length}张角色立绘作为参考图`)
  } else {
    // 模式4: 纯文本生成
    prompt = templatePrompt || buildFirstFramePrompt(scene, style, false, storyboard, characterConsistencyPrompt, contextPrompt)
    console.log('[FrameGen] 使用纯文本生成模式')
  }

  // 限制参考图数量 (最多4张)
  if (referenceImages.length > 4) {
    referenceImages = referenceImages.slice(0, 4)
    console.log('[FrameGen] 参考图数量超过4张，已截取前4张')
  }

  console.log(`[FrameGen] 生成首帧，参考图数量: ${referenceImages.length}`)

  // 从工作流配置获取首尾帧生成模型
  const workflowModels = await getWorkflowModels()
  const modelId = workflowModels.frame_generation
  console.log(`[FrameGen] 使用图片模型: ${modelId}`)

  // 构建请求体
  const firstFrameRequest = {
    modelId,
    prompt,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    maxRetries: 2
  }

  // 输出完整请求体 (参考图只输出数量和长度)
  console.log(`[FrameGen] ========== 首帧生成请求体 ==========`)
  console.log(`[FrameGen] modelId: ${firstFrameRequest.modelId}`)
  console.log(`[FrameGen] prompt: ${firstFrameRequest.prompt}`)
  console.log(`[FrameGen] referenceImages: ${firstFrameRequest.referenceImages ? `[${firstFrameRequest.referenceImages.length}张图片]` : 'undefined'}`)
  if (firstFrameRequest.referenceImages) {
    firstFrameRequest.referenceImages.forEach((img, idx) => {
      console.log(`[FrameGen]   - 参考图${idx + 1}: 长度=${img.length}`)
    })
  }
  console.log(`[FrameGen] maxRetries: ${firstFrameRequest.maxRetries}`)
  console.log(`[FrameGen] ========================================`)

  // 使用并发限制器控制请求，传递参考图
  const result = await imageLimiter.execute(() =>
    generateImage(firstFrameRequest)
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
 * 构建角色一致性约束提示词
 */
function buildCharacterConsistencyPrompt(
  sceneCharacters: Array<{ name: string, appearance?: string, emotion?: string, action?: string }>,
  characterAnchors?: CharacterVisualAnchor[],
  characterAssets?: Record<string, string>
): string {
  if (!characterAnchors || characterAnchors.length === 0) {
    // 没有角色锚点时，使用基础的一致性提示
    if (!characterAssets || Object.keys(characterAssets).length === 0) {
      return ''
    }
    const charNames = sceneCharacters.filter(c => characterAssets[c.name]).map(c => c.name)
    if (charNames.length === 0) return ''

    return `
【角色一致性要求 - 严格遵守】
参考图中包含以下角色的立绘，必须严格保持一致：
${charNames.map(name => `- ${name}: 保持发型、发色、服装、面部特征完全一致`).join('\n')}
⚠️ 禁止改变角色的任何外观特征，包括发型、发色、服装颜色和款式。`
  }

  // 有角色锚点时，使用详细的一致性约束
  const anchorsInScene = characterAnchors.filter(anchor =>
    sceneCharacters.some(c => c.name === anchor.name)
  )

  if (anchorsInScene.length === 0) return ''

  const anchorDescriptions = anchorsInScene.map(anchor => {
    const features = anchor.coreFeatures
    const parts = [`【${anchor.name}】`]
    if (features.hairStyle) parts.push(`发型: ${features.hairStyle}`)
    if (features.hairColor) parts.push(`发色: ${features.hairColor}`)
    if (features.eyeColor) parts.push(`眼睛: ${features.eyeColor}`)
    if (features.skinTone) parts.push(`肤色: ${features.skinTone}`)
    if (features.facialFeatures) parts.push(`面部: ${features.facialFeatures}`)
    if (anchor.outfit) {
      parts.push(`服装: ${anchor.outfit.description}`)
      if (anchor.outfit.colors?.length) parts.push(`服装颜色: ${anchor.outfit.colors.join('、')}`)
    }
    return parts.join('\n  ')
  }).join('\n\n')

  return `
【角色一致性要求 - 最高优先级】
以下角色特征必须与参考图完全一致，不允许任何偏差：

${anchorDescriptions}

⚠️ 严格要求：
1. 角色的发型、发色必须与参考图100%一致
2. 角色的服装款式、颜色必须与参考图100%一致
3. 角色的面部特征必须与参考图保持一致
4. 只允许改变角色的表情和姿势，不允许改变外观`
}

/**
 * 构建连续性上下文提示词
 */
function buildContinuityContextPrompt(
  context: SceneContinuityContext,
  hasPreviousFrame: boolean
): string {
  const parts: string[] = []

  // 场景位置信息
  parts.push(`【场景位置】第 ${context.sceneIndex + 1} 场 / 共 ${context.totalScenes} 场`)

  // 上一场景信息
  if (context.previousScene && hasPreviousFrame) {
    const prev = context.previousScene
    parts.push(`
【上一场景摘要】
- 标题: ${prev.title || '无'}
- 地点: ${prev.setting?.location || '未知'}
- 时间: ${prev.setting?.timeOfDay || '未知'}
- 氛围: ${prev.setting?.mood || '正常'}
- 角色状态: ${prev.characters.map(c => `${c.name}(${c.emotion || '平静'})`).join('、')}
${prev.narrativeState?.plotPoint ? `- 剧情要点: ${prev.narrativeState.plotPoint}` : ''}`)
  }

  // 下一场景预告（如果有）
  if (context.nextScene) {
    const next = context.nextScene
    parts.push(`
【下一场景预告】
- 地点: ${next.setting?.location || '未知'}
- 氛围变化: ${next.setting?.mood || '正常'}`)
  }

  // 故事全局信息
  if (context.storyContext) {
    const story = context.storyContext
    if (story.overallMood) {
      parts.push(`【故事基调】${story.overallMood}`)
    }
  }

  return parts.join('\n')
}

/**
 * 构建连续性首帧提示词（强制与上一场景连接）
 */
function buildContinuityFirstFramePrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  storyboard: z.infer<typeof StoryboardSchema>,
  sceneVisual: z.infer<typeof SceneVisualSchema>,
  continuityContext?: SceneContinuityContext,
  characterConsistencyPrompt: string = '',
  contextPrompt: string = '',
  characterAssets?: Record<string, string>
): string {
  const { setting, characters, description, dialogues } = scene

  // 提取第一句对话的情绪
  const firstDialogue = dialogues?.[0]
  const initialMood = firstDialogue?.emotion || characters[0]?.emotion || 'neutral'

  // 构建角色描述
  const charactersDesc = characters.map((c) => {
    const parts = [c.name]
    const hasAsset = characterAssets && characterAssets[c.name]
    if (hasAsset) parts.push('(必须与参考图一致)')
    if (c.appearance) parts.push(`(${c.appearance})`)
    if (c.emotion) parts.push(`表情${getEmotionChinese(c.emotion)}`)
    if (c.action) parts.push(c.action)
    return parts.join(' ')
  }).join('、')

  // 获取分镜信息
  let shotInfo = ''
  if (storyboard && storyboard.shots.length > 0) {
    const firstShot = storyboard.shots[0]
    if (firstShot) {
      shotInfo = `
【镜头设计】
- 景别: ${getShotTypeChinese(firstShot.shotType)}
- 运镜: ${getCameraMovementChinese(firstShot.cameraMovement)}
- 画面内容: ${firstShot.visualContent}`
    }
  }

  // 处理可选的 setting 字段
  const location = setting?.location || '未知地点'
  const timeOfDay = setting?.timeOfDay || 'morning'
  const mood = setting?.mood || '正常'

  // 使用场景视觉的 imagePrompt（如果有）
  const visualPrompt = sceneVisual?.imagePrompt || description

  return `【最高优先级任务】基于参考图（上一场景尾帧）创作连续动画的下一帧。
${contextPrompt}
${characterConsistencyPrompt}

【严格要求 - 必须与参考图保持一致】
1. 角色的脸部特征、发型、发色必须完全相同
2. 角色的服装款式、颜色必须完全相同
3. 整体画风、色调、光影效果保持统一
4. 镜头角度/构图与参考图相似或自然过渡

【允许变化的部分】
- 角色的表情变化（从上一场景过渡到: ${getEmotionChinese(initialMood)}）
- 角色的姿势/动作变化
- 场景环境的自然变化（如果场景切换）

【新场景内容】
- 地点: ${location}
- 时间: ${getTimeOfDayChinese(timeOfDay)}
- 氛围: ${mood}
- 描述: ${visualPrompt}
${shotInfo}

【登场角色】${charactersDesc}

【画面要求】
- ${style}画风，16:9宽屏，高清质量
- 情绪基调: ${getEmotionChinese(initialMood)}
- 这是场景的【开始状态】，需要与上一场景自然衔接`
}

/**
 * 构建角色+场景融合提示词(基于飞书文档 2.6.1.1)
 */
function buildCharacterSceneFusionPrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  mainCharacter: { name: string, appearance?: string, action?: string, emotion?: string },
  characterConsistencyPrompt: string = ''
): string {
  return `将角色融合到参考图的场景中。
${characterConsistencyPrompt}

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
 * 基于场景视觉提取数据构建提示词 (优先使用 imagePrompt)
 */
function buildPromptFromSceneVisual(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  sceneVisual: z.infer<typeof SceneVisualSchema>,
  storyboard?: z.infer<typeof StoryboardSchema>,
  isLastFrame: boolean = false,
  characterAssets?: Record<string, string>,
  characterConsistencyPrompt: string = '',
  contextPrompt: string = ''
): string {
  const { characters, dialogues } = scene

  // 获取分镜信息
  let shotInfo = ''
  if (storyboard && storyboard.shots.length > 0) {
    const shot = isLastFrame
      ? storyboard.shots[storyboard.shots.length - 1]
      : storyboard.shots[0]
    if (shot) {
      shotInfo = `
镜头设计:
- 景别: ${getShotTypeChinese(shot.shotType)}
- 运镜: ${getCameraMovementChinese(shot.cameraMovement)}
- 画面内容: ${shot.visualContent}`
      console.log(`[FrameGen] 使用分镜信息: 景别=${shot.shotType}, 运镜=${shot.cameraMovement}`)
    }
  } else {
    console.log(`[FrameGen] 未使用分镜信息: storyboard=${storyboard ? 'exists' : 'undefined'}, shots=${storyboard?.shots?.length || 0}`)
  }

  // 构建角色描述，标注哪些角色有参考立绘
  const charactersDesc = characters.map((c) => {
    const parts = [c.name]
    const hasAsset = characterAssets && characterAssets[c.name]
    if (hasAsset) parts.push('(必须与参考图一致)')
    if (c.appearance) parts.push(`(${c.appearance})`)
    if (c.emotion) parts.push(`表情${getEmotionChinese(c.emotion)}`)
    if (c.action) parts.push(c.action)
    return parts.join(' ')
  }).join('、')

  // 提取情绪
  const emotion = isLastFrame
    ? (dialogues?.[dialogues.length - 1]?.emotion || characters[0]?.emotion || 'neutral')
    : (dialogues?.[0]?.emotion || characters[0]?.emotion || 'neutral')

  // 使用 imagePrompt 作为核心提示词
  const basePrompt = sceneVisual.imagePrompt || scene.description

  // 处理 sensoryDetails (可能是字符串或对象)
  let sensoryDetailsStr = ''
  if (sceneVisual.sensoryDetails) {
    if (typeof sceneVisual.sensoryDetails === 'string') {
      sensoryDetailsStr = sceneVisual.sensoryDetails
    } else if (typeof sceneVisual.sensoryDetails === 'object' && sceneVisual.sensoryDetails.visual) {
      sensoryDetailsStr = sceneVisual.sensoryDetails.visual
    }
  }

  return `创作一幅${style}风格的${isLastFrame ? '场景结束' : '场景开始'}画面。
${contextPrompt}
${characterConsistencyPrompt}

【AI优化的图像提示词】
${basePrompt}

【场景氛围】
${sceneVisual.atmosphere || ''}

【感官细节】
${sensoryDetailsStr}
${shotInfo}

【登场角色】
${charactersDesc}

【画面要求】
1. ${style}画风，高清质量
2. 宽屏 16:9 比例
3. 情绪基调: ${getEmotionChinese(emotion)}
4. ${isLastFrame ? '体现场景发展后的结束状态' : '体现场景开始时的初始状态'}`
}


/**
 * 生成尾帧（增强版，支持角色一致性）
 */
async function generateLastFrame(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  firstFrameData: string,
  _firstFrameMimeType: string,
  storyboard: z.infer<typeof StoryboardSchema>,
  sceneVisual: z.infer<typeof SceneVisualSchema>,
  characterAssets?: Record<string, string>,
  characterAnchors?: CharacterVisualAnchor[],
  enforceCharacterConsistency: boolean = true
): Promise<{ imageData: string, mimeType: string }> {
  // 1. 构建角色一致性约束提示词
  const characterConsistencyPrompt = enforceCharacterConsistency
    ? buildCharacterConsistencyPrompt(scene.characters, characterAnchors, characterAssets)
    : ''

  // 2. 收集参考图：首帧 + 角色立绘
  let referenceImages: string[] = [firstFrameData]  // 首帧作为第一张参考图

  if (characterAssets) {
    for (const char of scene.characters) {
      const charImage = characterAssets[char.name]
      if (charImage) {
        referenceImages.push(charImage)
        console.log(`[FrameGen] 尾帧添加角色立绘参考图: ${char.name}`)
      }
    }
  }

  // 限制参考图数量 (最多4张)
  if (referenceImages.length > 4) {
    referenceImages = referenceImages.slice(0, 4)
    console.log('[FrameGen] 尾帧参考图数量超过4张，已截取前4张')
  }

  // 尝试从数据库获取尾帧提示词模板
  const lastShot = storyboard?.shots?.[storyboard.shots.length - 1]
  const firstDialogue = scene.dialogues?.[0]
  const lastDialogue = scene.dialogues?.[scene.dialogues.length - 1]
  const initialEmotion = firstDialogue?.emotion || scene.characters[0]?.emotion || 'neutral'
  const finalEmotion = lastDialogue?.emotion || scene.characters[0]?.emotion || 'neutral'

  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.LAST_FRAME_GENERATION,
    {
      sceneDescription: scene.description,
      characters: JSON.stringify(scene.characters),
      style,
      setting: JSON.stringify(scene.setting || {}),
      storyboardShot: lastShot ? JSON.stringify({
        shotType: lastShot.shotType,
        cameraMovement: lastShot.cameraMovement,
        visualContent: lastShot.visualContent
      }) : '{}',
      initialEmotion: getEmotionChinese(initialEmotion),
      finalEmotion: getEmotionChinese(finalEmotion)
    }
  )

  // 优先使用场景视觉提取的 imagePrompt 构建尾帧提示词
  let prompt: string
  if (sceneVisual?.imagePrompt) {
    prompt = buildPromptFromSceneVisual(scene, style, sceneVisual, storyboard, true, characterAssets, characterConsistencyPrompt, '')
  } else {
    prompt = templatePrompt || buildLastFramePrompt(scene, style, storyboard, characterConsistencyPrompt)
  }

  console.log(`[FrameGen] 生成尾帧，参考图数量: ${referenceImages.length}`)

  // 从工作流配置获取首尾帧生成模型
  const workflowModels = await getWorkflowModels()
  const modelId = workflowModels.frame_generation
  console.log(`[FrameGen] 尾帧使用图片模型: ${modelId}`)

  // 构建请求体
  const lastFrameRequest = {
    modelId,
    prompt,
    referenceImages,
    maxRetries: 2
  }

  // 输出完整请求体 (参考图只输出数量和长度)
  console.log(`[FrameGen] ========== 尾帧生成请求体 ==========`)
  console.log(`[FrameGen] modelId: ${lastFrameRequest.modelId}`)
  console.log(`[FrameGen] prompt: ${lastFrameRequest.prompt}`)
  console.log(`[FrameGen] referenceImages: [${lastFrameRequest.referenceImages.length}张图片]`)
  lastFrameRequest.referenceImages.forEach((img, idx) => {
    console.log(`[FrameGen]   - 参考图${idx + 1}: 长度=${img.length}`)
  })
  console.log(`[FrameGen] maxRetries: ${lastFrameRequest.maxRetries}`)
  console.log(`[FrameGen] ========================================`)

  // 使用并发限制器控制请求，传递参考图
  const result = await imageLimiter.execute(() =>
    generateImage(lastFrameRequest)
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
 * @param storyboard 分镜脚本数据
 * @param characterConsistencyPrompt 角色一致性提示词
 * @param contextPrompt 上下文提示词
 */
function buildFirstFramePrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  hasPreviousFrame: boolean = false,
  storyboard?: z.infer<typeof StoryboardSchema>,
  characterConsistencyPrompt: string = '',
  contextPrompt: string = ''
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

  // 获取分镜信息
  let shotInfo = ''
  if (storyboard && storyboard.shots.length > 0) {
    const firstShot = storyboard.shots[0]
    if (firstShot) {
      shotInfo = `
【镜头设计】
- 景别: ${getShotTypeChinese(firstShot.shotType)}
- 运镜: ${getCameraMovementChinese(firstShot.cameraMovement)}
- 画面内容: ${firstShot.visualContent}`
    }
  }

  // 如果有上一场景的参考帧，使用完全不同的提示词结构
  if (hasPreviousFrame) {
    return `【关键任务】基于参考图创作连续动画的下一帧。
${contextPrompt}
${characterConsistencyPrompt}

⚠️ 严格要求 - 必须与参考图保持一致：
1. 角色的脸部特征、发型、发色必须完全相同
2. 角色的服装款式、颜色必须完全相同
3. 场景的整体布局、装饰保持一致
4. 画风、色调、光影效果保持统一
5. 镜头角度/构图与参考图相似或自然过渡

允许变化的部分：
- 角色的表情变化
- 角色的姿势/动作变化
- 新增角色出场

新场景内容：
${description}
${shotInfo}

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
${contextPrompt}
${characterConsistencyPrompt}

场景设定:
- 地点: ${location}
- 时间: ${getTimeOfDayChinese(timeOfDay)}
- 氛围: ${mood}
${weather ? `- 天气: ${weather}` : ''}

场景描述: ${description}
${shotInfo}

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
 * @param characterConsistencyPrompt 角色一致性提示词
 */
function buildLastFramePrompt(
  scene: z.infer<typeof LocalSceneSchema>,
  style: string,
  storyboard?: z.infer<typeof StoryboardSchema>,
  characterConsistencyPrompt: string = ''
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

  // 获取分镜信息
  let shotInfo = ''
  if (storyboard && storyboard.shots.length > 0) {
    const lastShot = storyboard.shots[storyboard.shots.length - 1]
    if (lastShot) {
      shotInfo = `
【镜头设计】
- 景别: ${getShotTypeChinese(lastShot.shotType)}
- 运镜: ${getCameraMovementChinese(lastShot.cameraMovement)}
- 画面内容: ${lastShot.visualContent}`
    }
  }

  return `基于参考图，创作场景的【结束状态】画面。
${characterConsistencyPrompt}

保持一致:
1. 相同的场景地点: ${location}
2. 相同的时间段: ${getTimeOfDayChinese(timeOfDay)}
3. 相同的角色外观和服装（必须与参考图完全一致）
4. 相同的${style}画风
5. 相同的构图视角

变化部分:
1. 角色表情变化为: ${getEmotionChinese(finalMood)}
2. 角色姿态可有轻微变化
3. 体现场景发展后的状态
${shotInfo}

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
 * 景别中文映射
 */
function getShotTypeChinese(shotType: string): string {
  const map: Record<string, string> = {
    extreme_wide: '大远景',
    wide: '远景/全景',
    medium_wide: '中全景',
    medium: '中景',
    medium_close: '中近景',
    close: '近景',
    extreme_close: '特写',
    detail: '细节特写'
  }
  return map[shotType] || shotType
}

/**
 * 运镜中文映射
 */
function getCameraMovementChinese(cameraMovement: string): string {
  const map: Record<string, string> = {
    static: '定镜/固定机位',
    push: '推镜头',
    pull: '拉镜头',
    pan_left: '左摇',
    pan_right: '右摇',
    tilt_up: '上摇',
    tilt_down: '下摇',
    track: '跟镜头',
    dolly: '移动镜头',
    zoom_in: '变焦推进',
    zoom_out: '变焦拉远',
    crane: '升降镜头',
    handheld: '手持镜头',
    arc: '环绕镜头'
  }
  return map[cameraMovement] || cameraMovement
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

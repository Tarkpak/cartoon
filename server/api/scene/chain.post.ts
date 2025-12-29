import { eq } from 'drizzle-orm'
import { getGeminiClient, VideoModels, GeminiError, GeminiErrorCode, _geminiWithRetry } from '../../utils/gemini'
import * as qwen from '../../utils/qwen'
import { generateImage, findVideoModel } from '../../utils/model-provider'
import { getWorkflowModels } from '../models/workflow.get'
import { db, videoTasks as videoTasksTable } from '../../db'
import {
  ChainScenesRequestSchema,
  type SceneChain,
  type SceneFrameData,
  type TransitionType,
  type Duration
} from '../../../shared/types/video'

/**
 * 场景串联 API
 * POST /api/scene/chain
 *
 * 将多个场景串联起来，自动生成场景间的转场视频
 * - 上一场景尾帧 → 下一场景首帧 过渡
 * - 生成场景间转场视频 (使用首尾帧插值)
 * - 维护整体叙事连贯性
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = ChainScenesRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { sceneFrames, transitionType, transitionDuration, style } = parseResult.data

  if (sceneFrames.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: '至少需要2个场景才能串联'
    })
  }

  try {
    console.log(`[SceneChain] 开始串联 ${sceneFrames.length} 个场景, 风格: ${style}`)

    // 2. 生成场景链 ID
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 3. 为每对相邻场景创建转场任务
    const transitions: SceneChain['transitions'] = []

    for (let i = 0; i < sceneFrames.length - 1; i++) {
      const fromScene = sceneFrames[i]
      const toScene = sceneFrames[i + 1]

      if (!fromScene || !toScene) {
        console.warn(`[SceneChain] 跳过无效场景: index ${i}`)
        continue
      }

      // 创建转场任务
      const taskId = await createTransitionTask(
        fromScene,
        toScene,
        transitionType || 'dissolve',
        transitionDuration || 4,
        style
      )

      transitions.push({
        fromSceneId: fromScene.sceneId,
        toSceneId: toScene.sceneId,
        taskId,
        status: 'pending'
      })

      console.log(`[SceneChain] 转场任务已创建: ${fromScene.sceneId} → ${toScene.sceneId}`)
    }

    // 4. 异步启动所有转场视频生成
    for (let i = 0; i < transitions.length; i++) {
      const transition = transitions[i]
      const fromScene = sceneFrames[i]
      const toScene = sceneFrames[i + 1]

      if (!transition || !fromScene || !toScene) {
        console.warn(`[SceneChain] 跳过无效转场: index ${i}`)
        continue
      }

      // 异步生成转场视频（不阻塞响应）
      generateTransitionVideoAsync(
        transition.taskId,
        fromScene,
        toScene,
        transitionType || 'dissolve',
        transitionDuration || 4,
        style
      ).catch(async (error) => {
        console.error(`[SceneChain] 转场任务 ${transition.taskId} 失败:`, error)
        await db.update(videoTasksTable)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : '未知错误',
            updatedAt: new Date().toISOString()
          })
          .where(eq(videoTasksTable.id, transition.taskId))
      })
    }

    // 5. 返回场景链信息
    const result: SceneChain = {
      id: chainId,
      sceneIds: sceneFrames.map(s => s.sceneId),
      transitions,
      createdAt: new Date().toISOString()
    }

    const latencyMs = Date.now() - startTime
    console.log(`[SceneChain] 场景链创建完成: ${chainId}, 共 ${transitions.length} 个转场任务`)

    return {
      success: true,
      chain: result,
      message: `已启动 ${transitions.length} 个转场视频生成任务`,
      latencyMs
    }
  } catch (error) {
    console.error(`[SceneChain] 串联失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `场景串联失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 创建转场任务记录
 */
async function createTransitionTask(
  fromScene: SceneFrameData,
  toScene: SceneFrameData,
  transitionType: TransitionType,
  duration: Duration,
  style: string
): Promise<string> {
  const taskId = `transition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const config = {
    firstFrame: fromScene.lastFrame, // 上一场景的尾帧
    lastFrame: toScene.firstFrame, // 下一场景的首帧
    prompt: buildTransitionPrompt(fromScene.sceneId, toScene.sceneId, transitionType, style),
    duration,
    resolution: '1080p' as const,
    aspectRatio: '16:9' as const,
    withAudio: false // 转场视频不需要单独音频
  }

  await db.insert(videoTasksTable).values({
    id: taskId,
    sceneId: `${fromScene.sceneId}_to_${toScene.sceneId}`,
    status: 'pending',
    progress: 0,
    config: JSON.stringify(config),
    createdAt: now,
    updatedAt: now
  })

  return taskId
}

/**
 * 构建转场视频提示词
 */
function buildTransitionPrompt(
  fromSceneId: string,
  toSceneId: string,
  transitionType: TransitionType,
  style: string
): string {
  const transitionDescriptions: Record<TransitionType, string> = {
    fade: '画面逐渐淡出，然后新画面淡入，形成柔和的过渡效果',
    dissolve: '两个画面交叉溶解，前一个画面逐渐消失的同时后一个画面逐渐出现',
    cut: '快速切换到下一个画面，保持动作的连贯性',
    wipe: '新画面从一侧擦入，覆盖原有画面'
  }

  return `创作一段场景转场动画。

这是从场景 [${fromSceneId}] 到场景 [${toSceneId}] 的过渡。

转场效果: ${transitionDescriptions[transitionType]}

要求:
1. 保持两个场景之间的视觉连贯性
2. 转场过程自然流畅
3. 动作和角色运动要平滑衔接
4. 光影和色调要协调过渡
5. ${style}风格，高清质量`
}

/**
 * 更新任务进度
 */
type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

async function updateTaskProgress(taskId: string, progress: number, status?: TaskStatus) {
  const updateData: Record<string, unknown> = {
    progress,
    updatedAt: new Date().toISOString()
  }
  if (status) {
    updateData.status = status
  }
  await db.update(videoTasksTable)
    .set(updateData)
    .where(eq(videoTasksTable.id, taskId))
}

/**
 * 确定使用哪个视频提供商
 */
function determineVideoProvider(): 'gemini' | 'qwen' {
  const selected = getSelectedModels()
  const selectedModel = findVideoModel(selected.video)
  if (selectedModel && (selectedModel.provider === 'gemini' || selectedModel.provider === 'qwen')) {
    return selectedModel.provider
  }
  return 'gemini'
}

/**
 * 异步生成转场视频
 */
async function generateTransitionVideoAsync(
  taskId: string,
  fromScene: SceneFrameData,
  toScene: SceneFrameData,
  transitionType: TransitionType,
  duration: Duration,
  style: string
): Promise<void> {
  const provider = determineVideoProvider()
  console.log(`[SceneChain] 使用提供商: ${provider}`)

  if (provider === 'qwen') {
    await generateTransitionWithQwen(taskId, fromScene, toScene, transitionType, duration, style)
  } else {
    await generateTransitionWithGemini(taskId, fromScene, toScene, transitionType, duration, style)
  }
}

/**
 * 使用千问万相生成转场视频
 */
async function generateTransitionWithQwen(
  taskId: string,
  fromScene: SceneFrameData,
  toScene: SceneFrameData,
  transitionType: TransitionType,
  duration: Duration,
  style: string
): Promise<void> {
  try {
    await updateTaskProgress(taskId, 10, 'processing')

    const selected = getSelectedModels()
    const modelId = selected.video || qwen.QwenVideoModels.WAN_2_6_T2V

    // 千问不支持首尾帧插值，使用文生视频
    const prompt = buildTransitionPrompt(fromScene.sceneId, toScene.sceneId, transitionType, style)

    // 转换时长
    let qwenDuration = duration
    if (qwenDuration <= 5) qwenDuration = 5
    else if (qwenDuration <= 10) qwenDuration = 10
    else qwenDuration = 15

    console.log('[SceneChain] Qwen API 转场视频请求参数:', {
      model: modelId,
      promptLength: prompt.length,
      fromSceneId: fromScene.sceneId,
      toSceneId: toScene.sceneId,
      transitionType,
      duration: qwenDuration
    })

    await updateTaskProgress(taskId, 20)

    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt,
      duration: qwenDuration,
      size: '1280*720',
      promptExtend: true,
      audio: false,
      watermark: false
    })

    await updateTaskProgress(taskId, 95)

    // 保存结果
    const metadata = {
      duration: qwenDuration,
      resolution: '720p',
      aspectRatio: '16:9',
      fps: 24,
      hasAudio: false,
      isTransition: true,
      fromSceneId: fromScene.sceneId,
      toSceneId: toScene.sceneId
    }

    await db.update(videoTasksTable)
      .set({
        status: 'completed',
        progress: 100,
        videoData: result.videoUrl ? `url:${result.videoUrl}` : '',
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))

    console.log(`[SceneChain] 千问转场视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[SceneChain] 千问转场生成失败:`, error)
    throw error
  }
}

/**
 * 使用 Gemini Veo 生成转场视频
 */
async function generateTransitionWithGemini(
  taskId: string,
  fromScene: SceneFrameData,
  toScene: SceneFrameData,
  transitionType: TransitionType,
  duration: Duration,
  style: string
): Promise<void> {
  try {
    // 更新状态为处理中
    await updateTaskProgress(taskId, 10, 'processing')

    const client = getGeminiClient()
    console.log(`[SceneChain] 开始生成转场视频: ${taskId}`)

    // 1. 可选：生成过渡中间帧以增强连贯性（当前仅用于日志，后续可用于优化）
    await updateTaskProgress(taskId, 15)
    const _transitionFrame = await generateTransitionFrame(
      fromScene.lastFrame,
      toScene.firstFrame,
      fromScene.mimeType,
      transitionType,
      style
    )
    console.log(`[SceneChain] 过渡中间帧生成完成`)

    // 2. 调用 Veo API 生成转场视频
    await updateTaskProgress(taskId, 25)

    const prompt = buildTransitionPrompt(fromScene.sceneId, toScene.sceneId, transitionType, style)

    console.log('[SceneChain] Veo API 转场视频请求参数:', {
      model: VideoModels.VEO_3_1,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
      fromSceneId: fromScene.sceneId,
      toSceneId: toScene.sceneId,
      transitionType,
      duration,
      fromFrameMimeType: fromScene.mimeType || 'image/png',
      toFrameMimeType: toScene.mimeType || 'image/png',
      aspectRatio: '16:9',
      resolution: '1080p'
    })

    let operation = await _geminiWithRetry(async () => {
      return await client.models.generateVideos({
        model: VideoModels.VEO_3_1,
        prompt,
        image: {
          imageBytes: fromScene.lastFrame,
          mimeType: fromScene.mimeType || 'image/png'
        },
        config: {
          lastFrame: {
            imageBytes: toScene.firstFrame,
            mimeType: toScene.mimeType || 'image/png'
          },
          aspectRatio: '16:9',
          durationSeconds: duration,
          resolution: '1080p',
          generateAudio: false
        }
      })
    }, { maxRetries: 2 })

    // 3. 轮询等待生成完成
    console.log(`[SceneChain] 等待转场视频生成完成...`)
    const maxWaitTime = 180000 // 最长等待 3 分钟
    const pollInterval = 10000 // 每 10 秒检查一次
    const startPollTime = Date.now()

    while (!operation.done) {
      // 检查超时
      if (Date.now() - startPollTime > maxWaitTime) {
        throw new GeminiError(
          '转场视频生成超时',
          GeminiErrorCode.DEADLINE_EXCEEDED,
          504,
          false
        )
      }

      // 更新进度 (25% - 90%)
      const elapsed = Date.now() - startPollTime
      const progressPercent = Math.min(90, 25 + (elapsed / maxWaitTime) * 65)
      await updateTaskProgress(taskId, Math.round(progressPercent))

      // 等待后再次检查
      await new Promise(resolve => setTimeout(resolve, pollInterval))

      operation = await client.operations.getVideosOperation({
        operation
      })
    }

    // 4. 获取生成结果
    await updateTaskProgress(taskId, 95)

    const generatedVideos = operation.response?.generatedVideos
    if (!generatedVideos || generatedVideos.length === 0) {
      throw new GeminiError(
        '未能生成转场视频',
        GeminiErrorCode.INTERNAL,
        500,
        false
      )
    }

    // 5. 获取视频数据
    const generatedVideo = generatedVideos[0]
    let videoData = ''

    if (!generatedVideo) {
      throw new GeminiError(
        '视频数据为空',
        GeminiErrorCode.INTERNAL,
        500,
        false
      )
    }

    try {
      if (generatedVideo.video) {
        const videoInfo = generatedVideo.video as { uri?: string, name?: string }
        if (videoInfo.uri) {
          const response = await fetch(videoInfo.uri)
          const buffer = await response.arrayBuffer()
          videoData = Buffer.from(buffer).toString('base64')
        } else if (videoInfo.name) {
          videoData = `ref:${videoInfo.name}`
        }
      }
    } catch (downloadError) {
      console.warn(`[SceneChain] 视频下载失败:`, downloadError)
      const videoInfo = generatedVideo.video as { name?: string }
      videoData = videoInfo?.name ? `ref:${videoInfo.name}` : ''
    }

    // 6. 完成任务
    const metadata = {
      duration,
      resolution: '1080p',
      aspectRatio: '16:9',
      fps: 24,
      hasAudio: false,
      isTransition: true,
      fromSceneId: fromScene.sceneId,
      toSceneId: toScene.sceneId
    }

    await db.update(videoTasksTable)
      .set({
        status: 'completed',
        progress: 100,
        videoData,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))

    console.log(`[SceneChain] 转场视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[SceneChain] 转场生成失败:`, error)

    await db.update(videoTasksTable)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : '未知错误',
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))

    throw error
  }
}

/**
 * 生成过渡中间帧（可选，用于增强连贯性）
 * 通过混合两帧的风格来创建更平滑的过渡
 */
async function generateTransitionFrame(
  _lastFrameData: string,
  _firstFrameData: string,
  _mimeType: string,
  transitionType: TransitionType,
  style: string
): Promise<{ imageData: string, mimeType: string } | null> {
  try {
    // 对于直切类型，不需要中间帧
    if (transitionType === 'cut') {
      return null
    }

    const prompt = `基于提供的两张图片，创建一个中间过渡帧。

要求:
1. 融合两张图片的视觉元素
2. 保持${style}风格
3. 画面要自然协调
4. 光影效果要平滑过渡
5. 16:9 宽屏比例

这是两个场景之间的过渡帧，需要在视觉上连接这两个画面。`

    // 从工作流配置获取首尾帧生成模型
    const workflowModels = await getWorkflowModels()
    const modelId = workflowModels.frame_generation
    console.log(`[SceneChain] 过渡帧使用图片模型: ${modelId}`)

    // 使用统一的 generateImage 函数
    const result = await generateImage({
      modelId,
      prompt,
      maxRetries: 1
    })

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
  } catch (error) {
    // 中间帧生成失败不影响主流程
    console.warn(`[SceneChain] 中间帧生成失败，跳过:`, error)
    return null
  }
}

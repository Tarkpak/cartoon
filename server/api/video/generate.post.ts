import { eq } from 'drizzle-orm'
import { VideoModels, GeminiError, GeminiErrorCode, _geminiWithRetry } from '../../utils/gemini'
import * as qwen from '../../utils/qwen'
import * as volcengine from '../../utils/volcengine'
import { getSelectedModels, findVideoModel } from '../../utils/model-provider'
import { getWorkflowModels } from '../models/workflow.get'
import { videoLimiter } from '../../utils/concurrency'
import { db, scenes as scenesTable, videoTasks as videoTasksTable } from '../../db'
import {
  GenerateVideoRequestSchema,
  type GeneratedVideo
} from '../../../shared/types/video'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 视频生成 API
 * POST /api/video/generate
 *
 * 支持 Gemini Veo、千问万相、火山引擎 视频生成
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  console.log('[VideoGen] 收到请求:', JSON.stringify({
    sceneId: body?.sceneId,
    hasConfig: !!body?.config,
    configKeys: body?.config ? Object.keys(body.config) : [],
    provider: body?.config?.provider,
    modelId: body?.config?.modelId
  }))

  const parseResult = GenerateVideoRequestSchema.safeParse(body)

  if (!parseResult.success) {
    console.error('[VideoGen] 请求验证失败:', parseResult.error.issues)
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { sceneId, config } = parseResult.data

  // 2. 创建任务并存入数据库
  const taskId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  try {
    await db.insert(videoTasksTable).values({
      id: taskId,
      sceneId,
      status: 'pending',
      progress: 0,
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now
    })
    console.log('[VideoGen] 任务创建成功:', taskId)
  } catch (dbError) {
    console.error('[VideoGen] 数据库插入失败:', dbError)
    throw createError({
      statusCode: 500,
      statusMessage: '任务创建失败',
      message: dbError instanceof Error ? dbError.message : '数据库错误'
    })
  }

  // 3. 异步启动视频生成 (不阻塞响应)
  generateVideoAsync(taskId, sceneId, config).catch(async (error) => {
    console.error(`[VideoGen] 任务 ${taskId} 失败:`, error)
    await db.update(videoTasksTable)
      .set({
        status: 'failed',
        error: normalizeVideoTaskError(error),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))
  })

  return {
    success: true,
    taskId,
    message: '视频生成任务已启动',
    latencyMs: Date.now() - startTime
  }
})

/**
 * 更新任务进度
 */
type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

function normalizeVideoTaskError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误')
  const message = rawMessage.trim()

  if (!message) return '视频生成失败'

  if (/input image may contain real person/i.test(message)) {
    return '输入图片可能包含真人内容，当前视频模型不支持，请改用非真人角色图或切换其他模型。'
  }

  if (/sensitive/i.test(message)) {
    return '输入内容可能触发安全限制，请调整提示词或参考图后重试。'
  }

  if (/quota|rate limit|resource_exhausted/i.test(message)) {
    return '模型调用次数已达上限，请稍后重试。'
  }

  if (/timeout|deadline exceeded/i.test(message)) {
    return '视频生成超时，请稍后重试。'
  }

  return message
}

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

function normalizeSceneVideoUrlFromTask(videoData?: string | null): string | null {
  const raw = videoData?.trim()
  if (!raw) return null

  if (raw.startsWith('url:')) {
    return normalizeSceneVideoUrlFromTask(raw.slice(4))
  }

  if (raw.startsWith('/videos/')) {
    const filename = raw.slice('/videos/'.length)
    return filename ? `/api/video/file/${filename}` : null
  }

  if (raw.startsWith('/api/video/file/')) return raw
  if (raw.startsWith('http')) return raw
  if (raw.startsWith('data:video')) return raw
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('ref:')) return null

  // 兜底兼容：如果是纯 base64，补充 data URI
  return `data:video/mp4;base64,${raw}`
}

async function syncSceneVideoResult(sceneId: string, videoData?: string | null): Promise<void> {
  if (!sceneId) return

  const normalizedVideoUrl = normalizeSceneVideoUrlFromTask(videoData)
  if (!normalizedVideoUrl) return

  try {
    await db.update(scenesTable)
      .set({
        videoUrl: normalizedVideoUrl,
        status: 'video_ready',
        updatedAt: new Date().toISOString()
      })
      .where(eq(scenesTable.id, sceneId))
  } catch (error) {
    console.warn(`[VideoGen] 场景视频状态回写失败: ${sceneId}`, error)
  }
}

/**
 * 确定使用哪个提供商
 */
async function determineProvider(config: typeof GenerateVideoRequestSchema._type['config']): Promise<'gemini' | 'qwen' | 'volcengine'> {
  // 1. 如果明确指定了 provider
  if (config.provider === 'gemini' || config.provider === 'qwen' || config.provider === 'volcengine') {
    return config.provider
  }
  
  // 2. 如果指定了 modelId，从模型配置中获取
  if (config.modelId) {
    const modelConfig = findVideoModel(config.modelId)
    if (modelConfig && (modelConfig.provider === 'gemini' || modelConfig.provider === 'qwen' || modelConfig.provider === 'volcengine')) {
      return modelConfig.provider
    }
  }
  
  // 3. 优先使用业务流程配置的模型 (从数据库读取)
  const workflowModels = await getWorkflowModels()
  const workflowVideoModel = workflowModels.video_generation
  if (workflowVideoModel) {
    const workflowModelConfig = findVideoModel(workflowVideoModel)
    if (workflowModelConfig && (workflowModelConfig.provider === 'gemini' || workflowModelConfig.provider === 'qwen' || workflowModelConfig.provider === 'volcengine')) {
      console.log(`[VideoGen] 使用业务流程配置的模型: ${workflowVideoModel} (${workflowModelConfig.provider})`)
      return workflowModelConfig.provider
    }
  }
  
  // 4. 使用当前选择的模型
  const selected = getSelectedModels()
  const selectedModel = findVideoModel(selected.video)
  if (selectedModel && (selectedModel.provider === 'gemini' || selectedModel.provider === 'qwen' || selectedModel.provider === 'volcengine')) {
    return selectedModel.provider
  }
  
  // 5. 默认使用 Gemini
  return 'gemini'
}

/**
 * 获取实际使用的模型 ID
 */
async function getActualModelId(config: typeof GenerateVideoRequestSchema._type['config']): Promise<string | undefined> {
  // 1. 如果明确指定了 modelId
  if (config.modelId) {
    return config.modelId
  }
  
  // 2. 优先使用业务流程配置的模型 (从数据库读取)
  const workflowModels = await getWorkflowModels()
  const workflowVideoModel = workflowModels.video_generation
  if (workflowVideoModel) {
    const modelConfig = findVideoModel(workflowVideoModel)
    if (modelConfig) {
      return workflowVideoModel
    }
  }
  
  // 3. 使用当前选择的模型
  const selected = getSelectedModels()
  return selected.video
}

/**
 * 异步生成视频
 */
async function generateVideoAsync(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  const provider = await determineProvider(config)
  console.log(`[VideoGen] 使用提供商: ${provider}`)

  if (provider === 'qwen') {
    await generateVideoWithQwen(taskId, sceneId, config)
  } else if (provider === 'volcengine') {
    await generateVideoWithVolcengine(taskId, sceneId, config)
  } else {
    await generateVideoWithGemini(taskId, sceneId, config)
  }
}

/**
 * 使用千问万相生成视频
 */
async function generateVideoWithQwen(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  try {
    await updateTaskProgress(taskId, 10, 'processing')

    // 确定模型 - 优先使用业务流程配置 (从数据库读取)
    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null
    
    // 如果模型不是 qwen 的，使用默认 qwen 模型
    if (!modelConfig || modelConfig.provider !== 'qwen') {
      modelId = config.imageUrl ? qwen.QwenVideoModels.WAN_2_6_I2V : qwen.QwenVideoModels.WAN_2_6_T2V
    }

    // 转换分辨率为 size 格式
    let size = config.size
    if (!size) {
      // 根据 resolution 和 aspectRatio 计算 size
      if (config.resolution === '1080p') {
        switch (config.aspectRatio) {
          case '16:9': size = '1920*1080'; break
          case '9:16': size = '1080*1920'; break
          case '1:1': size = '1440*1440'; break
          default: size = '1920*1080'
        }
      } else {
        switch (config.aspectRatio) {
          case '16:9': size = '1280*720'; break
          case '9:16': size = '720*1280'; break
          case '1:1': size = '960*960'; break
          default: size = '1280*720'
        }
      }
    }

    // 转换时长 (Qwen 支持 5, 10, 15)
    let duration = config.duration
    if (duration <= 5) duration = 5
    else if (duration <= 10) duration = 10
    else duration = 15

    console.log('[VideoGen] Qwen API 请求参数:', {
      model: modelId,
      promptLength: config.prompt.length,
      hasImageUrl: !!config.imageUrl,
      hasAudioUrl: !!config.audioUrl,
      size,
      duration,
      withAudio: config.withAudio
    })

    await updateTaskProgress(taskId, 20)

    // 调用千问视频生成
    // 检查是否是首尾帧模型
    const isKf2vModel = modelId?.includes('kf2v')
    
    // 准备首尾帧 URL (如果有 base64 数据，转换为 data URL)
    let firstFrameUrl: string | undefined
    let lastFrameUrl: string | undefined
    
    if (config.firstFrame) {
      firstFrameUrl = config.firstFrame.startsWith('data:') 
        ? config.firstFrame 
        : `data:image/png;base64,${config.firstFrame}`
    }
    if (config.lastFrame) {
      lastFrameUrl = config.lastFrame.startsWith('data:') 
        ? config.lastFrame 
        : `data:image/png;base64,${config.lastFrame}`
    }
    
    console.log('[VideoGen] 首尾帧信息:', {
      isKf2vModel,
      hasFirstFrame: !!firstFrameUrl,
      hasLastFrame: !!lastFrameUrl,
      firstFrameLength: firstFrameUrl?.length || 0,
      lastFrameLength: lastFrameUrl?.length || 0
    })
    
    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt: config.prompt,
      imageUrl: config.imageUrl,
      firstFrameUrl,  // 首尾帧模型需要
      lastFrameUrl,   // 首尾帧模型需要
      audioUrl: config.audioUrl,
      duration,
      size,
      negativePrompt: config.negativePrompt,
      promptExtend: config.promptExtend ?? true,
      audio: config.withAudio,
      watermark: config.watermark ?? false,
      seed: config.seed
    })

    await updateTaskProgress(taskId, 95)

    // 下载视频到本地
    let videoData = ''
    if (result.videoUrl) {
      try {
        const videosDir = path.join(process.cwd(), 'public', 'videos')
        if (!fs.existsSync(videosDir)) {
          fs.mkdirSync(videosDir, { recursive: true })
        }

        const videoFileName = `${taskId}.mp4`
        const videoFilePath = path.join(videosDir, videoFileName)
        const localVideoUrl = `/api/video/file/${videoFileName}`

        // 下载视频
        const response = await fetch(result.videoUrl)
        if (response.ok) {
          const buffer = await response.arrayBuffer()
          fs.writeFileSync(videoFilePath, Buffer.from(buffer))
          console.log(`[VideoGen] 视频下载成功: ${videoFilePath}`)
          videoData = `url:${localVideoUrl}`
        } else {
          // 保存远程 URL
          videoData = `url:${result.videoUrl}`
        }
      } catch (downloadError) {
        console.error('[VideoGen] 视频下载失败:', downloadError)
        videoData = `url:${result.videoUrl}`
      }
    }

    // 构建结果
    const generatedVideo: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: {
        duration,
        resolution: config.resolution,
        aspectRatio: config.aspectRatio,
        fps: 24,
        hasAudio: config.withAudio
      },
      createdAt: new Date().toISOString()
    }

    // 完成任务
    await db.update(videoTasksTable)
      .set({
        status: 'completed',
        progress: 100,
        videoData: generatedVideo.videoData,
        metadata: JSON.stringify(generatedVideo.metadata),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))
    await syncSceneVideoResult(sceneId, generatedVideo.videoData)

    console.log(`[VideoGen] 千问视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 千问生成失败:`, error)
    throw error
  }
}

/**
 * 使用 Gemini Veo 生成视频
 */
async function generateVideoWithGemini(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  try {
    // 更新状态为处理中
    await updateTaskProgress(taskId, 10, 'processing')

    console.log(`[VideoGen] 开始生成视频: ${taskId}`)

    // 1. 调用 Veo API 开始生成
    await updateTaskProgress(taskId, 20)

    // 根据是否有首尾帧决定生成方式
    const hasFrames = config.firstFrame && config.lastFrame

    // 根据配置选择模型
    const selectedModel = config.model === 'fast'
      ? VideoModels.VEO_3_1_FAST
      : VideoModels.VEO_3_1

    console.log('[VideoGen] Veo API 请求参数:', {
      model: selectedModel,
      promptLength: config.prompt.length,
      prompt: config.prompt,
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      resolution: config.resolution,
      withAudio: config.withAudio
    })

    // 使用视频并发限制器控制请求
    const startResult = await videoLimiter.execute(() => _geminiWithRetry(async ({ client, keyAlias }) => {
      console.log(`[VideoGen] 本次视频请求使用 key: ${keyAlias}`)
      if (hasFrames) {
        // 使用首尾帧插值模式
        // 注意：使用插值时 durationSeconds 必须为 8 秒
        // 参考文档：https://ai.google.dev/gemini-api/docs/video#using-first-and-last-video-frames
        const operation = await client.models.generateVideos({
          model: selectedModel,
          prompt: config.prompt,
          image: {
            imageBytes: config.firstFrame,
            mimeType: 'image/png'
          },
          config: {
            lastFrame: {
              imageBytes: config.lastFrame,
              mimeType: 'image/png'
            },
            aspectRatio: config.aspectRatio,
            durationSeconds: 8, // 插值模式必须为 8 秒
            resolution: config.resolution
          }
        })
        return { operation, client }
      } else {
        // 纯文本生成模式
        const operation = await client.models.generateVideos({
          model: selectedModel,
          prompt: config.prompt,
          config: {
            aspectRatio: config.aspectRatio,
            durationSeconds: config.duration,
            resolution: config.resolution
          }
        })
        return { operation, client }
      }
    }, { maxRetries: 2 }))

    let operation = startResult.operation
    const operationClient = startResult.client

    // 2. 轮询等待生成完成
    console.log(`[VideoGen] 等待视频生成完成...`)
    const maxWaitTime = 180000 // 最长等待 3 分钟
    const pollInterval = 10000 // 每 10 秒检查一次
    const startPollTime = Date.now()

    while (!operation.done) {
      // 检查超时
      if (Date.now() - startPollTime > maxWaitTime) {
        throw new GeminiError(
          '视频生成超时',
          GeminiErrorCode.DEADLINE_EXCEEDED,
          504,
          false
        )
      }

      // 更新进度 (20% - 90%)
      const elapsed = Date.now() - startPollTime
      const progressPercent = Math.min(90, 20 + (elapsed / maxWaitTime) * 70)
      await updateTaskProgress(taskId, Math.round(progressPercent))

      // 等待后再次检查
      await new Promise(resolve => setTimeout(resolve, pollInterval))

      operation = await operationClient.operations.getVideosOperation({
        operation: operation
      })
    }

    // 3. 获取生成结果
    await updateTaskProgress(taskId, 95)

    const generatedVideos = operation.response?.generatedVideos
    if (!generatedVideos || generatedVideos.length === 0) {
      throw new GeminiError(
        '未能生成视频',
        GeminiErrorCode.INTERNAL,
        500,
        false
      )
    }

    // 4. 获取视频数据 - 保存到 public/videos 目录
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
        console.log(`[VideoGen] 视频对象:`, JSON.stringify(generatedVideo.video))

        // 确保视频目录存在
        const videosDir = path.join(process.cwd(), 'public', 'videos')
        if (!fs.existsSync(videosDir)) {
          fs.mkdirSync(videosDir, { recursive: true })
        }

        // 生成唯一文件名
        const videoFileName = `${taskId}.mp4`
        const videoFilePath = path.join(videosDir, videoFileName)
        const videoUrl = `/api/video/file/${videoFileName}`

        console.log(`[VideoGen] 保存视频到: ${videoFilePath}`)

        await operationClient.files.download({
          file: generatedVideo.video,
          downloadPath: videoFilePath
        })

        // 验证文件是否下载成功
        if (fs.existsSync(videoFilePath)) {
          const stats = fs.statSync(videoFilePath)
          console.log(`[VideoGen] 视频保存成功, 大小: ${stats.size} bytes, URL: ${videoUrl}`)
          // 返回 URL 而不是 base64
          videoData = `url:${videoUrl}`
        } else {
          throw new Error('视频文件未能保存')
        }
      }
    } catch (downloadError) {
      console.error(`[VideoGen] 视频下载失败:`, downloadError)
      // 存储视频引用供后续处理
      const videoInfo = generatedVideo.video as { name?: string }
      videoData = videoInfo?.name ? `ref:${videoInfo.name}` : ''
    }

    // 5. 构建结果
    const result: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: {
        duration: config.duration,
        resolution: config.resolution,
        aspectRatio: config.aspectRatio,
        fps: 24,
        hasAudio: config.withAudio
      },
      createdAt: new Date().toISOString()
    }

    // 6. 完成任务 - 更新数据库
    await db.update(videoTasksTable)
      .set({
        status: 'completed',
        progress: 100,
        videoData: result.videoData,
        metadata: JSON.stringify(result.metadata),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))
    await syncSceneVideoResult(sceneId, result.videoData)

    console.log(`[VideoGen] 视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 生成失败:`, error)

    await db.update(videoTasksTable)
      .set({
        status: 'failed',
        error: normalizeVideoTaskError(error),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))

    throw error
  }
}

/**
 * 使用火山引擎生成视频
 */
async function generateVideoWithVolcengine(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  try {
    await updateTaskProgress(taskId, 10, 'processing')

    // 确定模型 - 优先使用业务流程配置 (从数据库读取)
    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null
    
    // 如果模型不是 volcengine 的，使用默认 volcengine 模型
    if (!modelConfig || modelConfig.provider !== 'volcengine') {
      // 火山引擎只有图生视频模型，没有纯文生视频
      modelId = volcengine.VolcengineVideoModels.SEEDANCE_1_0_LITE_I2V
    }

    // 转换时长 (火山引擎支持 2-12 秒)
    let duration = config.duration
    if (duration < 2) duration = 2
    else if (duration > 12) duration = 12

    console.log('[VideoGen] Volcengine API 请求参数:', {
      model: modelId,
      promptLength: config.prompt.length,
      hasImageUrl: !!config.imageUrl,
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      duration
    })

    await updateTaskProgress(taskId, 20)

    // 调用火山引擎视频生成
    const result = await volcengine._volcengineGenerateVideo({
      model: modelId,
      prompt: config.prompt,
      imageUrl: config.imageUrl,
      firstFrameUrl: config.firstFrame ? `data:image/png;base64,${config.firstFrame}` : undefined,
      lastFrameUrl: config.lastFrame ? `data:image/png;base64,${config.lastFrame}` : undefined,
      duration,
      resolution: config.resolution
    })

    await updateTaskProgress(taskId, 95)

    // 下载视频到本地
    let videoData = ''
    if (result.videoUrl) {
      try {
        const videosDir = path.join(process.cwd(), 'public', 'videos')
        if (!fs.existsSync(videosDir)) {
          fs.mkdirSync(videosDir, { recursive: true })
        }

        const videoFileName = `${taskId}.mp4`
        const videoFilePath = path.join(videosDir, videoFileName)
        const localVideoUrl = `/api/video/file/${videoFileName}`

        // 下载视频
        const response = await fetch(result.videoUrl)
        if (response.ok) {
          const buffer = await response.arrayBuffer()
          fs.writeFileSync(videoFilePath, Buffer.from(buffer))
          console.log(`[VideoGen] 视频下载成功: ${videoFilePath}`)
          videoData = `url:${localVideoUrl}`
        } else {
          // 保存远程 URL
          videoData = `url:${result.videoUrl}`
        }
      } catch (downloadError) {
        console.error('[VideoGen] 视频下载失败:', downloadError)
        videoData = `url:${result.videoUrl}`
      }
    }

    // 构建结果
    const generatedVideo: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: {
        duration,
        resolution: config.resolution,
        aspectRatio: config.aspectRatio,
        fps: 24,
        hasAudio: false // 火山引擎 1.5 pro 支持音频，其他不支持
      },
      createdAt: new Date().toISOString()
    }

    // 完成任务
    await db.update(videoTasksTable)
      .set({
        status: 'completed',
        progress: 100,
        videoData: generatedVideo.videoData,
        metadata: JSON.stringify(generatedVideo.metadata),
        updatedAt: new Date().toISOString()
      })
      .where(eq(videoTasksTable.id, taskId))
    await syncSceneVideoResult(sceneId, generatedVideo.videoData)

    console.log(`[VideoGen] 火山引擎视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 火山引擎生成失败:`, error)
    throw error
  }
}

import { eq } from 'drizzle-orm'
import { getGeminiClient, VideoModels, GeminiError, GeminiErrorCode, withRetry } from '../../utils/gemini'
import { videoLimiter } from '../../utils/concurrency'
import { db, videoTasks as videoTasksTable } from '../../db'
import {
  GenerateVideoRequestSchema,
  type GeneratedVideo
} from '../../../shared/types/video'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * 视频生成 API
 * POST /api/video/generate
 *
 * 使用 Veo 3.1 基于首尾帧生成视频
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  console.log('[VideoGen] 收到请求:', JSON.stringify({
    sceneId: body?.sceneId,
    hasConfig: !!body?.config,
    configKeys: body?.config ? Object.keys(body.config) : []
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
        error: error instanceof Error ? error.message : '未知错误',
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
 * 异步生成视频
 */
async function generateVideoAsync(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  try {
    // 更新状态为处理中
    await updateTaskProgress(taskId, 10, 'processing')

    const client = getGeminiClient()
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
      promptPreview: config.prompt.slice(0, 200) + (config.prompt.length > 200 ? '...' : ''),
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      resolution: config.resolution,
      withAudio: config.withAudio
    })

    // 使用视频并发限制器控制请求
    let operation = await videoLimiter.execute(() => withRetry(async () => {
      if (hasFrames) {
        // 使用首尾帧插值模式
        // 注意：使用插值时 durationSeconds 必须为 8 秒
        // 参考文档：https://ai.google.dev/gemini-api/docs/video#using-first-and-last-video-frames
        return await client.models.generateVideos({
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
      } else {
        // 纯文本生成模式
        return await client.models.generateVideos({
          model: selectedModel,
          prompt: config.prompt,
          config: {
            aspectRatio: config.aspectRatio,
            durationSeconds: config.duration,
            resolution: config.resolution
          }
        })
      }
    }, { maxRetries: 2 }))

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

      operation = await client.operations.getVideosOperation({
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

    // 4. 获取视频数据 - 使用 SDK 的 files.download() 方法
    const generatedVideo = generatedVideos[0]
    let videoData = ''

    try {
      if (generatedVideo.video) {
        console.log(`[VideoGen] 视频对象:`, JSON.stringify(generatedVideo.video))

        // 使用 SDK 的 files.download() 方法下载视频到临时文件
        const tempDir = os.tmpdir()
        const tempFileName = `video_${taskId}_${Date.now()}.mp4`
        const tempFilePath = path.join(tempDir, tempFileName)

        console.log(`[VideoGen] 使用 SDK 下载视频到: ${tempFilePath}`)

        await client.files.download({
          file: generatedVideo.video,
          downloadPath: tempFilePath
        })

        // 读取临时文件并转为 base64
        if (fs.existsSync(tempFilePath)) {
          const fileBuffer = fs.readFileSync(tempFilePath)
          videoData = fileBuffer.toString('base64')
          console.log(`[VideoGen] 视频下载成功, 大小: ${fileBuffer.byteLength} bytes`)

          // 清理临时文件
          fs.unlinkSync(tempFilePath)
          console.log(`[VideoGen] 临时文件已清理`)
        } else {
          throw new Error('视频文件未能下载')
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

    console.log(`[VideoGen] 视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 生成失败:`, error)

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

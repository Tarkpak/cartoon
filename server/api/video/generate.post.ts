import { eq } from 'drizzle-orm'
import { VideoModels, GeminiError, GeminiErrorCode, _geminiWithRetry } from '../../utils/gemini'
import * as qwen from '../../utils/qwen'
import * as kling from '../../utils/kling'
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
 * 支持 Gemini Veo、千问万相、可灵 AI、火山引擎 视频生成
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
const VOLCENGINE_REALISM_PROMPT_PREFIX = [
  '【真人实拍要求】',
  '@图1（若有@图2同样适用）角色必须保持同一人物身份',
  '真人实拍，电影级光影，真实皮肤质感，4K高清，面部稳定',
  '禁止换脸、禁止变更发型发色、禁止新增主角'
].join('\n')

function withVolcengineRealismPrompt(prompt: string): string {
  if (/真人实拍|真人写实|写实风格|photoreal|realistic skin|cinematic lighting/i.test(prompt)) {
    return prompt
  }
  return `${VOLCENGINE_REALISM_PROMPT_PREFIX}\n${prompt}`
}

function normalizeVideoTaskError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误')
  const message = rawMessage.trim()

  if (!message) return '视频生成失败'

  if (/input image may contain real person/i.test(message)) {
    return '输入图片触发真人隐私拦截。若当前使用 Seedance，请先在前置步骤生成线稿参考图（角色立绘/首尾帧）后重试。'
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

function isGeminiDurationBoundError(error: unknown): boolean {
  const rawMessage = error instanceof Error ? error.message : JSON.stringify(error)
  if (!rawMessage) return false
  return /durationSeconds.*out of bound|between\s+4\s+and\s+8/i.test(rawMessage)
}

function isGeminiUnsupportedVideoRequestError(error: unknown): boolean {
  const rawMessage = error instanceof Error ? error.message : JSON.stringify(error)
  if (!rawMessage) return false
  return /unsupported video generation request|referenceimages\s+isn['’]?t\s+supported/i.test(rawMessage)
}

function clampGeminiDuration(duration: unknown): number {
  const value = typeof duration === 'number' && Number.isFinite(duration)
    ? Math.round(duration)
    : 8
  return Math.max(4, Math.min(8, value))
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function extractGeminiErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message) return message
  }
  if (typeof error === 'string') {
    const message = error.trim()
    if (message) return message
  }

  const record = toRecord(error)
  if (!record) return undefined

  const directMessage = typeof record.message === 'string' ? record.message.trim() : ''
  if (directMessage) return directMessage

  const statusMessage = typeof record.statusMessage === 'string' ? record.statusMessage.trim() : ''
  if (statusMessage) return statusMessage

  const nestedError = extractGeminiErrorMessage(record.error)
  if (nestedError) return nestedError

  const details = Array.isArray(record.details) ? record.details : []
  for (const detail of details) {
    const detailMessage = extractGeminiErrorMessage(detail)
    if (detailMessage) return detailMessage
  }

  return undefined
}

function parseGeminiOperationResponse(operation: { response?: unknown }): {
  generatedVideos: Array<{ video?: unknown }>
  raiMediaFilteredCount: number
  raiMediaFilteredReasons: string[]
} {
  const responseRecord = toRecord(operation.response)

  const generatedVideosRaw = responseRecord?.generatedVideos ?? responseRecord?.videos
  const generatedVideos = Array.isArray(generatedVideosRaw)
    ? (generatedVideosRaw as Array<{ video?: unknown }>)
    : []

  const filteredCountRaw = responseRecord?.raiMediaFilteredCount
  const parsedCount = typeof filteredCountRaw === 'number'
    ? filteredCountRaw
    : Number(filteredCountRaw ?? 0)
  const raiMediaFilteredCount = Number.isFinite(parsedCount) ? parsedCount : 0

  const raiMediaFilteredReasons = toStringArray(responseRecord?.raiMediaFilteredReasons)

  return {
    generatedVideos,
    raiMediaFilteredCount,
    raiMediaFilteredReasons
  }
}

function resolveGeminiModelId(config: typeof GenerateVideoRequestSchema._type['config']): string {
  if (config.modelId) {
    const modelConfig = findVideoModel(config.modelId)
    if (modelConfig?.provider === 'gemini') {
      return config.modelId
    }
  }

  return config.model === 'fast'
    ? VideoModels.VEO_3_1_FAST
    : VideoModels.VEO_3_1
}

async function resolveGeminiImageInput(imageUrl?: string): Promise<{ imageBytes: string, mimeType: string } | null> {
  const raw = imageUrl?.trim()
  if (!raw) return null

  const dataUriMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    return {
      imageBytes: dataUriMatch[2],
      mimeType: dataUriMatch[1]
    }
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`参考图下载失败: ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    const mimeType = response.headers.get('content-type') || 'image/png'
    return {
      imageBytes: Buffer.from(buffer).toString('base64'),
      mimeType
    }
  }

  return {
    imageBytes: raw,
    mimeType: 'image/png'
  }
}

async function resolveGeminiReferenceImages(
  referenceImages?: string[]
): Promise<Array<{ imageBytes: string, mimeType: string }>> {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return []
  }

  const normalized: Array<{ imageBytes: string, mimeType: string }> = []
  const seen = new Set<string>()

  for (const raw of referenceImages) {
    const parsed = await resolveGeminiImageInput(raw)
    if (!parsed) continue

    const dedupeKey = `${parsed.mimeType}:${parsed.imageBytes}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    normalized.push(parsed)
    if (normalized.length >= 3) break
  }

  return normalized
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
async function determineProvider(config: typeof GenerateVideoRequestSchema._type['config']): Promise<'gemini' | 'qwen' | 'kling' | 'volcengine'> {
  // 1. 如果明确指定了 provider
  if (config.provider === 'gemini' || config.provider === 'qwen' || config.provider === 'kling' || config.provider === 'volcengine') {
    return config.provider
  }

  // 2. 如果指定了 modelId，从模型配置中获取
  if (config.modelId) {
    const modelConfig = findVideoModel(config.modelId)
    if (modelConfig && (modelConfig.provider === 'gemini' || modelConfig.provider === 'qwen' || modelConfig.provider === 'kling' || modelConfig.provider === 'volcengine')) {
      return modelConfig.provider
    }
  }

  // 3. 优先使用业务流程配置的模型 (从数据库读取)
  const workflowModels = await getWorkflowModels()
  const workflowVideoModel = workflowModels.video_generation
  if (workflowVideoModel) {
    const workflowModelConfig = findVideoModel(workflowVideoModel)
    if (workflowModelConfig && (workflowModelConfig.provider === 'gemini' || workflowModelConfig.provider === 'qwen' || workflowModelConfig.provider === 'kling' || workflowModelConfig.provider === 'volcengine')) {
      console.log(`[VideoGen] 使用业务流程配置的模型: ${workflowVideoModel} (${workflowModelConfig.provider})`)
      return workflowModelConfig.provider
    }
  }

  // 4. 使用当前选择的模型
  const selected = getSelectedModels()
  const selectedModel = findVideoModel(selected.video)
  if (selectedModel && (selectedModel.provider === 'gemini' || selectedModel.provider === 'qwen' || selectedModel.provider === 'kling' || selectedModel.provider === 'volcengine')) {
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
  } else if (provider === 'kling') {
    await generateVideoWithKling(taskId, sceneId, config)
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
          case '16:9':
            size = '1920*1080'
            break
          case '9:16':
            size = '1080*1920'
            break
          case '1:1':
            size = '1440*1440'
            break
          default: size = '1920*1080'
        }
      } else {
        switch (config.aspectRatio) {
          case '16:9':
            size = '1280*720'
            break
          case '9:16':
            size = '720*1280'
            break
          case '1:1':
            size = '960*960'
            break
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
      firstFrameUrl, // 首尾帧模型需要
      lastFrameUrl, // 首尾帧模型需要
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
 * 使用可灵 AI 生成视频
 */
async function generateVideoWithKling(
  taskId: string,
  sceneId: string,
  config: typeof GenerateVideoRequestSchema._type['config']
): Promise<void> {
  try {
    await updateTaskProgress(taskId, 10, 'processing')

    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null
    if (!modelConfig || modelConfig.provider !== 'kling' || !modelId) {
      modelId = kling.KlingVideoModels.KLING_V2_6
    }

    const duration = Math.min(15, Math.max(3, Math.round(config.duration)))
    const mode: 'std' | 'pro' = config.model === 'fast' ? 'std' : 'pro'

    const normalizeKlingImageInput = (value?: string): string | undefined => {
      if (!value) return undefined
      const trimmed = value.trim()
      if (!trimmed) return undefined
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
      if (trimmed.startsWith('data:')) {
        const commaIndex = trimmed.indexOf(',')
        return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed
      }
      return trimmed
    }

    const firstFrame = normalizeKlingImageInput(config.firstFrame)
    const lastFrame = normalizeKlingImageInput(config.lastFrame)
    const imageInput = normalizeKlingImageInput(config.imageUrl)

    console.log('[VideoGen] Kling API 请求参数:', {
      model: modelId,
      mode,
      duration,
      aspectRatio: config.aspectRatio,
      hasImageUrl: !!imageInput,
      hasFirstFrame: !!firstFrame,
      hasLastFrame: !!lastFrame,
      withAudio: config.withAudio
    })

    await updateTaskProgress(taskId, 20)

    const result = await kling._klingGenerateVideo({
      model: modelId,
      prompt: config.prompt,
      imageUrl: imageInput,
      firstFrameUrl: firstFrame,
      lastFrameUrl: lastFrame,
      duration,
      aspectRatio: config.aspectRatio,
      withAudio: config.withAudio,
      mode,
      negativePrompt: config.negativePrompt
    })

    await updateTaskProgress(taskId, 95)

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

        const response = await fetch(result.videoUrl)
        if (response.ok) {
          const buffer = await response.arrayBuffer()
          fs.writeFileSync(videoFilePath, Buffer.from(buffer))
          console.log(`[VideoGen] 视频下载成功: ${videoFilePath}`)
          videoData = `url:${localVideoUrl}`
        } else {
          videoData = `url:${result.videoUrl}`
        }
      } catch (downloadError) {
        console.error('[VideoGen] 视频下载失败:', downloadError)
        videoData = `url:${result.videoUrl}`
      }
    }

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

    console.log(`[VideoGen] 可灵视频生成完成: ${taskId}`)
  } catch (error) {
    console.error('[VideoGen] 可灵生成失败:', error)
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

    // 根据输入决定生成方式：首尾帧 > 单图参考/多参考图 > 纯文本
    const hasFrames = !!(config.firstFrame && config.lastFrame)
    const resolvedSingleReferenceImage = hasFrames ? null : await resolveGeminiImageInput(config.imageUrl)
    const referenceImages = hasFrames ? [] : await resolveGeminiReferenceImages(config.referenceImages)
    const hasReferenceImages = referenceImages.length > 0
    const fallbackSingleReferenceImage = resolvedSingleReferenceImage || referenceImages[0] || null
    const hasSingleImage = !hasReferenceImages && !!resolvedSingleReferenceImage

    // Gemini 当前 Veo 3.1 系列稳定支持 4-8 秒
    // 首尾帧插值模式固定 8 秒；使用 referenceImages 时官方要求也为 8 秒
    let effectiveDurationSeconds = hasFrames || hasReferenceImages
      ? 8
      : clampGeminiDuration(config.duration)

    // 优先尊重前端传入的 gemini 模型ID，否则根据快/高质量选择默认模型
    const selectedModel = resolveGeminiModelId(config)
    const selectedVideoModel = findVideoModel(selectedModel)
    const modelSupportsReferenceImages = !!selectedVideoModel?.supportReferenceImages
    const initialModel = hasReferenceImages && !modelSupportsReferenceImages
      ? VideoModels.VEO_3_1
      : selectedModel

    if (hasReferenceImages && initialModel !== selectedModel) {
      console.warn(`[VideoGen] 模型 ${selectedModel} 不支持 referenceImages，预切换到 ${initialModel}`)
    }

    console.log('[VideoGen] Veo API 请求参数:', {
      requestedModel: selectedModel,
      model: initialModel,
      promptLength: config.prompt.length,
      prompt: config.prompt,
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      hasImageUrl: !!config.imageUrl,
      hasReferenceImages,
      referenceImagesCount: referenceImages.length,
      hasSingleImage,
      hasFallbackSingleImage: !!fallbackSingleReferenceImage,
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      effectiveDurationSeconds,
      resolution: config.resolution,
      withAudio: config.withAudio
    })

    // 使用视频并发限制器控制请求
    const startResult = await videoLimiter.execute(() => _geminiWithRetry(async ({ client, keyAlias }) => {
      console.log(`[VideoGen] 本次视频请求使用 key: ${keyAlias}`)
      const submitNonInterpolation = async (options: {
        durationSeconds: number
        modelId?: string
        withReferenceImages?: boolean
        singleImage?: { imageBytes: string, mimeType: string } | null
      }) => {
        const modelId = options.modelId || initialModel
        const withReferenceImages = options.withReferenceImages ?? hasReferenceImages
        const singleImage = options.singleImage ?? (withReferenceImages ? null : resolvedSingleReferenceImage)
        const requestConfig: Record<string, unknown> = {
          aspectRatio: config.aspectRatio,
          durationSeconds: options.durationSeconds,
          resolution: config.resolution
        }

        if (withReferenceImages) {
          requestConfig.referenceImages = referenceImages.map((item) => {
            return {
              image: {
                imageBytes: item.imageBytes,
                mimeType: item.mimeType
              },
              referenceType: 'ASSET'
            }
          })
        }

        const request = {
          model: modelId,
          prompt: config.prompt,
          config: requestConfig
        } as Parameters<typeof client.models.generateVideos>[0]

        if (singleImage) {
          Object.assign(request, {
            image: {
              imageBytes: singleImage.imageBytes,
              mimeType: singleImage.mimeType
            }
          })
        }

        return client.models.generateVideos(request)
      }

      if (hasFrames) {
        // 使用首尾帧插值模式
        // 注意：使用插值时 durationSeconds 必须为 8 秒
        // 参考文档：https://ai.google.dev/gemini-api/docs/video#using-first-and-last-video-frames
        const operation = await client.models.generateVideos({
          model: initialModel,
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
        effectiveDurationSeconds = 8
        return { operation, client }
      }

      // 单图参考或纯文本模式
      try {
        const operation = await submitNonInterpolation({
          durationSeconds: effectiveDurationSeconds
        })
        return { operation, client }
      } catch (error) {
        // referenceImages 不可用时：先重试 veo-3.1，再自动降级为单图输入
        if (hasReferenceImages && isGeminiUnsupportedVideoRequestError(error)) {
          let fallbackError: unknown = error

          if (initialModel !== VideoModels.VEO_3_1) {
            try {
              console.warn('[VideoGen] 当前模型不支持 referenceImages，自动回退 veo-3.1 重试')
              const operation = await submitNonInterpolation({
                durationSeconds: 8,
                modelId: VideoModels.VEO_3_1,
                withReferenceImages: true,
                singleImage: null
              })
              effectiveDurationSeconds = 8
              return { operation, client }
            } catch (retryError) {
              fallbackError = retryError
            }
          }

          if (fallbackSingleReferenceImage) {
            const singleImageDuration = clampGeminiDuration(config.duration)
            try {
              console.warn('[VideoGen] referenceImages 不可用，自动降级为单图模式重试')
              const operation = await submitNonInterpolation({
                durationSeconds: singleImageDuration,
                modelId: VideoModels.VEO_3_1,
                withReferenceImages: false,
                singleImage: fallbackSingleReferenceImage
              })
              effectiveDurationSeconds = singleImageDuration
              return { operation, client }
            } catch (singleImageError) {
              fallbackError = singleImageError
            }
          }

          throw fallbackError
        }

        // 遇到 duration 边界错误时自动回退到 8 秒重试一次
        if (isGeminiDurationBoundError(error) && effectiveDurationSeconds !== 8) {
          console.warn(`[VideoGen] durationSeconds=${effectiveDurationSeconds} 被模型拒绝，自动回退到 8 秒重试`)
          const fallbackDuration = 8
          const operation = await submitNonInterpolation({
            durationSeconds: fallbackDuration
          })
          effectiveDurationSeconds = fallbackDuration
          return { operation, client }
        }
        throw error
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

    let parsedResponse = parseGeminiOperationResponse(operation)

    // done=true 但 response 仍为空时，短轮询两次避免短暂竞态
    if (
      parsedResponse.generatedVideos.length === 0
      && parsedResponse.raiMediaFilteredCount === 0
      && !extractGeminiErrorMessage(operation.error)
    ) {
      for (let retry = 0; retry < 2; retry++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        operation = await operationClient.operations.getVideosOperation({
          operation
        })
        parsedResponse = parseGeminiOperationResponse(operation)
        if (
          parsedResponse.generatedVideos.length > 0
          || parsedResponse.raiMediaFilteredCount > 0
          || extractGeminiErrorMessage(operation.error)
        ) {
          break
        }
      }
    }

    const generatedVideos = parsedResponse.generatedVideos
    if (!generatedVideos || generatedVideos.length === 0) {
      if (parsedResponse.raiMediaFilteredCount > 0) {
        const reasonSuffix = parsedResponse.raiMediaFilteredReasons.length > 0
          ? `（${parsedResponse.raiMediaFilteredReasons.join(' / ')}）`
          : ''
        throw new GeminiError(
          `视频被安全策略过滤，未返回可用结果${reasonSuffix}。请降低敏感描述后重试。`,
          GeminiErrorCode.INTERNAL,
          500,
          false
        )
      }

      const operationErrorMessage = extractGeminiErrorMessage(operation.error)
      if (operationErrorMessage) {
        throw new GeminiError(
          operationErrorMessage,
          GeminiErrorCode.INTERNAL,
          500,
          false
        )
      }

      console.warn('[VideoGen] Veo 返回空结果:', {
        operationName: operation.name,
        done: operation.done,
        hasError: !!operation.error,
        raiMediaFilteredCount: parsedResponse.raiMediaFilteredCount,
        raiMediaFilteredReasons: parsedResponse.raiMediaFilteredReasons
      })

      throw new GeminiError(
        'Veo 返回空结果（无视频、无错误）。可能触发平台过滤或临时异常，请稍后重试。',
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
      // 回退处理：优先使用返回的 URI / videoBytes / 引用标识
      const videoInfo = generatedVideo.video as {
        name?: string
        uri?: string
        videoBytes?: string
        mimeType?: string
      }

      try {
        const videosDir = path.join(process.cwd(), 'public', 'videos')
        if (!fs.existsSync(videosDir)) {
          fs.mkdirSync(videosDir, { recursive: true })
        }
        const videoFileName = `${taskId}.mp4`
        const videoFilePath = path.join(videosDir, videoFileName)
        const videoUrl = `/api/video/file/${videoFileName}`

        if (videoInfo?.videoBytes) {
          fs.writeFileSync(videoFilePath, Buffer.from(videoInfo.videoBytes, 'base64'))
          videoData = `url:${videoUrl}`
        } else if (videoInfo?.uri?.startsWith('http://') || videoInfo?.uri?.startsWith('https://')) {
          const response = await fetch(videoInfo.uri)
          if (response.ok) {
            const buffer = await response.arrayBuffer()
            fs.writeFileSync(videoFilePath, Buffer.from(buffer))
            videoData = `url:${videoUrl}`
          } else {
            videoData = `url:${videoInfo.uri}`
          }
        } else if (videoInfo?.uri) {
          videoData = `url:${videoInfo.uri}`
        } else if (videoInfo?.name) {
          videoData = `ref:${videoInfo.name}`
        } else {
          videoData = ''
        }
      } catch (fallbackError) {
        console.error('[VideoGen] 视频回退处理失败:', fallbackError)
        videoData = videoInfo?.name ? `ref:${videoInfo.name}` : ''
      }
    }

    // 5. 构建结果
    const result: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: {
        duration: effectiveDurationSeconds,
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
    if (!modelConfig || modelConfig.provider !== 'volcengine' || !modelId) {
      modelId = volcengine.VolcengineVideoModels.SEEDANCE_2_0_FAST
    }
    const resolvedModelId = modelId

    // 转换时长
    // Seedance 2.0/2.0 fast: 4-15 秒；历史模型: 2-12 秒
    const isSeedance2 = resolvedModelId.includes('seedance-2-0')
    const isSeedanceModel = resolvedModelId.includes('seedance')
    const minDuration = isSeedance2 ? 4 : 2
    const maxDuration = isSeedance2 ? 15 : 12
    let duration = config.duration
    if (duration < minDuration) duration = minDuration
    else if (duration > maxDuration) duration = maxDuration

    console.log('[VideoGen] Volcengine API 请求参数:', {
      model: resolvedModelId,
      promptLength: config.prompt.length,
      hasImageUrl: !!config.imageUrl,
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      duration
    })

    await updateTaskProgress(taskId, 20)

    const imageUrl = config.imageUrl
    const firstFrameUrl = config.firstFrame
    const lastFrameUrl = config.lastFrame
    const effectivePrompt = isSeedanceModel
      ? withVolcengineRealismPrompt(config.prompt)
      : config.prompt

    console.log('[VideoGen] Seedance 输入策略:', {
      isSeedanceModel,
      promptPatched: effectivePrompt !== config.prompt,
      autoLineartPreprocess: false,
      hasImageUrl: !!imageUrl,
      hasFirstFrame: !!firstFrameUrl,
      hasLastFrame: !!lastFrameUrl
    })

    const result = await volcengine._volcengineGenerateVideo({
      model: resolvedModelId,
      prompt: effectivePrompt,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
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

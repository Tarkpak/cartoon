import { eq } from 'drizzle-orm'
import { VideoModels, GeminiError, GeminiErrorCode, _geminiWithRetry } from '../../utils/gemini'
import * as qwen from '../../utils/qwen'
import * as kling from '../../utils/kling'
import * as volcengine from '../../utils/volcengine'
import { getSelectedModels, findVideoModel } from '../../utils/model-provider'
import { getWorkflowModels, getWorkflowModelOptions } from '../models/workflow.get'
import { videoLimiter } from '../../utils/concurrency'
import { db, videoTasks as videoTasksTable } from '../../db'
import {
  GenerateVideoRequestSchema,
  type GeneratedVideo
} from '../../../shared/types/video'
import { getGeneratedImageCandidatePaths } from '../../utils/image-storage'
import {
  persistGeneratedVideoBuffer,
  persistGeneratedVideoFromRemoteUrl,
  syncSceneVideoResult
} from '../../utils/video-task-storage'
import {
  enrichVideoConfigWithCharacterVoiceReference,
  extractCharacterVoiceAssetsFromSceneVideo
} from '../../utils/character-voice-assets'
import {
  parseVideoTaskMetadata,
  patchUpstreamVideoTaskMetadata,
  setUpstreamVideoTaskMetadata,
  type UpstreamVideoTaskTracking
} from '../../utils/video-task-upstream'
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

  const { sceneId, config: rawConfig } = parseResult.data
  const requestOrigin = extractRequestOrigin(event)
  let config: typeof GenerateVideoRequestSchema._type['config']
  try {
    config = await normalizeVideoConfigImageInputs(rawConfig, requestOrigin)
  } catch (normalizeError) {
    console.error('[VideoGen] 图片输入归一化失败:', normalizeError)
    throw createError({
      statusCode: 400,
      statusMessage: '图片输入无效',
      message: normalizeError instanceof Error ? normalizeError.message : '参考图格式错误或不可访问'
    })
  }

  const actualModelId = await getActualModelId(config)
  const actualVideoModel = actualModelId
    ? findVideoModel(actualModelId)
    : undefined
  const modelProvider = actualVideoModel?.provider || await determineProvider(config)
  config = await enrichVideoConfigWithCharacterVoiceReference({
    sceneId,
    config,
    modelProvider,
    supportsExplicitAudioReference: actualVideoModel?.supportAudioReference === true
  })

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

    const deferred = await preserveDeferredVideoTask(taskId, error)
    if (deferred) {
      console.warn(`[VideoGen] 任务 ${taskId} 超时，但上游任务仍在继续，保留为 processing`)
      return
    }

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

function ensureVideoTempDir(): string {
  const tempDir = path.join(process.cwd(), 'data', 'tmp', 'videos')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  return tempDir
}

function createVideoTempFilePath(taskId: string): string {
  const tempDir = ensureVideoTempDir()
  const randomSuffix = Math.random().toString(36).slice(2, 10)
  return path.join(tempDir, `${taskId}_${Date.now()}_${randomSuffix}.mp4`)
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    console.warn('[VideoGen] 清理临时文件失败:', filePath, error)
  }
}

function isVideoGenerationTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /视频生成超时|timeout|deadline exceeded/i.test(message)
}

async function updateUpstreamTaskTracking(
  taskId: string,
  upstreamTask: UpstreamVideoTaskTracking
): Promise<void> {
  const tasks = await db.select({
    metadata: videoTasksTable.metadata,
    progress: videoTasksTable.progress
  })
    .from(videoTasksTable)
    .where(eq(videoTasksTable.id, taskId))
    .limit(1)

  const currentMetadata = tasks[0]?.metadata
  const nextMetadata = setUpstreamVideoTaskMetadata(currentMetadata, upstreamTask)

  await db.update(videoTasksTable)
    .set({
      metadata: nextMetadata,
      updatedAt: new Date().toISOString()
    })
    .where(eq(videoTasksTable.id, taskId))
}

async function preserveDeferredVideoTask(taskId: string, error: unknown): Promise<boolean> {
  if (!isVideoGenerationTimeoutError(error)) {
    return false
  }

  const tasks = await db.select({
    metadata: videoTasksTable.metadata,
    progress: videoTasksTable.progress
  })
    .from(videoTasksTable)
    .where(eq(videoTasksTable.id, taskId))
    .limit(1)

  const task = tasks[0]
  const upstreamTask = parseVideoTaskMetadata(task?.metadata).upstreamTask
  if (!task || !upstreamTask) {
    return false
  }

  const nextMetadata = patchUpstreamVideoTaskMetadata(task.metadata, {
    timedOutAt: new Date().toISOString()
  })

  await db.update(videoTasksTable)
    .set({
      status: 'processing',
      progress: Math.max(task.progress || 0, 90),
      error: null,
      metadata: nextMetadata,
      updatedAt: new Date().toISOString()
    })
    .where(eq(videoTasksTable.id, taskId))

  return true
}

function isLikelyBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function normalizeLegacyImagePath(raw: string): string {
  if (raw.startsWith('/generated-images/')) {
    const filename = raw.slice('/generated-images/'.length)
    return filename ? `/api/image/file/${encodeURIComponent(filename)}` : raw
  }
  return raw
}

function detectImageMimeType(base64Payload: string): string {
  const head = base64Payload.trim()
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBOR')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'
  if (head.startsWith('Qk')) return 'image/bmp'
  if (head.startsWith('SUkq') || head.startsWith('TU0A')) return 'image/tiff'
  return 'image/png'
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return 'image/png'
  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
  ) return 'image/gif'
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  if (buffer.length >= 4 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) return 'image/tiff'
  if (buffer.length >= 4 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) return 'image/tiff'
  return 'image/png'
}

function toDataUriFromPayload(payload: string, mimeType?: string): string {
  const compact = payload.replace(/\s+/g, '')
  if (!compact) {
    throw new Error('图片 base64 内容为空')
  }
  const resolvedMimeType = (mimeType || detectImageMimeType(compact)).split(';')[0]?.trim() || 'image/png'
  return `data:${resolvedMimeType};base64,${compact}`
}

function toDataUriFromBuffer(buffer: Buffer, mimeType?: string): string {
  if (!buffer.length) {
    throw new Error('图片内容为空')
  }
  const resolvedMimeType = (mimeType || detectImageMimeTypeFromBuffer(buffer)).split(';')[0]?.trim() || 'image/png'
  return `data:${resolvedMimeType};base64,${buffer.toString('base64')}`
}

function normalizeOriginValue(value?: string | null): string | undefined {
  const trimmed = (value || '').trim()
  if (!trimmed) return undefined
  const normalized = trimmed.replace(/\/+$/, '')
  if (/^https?:\/\//i.test(normalized)) return normalized
  return undefined
}

function extractRequestOrigin(event: Parameters<typeof getHeader>[0]): string | undefined {
  const xfProto = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  const xfHost = getHeader(event, 'x-forwarded-host')?.split(',')[0]?.trim()
  const host = getHeader(event, 'host')?.trim()
  const candidateHost = xfHost || host
  if (!candidateHost) return undefined
  const protocol = xfProto || 'https'
  return normalizeOriginValue(`${protocol}://${candidateHost}`)
}

function resolveGeneratedImageFilename(imagePath: string): string | null {
  if (!imagePath) return null
  const cleanPath = imagePath.split('?')[0]?.split('#')[0] || ''
  if (!cleanPath) return null

  if (cleanPath.startsWith('/api/image/file/')) {
    const encoded = cleanPath.slice('/api/image/file/'.length)
    if (!encoded) return null
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  if (cleanPath.startsWith('/generated-images/')) {
    const encoded = cleanPath.slice('/generated-images/'.length)
    if (!encoded) return null
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  return null
}

function resolveGeneratedImageDataUri(imagePath: string): string | null {
  const filename = resolveGeneratedImageFilename(imagePath)
  if (!filename) return null
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null

  const filePath = getGeneratedImageCandidatePaths(filename)
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
  if (!filePath) return null

  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.gif'
      ? 'image/gif'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.bmp'
          ? 'image/bmp'
          : ext === '.tiff' || ext === '.tif'
            ? 'image/tiff'
            : detectImageMimeTypeFromBuffer(buffer)

  return toDataUriFromBuffer(buffer, mimeType)
}

async function fetchImageAsDataUri(targetUrl: string): Promise<string> {
  const response = await fetch(targetUrl)
  if (!response.ok) {
    throw new Error(`参考图下载失败: ${response.status} (${targetUrl})`)
  }
  const mimeTypeHeader = response.headers.get('content-type')?.split(';')[0]?.trim()
  const buffer = Buffer.from(await response.arrayBuffer())
  return toDataUriFromBuffer(buffer, mimeTypeHeader && mimeTypeHeader.startsWith('image/') ? mimeTypeHeader : undefined)
}

async function resolveImageInputToDataUri(rawValue: string | undefined, requestOrigin?: string): Promise<string | undefined> {
  const raw = rawValue?.trim()
  if (!raw) return undefined

  const normalized = normalizeLegacyImagePath(raw)

  const dataUriMatch = normalized.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    return toDataUriFromPayload(dataUriMatch[2], dataUriMatch[1])
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return fetchImageAsDataUri(normalized)
  }

  if (normalized.startsWith('/') && !isLikelyBase64Image(normalized)) {
    const localDataUri = resolveGeneratedImageDataUri(normalized)
    if (localDataUri) return localDataUri

    const origin = normalizeOriginValue(requestOrigin)
    if (origin) {
      return fetchImageAsDataUri(`${origin}${normalized}`)
    }

    throw new Error(`无法读取站内图片路径: ${normalized}`)
  }

  if (normalized.startsWith('asset://') || normalized.startsWith('ref:')) {
    throw new Error(`不支持的图片引用格式: ${normalized.slice(0, 32)}`)
  }

  return toDataUriFromPayload(normalized)
}

async function normalizeVideoConfigImageInputs(
  config: typeof GenerateVideoRequestSchema._type['config'],
  requestOrigin?: string
): Promise<typeof GenerateVideoRequestSchema._type['config']> {
  const cache = new Map<string, string>()
  const normalizeOne = async (input?: string): Promise<string | undefined> => {
    const key = input?.trim()
    if (!key) return undefined
    if (cache.has(key)) return cache.get(key)
    const resolved = await resolveImageInputToDataUri(key, requestOrigin)
    if (resolved) cache.set(key, resolved)
    return resolved
  }

  const referenceImagesRaw = Array.isArray(config.referenceImages) ? config.referenceImages : []
  const normalizedReferences = await Promise.all(referenceImagesRaw.map(item => normalizeOne(item)))
  const dedupe = new Set<string>()
  const referenceImages = normalizedReferences
    .filter((item): item is string => !!item)
    .filter((item) => {
      if (dedupe.has(item)) return false
      dedupe.add(item)
      return true
    })

  return {
    ...config,
    imageUrl: await normalizeOne(config.imageUrl),
    firstFrame: await normalizeOne(config.firstFrame),
    lastFrame: await normalizeOne(config.lastFrame),
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined
  }
}

function normalizeVideoTaskError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误')
  const message = rawMessage.trim()

  if (!message) return '视频生成失败'

  if (/input image may contain real person/i.test(message)) {
    return '输入图片触发真人隐私拦截。请更换参考图（避免高风险真实人脸）或调整提示词后重试。'
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
  referenceImages?: string[],
  maxImages: number = 3
): Promise<Array<{ imageBytes: string, mimeType: string }>> {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return []
  }

  const limit = Math.max(1, Math.min(9, Math.round(maxImages || 3)))
  const normalized: Array<{ imageBytes: string, mimeType: string }> = []
  const seen = new Set<string>()

  for (const raw of referenceImages) {
    const parsed = await resolveGeminiImageInput(raw)
    if (!parsed) continue

    const dedupeKey = `${parsed.mimeType}:${parsed.imageBytes}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    normalized.push(parsed)
    if (normalized.length >= limit) break
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

function triggerCharacterVoiceAssetExtraction(options: {
  taskId: string
  sceneId: string
  remoteVideoUrl?: string
  persistedVideoData?: string
}) {
  void extractCharacterVoiceAssetsFromSceneVideo(options).catch((error) => {
    console.warn('[VideoGen] 角色声音资产提取失败:', {
      sceneId: options.sceneId,
      taskId: options.taskId,
      error: error instanceof Error ? error.message : String(error)
    })
  })
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

  // 3. 优先使用业务模型配置的模型 (从数据库读取)
  const workflowModels = await getWorkflowModels()
  const workflowVideoModel = workflowModels.video_generation
  if (workflowVideoModel) {
    const workflowModelConfig = findVideoModel(workflowVideoModel)
    if (workflowModelConfig && (workflowModelConfig.provider === 'gemini' || workflowModelConfig.provider === 'qwen' || workflowModelConfig.provider === 'kling' || workflowModelConfig.provider === 'volcengine')) {
      console.log(`[VideoGen] 使用业务模型配置的模型: ${workflowVideoModel} (${workflowModelConfig.provider})`)
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

  // 2. 优先使用业务模型配置的模型 (从数据库读取)
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
    const workflowOptions = await getWorkflowModelOptions()

    // 确定模型 - 优先使用业务模型配置 (从数据库读取)
    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null

    const hasImageInputs = !!(config.imageUrl || config.firstFrame || config.lastFrame)
    const hasReferenceInputs = Array.isArray(config.referenceImages) && config.referenceImages.length > 0

    // 如果模型不是 qwen 的，使用默认 qwen 模型（优先最新 wan2.7 系列）
    if (!modelConfig || modelConfig.provider !== 'qwen') {
      if (hasReferenceInputs) {
        modelId = qwen.QwenVideoModels.WAN_2_7_R2V
      } else if (hasImageInputs) {
        modelId = qwen.QwenVideoModels.WAN_2_7_I2V
      } else {
        modelId = qwen.QwenVideoModels.WAN_2_7_T2V
      }
    }

    const requestedDuration = typeof config.duration === 'number' && Number.isFinite(config.duration)
      ? config.duration
      : 8

    // Qwen 首尾帧模型当前通常仅支持固定短时长（约 5s）。
    // 当请求时长超过 5s 时，自动切换到长时长文生模型，优先保证叙事完整。
    if (modelId?.includes('kf2v') && requestedDuration > 5) {
      const fallbackModel = hasReferenceInputs
        ? qwen.QwenVideoModels.WAN_2_7_R2V
        : hasImageInputs
          ? qwen.QwenVideoModels.WAN_2_7_I2V
          : qwen.QwenVideoModels.WAN_2_7_T2V
      console.warn(`[VideoGen] Qwen 模型 ${modelId} 无法满足 ${requestedDuration}s，自动切换到 ${fallbackModel}`)
      modelId = fallbackModel
    }

    // Qwen 首尾帧模型不支持自定义音频参考；当配置中已注入 audioUrl 时，
    // 自动切换到 wan2.7 模型，确保音频参考能真正生效。
    if (modelId?.includes('kf2v') && config.audioUrl) {
      const fallbackModel = hasReferenceInputs
        ? qwen.QwenVideoModels.WAN_2_7_R2V
        : hasImageInputs
          ? qwen.QwenVideoModels.WAN_2_7_I2V
          : qwen.QwenVideoModels.WAN_2_7_T2V
      console.warn(`[VideoGen] Qwen 模型 ${modelId} 不支持 audioUrl，自动切换到 ${fallbackModel}`)
      modelId = fallbackModel
    }
    const withAudio = typeof config.withAudio === 'boolean'
      ? config.withAudio
      : workflowOptions.video_generation.audioDefaults.qwen

    // 兼容旧版 Qwen 模型：转换分辨率为 size 格式（wan2.7 主要使用 resolution/ratio）
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

    const isWan27Model = !!modelId && modelId.startsWith('wan2.7-')

    const hasReferenceVideoInput = Array.isArray(config.referenceImages)
      && config.referenceImages.some((url) => {
        const raw = (url || '').trim().toLowerCase()
        return raw.startsWith('data:video/') || /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(raw)
      })

    // 转换时长
    let duration = requestedDuration
    if (isWan27Model) {
      duration = Math.max(2, Math.min(15, Math.round(duration)))
      if (modelId === qwen.QwenVideoModels.WAN_2_7_R2V && hasReferenceVideoInput && duration > 10) {
        console.warn(`[VideoGen] Qwen 模型 ${modelId} 在包含参考视频时最长 10s，自动裁剪到 10s`)
        duration = 10
      }
    } else if (duration <= 5) duration = 5
    else if (duration <= 10) duration = 10
    else duration = 15

    console.log('[VideoGen] Qwen API 请求参数:', {
      model: modelId,
      requestedDuration,
      promptLength: config.prompt.length,
      hasImageUrl: !!config.imageUrl,
      referenceImagesCount: Array.isArray(config.referenceImages) ? config.referenceImages.length : 0,
      hasAudioUrl: !!config.audioUrl,
      size,
      resolution: config.resolution,
      aspectRatio: config.aspectRatio,
      duration,
      withAudio
    })

    await updateTaskProgress(taskId, 20)

    // 调用千问视频生成
    // 检查是否是首尾帧模型（仅该类模型使用首尾帧参数）
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

    const resultMetadata = {
      duration,
      resolution: config.resolution,
      aspectRatio: config.aspectRatio,
      fps: 24,
      hasAudio: withAudio
    } satisfies UpstreamVideoTaskTracking['resultMetadata']

    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt: config.prompt,
      imageUrl: config.imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      referenceImages: config.referenceImages,
      audioUrl: config.audioUrl,
      duration,
      aspectRatio: config.aspectRatio,
      size,
      resolution: config.resolution,
      negativePrompt: config.negativePrompt,
      promptExtend: config.promptExtend ?? true,
      audio: withAudio,
      watermark: config.watermark ?? false,
      seed: config.seed,
      onTaskCreated: async (upstreamTaskId) => {
        await updateUpstreamTaskTracking(taskId, {
          provider: 'qwen',
          taskId: upstreamTaskId,
          modelId: modelId || undefined,
          resultMetadata
        })
      }
    })

    await updateTaskProgress(taskId, 95)

    let videoData = ''
    if (result.videoUrl) {
      videoData = await persistGeneratedVideoFromRemoteUrl({
        taskId,
        videoUrl: result.videoUrl
      })
    }

    // 构建结果
    const generatedVideo: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: resultMetadata,
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
    triggerCharacterVoiceAssetExtraction({
      taskId,
      sceneId,
      remoteVideoUrl: result.videoUrl,
      persistedVideoData: generatedVideo.videoData
    })

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
    const workflowOptions = await getWorkflowModelOptions()

    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null
    if (!modelConfig || modelConfig.provider !== 'kling' || !modelId) {
      modelId = kling.KlingVideoModels.KLING_V2_6
    }

    const duration = Math.min(15, Math.max(3, Math.round(config.duration)))
    const isKlingV3Omni = modelId === kling.KlingVideoModels.KLING_V3_OMNI
    let mode: 'std' | 'pro' = config.model === 'fast' ? 'std' : 'pro'
    let withAudio = typeof config.withAudio === 'boolean'
      ? config.withAudio
      : workflowOptions.video_generation.audioDefaults.kling

    if (isKlingV3Omni) {
      mode = workflowOptions.video_generation.klingV3Omni.mode
      if (typeof config.withAudio !== 'boolean') {
        withAudio = workflowOptions.video_generation.klingV3Omni.sound === 'on'
      }
    }

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
    const referenceImages = Array.from(new Set(
      (Array.isArray(config.referenceImages) ? config.referenceImages : [])
        .map(item => normalizeKlingImageInput(item))
        .filter((item): item is string => !!item)
    ))

    console.log('[VideoGen] Kling API 请求参数:', {
      model: modelId,
      mode,
      duration,
      aspectRatio: config.aspectRatio,
      hasImageUrl: !!imageInput,
      hasFirstFrame: !!firstFrame,
      hasLastFrame: !!lastFrame,
      hasAudioUrl: !!config.audioUrl,
      hasReferenceImages: referenceImages.length > 0,
      referenceImagesCount: referenceImages.length,
      withAudio
    })

    await updateTaskProgress(taskId, 20)

    const resultMetadata = {
      duration,
      resolution: config.resolution,
      aspectRatio: config.aspectRatio,
      fps: 24,
      hasAudio: withAudio
    } satisfies UpstreamVideoTaskTracking['resultMetadata']

    const result = await kling._klingGenerateVideo({
      model: modelId,
      prompt: config.prompt,
      imageUrl: imageInput,
      firstFrameUrl: firstFrame,
      lastFrameUrl: lastFrame,
      referenceImages,
      audioUrl: config.audioUrl,
      duration,
      aspectRatio: config.aspectRatio,
      withAudio,
      mode,
      negativePrompt: config.negativePrompt,
      onTaskCreated: async ({ taskId: upstreamTaskId, endpoint }) => {
        await updateUpstreamTaskTracking(taskId, {
          provider: 'kling',
          taskId: upstreamTaskId,
          endpoint,
          modelId: modelId || undefined,
          resultMetadata
        })
      }
    })

    await updateTaskProgress(taskId, 95)

    let videoData = ''
    if (result.videoUrl) {
      videoData = await persistGeneratedVideoFromRemoteUrl({
        taskId,
        videoUrl: result.videoUrl
      })
    }

    const generatedVideo: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: resultMetadata,
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
    triggerCharacterVoiceAssetExtraction({
      taskId,
      sceneId,
      remoteVideoUrl: result.videoUrl,
      persistedVideoData: generatedVideo.videoData
    })

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
    // 优先尊重前端传入的 gemini 模型ID，否则根据快/高质量选择默认模型
    const selectedModel = resolveGeminiModelId(config)
    const selectedVideoModel = findVideoModel(selectedModel)
    const modelSupportsReferenceImages = !!selectedVideoModel?.supportReferenceImages
    const modelReferenceImageLimit = Math.max(
      1,
      Math.min(
        3,
        Math.round(selectedVideoModel?.maxReferenceImages ?? 3)
      )
    )

    const resolvedSingleReferenceImage = hasFrames ? null : await resolveGeminiImageInput(config.imageUrl)
    const referenceImages = hasFrames
      ? []
      : await resolveGeminiReferenceImages(config.referenceImages, modelReferenceImageLimit)
    const hasReferenceImages = referenceImages.length > 0
    const fallbackSingleReferenceImage = resolvedSingleReferenceImage || referenceImages[0] || null
    const hasSingleImage = !hasReferenceImages && !!resolvedSingleReferenceImage
    const withAudio = typeof config.withAudio === 'boolean' ? config.withAudio : true

    // Gemini 当前 Veo 3.1 系列稳定支持 4-8 秒
    // 首尾帧插值模式固定 8 秒；使用 referenceImages 时官方要求也为 8 秒
    let effectiveDurationSeconds = hasFrames || hasReferenceImages
      ? 8
      : clampGeminiDuration(config.duration)

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
      referenceImageLimit: modelReferenceImageLimit,
      referenceImagesCount: referenceImages.length,
      hasSingleImage,
      hasFallbackSingleImage: !!fallbackSingleReferenceImage,
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      effectiveDurationSeconds,
      resolution: config.resolution,
      withAudio
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
        const firstFrame = await resolveGeminiImageInput(config.firstFrame)
        const lastFrame = await resolveGeminiImageInput(config.lastFrame)
        if (!firstFrame || !lastFrame) {
          throw new Error('首尾帧模式要求可用的首帧与尾帧图片')
        }
        const operation = await client.models.generateVideos({
          model: initialModel,
          prompt: config.prompt,
          image: {
            imageBytes: firstFrame.imageBytes,
            mimeType: firstFrame.mimeType
          },
          config: {
            lastFrame: {
              imageBytes: lastFrame.imageBytes,
              mimeType: lastFrame.mimeType
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

    // 4. 获取视频数据并持久化（优先 TOS，失败回退本地）
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

    let tempVideoPath: string | null = null
    try {
      if (generatedVideo.video) {
        console.log(`[VideoGen] 视频对象:`, JSON.stringify(generatedVideo.video))
        tempVideoPath = createVideoTempFilePath(taskId)
        console.log(`[VideoGen] 下载视频到临时路径: ${tempVideoPath}`)

        await operationClient.files.download({
          file: generatedVideo.video,
          downloadPath: tempVideoPath
        })

        if (fs.existsSync(tempVideoPath)) {
          const stats = fs.statSync(tempVideoPath)
          const buffer = fs.readFileSync(tempVideoPath)
          videoData = await persistGeneratedVideoBuffer({
            taskId,
            buffer
          })
          console.log(`[VideoGen] 视频持久化成功, 大小: ${stats.size} bytes`)
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
        if (videoInfo?.videoBytes) {
          videoData = await persistGeneratedVideoBuffer({
            taskId,
            buffer: Buffer.from(videoInfo.videoBytes, 'base64')
          })
        } else if (videoInfo?.uri?.startsWith('http://') || videoInfo?.uri?.startsWith('https://')) {
          videoData = await persistGeneratedVideoFromRemoteUrl({
            taskId,
            videoUrl: videoInfo.uri
          })
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
    } finally {
      if (tempVideoPath) {
        cleanupTempFile(tempVideoPath)
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
        hasAudio: withAudio
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
    triggerCharacterVoiceAssetExtraction({
      taskId,
      sceneId,
      persistedVideoData: result.videoData
    })

    console.log(`[VideoGen] 视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 生成失败:`, error)
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

    // 确定模型 - 优先使用业务模型配置 (从数据库读取)
    let modelId = await getActualModelId(config)
    const modelConfig = modelId ? findVideoModel(modelId) : null

    // 如果模型不是 volcengine 的，使用默认 volcengine 模型
    if (!modelConfig || modelConfig.provider !== 'volcengine' || !modelId) {
      modelId = volcengine.VolcengineVideoModels.SEEDANCE_2_0_FAST
    }
    const resolvedModelId = modelId
    const workflowOptions = await getWorkflowModelOptions()
    const selectedVideoModel = findVideoModel(resolvedModelId)
    const referenceImageLimit = Math.max(
      1,
      Math.min(
        9,
        Math.round(selectedVideoModel?.maxReferenceImages ?? (selectedVideoModel?.supportReferenceImages ? 9 : 1))
      )
    )
    const configuredSeedanceQuality = workflowOptions.video_generation.seedance.quality
    const configuredSeedanceWithAudio = workflowOptions.video_generation.audioDefaults.seedance
    let resolvedResolution = configuredSeedanceQuality
    const withAudio = typeof config.withAudio === 'boolean'
      ? config.withAudio
      : configuredSeedanceWithAudio
    if (resolvedModelId === volcengine.VolcengineVideoModels.SEEDANCE_2_0_FAST && resolvedResolution === '1080p') {
      console.warn('[VideoGen] Seedance 2.0 Fast 不支持 1080p，已自动回退为 720p')
      resolvedResolution = '720p'
    }

    // 转换时长
    // Seedance 2.0/2.0 fast: 4-15 秒；历史模型: 2-12 秒
    const isSeedance2 = resolvedModelId.includes('seedance-2-0')
    const minDuration = isSeedance2 ? 4 : 2
    const maxDuration = isSeedance2 ? 15 : 12
    let duration = config.duration
    if (duration < minDuration) duration = minDuration
    else if (duration > maxDuration) duration = maxDuration

    const mergedReferenceImages = Array.from(new Set(
      [
        ...(config.imageUrl ? [config.imageUrl] : []),
        ...(Array.isArray(config.referenceImages) ? config.referenceImages : [])
      ]
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    ))
    const canUseReferenceImages = !!selectedVideoModel?.supportReferenceImages && mergedReferenceImages.length > 0
    const referenceImages = canUseReferenceImages
      ? mergedReferenceImages.slice(0, referenceImageLimit)
      : []
    const hasReferenceImages = referenceImages.length > 0

    console.log('[VideoGen] Volcengine API 请求参数:', {
      model: resolvedModelId,
      promptLength: config.prompt.length,
      hasImageUrl: !!config.imageUrl,
      hasFirstFrame: !!config.firstFrame,
      hasLastFrame: !!config.lastFrame,
      hasAudioUrl: !!config.audioUrl,
      hasReferenceImages,
      referenceImagesCount: referenceImages.length,
      referenceImageLimit,
      configuredSeedanceQuality,
      configuredSeedanceWithAudio,
      resolution: resolvedResolution,
      withAudio,
      duration
    })

    await updateTaskProgress(taskId, 20)

    const imageUrl = hasReferenceImages ? undefined : config.imageUrl
    const firstFrameUrl = hasReferenceImages ? undefined : config.firstFrame
    const lastFrameUrl = hasReferenceImages ? undefined : config.lastFrame
    const hasAudioReference = !!config.audioUrl && (hasReferenceImages || !!imageUrl || !!firstFrameUrl || !!lastFrameUrl)

    console.log('[VideoGen] Seedance 输入策略:', {
      inputMode: hasReferenceImages ? 'reference_images' : (firstFrameUrl && lastFrameUrl ? 'first_last_frame' : imageUrl ? 'single_image' : 'text_only'),
      hasImageUrl: !!imageUrl,
      hasFirstFrame: !!firstFrameUrl,
      hasLastFrame: !!lastFrameUrl,
      hasAudioReference,
      hasReferenceImages,
      referenceImagesCount: referenceImages.length,
      withAudio
    })

    const resultMetadata = {
      duration,
      resolution: resolvedResolution,
      aspectRatio: config.aspectRatio,
      fps: 24,
      hasAudio: withAudio
    } satisfies UpstreamVideoTaskTracking['resultMetadata']

    const result = await volcengine._volcengineGenerateVideo({
      model: resolvedModelId,
      prompt: config.prompt,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      audioUrl: config.audioUrl,
      referenceImages: hasReferenceImages ? referenceImages : undefined,
      maxReferenceImages: referenceImageLimit,
      duration,
      aspectRatio: config.aspectRatio,
      resolution: resolvedResolution,
      withAudio,
      onTaskCreated: async (upstreamTaskId) => {
        await updateUpstreamTaskTracking(taskId, {
          provider: 'volcengine',
          taskId: upstreamTaskId,
          modelId: resolvedModelId,
          resultMetadata
        })
      }
    })

    await updateTaskProgress(taskId, 95)

    let videoData = ''
    if (result.videoUrl) {
      videoData = await persistGeneratedVideoFromRemoteUrl({
        taskId,
        videoUrl: result.videoUrl
      })
    }

    // 构建结果
    const generatedVideo: GeneratedVideo = {
      id: `generated_${taskId}`,
      sceneId,
      videoData,
      metadata: resultMetadata,
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
    triggerCharacterVoiceAssetExtraction({
      taskId,
      sceneId,
      remoteVideoUrl: result.videoUrl,
      persistedVideoData: generatedVideo.videoData
    })

    console.log(`[VideoGen] 火山引擎视频生成完成: ${taskId}`)
  } catch (error) {
    console.error(`[VideoGen] 火山引擎生成失败:`, error)
    throw error
  }
}

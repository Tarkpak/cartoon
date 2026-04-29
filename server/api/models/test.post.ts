/**
 * 测试模型 API
 * POST /api/models/test
 *
 * 用于测试各类模型是否正常工作
 */

import { z } from 'zod'
import {
  generateText,
  generateImage,
  generateVideo,
  textToSpeech,
  initializeSelectedModels,
  getSelectedModels,
  findTextModel,
  findImageModel,
  findVideoModel,
  findVoiceModel,
  normalizeModelId
} from '../../utils/model-provider'
import { persistImageToPublic } from '../../utils/image-storage'
import { persistAudioSourceToCloud } from '../../utils/audio-storage'

const TestRequestSchema = z.object({
  modelType: z.enum(['text', 'image', 'video', 'tts']).default('text'),
  modelId: z.string().optional(),
  prompt: z.string().optional(),
  imageAspectRatio: z.string().optional(),
  referenceImages: z.array(z.string()).optional() // base64 图片数组
})

const DEFAULT_IMAGE_ASPECT_RATIO = '1:1'

const GENERIC_IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1024*1024',
  '16:9': '1280*720',
  '9:16': '720*1280',
  '4:3': '1152*864',
  '3:4': '864*1152',
  '3:2': '1248*832',
  '2:3': '832*1248',
  '21:9': '1344*576'
}

const QWEN_IMAGE_2_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '16:9': '2688*1536',
  '4:3': '2368*1728',
  '1:1': '2048*2048',
  '3:4': '1728*2368',
  '9:16': '1536*2688'
}

const QWEN_IMAGE_PLUS_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '16:9': '1664*928',
  '4:3': '1472*1104',
  '1:1': '1328*1328',
  '3:4': '1104*1472',
  '9:16': '928*1664'
}

const QWEN_WAN_IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1280*1280',
  '2:3': '800*1200',
  '3:2': '1200*800',
  '3:4': '960*1280',
  '4:3': '1280*960',
  '9:16': '720*1280',
  '16:9': '1280*720',
  '21:9': '1344*576'
}

const QWEN_Z_IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1280*1280',
  '2:3': '1024*1536',
  '3:2': '1536*1024',
  '3:4': '1104*1472',
  '4:3': '1472*1104',
  '9:16': '864*1536',
  '16:9': '1536*864',
  '21:9': '1680*720'
}

const VOLCENGINE_IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '2048*2048',
  '4:3': '2304*1728',
  '3:4': '1728*2304',
  '16:9': '2848*1600',
  '9:16': '1600*2848',
  '3:2': '2496*1664',
  '2:3': '1664*2496',
  '21:9': '3136*1344'
}

function normalizeImageAspectRatio(value?: string): string {
  if (!value) return DEFAULT_IMAGE_ASPECT_RATIO

  const normalized = value.replace(/\s+/g, '').toLowerCase()
  if (normalized === 'auto') return 'auto'
  if (!/^\d+:\d+$/.test(normalized)) return DEFAULT_IMAGE_ASPECT_RATIO

  const [widthRaw = '1', heightRaw = '1'] = normalized.split(':')
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DEFAULT_IMAGE_ASPECT_RATIO
  }

  return `${width}:${height}`
}

function resolveImageTestSize(modelId: string, provider: string | undefined, aspectRatio: string): string {
  const normalizedModelId = normalizeModelId(modelId)

  if (provider === 'qwen') {
    if (normalizedModelId === 'qwen-image-2.0-pro' || normalizedModelId === 'qwen-image-2.0') {
      return QWEN_IMAGE_2_SIZE_BY_ASPECT_RATIO[aspectRatio] || QWEN_IMAGE_2_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
    }

    if (normalizedModelId === 'qwen-image-max' || normalizedModelId === 'qwen-image' || normalizedModelId === 'qwen-image-plus') {
      return QWEN_IMAGE_PLUS_SIZE_BY_ASPECT_RATIO[aspectRatio] || QWEN_IMAGE_PLUS_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
    }

    if (normalizedModelId === 'wan2.6-image' || normalizedModelId === 'wan2.6-t2i') {
      return QWEN_WAN_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] || QWEN_WAN_IMAGE_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
    }

    if (normalizedModelId === 'wan2.7-image-pro' || normalizedModelId === 'wan2.7-image') {
      return QWEN_WAN_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] || QWEN_WAN_IMAGE_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
    }

    if (normalizedModelId === 'z-image-turbo') {
      return QWEN_Z_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] || QWEN_Z_IMAGE_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
    }
  }

  if (provider === 'volcengine') {
    return VOLCENGINE_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] || VOLCENGINE_IMAGE_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
  }

  return GENERIC_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] || GENERIC_IMAGE_SIZE_BY_ASPECT_RATIO[DEFAULT_IMAGE_ASPECT_RATIO]!
}

interface VideoStatusResponse {
  success: boolean
  task: {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    progress: number
    error?: string | null
    result?: {
      videoData?: string
    }
  }
}

function extractVideoUrl(videoData?: string): string | undefined {
  if (!videoData) {
    return undefined
  }
  if (videoData.startsWith('url:')) {
    return videoData.slice(4)
  }
  if (videoData.startsWith('http://') || videoData.startsWith('https://') || videoData.startsWith('data:') || videoData.startsWith('/')) {
    return videoData
  }
  return undefined
}

function inferAudioMimeType(audioData?: string): string {
  if (!audioData) {
    return 'audio/mpeg'
  }
  if (audioData.startsWith('UklGR')) {
    return 'audio/wav'
  }
  if (audioData.startsWith('T2dnUw')) {
    return 'audio/ogg'
  }
  return 'audio/mpeg'
}

async function toAudioPreviewUrlWithCloudFallback(audioUrl?: string, audioData?: string): Promise<string | undefined> {
  if (audioUrl) {
    return audioUrl
  }
  if (!audioData) {
    return undefined
  }

  const mimeType = inferAudioMimeType(audioData)
  try {
    return await persistAudioSourceToCloud({
      source: `data:${mimeType};base64,${audioData}`,
      prefix: 'model_test_tts',
      category: 'tts-tests'
    })
  } catch (error) {
    console.warn('[ModelTest] TTS base64 持久化失败，跳过返回 base64 音频:', error)
    return undefined
  }
}

async function waitForVideoTask(
  localFetch: (request: string, opts?: Record<string, unknown>) => Promise<unknown>,
  taskId: string,
  maxWaitMs: number = 60000,
  intervalMs: number = 5000
): Promise<{ status: string, progress: number, videoUrl?: string }> {
  const startTime = Date.now()
  let lastStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending'
  let lastProgress = 0

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))

    const statusResponse = await localFetch(`/api/video/status/${taskId}`) as VideoStatusResponse
    lastStatus = statusResponse.task.status
    lastProgress = statusResponse.task.progress || lastProgress

    if (lastStatus === 'completed') {
      return {
        status: lastStatus,
        progress: lastProgress,
        videoUrl: extractVideoUrl(statusResponse.task.result?.videoData)
      }
    }

    if (lastStatus === 'failed') {
      throw new Error(statusResponse.task.error || '视频生成失败')
    }
  }

  return {
    status: lastStatus,
    progress: lastProgress
  }
}

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const body = await readBody(event)
  const parseResult = TestRequestSchema.safeParse(body || {})

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { modelType, modelId, prompt, imageAspectRatio, referenceImages } = parseResult.data
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const selected = getSelectedModels()
  const startTime = Date.now()

  try {
    let result: unknown
    let usedModelId: string
    let modelInfo: { provider?: string, displayName?: string } | undefined

    switch (modelType) {
      case 'text': {
        usedModelId = modelId || selected.text
        modelInfo = findTextModel(usedModelId)
        const testPrompt = normalizedPrompt
        if (!testPrompt) {
          throw createError({
            statusCode: 400,
            statusMessage: '缺少测试提示词',
            message: '请在请求体中提供 prompt'
          })
        }
        console.log(`[ModelTest] 测试文本模型: ${usedModelId} (${modelInfo?.provider})`)

        result = await generateText({
          modelId: usedModelId,
          prompt: testPrompt,
          temperature: 0.7
        })
        break
      }

      case 'image': {
        usedModelId = modelId || selected.image
        modelInfo = findImageModel(usedModelId)
        const testPrompt = normalizedPrompt
        if (!testPrompt) {
          throw createError({
            statusCode: 400,
            statusMessage: '缺少测试提示词',
            message: '请在请求体中提供 prompt'
          })
        }
        const requestedAspectRatio = normalizeImageAspectRatio(imageAspectRatio)
        const resolvedAspectRatio = requestedAspectRatio === 'auto' && modelInfo?.provider !== 'kling'
          ? DEFAULT_IMAGE_ASPECT_RATIO
          : requestedAspectRatio
        const testSize = resolveImageTestSize(usedModelId, modelInfo?.provider, resolvedAspectRatio)

        console.log(
          `[ModelTest] 测试图片模型: ${usedModelId} (${modelInfo?.provider}), 比例: ${resolvedAspectRatio}, 尺寸: ${testSize}, 参考图数量: ${referenceImages?.length || 0}`
        )

        console.log(`[ModelTest] 开始调用 generateImage...`)
        let imageResult
        try {
          imageResult = await generateImage({
            modelId: usedModelId,
            prompt: testPrompt,
            size: testSize,
            aspectRatio: resolvedAspectRatio,
            referenceImages: referenceImages // 传递参考图
          })
          // 只输出摘要信息，避免 base64 数据占满控制台
          console.log(`[ModelTest] generateImage 返回:`, JSON.stringify({
            hasImageUrl: !!imageResult.imageUrl,
            imageUrlPreview: imageResult.imageUrl?.slice(0, 100),
            hasImageData: !!imageResult.imageData,
            imageDataLength: imageResult.imageData?.length || 0,
            mimeType: imageResult.mimeType,
            text: imageResult.text?.slice(0, 100)
          }))
        } catch (imgError) {
          console.error(`[ModelTest] generateImage 抛出错误:`, imgError)
          throw imgError
        }

        // 返回图片 URL 或 base64 预览
        // Gemini 返回 imageData (base64)，需要转换为 data URL
        // Qwen 返回 imageUrl
        let displayUrl = imageResult.imageUrl
        if (!displayUrl && imageResult.imageData) {
          const mimeType = imageResult.mimeType || 'image/png'
          try {
            displayUrl = await persistImageToPublic({
              source: `data:${mimeType};base64,${imageResult.imageData}`,
              prefix: 'model_test_image'
            })
          } catch (error) {
            console.warn('[ModelTest] 图片 base64 持久化失败，跳过返回 base64 图片:', error)
          }
        }

        result = {
          imageUrl: displayUrl,
          hasImageData: !!imageResult.imageData,
          mimeType: imageResult.mimeType
        }
        break
      }

      case 'video': {
        usedModelId = modelId || selected.video
        modelInfo = findVideoModel(usedModelId)
        const testPrompt = normalizedPrompt
        if (!testPrompt) {
          throw createError({
            statusCode: 400,
            statusMessage: '缺少测试提示词',
            message: '请在请求体中提供 prompt'
          })
        }
        console.log(`[ModelTest] 测试视频模型: ${usedModelId} (${modelInfo?.provider})`)

        if (modelInfo?.provider === 'gemini') {
          const testSceneId = `model_test_${Date.now()}`
          const isFastModel = usedModelId.includes('lite') || usedModelId.includes('fast')
          const localFetch = (event.$fetch as unknown) as (request: string, opts?: Record<string, unknown>) => Promise<unknown>

          const generateResponse = await localFetch('/api/video/generate', {
            method: 'POST',
            body: {
              sceneId: testSceneId,
              config: {
                prompt: testPrompt,
                duration: 5,
                resolution: '720p',
                aspectRatio: '16:9',
                withAudio: false,
                provider: 'gemini',
                modelId: usedModelId,
                model: isFastModel ? 'fast' : 'standard'
              }
            }
          }) as {
            success: boolean
            taskId?: string
            message?: string
            error?: string
          }

          if (!generateResponse.success || !generateResponse.taskId) {
            throw new Error(generateResponse.error || 'Gemini 视频测试任务创建失败')
          }

          const taskResult = await waitForVideoTask(localFetch, generateResponse.taskId)
          result = {
            taskId: generateResponse.taskId,
            status: taskResult.status,
            progress: taskResult.progress,
            videoUrl: taskResult.videoUrl
          }
        } else {
          const videoResult = await generateVideo({
            modelId: usedModelId,
            prompt: testPrompt,
            duration: 5, // 测试用最短时长
            size: '1280*720',
            resolution: '720P',
            aspectRatio: '16:9'
          })

          result = {
            videoUrl: videoResult.videoUrl,
            taskId: videoResult.taskId
          }
        }
        break
      }

      case 'tts': {
        usedModelId = modelId || selected.tts || ''
        modelInfo = findVoiceModel(usedModelId)
        const testText = normalizedPrompt
        if (!testText) {
          throw createError({
            statusCode: 400,
            statusMessage: '缺少测试文本',
            message: '请在请求体中提供 prompt 作为 TTS 测试文本'
          })
        }
        console.log(`[ModelTest] 测试TTS模型: ${usedModelId} (${modelInfo?.provider})`)

        const ttsResult = await textToSpeech({
          modelId: usedModelId,
          text: testText
        })
        const previewAudioUrl = await toAudioPreviewUrlWithCloudFallback(ttsResult.audioUrl, ttsResult.audioData)

        result = {
          hasAudioData: !!ttsResult.audioData,
          audioUrl: previewAudioUrl,
          audioMimeType: inferAudioMimeType(ttsResult.audioData)
        }
        break
      }

      default:
        throw new Error(`不支持的模型类型: ${modelType}`)
    }

    return {
      success: true,
      data: {
        modelType,
        modelId: usedModelId!,
        provider: modelInfo?.provider,
        displayName: modelInfo?.displayName,
        result,
        latencyMs: Date.now() - startTime
      }
    }
  } catch (error) {
    console.error('[ModelTest] 测试失败:', error instanceof Error ? error.message : String(error))
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error) || '测试失败',
      data: {
        modelType,
        latencyMs: Date.now() - startTime
      }
    }
  }
})

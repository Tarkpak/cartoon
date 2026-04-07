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
  getSelectedModels,
  findTextModel,
  findImageModel,
  findVideoModel,
  findVoiceModel
} from '../../utils/model-provider'

const TestRequestSchema = z.object({
  modelType: z.enum(['text', 'image', 'video', 'tts']).default('text'),
  modelId: z.string().optional(),
  prompt: z.string().optional(),
  referenceImages: z.array(z.string()).optional()  // base64 图片数组
})

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
  const body = await readBody(event)
  const parseResult = TestRequestSchema.safeParse(body || {})

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { modelType, modelId, prompt, referenceImages } = parseResult.data
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
        const testPrompt = prompt || '你好，请用一句话介绍你自己。'
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
        const testPrompt = prompt || '一只可爱的橘色小猫，日式动漫风格，白色背景'
        console.log(`[ModelTest] 测试图片模型: ${usedModelId} (${modelInfo?.provider}), 参考图数量: ${referenceImages?.length || 0}`)

        // 根据模型设置合适的测试尺寸
        // wan2.6-image 要求 [768*768, 1280*1280]
        // qwen-image-plus 默认 1328*1328
        // 其他模型使用 512*512 或 1024*1024
        let testSize = '1024*1024'
        if (usedModelId === 'wan2.6-image') {
          testSize = '1024*1024'  // wan2.6-image 最小 768*768
        } else if (usedModelId === 'qwen-image-plus') {
          testSize = '1328*1328'
        }

        console.log(`[ModelTest] 开始调用 generateImage...`)
        let imageResult
        try {
          imageResult = await generateImage({
            modelId: usedModelId,
            prompt: testPrompt,
            size: testSize,
            referenceImages: referenceImages  // 传递参考图
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
          displayUrl = `data:${mimeType};base64,${imageResult.imageData}`
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
        const testPrompt = prompt || '一只小猫在草地上奔跑，阳光明媚'
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
            duration: 5,  // 测试用最短时长
            size: '1280*720'
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
        const testText = prompt || '你好，这是一段测试语音。'
        console.log(`[ModelTest] 测试TTS模型: ${usedModelId} (${modelInfo?.provider})`)

        const ttsResult = await textToSpeech({
          modelId: usedModelId,
          text: testText
        })

        result = {
          hasAudioData: !!ttsResult.audioData,
          audioUrl: ttsResult.audioUrl
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

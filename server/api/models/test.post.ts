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
          console.log(`[ModelTest] generateImage 返回:`, JSON.stringify(imageResult))
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

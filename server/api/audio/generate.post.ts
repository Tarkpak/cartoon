import { z } from 'zod'
import { getGeminiClient, GeminiError, GeminiErrorCode, withRetry, TextModels } from '../../utils/gemini'
import type { Emotion } from '../../../shared/types/script'

/**
 * 音频生成请求 Schema
 */
const GenerateAudioRequestSchema = z.object({
  type: z.enum(['tts', 'bgm']).describe('生成类型: tts=配音, bgm=背景音乐'),
  // TTS 配置
  text: z.string().optional().describe('TTS 文本'),
  characterName: z.string().optional().describe('角色名'),
  emotion: z.string().optional().describe('情绪'),
  language: z.string().default('zh-CN').describe('语言'),
  // BGM 配置
  prompt: z.string().optional().describe('BGM 描述'),
  style: z.enum(['ambient', 'dramatic', 'romantic', 'action', 'mysterious', 'happy', 'sad', 'tense']).optional(),
  duration: z.number().min(1).max(60).optional().default(10).describe('时长(秒)')
})

/**
 * 角色语音配置 - 为不同角色配置不同音色
 */
const characterVoiceMap: Record<string, {
  voiceName: string
  pitch?: number
  speakingRate?: number
}> = {
  default_male: { voiceName: 'Aoede', pitch: 0, speakingRate: 1.0 },
  default_female: { voiceName: 'Kore', pitch: 0, speakingRate: 1.0 },
  protagonist: { voiceName: 'Puck', pitch: -0.5, speakingRate: 1.0 },
  antagonist: { voiceName: 'Charon', pitch: -1, speakingRate: 0.9 }
}

/**
 * 情绪语音调整
 */
const emotionAdjustments: Record<string, { pitch: number, speakingRate: number }> = {
  neutral: { pitch: 0, speakingRate: 1.0 },
  happy: { pitch: 0.5, speakingRate: 1.1 },
  sad: { pitch: -0.5, speakingRate: 0.85 },
  angry: { pitch: 0.3, speakingRate: 1.2 },
  surprised: { pitch: 0.8, speakingRate: 1.15 },
  confused: { pitch: 0.2, speakingRate: 0.95 },
  excited: { pitch: 0.6, speakingRate: 1.25 },
  scared: { pitch: 0.4, speakingRate: 1.1 }
}

/**
 * 音频生成 API
 * POST /api/audio/generate
 *
 * 支持两种类型:
 * 1. TTS - 使用 Gemini TTS 生成对话配音
 * 2. BGM - 背景音乐描述 (返回提示词，实际生成需要 Live API)
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = GenerateAudioRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { type, text, characterName, emotion, language, prompt, style, duration } = parseResult.data

  try {
    if (type === 'tts') {
      // TTS 配音生成
      if (!text) {
        throw createError({
          statusCode: 400,
          statusMessage: 'TTS 需要提供 text 参数'
        })
      }

      const result = await generateTTS({
        text,
        characterName,
        emotion: emotion as Emotion,
        language
      })

      return {
        success: true,
        type: 'tts',
        audio: result,
        latencyMs: Date.now() - startTime
      }
    } else {
      // BGM 生成 - 返回优化后的提示词
      // 注意: 实际 Lyria 音乐生成需要通过 Live API WebSocket
      const bgmPrompt = buildBGMPrompt(prompt || '', style, duration)

      return {
        success: true,
        type: 'bgm',
        prompt: bgmPrompt,
        style,
        duration,
        message: 'BGM 生成需要通过 Live API WebSocket 调用 Lyria',
        latencyMs: Date.now() - startTime
      }
    }
  } catch (error) {
    console.error(`[AudioGen] 生成失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `音频生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 生成 TTS 配音
 */
async function generateTTS(config: {
  text: string
  characterName?: string
  emotion?: Emotion
  language?: string
}): Promise<{
  id: string
  audioData: string
  mimeType: string
  duration: number
  characterName?: string
  text: string
}> {
  const client = getGeminiClient()

  // 获取角色语音配置
  const voiceConfig = config.characterName
    ? (characterVoiceMap[config.characterName.toLowerCase()] || characterVoiceMap.default_male)
    : characterVoiceMap.default_male

  // 获取情绪调整 (预留用于后续音频后处理)
  const _emotionAdj = config.emotion
    ? (emotionAdjustments[config.emotion] || emotionAdjustments.neutral)
    : emotionAdjustments.neutral

  console.log('[AudioGen] TTS 请求参数:', {
    model: TextModels.GENERAL,
    textLength: config.text.length,
    textPreview: config.text.slice(0, 100) + (config.text.length > 100 ? '...' : ''),
    characterName: config.characterName || '默认',
    voiceName: voiceConfig.voiceName,
    emotion: config.emotion || 'neutral',
    language: config.language || 'zh-CN'
  })

  const result = await withRetry(async () => {
    const response = await client.models.generateContent({
      model: TextModels.GENERAL,
      contents: config.text,
      config: {
        responseModalities: ['audio'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceConfig.voiceName
            }
          }
        }
      }
    })

    // 提取音频数据
    const parts = response.candidates?.[0]?.content?.parts || []
    let audioData = ''
    let mimeType = 'audio/mp3'

    for (const part of parts) {
      if (part.inlineData) {
        audioData = part.inlineData.data || ''
        mimeType = part.inlineData.mimeType || 'audio/mp3'
        break
      }
    }

    if (!audioData) {
      throw new GeminiError(
        '未能生成音频',
        GeminiErrorCode.INTERNAL,
        500,
        true
      )
    }

    return { audioData, mimeType }
  }, { maxRetries: 2 })

  // 估算时长 (中文大约每秒4-5个字)
  const estimatedDuration = Math.ceil(config.text.length / 4.5)

  return {
    id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    audioData: result.audioData,
    mimeType: result.mimeType,
    duration: estimatedDuration,
    characterName: config.characterName,
    text: config.text
  }
}

/**
 * 构建 BGM 提示词
 */
function buildBGMPrompt(
  description: string,
  style?: string,
  duration?: number
): string {
  const styleDescriptions: Record<string, string> = {
    ambient: '舒缓的环境音乐，轻柔的背景氛围',
    dramatic: '戏剧性的交响乐，情感张力强烈',
    romantic: '浪漫抒情的旋律，温柔甜蜜',
    action: '紧张刺激的节奏，动感十足',
    mysterious: '神秘悬疑的氛围，引人入胜',
    happy: '欢快明朗的曲调，充满活力',
    sad: '忧伤动人的旋律，令人感触',
    tense: '紧张压迫的氛围，扣人心弦'
  }

  const styleDesc = style ? styleDescriptions[style] || '' : ''

  return `生成一段${duration || 10}秒的背景音乐。

风格: ${styleDesc || '适合场景的背景音乐'}

场景描述: ${description || '动漫场景背景音乐'}

要求:
1. 日式动漫风格配乐
2. 适合作为视频背景音乐
3. 音乐情绪与场景匹配
4. 无人声，纯音乐`
}

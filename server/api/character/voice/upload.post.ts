import { z } from 'zod'
import { persistAudioSourceToCloud } from '../../../utils/audio-storage'

const UploadCharacterVoiceSchema = z.object({
  audioData: z.string().trim().min(1, '音频内容不能为空').max(40 * 1024 * 1024, '音频内容过大'),
  prefix: z.string().trim().max(80).optional()
})

function isSupportedAudioSource(value: string): boolean {
  return value.startsWith('data:audio/')
    || value.startsWith('http://')
    || value.startsWith('https://')
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = UploadCharacterVoiceSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const audioData = parsed.data.audioData.trim()
  if (!isSupportedAudioSource(audioData)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '仅支持音频 dataURL 或音频 URL'
    })
  }

  try {
    const audioUrl = await persistAudioSourceToCloud({
      source: audioData,
      prefix: parsed.data.prefix || 'character_voice_upload'
    })

    return {
      success: true,
      audioUrl
    }
  } catch (error) {
    console.error('[CharacterVoice] 上传角色音频失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '角色音频上传失败'
    })
  }
})

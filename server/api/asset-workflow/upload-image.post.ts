import { z } from 'zod'
import { persistImageToPublic } from '../../utils/image-storage'

const MAX_IMAGE_UPLOAD_SIZE = 50 * 1024 * 1024
const MAX_IMAGE_DATA_LENGTH = 70 * 1024 * 1024

const UploadAssetImageSchema = z.object({
  imageData: z.string().trim().min(1, '图片内容不能为空').max(MAX_IMAGE_DATA_LENGTH, '图片内容过大'),
  prefix: z.string().trim().max(80).optional()
})

function looksLikeBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function isSupportedImageSource(value: string): boolean {
  return value.startsWith('data:image/')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || looksLikeBase64Image(value)
}

/**
 * 上传资产图片到云存储
 * POST /api/asset-workflow/upload-image
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = UploadAssetImageSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const imageData = parsed.data.imageData.trim()
  if (imageData.startsWith('data:image/') || looksLikeBase64Image(imageData)) {
    const estimatedBinarySize = Math.floor(imageData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s+/g, '').length * 3 / 4)
    if (estimatedBinarySize > MAX_IMAGE_UPLOAD_SIZE) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '图片大小不能超过 50MB'
      })
    }
  }

  if (!isSupportedImageSource(imageData)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '仅支持图片 dataURL、base64 或图片 URL'
    })
  }

  try {
    const imageUrl = await persistImageToPublic({
      source: imageData,
      prefix: parsed.data.prefix || 'asset_upload'
    })

    return {
      success: true,
      imageUrl
    }
  } catch (error) {
    console.error('[AssetWorkflow] 上传资产图片失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '图片上传失败'
    })
  }
})

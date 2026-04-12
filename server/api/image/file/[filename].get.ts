import * as fs from 'node:fs'
import * as path from 'node:path'
import { getGeneratedImageCandidatePaths } from '../../../utils/image-storage'

/**
 * 运行时图片文件访问
 * GET /api/image/file/:filename
 *
 * 说明:
 * - 优先读取 data/generated-images（运行期生成）
 * - 兼容读取 public/generated-images 与 .output/public/generated-images（历史数据）
 */
export default defineEventHandler(async (event) => {
  const rawFilename = getRouterParam(event, 'filename')
  const filename = rawFilename ? decodeURIComponent(rawFilename) : ''

  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw createError({
      statusCode: 400,
      message: '无效的图片文件名'
    })
  }

  const candidatePaths = getGeneratedImageCandidatePaths(filename)
  const filePath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).isFile())

  if (!filePath) {
    throw createError({
      statusCode: 404,
      message: '图片文件不存在'
    })
  }

  const ext = path.extname(filePath).toLowerCase()
  const contentType = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.gif'
      ? 'image/gif'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.bmp'
          ? 'image/bmp'
          : ext === '.tiff' || ext === '.tif'
            ? 'image/tiff'
            : 'image/png'

  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')

  return sendStream(event, fs.createReadStream(filePath))
})


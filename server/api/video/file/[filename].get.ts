import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 运行时视频文件访问
 * GET /api/video/file/:filename
 *
 * 说明:
 * - 运行期生成的视频位于 public/videos
 * - 支持 Range 请求，保证 <video> 预览和拖动可用
 */
export default defineEventHandler(async (event) => {
  const rawFilename = getRouterParam(event, 'filename')
  const filename = rawFilename ? decodeURIComponent(rawFilename) : ''

  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw createError({
      statusCode: 400,
      message: '无效的视频文件名'
    })
  }

  const candidatePaths = [
    path.join(process.cwd(), 'public', 'videos', filename),
    path.join(process.cwd(), '.output', 'public', 'videos', filename)
  ]

  const filePath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).isFile())
  if (!filePath) {
    throw createError({
      statusCode: 404,
      message: '视频文件不存在'
    })
  }

  const stat = fs.statSync(filePath)
  const totalSize = stat.size
  const range = getHeader(event, 'range')

  const ext = path.extname(filePath).toLowerCase()
  const contentType = ext === '.webm'
    ? 'video/webm'
    : ext === '.mov'
      ? 'video/quicktime'
      : 'video/mp4'

  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')

  if (!range) {
    setHeader(event, 'Content-Length', totalSize)
    return sendStream(event, fs.createReadStream(filePath))
  }

  const matched = range.match(/bytes=(\d*)-(\d*)/)
  if (!matched) {
    throw createError({
      statusCode: 416,
      message: '无效的 Range 请求'
    })
  }

  const start = matched[1] ? Number(matched[1]) : 0
  const end = matched[2] ? Number(matched[2]) : totalSize - 1

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= totalSize) {
    setHeader(event, 'Content-Range', `bytes */${totalSize}`)
    throw createError({
      statusCode: 416,
      message: 'Range 超出文件范围'
    })
  }

  const chunkSize = end - start + 1
  setResponseStatus(event, 206)
  setHeader(event, 'Content-Range', `bytes ${start}-${end}/${totalSize}`)
  setHeader(event, 'Content-Length', chunkSize)

  return sendStream(event, fs.createReadStream(filePath, { start, end }))
})

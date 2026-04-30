import { eq } from 'drizzle-orm'
import { db, scenes as scenesTable } from '../db'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import {
  buildCloudNewestFirstNamePrefix,
  buildCloudObjectKey,
  uploadBufferToCloudStorageOrThrow
} from './cloud-storage'
import { extractLastFrameFromVideoBuffer } from './ffmpeg'

function createVideoFileName(taskId: string): string {
  return `${buildCloudNewestFirstNamePrefix()}_${taskId}.mp4`
}

function createVideoFrameFileName(taskId: string): string {
  return `${buildCloudNewestFirstNamePrefix()}_${taskId}_last_frame.png`
}

export async function persistGeneratedVideoBuffer(options: {
  taskId: string
  buffer: Buffer
}): Promise<string> {
  const fileName = createVideoFileName(options.taskId)
  const cloudObjectKey = buildCloudObjectKey({
    category: 'videos',
    filename: fileName
  })

  const cloudUrl = await uploadBufferToCloudStorageOrThrow({
    key: cloudObjectKey,
    buffer: options.buffer
  })
  return `url:${cloudUrl}`
}

export async function persistGeneratedVideoFromRemoteUrl(options: {
  taskId: string
  videoUrl: string
}): Promise<string> {
  const result = await persistGeneratedVideoFromRemoteUrlWithBuffer(options)
  return result.videoData
}

export async function persistGeneratedVideoFromRemoteUrlWithBuffer(options: {
  taskId: string
  videoUrl: string
}): Promise<{ videoData: string, buffer?: Buffer }> {
  const remoteUrl = options.videoUrl.trim()
  if (!remoteUrl) return { videoData: '' }

  try {
    const response = await fetch(remoteUrl)
    if (!response.ok) {
      return { videoData: `url:${remoteUrl}` }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const videoData = await persistGeneratedVideoBuffer({
      taskId: options.taskId,
      buffer
    })
    return { videoData, buffer }
  } catch (error) {
    console.error('[VideoGen] 远程视频下载失败，回退原始 URL:', error)
    return { videoData: `url:${remoteUrl}` }
  }
}

async function persistLastFrameFromVideoUrl(sceneId: string, videoUrl: string, videoBuffer?: Buffer): Promise<string | undefined> {
  try {
    const sourceBuffer = videoBuffer || await (async () => {
      const response = await fetch(videoUrl)
      if (!response.ok) return undefined
      return Buffer.from(await response.arrayBuffer())
    })()
    if (!sourceBuffer) return undefined

    const frameBuffer = await extractLastFrameFromVideoBuffer(sourceBuffer)
    const cloudObjectKey = buildCloudObjectKey({
      category: 'images',
      filename: createVideoFrameFileName(sceneId)
    })
    const cloudUrl = await uploadBufferToCloudStorageOrThrow({
      key: cloudObjectKey,
      buffer: frameBuffer
    })
    return cloudUrl
  } catch (error) {
    console.warn(`[VideoGen] 分镜视频末帧提取失败: ${sceneId}`, error)
    return undefined
  }
}

export async function syncSceneVideoResult(sceneId: string, videoData?: string | null, videoBuffer?: Buffer): Promise<{ lastFrame?: string }> {
  if (!sceneId) return {}

  const normalizedVideoUrl = normalizeProjectVideoUrl(videoData)
  if (!normalizedVideoUrl) return {}

  const lastFrame = await persistLastFrameFromVideoUrl(sceneId, normalizedVideoUrl, videoBuffer)

  try {
    await db.update(scenesTable)
      .set({
        videoUrl: normalizedVideoUrl,
        ...(lastFrame ? { lastFrame } : {}),
        status: 'video_ready',
        updatedAt: new Date().toISOString()
      })
      .where(eq(scenesTable.id, sceneId))
  } catch (error) {
    console.warn(`[VideoGen] 分镜视频状态回写失败: ${sceneId}`, error)
  }

  return { lastFrame }
}

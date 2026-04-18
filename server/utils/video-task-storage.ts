import { eq } from 'drizzle-orm'
import { db, scenes as scenesTable } from '../db'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import {
  buildCloudObjectKey,
  uploadBufferToCloudStorageOrThrow
} from './cloud-storage'

function createVideoFileName(taskId: string): string {
  return `${taskId}.mp4`
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
  const remoteUrl = options.videoUrl.trim()
  if (!remoteUrl) return ''

  try {
    const response = await fetch(remoteUrl)
    if (!response.ok) {
      return `url:${remoteUrl}`
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return await persistGeneratedVideoBuffer({
      taskId: options.taskId,
      buffer
    })
  } catch (error) {
    console.error('[VideoGen] 远程视频下载失败，回退原始 URL:', error)
    return `url:${remoteUrl}`
  }
}

export async function syncSceneVideoResult(sceneId: string, videoData?: string | null): Promise<void> {
  if (!sceneId) return

  const normalizedVideoUrl = normalizeProjectVideoUrl(videoData)
  if (!normalizedVideoUrl) return

  try {
    await db.update(scenesTable)
      .set({
        videoUrl: normalizedVideoUrl,
        status: 'video_ready',
        updatedAt: new Date().toISOString()
      })
      .where(eq(scenesTable.id, sceneId))
  } catch (error) {
    console.warn(`[VideoGen] 场景视频状态回写失败: ${sceneId}`, error)
  }
}

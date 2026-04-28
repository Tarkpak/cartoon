import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { db, projects as projectsTable } from '../../db'
import {
  mergeVideos,
  saveBase64ToFile,
  type VideoClip,
  type SubtitleItem
} from '../../utils/ffmpeg'

// 获取项目根目录的 public 文件夹路径
function getPublicDir(): string {
  // 在开发环境中，public 目录在项目根目录
  // process.cwd() 返回 Nuxt 项目根目录
  return join(process.cwd(), 'public')
}

function getPublicVideosDir(): string {
  return join(getPublicDir(), 'videos')
}

async function persistMergedVideo(projectId: string, sourcePath: string): Promise<string> {
  const outputFilename = `${projectId}_final.mp4`
  const outputDir = getPublicVideosDir()
  const outputPath = join(outputDir, outputFilename)

  await fs.mkdir(outputDir, { recursive: true })
  await fs.copyFile(sourcePath, outputPath)

  return `/api/video/file/${encodeURIComponent(outputFilename)}`
}

/**
 * 视频合成请求 Schema
 */
const MergeVideosRequestSchema = z.object({
  projectId: z.string().describe('项目ID'),
  scenes: z.array(z.object({
    id: z.string(),
    title: z.string().optional(),
    videoUrl: z.string().describe('视频URL或base64数据'),
    duration: z.number().describe('视频时长(秒)'),
    dialogues: z.array(z.object({
      character: z.string(),
      text: z.string(),
      startTime: z.number().optional(),
      endTime: z.number().optional()
    })).optional()
  })).min(1).describe('分镜视频列表'),
  options: z.object({
    transition: z.object({
      type: z.enum(['fade', 'dissolve', 'wipe', 'none']).default('fade'),
      duration: z.number().default(0.5)
    }).optional(),
    addSubtitles: z.boolean().default(false),
    bgm: z.object({
      url: z.string(),
      volume: z.number().min(0).max(1).default(0.3)
    }).optional(),
    outputFormat: z.enum(['mp4', 'webm']).default('mp4')
  }).optional()
})

/**
 * 视频合成 API
 * POST /api/video/merge
 *
 * 将多个分镜视频合成为一个完整视频
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = MergeVideosRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { projectId, scenes, options } = parseResult.data

  // 检查项目是否存在
  const project = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).get()
  if (!project) {
    throw createError({
      statusCode: 404,
      statusMessage: '项目不存在'
    })
  }

  // 创建临时目录
  const tempDir = join(tmpdir(), `merge_${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  try {
    console.log(`[VideoMerge] 开始合成 ${scenes.length} 个分镜视频`)

    // 1. 准备视频片段
    const clips: VideoClip[] = []
    let currentTime = 0

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      if (!scene) continue

      let videoPath: string

      // 处理视频数据
      if (scene.videoUrl.startsWith('data:video')) {
        // base64 数据
        const base64Data = scene.videoUrl.split(',')[1]
        if (!base64Data) {
          console.warn(`[VideoMerge] 场景 ${scene.id} 视频数据无效，跳过`)
          continue
        }
        videoPath = await saveBase64ToFile(base64Data, `scene_${i}.mp4`, tempDir)
      } else if (scene.videoUrl.startsWith('http')) {
        // URL - 下载视频
        const response = await fetch(scene.videoUrl)
        if (!response.ok) {
          console.warn(`[VideoMerge] 场景 ${scene.id} 视频下载失败，跳过`)
          continue
        }
        const buffer = await response.arrayBuffer()
        videoPath = join(tempDir, `scene_${i}.mp4`)
        await fs.writeFile(videoPath, Buffer.from(buffer))
      } else if (scene.videoUrl.startsWith('/')) {
        const publicDir = getPublicDir()
        const apiPrefix = '/api/video/file/'
        const staticPrefix = '/videos/'

        // 本地 API 路径: /api/video/file/:filename
        if (scene.videoUrl.startsWith(apiPrefix)) {
          const filename = decodeURIComponent(scene.videoUrl.slice(apiPrefix.length))
          if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            console.warn(`[VideoMerge] 场景 ${scene.id} 文件名非法: ${scene.videoUrl}，跳过`)
            continue
          }
          videoPath = join(publicDir, 'videos', filename)
        } else if (scene.videoUrl.startsWith(staticPrefix)) {
          // 兼容旧格式: /videos/:filename
          const relativePath = scene.videoUrl.replace(/^\/+/, '')
          videoPath = join(publicDir, relativePath)
        } else {
          // 其他以 / 开头的路径，按 public 相对路径处理
          const relativePath = scene.videoUrl.replace(/^\/+/, '')
          videoPath = join(publicDir, relativePath)
        }

        try {
          await fs.access(videoPath)
          console.log(`[VideoMerge] 场景 ${scene.id} 使用本地文件: ${videoPath}`)
        } catch {
          console.warn(`[VideoMerge] 场景 ${scene.id} 本地文件不存在: ${videoPath}，跳过`)
          continue
        }
      } else {
        // 其他本地路径
        videoPath = scene.videoUrl
      }

      clips.push({
        id: scene.id,
        path: videoPath,
        duration: scene.duration
      })

      currentTime += scene.duration
    }

    if (clips.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: '没有有效的视频片段'
      })
    }

    console.log(`[VideoMerge] 准备了 ${clips.length} 个视频片段，总时长 ${currentTime}秒`)

    // 2. 准备字幕（如果需要）
    let subtitles: SubtitleItem[] | undefined
    if (options?.addSubtitles) {
      subtitles = []
      let subtitleTime = 0

      for (const scene of scenes) {
        if (scene.dialogues) {
          for (const dialogue of scene.dialogues) {
            const startTime = dialogue.startTime ?? subtitleTime
            const endTime = dialogue.endTime ?? (startTime + 3)
            subtitles.push({
              text: `${dialogue.character}: ${dialogue.text}`,
              startTime,
              endTime
            })
            subtitleTime = endTime
          }
        }
        subtitleTime += scene.duration
      }
    }

    // 3. 合成视频
    const outputFilename = `${projectId}_final.mp4`
    const outputPath = join(tempDir, outputFilename)

    const result = await mergeVideos({
      clips,
      output: outputPath,
      transition: options?.transition,
      subtitles,
      bgm: options?.bgm
        ? {
            path: options.bgm.url,
            volume: options.bgm.volume
          }
        : undefined
    })

    console.log(`[VideoMerge] 合成完成，输出文件大小: ${(result.size / 1024 / 1024).toFixed(2)}MB`)

    // 4. 持久化最终成片，保证刷新后仍可访问
    const finalVideoUrl = await persistMergedVideo(projectId, outputPath)

    // 5. 清理临时文件
    await fs.rm(tempDir, { recursive: true, force: true })

    return {
      success: true,
      data: {
        videoUrl: finalVideoUrl,
        duration: result.duration,
        size: result.size,
        sceneCount: clips.length
      },
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    // 清理临时文件
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (cleanupError) {
      console.warn('[VideoMerge] 清理临时目录失败:', cleanupError)
    }

    console.error('[VideoMerge] 合成失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '视频合成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

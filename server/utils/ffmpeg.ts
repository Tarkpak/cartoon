import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * FFmpeg 视频合成工具
 * 用于拼接视频片段、添加转场、叠加字幕、混音等
 */

export interface VideoClip {
  id: string
  path: string
  duration: number
}

export interface SubtitleItem {
  text: string
  startTime: number
  endTime: number
  style?: {
    fontSize?: number
    color?: string
    position?: 'top' | 'center' | 'bottom'
  }
}

export interface MergeVideosOptions {
  clips: VideoClip[]
  output: string
  transition?: {
    type: 'fade' | 'dissolve' | 'wipe' | 'none'
    duration: number
  }
  subtitles?: SubtitleItem[]
  bgm?: {
    path: string
    volume: number
  }
}

export interface ConcatResult {
  outputPath: string
  duration: number
  size: number
}

/**
 * 创建临时目录
 */
async function createTempDir(): Promise<string> {
  const tempDir = join(tmpdir(), `ffmpeg_${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

/**
 * 清理临时文件
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    console.warn(`[FFmpeg] 清理临时目录失败: ${dir}`, error)
  }
}

/**
 * 将 base64 视频数据保存为临时文件
 */
export async function saveBase64ToFile(
  base64Data: string,
  filename: string,
  tempDir?: string
): Promise<string> {
  const dir = tempDir || await createTempDir()
  const filePath = join(dir, filename)
  const buffer = Buffer.from(base64Data, 'base64')
  await fs.writeFile(filePath, buffer)
  return filePath
}

/**
 * 读取文件为 base64
 */
export async function readFileAsBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  return buffer.toString('base64')
}

/**
 * 拼接多个视频片段
 */
export async function concatVideos(
  clips: VideoClip[],
  outputPath: string
): Promise<ConcatResult> {
  return new Promise((resolve, reject) => {
    if (clips.length === 0) {
      reject(new Error('没有视频片段'))
      return
    }

    if (clips.length === 1) {
      // 单个视频直接复制
      fs.copyFile(clips[0].path, outputPath)
        .then(async () => {
          const stats = await fs.stat(outputPath)
          resolve({
            outputPath,
            duration: clips[0].duration,
            size: stats.size
          })
        })
        .catch(reject)
      return
    }

    // 多个视频使用 concat demuxer
    const command = ffmpeg()

    // 添加所有输入
    clips.forEach((clip) => {
      command.input(clip.path)
    })

    // 使用 concat filter
    const filterComplex = clips
      .map((_, i) => `[${i}:v][${i}:a]`)
      .join('') + `concat=n=${clips.length}:v=1:a=1[outv][outa]`

    command
      .complexFilter(filterComplex)
      .outputOptions(['-map', '[outv]', '-map', '[outa]'])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`[FFmpeg] 开始拼接: ${cmd}`)
      })
      .on('progress', (progress) => {
        console.log(`[FFmpeg] 拼接进度: ${progress.percent?.toFixed(1)}%`)
      })
      .on('end', async () => {
        const stats = await fs.stat(outputPath)
        const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0)
        resolve({
          outputPath,
          duration: totalDuration,
          size: stats.size
        })
      })
      .on('error', (err) => {
        console.error(`[FFmpeg] 拼接失败:`, err)
        reject(err)
      })
      .run()
  })
}

/**
 * 添加淡入淡出转场
 */
export async function addFadeTransition(
  inputPath: string,
  outputPath: string,
  fadeInDuration: number = 0.5,
  fadeOutDuration: number = 0.5
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters([
        `fade=t=in:st=0:d=${fadeInDuration}`,
        `fade=t=out:st=end:d=${fadeOutDuration}`
      ])
      .audioFilters([
        `afade=t=in:st=0:d=${fadeInDuration}`,
        `afade=t=out:st=end:d=${fadeOutDuration}`
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * 叠加字幕
 */
export async function addSubtitles(
  inputPath: string,
  outputPath: string,
  subtitles: SubtitleItem[]
): Promise<string> {
  // 生成 ASS 字幕文件
  const tempDir = await createTempDir()
  const assPath = join(tempDir, 'subtitles.ass')

  const assContent = generateASSContent(subtitles)
  await fs.writeFile(assPath, assContent, 'utf-8')

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([`-vf`, `ass=${assPath}`])
      .output(outputPath)
      .on('end', async () => {
        await cleanupTempDir(tempDir)
        resolve(outputPath)
      })
      .on('error', async (err) => {
        await cleanupTempDir(tempDir)
        reject(err)
      })
      .run()
  })
}

/**
 * 生成 ASS 字幕内容
 */
function generateASSContent(subtitles: SubtitleItem[]): string {
  const header = `[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const events = subtitles.map((sub) => {
    const start = formatASSTime(sub.startTime)
    const end = formatASSTime(sub.endTime)
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${sub.text}`
  }).join('\n')

  return header + events
}

/**
 * 格式化 ASS 时间
 */
function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

/**
 * 混合背景音乐
 */
export async function mixAudio(
  videoPath: string,
  bgmPath: string,
  outputPath: string,
  bgmVolume: number = 0.3
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(bgmPath)
      .complexFilter([
        `[0:a]volume=1[a0]`,
        `[1:a]volume=${bgmVolume}[a1]`,
        `[a0][a1]amix=inputs=2:duration=first[aout]`
      ])
      .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * 完整的视频合成流程
 */
export async function mergeVideos(options: MergeVideosOptions): Promise<ConcatResult> {
  const { clips, output, transition, subtitles, bgm } = options
  const tempDir = await createTempDir()

  try {
    let currentPath = ''

    // 1. 拼接视频
    const concatOutput = join(tempDir, 'concat.mp4')
    await concatVideos(clips, concatOutput)
    currentPath = concatOutput

    // 2. 添加转场效果
    if (transition && transition.type !== 'none') {
      const transitionOutput = join(tempDir, 'transition.mp4')
      await addFadeTransition(currentPath, transitionOutput, transition.duration, transition.duration)
      currentPath = transitionOutput
    }

    // 3. 叠加字幕
    if (subtitles && subtitles.length > 0) {
      const subtitleOutput = join(tempDir, 'subtitle.mp4')
      await addSubtitles(currentPath, subtitleOutput, subtitles)
      currentPath = subtitleOutput
    }

    // 4. 混合背景音乐
    if (bgm) {
      const bgmOutput = join(tempDir, 'bgm.mp4')
      await mixAudio(currentPath, bgm.path, bgmOutput, bgm.volume)
      currentPath = bgmOutput
    }

    // 5. 复制到最终输出
    await fs.copyFile(currentPath, output)
    const stats = await fs.stat(output)
    const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0)

    return {
      outputPath: output,
      duration: totalDuration,
      size: stats.size
    }
  } finally {
    await cleanupTempDir(tempDir)
  }
}

/**
 * 获取视频信息
 */
export function getVideoInfo(inputPath: string): Promise<{
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err)
        return
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video')
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio')

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : 24,
        hasAudio: !!audioStream
      })
    })
  })
}

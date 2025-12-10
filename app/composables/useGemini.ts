import type { ParsedScript } from '../../shared/types/script'
import type { VideoModel } from '../../shared/types/video'

/**
 * Gemini API 前端封装
 *
 * 提供统一的 API 调用接口，包括：
 * - 剧本解析
 * - 角色生成
 * - 首尾帧生成
 * - 视频生成
 */
export function useGemini() {
  // ==================== 剧本解析 ====================

  interface ParseScriptOptions {
    text: string
    maxScenes?: number
  }

  interface ParseScriptResult {
    success: boolean
    data?: ParsedScript
    error?: string
    latencyMs?: number
  }

  /**
   * 解析剧本文本
   */
  async function parseScript(options: ParseScriptOptions): Promise<ParseScriptResult> {
    try {
      const response = await $fetch<{
        success: boolean
        data: ParsedScript
        latencyMs: number
      }>('/api/script/parse', {
        method: 'POST',
        body: {
          text: options.text,
          maxScenes: options.maxScenes ?? 10
        }
      })
      return {
        success: response.success,
        data: response.data,
        latencyMs: response.latencyMs
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '剧本解析失败'
      }
    }
  }

  // ==================== 角色生成 ====================

  interface GenerateCharacterOptions {
    id: string
    name: string
    appearance: string
    style?: string
    generateExpressions?: boolean
  }

  interface CharacterAsset {
    baseImage: string
    expressions?: Record<string, string>
  }

  interface GenerateCharacterResult {
    success: boolean
    asset?: CharacterAsset
    error?: string
    latencyMs?: number
  }

  /**
   * 生成角色图片
   */
  async function generateCharacter(options: GenerateCharacterOptions): Promise<GenerateCharacterResult> {
    try {
      const response = await $fetch<{
        success: boolean
        asset: CharacterAsset
        latencyMs: number
      }>('/api/character/generate', {
        method: 'POST',
        body: {
          character: {
            id: options.id,
            name: options.name,
            appearance: options.appearance
          },
          style: options.style ?? '日式动漫',
          generateExpressions: options.generateExpressions ?? false
        }
      })
      return {
        success: response.success,
        asset: response.asset,
        latencyMs: response.latencyMs
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '角色生成失败'
      }
    }
  }

  // ==================== 首尾帧生成 ====================

  interface Scene {
    id: string
    title: string
    description: string
    characters: Array<{ name: string, appearance?: string, emotion?: string, action?: string }>
    dialogues: Array<{ character: string, text: string, emotion?: string }>
    duration: number
    setting?: { location: string, timeOfDay: string, mood?: string, weather?: string }
  }

  interface GenerateFramesOptions {
    scene: Scene
    style?: string
    characterAssets?: Record<string, string>
  }

  interface FrameData {
    imageData: string
    mimeType: string
  }

  interface GenerateFramesResult {
    success: boolean
    firstFrame?: FrameData
    lastFrame?: FrameData
    error?: string
    latencyMs?: number
  }

  /**
   * 生成场景首尾帧
   */
  async function generateFrames(options: GenerateFramesOptions): Promise<GenerateFramesResult> {
    try {
      const response = await $fetch<{
        success: boolean
        firstFrame: FrameData
        lastFrame: FrameData
        latencyMs: number
      }>('/api/frame/generate', {
        method: 'POST',
        body: {
          scene: options.scene,
          style: options.style ?? '日式动漫',
          characterAssets: options.characterAssets
        }
      })
      return {
        success: response.success,
        firstFrame: response.firstFrame,
        lastFrame: response.lastFrame,
        latencyMs: response.latencyMs
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '首尾帧生成失败'
      }
    }
  }

  // ==================== 视频生成 ====================

  interface GenerateVideoOptions {
    sceneId: string
    prompt: string
    firstFrame?: string
    lastFrame?: string
    duration?: 4 | 6 | 8
    resolution?: '720p' | '1080p'
    aspectRatio?: '16:9' | '9:16' | '1:1'
    withAudio?: boolean
    model?: VideoModel
  }

  interface GenerateVideoResult {
    success: boolean
    taskId?: string
    error?: string
  }

  /**
   * 发起视频生成任务
   */
  async function generateVideo(options: GenerateVideoOptions): Promise<GenerateVideoResult> {
    try {
      const response = await $fetch<{
        success: boolean
        taskId: string
      }>('/api/video/generate', {
        method: 'POST',
        body: {
          sceneId: options.sceneId,
          config: {
            prompt: options.prompt,
            firstFrame: options.firstFrame,
            lastFrame: options.lastFrame,
            duration: options.duration ?? 8,
            resolution: options.resolution ?? '720p',
            aspectRatio: options.aspectRatio ?? '16:9',
            withAudio: options.withAudio ?? true,
            model: options.model ?? 'standard'
          }
        }
      })
      return {
        success: response.success,
        taskId: response.taskId
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '视频生成失败'
      }
    }
  }

  // ==================== 视频任务状态 ====================

  interface VideoTask {
    id: string
    sceneId: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    progress: number
    error?: string
    result?: {
      videoData: string
      metadata: {
        duration: number
        resolution: string
        aspectRatio: string
        hasAudio: boolean
      }
    }
  }

  interface GetVideoStatusResult {
    success: boolean
    task?: VideoTask
    error?: string
  }

  /**
   * 获取视频生成任务状态
   */
  async function getVideoStatus(taskId: string): Promise<GetVideoStatusResult> {
    try {
      const response = await $fetch<{
        success: boolean
        task: VideoTask
      }>(`/api/video/status/${taskId}`)
      return {
        success: response.success,
        task: response.task
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取状态失败'
      }
    }
  }

  /**
   * 轮询等待视频生成完成
   */
  async function waitForVideo(
    taskId: string,
    options?: {
      pollInterval?: number
      maxWaitTime?: number
      onProgress?: (progress: number) => void
    }
  ): Promise<GetVideoStatusResult> {
    const pollInterval = options?.pollInterval ?? 5000
    const maxWaitTime = options?.maxWaitTime ?? 180000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      const result = await getVideoStatus(taskId)

      if (!result.success || !result.task) {
        return result
      }

      options?.onProgress?.(result.task.progress)

      if (result.task.status === 'completed' || result.task.status === 'failed') {
        return result
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    return {
      success: false,
      error: '视频生成超时'
    }
  }

  // ==================== 返回接口 ====================

  return {
    // 剧本
    parseScript,

    // 角色
    generateCharacter,

    // 首尾帧
    generateFrames,

    // 视频
    generateVideo,
    getVideoStatus,
    waitForVideo
  }
}

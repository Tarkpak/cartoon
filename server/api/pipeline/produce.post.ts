import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, projects as projectsTable } from '../../db'
import { GeminiError } from '../../utils/gemini'
import {
  createPipelineTask,
  updatePipelineTask,
  updatePipelineStep,
  getPipelineTaskWS,
  type PipelineTaskInfo
} from '../../utils/websocket'

/**
 * 生产流水线请求 Schema
 */
const ProducePipelineRequestSchema = z.object({
  projectId: z.string().describe('项目ID'),
  options: z.object({
    generateFrames: z.boolean().default(true).describe('生成首尾帧'),
    generateVideos: z.boolean().default(true).describe('生成场景视频'),
    generateTransitions: z.boolean().default(true).describe('生成转场'),
    generateAudio: z.boolean().default(false).describe('生成音频'),
    mergeOutput: z.boolean().default(true).describe('合并最终输出')
  }).optional()
})

type PipelineOptions = {
  generateFrames?: boolean
  generateVideos?: boolean
  generateTransitions?: boolean
  generateAudio?: boolean
  mergeOutput?: boolean
}

interface PipelineStep {
  id: string
  name: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
  progress: number
}

/**
 * 生产流水线 API
 * POST /api/pipeline/produce
 *
 * 整合所有生成流程的完整流水线:
 * 1. 解析剧本 → 2. 生成角色 → 3. 生成首尾帧 → 4. 生成视频 → 5. 生成转场 → 6. 合成输出
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = ProducePipelineRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { projectId, options } = parseResult.data
  const opts: PipelineOptions = options || {}

  try {
    // 2. 检查项目是否存在
    const project = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).get()
    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: '项目不存在'
      })
    }

    // 3. 创建流水线任务
    const taskId = `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    const steps: PipelineStep[] = [
      { id: 'parse', name: '解析剧本', status: 'pending', progress: 0 },
      { id: 'characters', name: '生成角色', status: 'pending', progress: 0 },
      { id: 'frames', name: '生成首尾帧', status: opts.generateFrames ? 'pending' : 'skipped', progress: 0 },
      { id: 'videos', name: '生成场景视频', status: opts.generateVideos ? 'pending' : 'skipped', progress: 0 },
      { id: 'transitions', name: '生成转场', status: opts.generateTransitions ? 'pending' : 'skipped', progress: 0 },
      { id: 'audio', name: '生成音频', status: opts.generateAudio ? 'pending' : 'skipped', progress: 0 },
      { id: 'merge', name: '合成输出', status: opts.mergeOutput ? 'pending' : 'skipped', progress: 0 }
    ]

    // 使用 WebSocket 工具创建任务
    createPipelineTask({
      id: taskId,
      projectId,
      status: 'pending',
      progress: 0,
      steps: steps.map(s => ({ id: s.id, name: s.name, status: s.status, progress: s.progress })),
      updatedAt: now
    })

    // 4. 异步启动流水线执行
    executePipeline(taskId, projectId, opts as PipelineOptions).catch(async (error) => {
      console.error(`[Pipeline] 任务 ${taskId} 失败:`, error)
      updatePipelineTask(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '未知错误'
      })
    })

    return {
      success: true,
      taskId,
      message: '生产流水线已启动',
      steps: steps.map(s => ({ id: s.id, name: s.name, status: s.status })),
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[Pipeline] 启动失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `流水线启动失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 更新步骤状态（使用 WebSocket 工具）
 */
function updateStep(
  taskId: string,
  stepId: string,
  updates: Partial<{ status: string, progress: number, message: string, startedAt: string, completedAt: string }>
) {
  updatePipelineStep(taskId, stepId, updates)
}

/**
 * 执行流水线
 */
async function executePipeline(
  taskId: string,
  projectId: string,
  options: PipelineOptions
) {
  const task = getPipelineTaskWS(taskId)
  if (!task) return

  updatePipelineTask(taskId, { status: 'processing' })

  try {
    // Step 1: 解析剧本 (模拟 - 实际应从数据库获取)
    updateStep(taskId, 'parse', { status: 'processing', startedAt: new Date().toISOString() })
    await simulateStep(taskId, 'parse', 2000)
    updateStep(taskId, 'parse', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })

    // Step 2: 生成角色
    updateStep(taskId, 'characters', { status: 'processing', startedAt: new Date().toISOString() })
    await simulateStep(taskId, 'characters', 5000)
    updateStep(taskId, 'characters', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })

    // Step 3: 生成首尾帧
    if (options.generateFrames !== false) {
      updateStep(taskId, 'frames', { status: 'processing', startedAt: new Date().toISOString() })
      await simulateStep(taskId, 'frames', 8000)
      updateStep(taskId, 'frames', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })
    }

    // Step 4: 生成场景视频
    if (options.generateVideos !== false) {
      updateStep(taskId, 'videos', { status: 'processing', startedAt: new Date().toISOString() })
      await simulateStep(taskId, 'videos', 15000)
      updateStep(taskId, 'videos', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })
    }

    // Step 5: 生成转场
    if (options.generateTransitions !== false) {
      updateStep(taskId, 'transitions', { status: 'processing', startedAt: new Date().toISOString() })
      await simulateStep(taskId, 'transitions', 10000)
      updateStep(taskId, 'transitions', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })
    }

    // Step 6: 生成音频
    if (options.generateAudio) {
      updateStep(taskId, 'audio', { status: 'processing', startedAt: new Date().toISOString() })
      await simulateStep(taskId, 'audio', 5000)
      updateStep(taskId, 'audio', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })
    }

    // Step 7: 合成输出
    if (options.mergeOutput !== false) {
      updateStep(taskId, 'merge', { status: 'processing', startedAt: new Date().toISOString() })
      await simulateStep(taskId, 'merge', 5000)
      updateStep(taskId, 'merge', { status: 'completed', progress: 100, completedAt: new Date().toISOString() })
    }

    // 完成
    updatePipelineTask(taskId, {
      status: 'completed',
      progress: 100,
      outputPath: `/output/${projectId}/final.mp4`
    })

    console.log(`[Pipeline] 任务 ${taskId} 完成`)
  } catch (error) {
    const currentTask = getPipelineTaskWS(taskId)
    const currentStep = currentTask?.currentStep
    if (currentStep) {
      updateStep(taskId, currentStep, {
        status: 'failed',
        message: error instanceof Error ? error.message : '未知错误'
      })
    }
    throw error
  }
}

/**
 * 模拟步骤执行 (实际应调用对应的生成 API)
 */
async function simulateStep(taskId: string, stepId: string, duration: number) {
  const intervals = 10
  const intervalTime = duration / intervals

  for (let i = 1; i <= intervals; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalTime))
    updateStep(taskId, stepId, { progress: i * 10 })
  }
}

/**
 * 获取流水线任务状态
 */
export function getPipelineTask(taskId: string): PipelineTaskInfo | undefined {
  return getPipelineTaskWS(taskId)
}

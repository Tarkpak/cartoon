import { z } from 'zod'
import { db, projects as projectsTable } from '../../db'
import { isStyleIdEnabled } from '../../utils/style-config'

const CreateProjectSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  workflowType: z.enum(['classic', 'asset_consistency']).default('classic'),
  // 项目预设配置 (必填)
  styleId: z.string().min(1).describe('风格预设 ID (必填)'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).describe('视频比例 (必填)')
})

/**
 * 创建项目
 * POST /api/project/create
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = CreateProjectSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { title, description, workflowType, styleId, aspectRatio } = parseResult.data
  const now = new Date().toISOString()
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  try {
    const styleEnabled = await isStyleIdEnabled(styleId)
    if (!styleEnabled) {
      throw createError({
        statusCode: 400,
        statusMessage: '画风预设不可用',
        message: `当前后台配置未启用该画风: ${styleId}`
      })
    }

    await db.insert(projectsTable).values({
      id,
      name: title,
      description: description || null,
      workflowType,
      styleId,
      aspectRatio,
      status: 'draft',
      createdAt: now,
      updatedAt: now
    })

    return {
      success: true,
      project: {
        id,
        title,
        description,
        workflowType,
        styleId,
        aspectRatio,
        status: 'draft',
        totalScenes: 0,
        completedScenes: 0,
        totalDuration: 0,
        createdAt: now,
        updatedAt: now
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }
    console.error('[ProjectCreate] 创建失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '创建项目失败'
    })
  }
})

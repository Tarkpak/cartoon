import { z } from 'zod'
import { db, projects as projectsTable } from '../../db'

const CreateProjectSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional()
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

  const { title, description } = parseResult.data
  const now = new Date().toISOString()
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  try {
    await db.insert(projectsTable).values({
      id,
      name: title,
      description: description || null,
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
        status: 'draft',
        totalScenes: 0,
        completedScenes: 0,
        totalDuration: 0,
        createdAt: now,
        updatedAt: now
      }
    }
  } catch (error) {
    console.error('[ProjectCreate] 创建失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '创建项目失败'
    })
  }
})

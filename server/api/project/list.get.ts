import { db, projects as projectsTable } from '../../db'
import { desc } from 'drizzle-orm'

/**
 * 获取项目列表
 * GET /api/project/list
 */
export default defineEventHandler(async () => {
  try {
    const projectList = await db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.updatedAt))
      .all()

    return {
      success: true,
      projects: projectList.map(p => ({
        id: p.id,
        title: p.name,
        description: p.description,
        status: p.status,
        totalScenes: 0,
        completedScenes: 0,
        totalDuration: 0,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    }
  } catch (error) {
    console.error('[ProjectList] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取项目列表失败'
    })
  }
})

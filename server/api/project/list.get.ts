import { db, projects as projectsTable, scripts as scriptsTable, scenes as scenesTable } from '../../db'
import { desc, eq } from 'drizzle-orm'

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

    // 获取每个项目的场景数量
    const projectsWithScenes = await Promise.all(
      projectList.map(async (p) => {
        // 查询项目关联的剧本
        const script = await db
          .select()
          .from(scriptsTable)
          .where(eq(scriptsTable.projectId, p.id))
          .get()

        let totalScenes = 0
        let completedScenes = 0
        let totalDuration = 0

        if (script) {
          // 查询剧本关联的场景
          const sceneList = await db
            .select()
            .from(scenesTable)
            .where(eq(scenesTable.scriptId, script.id))
            .all()

          totalScenes = sceneList.length
          completedScenes = sceneList.filter(s => s.status === 'video_ready').length
          totalDuration = sceneList.reduce((sum, s) => sum + (s.duration || 0), 0)
        }

        return {
          id: p.id,
          title: p.name,
          description: p.description,
          workflowType: p.workflowType || 'classic',
          styleId: p.styleId,
          aspectRatio: p.aspectRatio,
          status: p.status,
          totalScenes,
          completedScenes,
          totalDuration,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        }
      })
    )

    return {
      success: true,
      projects: projectsWithScenes
    }
  } catch (error) {
    console.error('[ProjectList] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取项目列表失败'
    })
  }
})

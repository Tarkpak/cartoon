import { eq, inArray } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters } from '../../db'

/**
 * 删除项目
 * DELETE /api/project/:id
 * 由于 schema 中定义了 onDelete: 'cascade'，
 * 删除项目时会自动删除关联的 scripts、scenes、characters 等数据
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少项目ID',
    })
  }

  try {
    // 检查项目是否存在
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()

    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '项目不存在',
      })
    }

    // 显式清理关联数据，兼容历史数据库中的外键配置差异
    const scriptRows = await db
      .select({ id: scripts.id })
      .from(scripts)
      .where(eq(scripts.projectId, id))
      .all()

    const scriptIds = scriptRows.map(s => s.id)
    if (scriptIds.length > 0) {
      await db.delete(scenes).where(inArray(scenes.scriptId, scriptIds))
    }

    await db.delete(characters).where(eq(characters.projectId, id))
    await db.delete(scripts).where(eq(scripts.projectId, id))
    await db.delete(projects).where(eq(projects.id, id))

    return {
      success: true,
      message: '项目已删除'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }
    console.error('[ProjectDelete] 删除失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '删除项目失败',
    })
  }
})

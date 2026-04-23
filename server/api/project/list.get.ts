import { z } from 'zod'
import { db, projects as projectsTable, scripts as scriptsTable, scenes as scenesTable } from '../../db'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import { normalizeScriptParseMode } from '../../../shared/types/script'

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['all', 'in_progress', 'completed', 'draft']).optional(),
  sortBy: z.enum(['updated', 'created', 'name']).optional(),
  keyword: z.string().trim().optional()
})

/**
 * 获取项目列表
 * GET /api/project/list
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const parsed = QuerySchema.safeParse(query)
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: '查询参数无效',
        message: parsed.error.issues.map(item => item.message).join(', ')
      })
    }

    const shouldPaginate = query.page !== undefined || query.pageSize !== undefined
    const requestedPage = parsed.data.page ?? 1
    const pageSize = parsed.data.pageSize ?? 20
    const sortBy = parsed.data.sortBy ?? 'updated'
    const status = parsed.data.status ?? 'all'
    const keyword = parsed.data.keyword?.trim() || ''

    const statusCondition = status !== 'all'
      ? eq(projectsTable.status, status)
      : undefined
    const keywordCondition = keyword
      ? or(
          like(projectsTable.name, `%${keyword}%`),
          like(projectsTable.description, `%${keyword}%`),
          like(projectsTable.styleId, `%${keyword}%`),
          like(projectsTable.workflowType, `%${keyword}%`),
          like(projectsTable.scriptParseMode, `%${keyword}%`)
        )
      : undefined
    const whereClause = and(statusCondition, keywordCondition)

    const countBuilder = db
      .select({ total: sql<number>`count(*)` })
      .from(projectsTable)
    const countRows = whereClause
      ? await countBuilder.where(whereClause).all()
      : await countBuilder.all()
    const total = countRows[0]?.total ?? 0

    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1
    const page = shouldPaginate ? Math.min(requestedPage, totalPages) : requestedPage

    const runListQuery = () => {
      const offset = (page - 1) * pageSize
      if (sortBy === 'created') {
        if (shouldPaginate) {
          return whereClause
            ? db.select().from(projectsTable).where(whereClause).orderBy(desc(projectsTable.createdAt)).limit(pageSize).offset(offset).all()
            : db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt)).limit(pageSize).offset(offset).all()
        }
        return whereClause
          ? db.select().from(projectsTable).where(whereClause).orderBy(desc(projectsTable.createdAt)).all()
          : db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt)).all()
      }

      if (sortBy === 'name') {
        if (shouldPaginate) {
          return whereClause
            ? db.select().from(projectsTable).where(whereClause).orderBy(asc(projectsTable.name)).limit(pageSize).offset(offset).all()
            : db.select().from(projectsTable).orderBy(asc(projectsTable.name)).limit(pageSize).offset(offset).all()
        }
        return whereClause
          ? db.select().from(projectsTable).where(whereClause).orderBy(asc(projectsTable.name)).all()
          : db.select().from(projectsTable).orderBy(asc(projectsTable.name)).all()
      }

      if (shouldPaginate) {
        return whereClause
          ? db.select().from(projectsTable).where(whereClause).orderBy(desc(projectsTable.updatedAt)).limit(pageSize).offset(offset).all()
          : db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt)).limit(pageSize).offset(offset).all()
      }
      return whereClause
        ? db.select().from(projectsTable).where(whereClause).orderBy(desc(projectsTable.updatedAt)).all()
        : db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt)).all()
    }

    const projectList = await runListQuery()

    const projectIds = projectList.map(project => project.id)
    let scriptByProjectId = new Map<string, string>()
    let sceneStatsByScriptId = new Map<string, { totalScenes: number, completedScenes: number, totalDuration: number }>()

    if (projectIds.length > 0) {
      const scriptRows = await db
        .select({
          id: scriptsTable.id,
          projectId: scriptsTable.projectId
        })
        .from(scriptsTable)
        .where(inArray(scriptsTable.projectId, projectIds))
        .all()

      scriptByProjectId = new Map(
        scriptRows
          .filter(row => !!row.projectId)
          .map(row => [row.projectId!, row.id])
      )

      const scriptIds = scriptRows.map(row => row.id)
      if (scriptIds.length > 0) {
        const sceneRows = await db
          .select({
            scriptId: scenesTable.scriptId,
            status: scenesTable.status,
            duration: scenesTable.duration
          })
          .from(scenesTable)
          .where(inArray(scenesTable.scriptId, scriptIds))
          .all()

        sceneStatsByScriptId = sceneRows.reduce((statsMap, scene) => {
          if (!scene.scriptId) return statsMap
          const current = statsMap.get(scene.scriptId) || {
            totalScenes: 0,
            completedScenes: 0,
            totalDuration: 0
          }
          current.totalScenes += 1
          if (scene.status === 'video_ready') current.completedScenes += 1
          current.totalDuration += scene.duration || 0
          statsMap.set(scene.scriptId, current)
          return statsMap
        }, new Map<string, { totalScenes: number, completedScenes: number, totalDuration: number }>())
      }
    }

    const projectsWithScenes = projectList.map((p) => {
      const scriptId = scriptByProjectId.get(p.id)
      const sceneStats = scriptId ? sceneStatsByScriptId.get(scriptId) : undefined
      const totalScenes = sceneStats?.totalScenes ?? 0
      const completedScenes = sceneStats?.completedScenes ?? 0
      const totalDuration = sceneStats?.totalDuration ?? 0

      return {
        id: p.id,
        title: p.name,
        description: p.description,
        workflowType: normalizeProjectWorkflowType(p.workflowType),
        scriptParseMode: normalizeScriptParseMode(p.scriptParseMode),
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

    return {
      success: true,
      projects: projectsWithScenes,
      pagination: {
        page: shouldPaginate ? page : 1,
        pageSize: shouldPaginate ? pageSize : projectsWithScenes.length,
        total,
        totalPages: shouldPaginate ? totalPages : 1
      }
    }
  } catch (error) {
    console.error('[ProjectList] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取项目列表失败'
    })
  }
})

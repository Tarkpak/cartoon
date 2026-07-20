import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { readJsonBody, requireAuth } from '../../../utils/auth'
import { optionalJson, optionalString } from '../../../utils/http'
import { projectSyncOwnerId } from '../../../utils/admin-resource-scope'

interface ProjectPayload {
  id?: string
  force?: boolean
  localProjectId?: string
  name?: string
  title?: string
  description?: string
  scriptParseMode?: string
  script_parse_mode?: string
  styleId?: string
  style_id?: string
  aspectRatio?: string
  aspect_ratio?: string
  status?: string
  createdAt?: string
  created_at?: string
  localCreatedAt?: string
  local_created_at?: string
  updatedAt?: string
  updated_at?: string
  localUpdatedAt?: string
  local_updated_at?: string
  summary?: unknown
  snapshot?: unknown
  ownerUserId?: string
}

function normalizeProjects(body: Record<string, unknown>) {
  if (Array.isArray(body.projects)) return body.projects as ProjectPayload[]
  if (body.project && typeof body.project === 'object') return [body.project as ProjectPayload]
  return [body as ProjectPayload]
}

function skippedProjectResult(input: {
  localProjectId: string
  projectId: string
  reason?: string
}) {
  return {
    localProjectId: input.localProjectId,
    projectId: input.projectId,
    status: 'skipped' as const,
    reason: input.reason || 'unknown'
  }
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const projects = normalizeProjects(body)
  if (projects.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'projects is required' })
  }

  const db = getDb()
  const resolveOwnerUserId = (project: ProjectPayload) => {
    const requestedOwnerId = optionalString(project.ownerUserId, 128)
    const ownerUserId = projectSyncOwnerId({
      role: auth.user.role,
      authenticatedUserId: auth.user.id,
      requestedOwnerId
    })
    if (ownerUserId === auth.user.id) return ownerUserId
    const owner = db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(ownerUserId)
    if (!owner) throw createError({ statusCode: 400, statusMessage: 'project.ownerUserId is invalid' })
    return ownerUserId
  }
  const timestamp = nowIso()
  const upsertProject = db.prepare(`
    INSERT INTO user_projects
      (id, user_id, local_project_id, name, description, script_parse_mode, style_id, aspect_ratio, status,
       summary_json, local_created_at, local_updated_at, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, local_project_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      script_parse_mode = excluded.script_parse_mode,
      style_id = excluded.style_id,
      aspect_ratio = excluded.aspect_ratio,
      status = excluded.status,
      summary_json = excluded.summary_json,
      local_created_at = excluded.local_created_at,
      local_updated_at = excluded.local_updated_at,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `)
  const selectProject = db.prepare('SELECT id, local_updated_at FROM user_projects WHERE user_id = ? AND local_project_id = ? LIMIT 1')
  const insertSnapshot = db.prepare(`
    INSERT INTO user_project_snapshots
      (id, user_id, project_id, snapshot_json, snapshot_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const synced = db.transaction((items: ProjectPayload[]) => {
    const result: Array<{ localProjectId: string, projectId: string, status: 'synced' | 'skipped', reason?: string }> = []
    for (const project of items) {
      const ownerUserId = resolveOwnerUserId(project)
      const localProjectId = optionalString(project.localProjectId || project.id, 128)
      if (!localProjectId) {
        throw createError({ statusCode: 400, statusMessage: 'project.localProjectId is required' })
      }
      const name = optionalString(project.name || project.title, 256) || '未命名项目'
      const existing = selectProject.get(ownerUserId, localProjectId) as { id: string, local_updated_at: string | null } | undefined
      const projectId = existing?.id || randomUUID()
      const snapshot = optionalJson(project.snapshot) ?? project
      const force = project.force === true
      const localCreatedAt = optionalString(project.localCreatedAt || project.local_created_at || project.createdAt || project.created_at, 64)
      const localUpdatedAt = optionalString(project.localUpdatedAt || project.local_updated_at || project.updatedAt || project.updated_at, 64)
      if (!force && existing?.local_updated_at && localUpdatedAt && localUpdatedAt < existing.local_updated_at) {
        result.push(skippedProjectResult({
          localProjectId,
          projectId,
          reason: 'stale_local_update'
        }))
        continue
      }

      upsertProject.run(
        projectId,
        ownerUserId,
        localProjectId,
        name,
        optionalString(project.description, 2048),
        optionalString(project.scriptParseMode || project.script_parse_mode, 64),
        optionalString(project.styleId || project.style_id, 128),
        optionalString(project.aspectRatio || project.aspect_ratio, 32),
        optionalString(project.status, 64) || 'draft',
        jsonText(project.summary || {}),
        localCreatedAt,
        localUpdatedAt || timestamp,
        timestamp,
        timestamp,
        timestamp
      )

      insertSnapshot.run(randomUUID(), ownerUserId, projectId, jsonText(snapshot), 1, timestamp)
      result.push({ localProjectId, projectId, status: 'synced' })
    }
    return result
  })(projects)

  return {
    success: true,
    data: {
      synced
    }
  }
})

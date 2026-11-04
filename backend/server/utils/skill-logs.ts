import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import { requiredString } from './http'

export interface SkillLogContext {
  runId: string
  stage: string
  skills: Array<{ id: string, name: string, version: string, origin?: { repository: string, path: string, commit: string } }>
  batchStart?: number
  batchEnd?: number
  attempt?: number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 400, message: '技能日志格式无效' })
  return value as Record<string, unknown>
}

export function normalizeSkillContext(value: unknown): SkillLogContext | null {
  if (value == null) return null
  const data = record(value)
  if (!['scene_detail', 'video_review'].includes(String(data.stage))) throw createError({ statusCode: 400, message: '技能流程无效' })
  if (!Array.isArray(data.skills) || data.skills.length > 16) throw createError({ statusCode: 400, message: '技能列表无效' })
  const result: SkillLogContext = {
    runId: requiredString(data.runId, 'runId', 128),
    stage: String(data.stage),
    skills: data.skills.map(value => {
      const s = record(value)
      const origin = s.origin == null ? undefined : record(s.origin)
      return {
        id: requiredString(s.id, 'skill.id', 128), name: requiredString(s.name, 'skill.name', 100), version: requiredString(s.version, 'skill.version', 100),
        ...(origin ? { origin: { repository: requiredString(origin.repository, 'repository', 256), path: String(origin.path || '').slice(0, 512), commit: requiredString(origin.commit, 'commit', 64) } } : {})
      }
    })
  }
  for (const key of ['batchStart', 'batchEnd', 'attempt'] as const) {
    if (data[key] !== undefined) {
      if (!Number.isSafeInteger(data[key]) || Number(data[key]) < 1) throw createError({ statusCode: 400, message: '技能批次无效' })
      result[key] = Number(data[key])
    }
  }
  return result
}

export function ensureSkillRunSchema(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS skill_runs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL, project_id TEXT NOT NULL, stage TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL,
    body_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
  ); CREATE INDEX IF NOT EXISTS idx_skill_runs_created ON skill_runs(created_at);`)
}

export function saveSkillRun(db: Database, userId: string, payload: unknown) {
  const data = record(payload)
  const context = normalizeSkillContext({ ...data, runId: data.id })!
  const status = requiredString(data.status, 'status', 32)
  if (!['running', 'succeeded', 'failed', 'skipped', 'interrupted'].includes(status)) throw createError({ statusCode: 400, message: '技能执行状态无效' })
  const revision = status === 'running' ? 0 : 1
  const projectId = requiredString(data.projectId, 'projectId', 128)
  const createdAt = requiredString(data.createdAt, 'createdAt', 64)
  if (!Number.isFinite(Date.parse(createdAt))) throw createError({ statusCode: 400, message: '执行时间无效' })
  const finishedAt = typeof data.finishedAt === 'string' && Number.isFinite(Date.parse(data.finishedAt)) ? new Date(data.finishedAt).toISOString() : undefined
  const result = data.result == null ? {} : record(data.result)
  const body = {
    id: context.runId, projectId, projectName: String(data.projectName || '').slice(0, 256), stage: context.stage,
    skills: context.skills, status, revision, createdAt: new Date(createdAt).toISOString(), finishedAt,
    durationMs: Number.isFinite(data.durationMs) ? Math.max(0, Number(data.durationMs)) : undefined,
    result: { message: String(result.message || '').slice(0, 4000), sceneCount: Number.isFinite(result.sceneCount) ? Number(result.sceneCount) : undefined,
      issueCount: Number.isFinite(result.issueCount) ? Number(result.issueCount) : undefined, passed: typeof result.passed === 'boolean' ? result.passed : undefined }
  }
  // A delayed running event must never overwrite a terminal result. Duplicate
  // terminal events are idempotent and cannot replace the original outcome.
  db.prepare(`INSERT INTO skill_runs (user_id,id,project_id,stage,status,created_at,revision,body_json)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET
    status=excluded.status, revision=excluded.revision, body_json=excluded.body_json
    WHERE excluded.revision > skill_runs.revision`).run(userId,body.id,projectId,body.stage,status,body.createdAt,revision,JSON.stringify(body))
  return body.id
}

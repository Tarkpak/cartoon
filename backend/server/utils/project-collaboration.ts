import { applyCollaborationPatch, diffCollaborationBody, type CollaborationPatch } from '../../../shared/utils/collaboration-patch'
import { randomUUID, createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import {
  collaborationId,
  collaborationObject,
  collaborationResourceType,
  COLLABORATION_PROTOCOL_VERSION,
  type CollaborationChange,
  type CollaborationMutation,
  type CollaborationResource,
  type CollaborationResourceType
} from '../../../shared/types/project-collaboration'
import { composeProjectSnapshot, splitProjectSnapshot, validateCollaborationResources } from '../../../shared/utils/project-collaboration'
import { PROJECT_EDIT_LEASE_MS, requireProjectEditLease } from './project-edit-leases'

export function ensureProjectCollaborationSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_collaborations (
      project_id TEXT PRIMARY KEY REFERENCES user_projects(id) ON DELETE CASCADE,
      source_snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_resources (
      project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      revision INTEGER NOT NULL, body_json TEXT, deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, resource_type, resource_id)
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_leases (
      project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      user_id TEXT NOT NULL, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
      token TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, resource_type, resource_id)
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_presence (
      project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
      scopes_json TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id, device_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_window_presence (
      project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
      editing_json TEXT NOT NULL DEFAULT '[]', last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id, device_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_operations (
      project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE, user_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, result_json TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id, operation_id)
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_changes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES project_collaborations(project_id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, revision INTEGER NOT NULL,
      body_json TEXT, deleted INTEGER NOT NULL, user_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_collaboration_changes
      ON project_collaboration_changes(project_id, sequence);
  `)
  const columns = db.query('PRAGMA table_info(project_collaboration_changes)').all() as Array<{ name: string }>
  if (!columns.some(column => column.name === 'patch_json')) db.exec('ALTER TABLE project_collaboration_changes ADD COLUMN patch_json TEXT')
}

export function nextCollaborationTimestamp(nowMs: number, ...previous: Array<string | null | undefined>) {
  return new Date(Math.max(nowMs, ...previous.map(value => (Date.parse(value || '') || 0) + 1))).toISOString()
}

export function projectUsesCollaboration(db: Database, projectId: string): boolean {
  return !!db.query('SELECT 1 FROM project_collaborations WHERE project_id = ?').get(projectId)
}

function requireCollaboration(db: Database, projectId: string) {
  if (!projectUsesCollaboration(db, projectId)) throw createError({ statusCode: 409, message: '项目尚未迁移到按集协作' })
}

export function rejectLegacyProjectWrite(db: Database, projectId: string) {
  if (projectUsesCollaboration(db, projectId)) throw createError({ statusCode: 409, message: '项目已启用按集协作，请使用协作入口；整项目上传已停用' })
}

function invalid(cause: unknown): never {
  throw createError({ statusCode: 400, message: cause instanceof Error ? cause.message : '协作数据无效' })
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item) ?? 'undefined'
}

interface ResourceRow {
  resource_type: CollaborationResourceType
  resource_id: string
  revision: number
  body_json: string | null
  deleted: number
}

function resourceFromRow(row: ResourceRow): CollaborationResource {
  return { type: row.resource_type, id: row.resource_id, revision: row.revision, body: row.body_json == null ? null : JSON.parse(row.body_json), deleted: !!row.deleted }
}

export function collaborationResources(db: Database, projectId: string): CollaborationResource[] {
  return (db.query('SELECT * FROM project_collaboration_resources WHERE project_id = ? ORDER BY resource_type, resource_id')
    .all(projectId) as ResourceRow[]).map(resourceFromRow)
}

/** Presence needs identities and deletion state, never scene bodies or media histories. */
export function collaborationResourceHeaders(db: Database, projectId: string): CollaborationResource[] {
  requireCollaboration(db, projectId)
  return (db.query('SELECT resource_type, resource_id, revision, deleted FROM project_collaboration_resources WHERE project_id = ? ORDER BY resource_type, resource_id')
    .all(projectId) as Omit<ResourceRow, 'body_json'>[])
    .map(item => ({ type: item.resource_type, id: item.resource_id, revision: item.revision, deleted: !!item.deleted, body: null }))
}

function cursor(db: Database, projectId: string) {
  return (db.query('SELECT COALESCE(MAX(sequence), 0) AS cursor FROM project_collaboration_changes WHERE project_id = ?')
    .get(projectId) as { cursor: number }).cursor
}

export function readCollaboration(db: Database, projectId: string, knownResources?: unknown) {
  return db.transaction(() => {
    const enabled = projectUsesCollaboration(db, projectId)
    const result = { enabled, protocolVersion: COLLABORATION_PROTOCOL_VERSION, cursor: enabled ? cursor(db, projectId) : 0 }
    if (!enabled || knownResources === undefined) return { ...result, resources: enabled ? collaborationResources(db, projectId) : [] }
    if (!Array.isArray(knownResources) || knownResources.length > 50000) return invalid(new Error('缓存资源版本列表无效'))
    const known = new Map<string, number>()
    for (const value of knownResources) {
      try {
        const item = collaborationObject(value, '缓存资源版本')
        const key = JSON.stringify([collaborationResourceType(item.type), collaborationId(item.id)])
        if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || known.has(key)) throw new Error('缓存资源版本无效')
        known.set(key, item.revision as number)
      } catch (cause) { return invalid(cause) }
    }
    // Check small headers first; do not parse unchanged scene/media histories.
    const headers = db.query('SELECT resource_type, resource_id, revision, deleted FROM project_collaboration_resources WHERE project_id = ? ORDER BY resource_type, resource_id')
      .all(projectId) as Omit<ResourceRow, 'body_json'>[]
    const getResource = db.query('SELECT * FROM project_collaboration_resources WHERE project_id = ? AND resource_type = ? AND resource_id = ?')
    const resources = headers.filter(item => known.get(JSON.stringify([item.resource_type, item.resource_id])) !== item.revision)
      .map(item => resourceFromRow(getResource.get(projectId, item.resource_type, item.resource_id) as ResourceRow))
    return { ...result, resources, resourceManifest: headers.map(item => ({ type: item.resource_type, id: item.resource_id, revision: item.revision, deleted: !!item.deleted })) }

  })()
}

export function collaborationSnapshot(db: Database, projectId: string) {
  return db.transaction(() => {
    requireCollaboration(db, projectId)
    const snapshot = composeProjectSnapshot(collaborationResources(db, projectId))
    const project = db.query('SELECT local_updated_at FROM user_projects WHERE id = ?').get(projectId) as { local_updated_at: string }
    snapshot.project = { ...collaborationObject(snapshot.project, '项目设置'), updatedAt: project.local_updated_at }
    return snapshot
  })()
}

export function previewProjectCollaboration(db: Database, projectId: string, expectedUpdatedAt?: string) {
  const project = db.query('SELECT local_project_id, local_updated_at, deleted_at FROM user_projects WHERE id = ?').get(projectId) as { local_project_id: string, local_updated_at: string, deleted_at: string | null } | null
  if (!project || project.deleted_at) throw createError({ statusCode: 404, message: '项目不存在或已删除' })
  if (expectedUpdatedAt !== undefined && project.local_updated_at !== expectedUpdatedAt) throw createError({ statusCode: 409, message: '云端版本已变化，请刷新后重新预检' })
  const snapshot = db.query('SELECT snapshot_json FROM user_project_snapshots WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId) as { snapshot_json: string } | null
  if (!snapshot) throw createError({ statusCode: 409, message: '项目缺少可迁移的完整快照，请先完成同步' })
  try {
    const resources = splitProjectSnapshot(JSON.parse(snapshot.snapshot_json))
    validateCollaborationResources(resources)
    const settings = resources.find(item => item.type === 'settings')!.body!
    const projectBody = collaborationObject(settings.project, '项目设置')
    if (projectBody.id !== project.local_project_id) throw new Error('快照项目身份与云端项目不一致')
    return { expectedUpdatedAt: project.local_updated_at, snapshotHash: createHash('sha256').update(snapshot.snapshot_json).digest('hex'), projectName: projectBody.name,
      episodes: resources.filter(item => item.type === 'episode').length, characters: resources.filter(item => item.type === 'character').length,
      scenes: resources.filter(item => item.type === 'episode').reduce((sum, item) => sum + (item.body!.scenes as unknown[]).length, 0) }
  } catch (cause) { return invalid(cause) }
}

// The original snapshot is retained permanently, independently of snapshot retention.
export function enableProjectCollaboration(db: Database, input: {
  projectId: string, userId: string, expectedUpdatedAt: string, leaseToken: string, snapshotHash?: string
}) {
  return db.transaction(() => {
    const project = db.query('SELECT user_id, local_project_id, local_updated_at, deleted_at FROM user_projects WHERE id = ?')
      .get(input.projectId) as { user_id: string, local_project_id: string, local_updated_at: string, deleted_at: string | null } | null
    if (!project || project.deleted_at) throw createError({ statusCode: 404, message: '项目不存在或已删除' })
    if (projectUsesCollaboration(db, input.projectId)) return readCollaboration(db, input.projectId)
    if (project.local_updated_at !== input.expectedUpdatedAt) throw createError({ statusCode: 409, message: '云端版本已变化，请刷新后重新迁移' })
    if (input.snapshotHash !== undefined && previewProjectCollaboration(db, input.projectId, input.expectedUpdatedAt).snapshotHash !== input.snapshotHash) throw createError({ statusCode: 409, message: '快照内容已变化，请重新预检迁移' })
    requireProjectEditLease(db, { ownerUserId: project.user_id, localProjectId: project.local_project_id, userId: input.userId, token: input.leaseToken })
    const snapshot = db.query('SELECT snapshot_json FROM user_project_snapshots WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(input.projectId) as { snapshot_json: string } | null
    if (!snapshot) throw createError({ statusCode: 409, message: '项目缺少可迁移的完整快照，请先完成同步' })
    let resources: CollaborationResource[]
    try {
      resources = splitProjectSnapshot(JSON.parse(snapshot.snapshot_json))
      validateCollaborationResources(resources)
      const settings = resources.find(item => item.type === 'settings')!.body!
      if (collaborationObject(settings.project, '项目设置').id !== project.local_project_id) throw new Error('快照项目身份与云端项目不一致')
    }
    catch (cause) { return invalid(cause) }
    const timestamp = new Date().toISOString()
    db.query('INSERT INTO project_collaborations (project_id, source_snapshot_json, created_at) VALUES (?, ?, ?)')
      .run(input.projectId, snapshot.snapshot_json, timestamp)
    const insert = db.query('INSERT INTO project_collaboration_resources (project_id, resource_type, resource_id, revision, body_json, deleted) VALUES (?, ?, ?, ?, ?, 0)')
    for (const resource of resources) insert.run(input.projectId, resource.type, resource.id, resource.revision, JSON.stringify(resource.body))
    db.query('DELETE FROM project_edit_leases WHERE owner_user_id = ? AND local_project_id = ?').run(project.user_id, project.local_project_id)
    return readCollaboration(db, input.projectId)
  }).immediate()
}

interface LeaseRow {
  user_id: string, device_id: string, session_id: string, token: string, expires_at: number
}

export function operateCollaborationLease(db: Database, input: {
  projectId: string, type: CollaborationResourceType, id: string, userId: string,
  deviceId: string, sessionId: string, token?: string,
  action: 'acquire' | 'heartbeat' | 'check' | 'release' | 'takeover', canTakeover: boolean, nowMs?: number
}) {
  return db.transaction(() => {
    requireCollaboration(db, input.projectId)
    try { collaborationResourceType(input.type); collaborationId(input.id); collaborationId(input.deviceId); collaborationId(input.sessionId) }
    catch (cause) { return invalid(cause) }
    if (!['acquire', 'heartbeat', 'check', 'release', 'takeover'].includes(input.action)) return invalid(new Error('编辑权操作无效'))
    if (input.action === 'takeover' && !input.canTakeover) throw createError({ statusCode: 403, message: '仅项目所有者或管理员可以接管编辑权' })
    const now = input.nowMs ?? Date.now()
    const args = [input.projectId, input.type, input.id] as const
    const row = db.query('SELECT * FROM project_collaboration_leases WHERE project_id = ? AND resource_type = ? AND resource_id = ?').get(...args) as LeaseRow | null
    const active = row && row.expires_at > now ? row : null
    const owns = !!active && active.user_id === input.userId && active.device_id === input.deviceId && active.session_id === input.sessionId && active.token === input.token
    const result = (editable: boolean, lease: LeaseRow | null) => ({ editable, token: editable ? lease?.token : undefined, expiresAt: lease?.expires_at ?? null, holderUserId: lease?.user_id, canTakeover: input.canTakeover })
    if (input.action === 'release') {
      if (owns) db.query('DELETE FROM project_collaboration_leases WHERE project_id = ? AND resource_type = ? AND resource_id = ? AND token = ?').run(...args, input.token!)
      return result(false, owns ? null : active)
    }
    if (input.action === 'check') return result(owns, active)
    if (input.action === 'heartbeat' && !owns) return result(false, active)
    if (active && !owns && input.action !== 'takeover') return result(false, active)
    const token = owns ? active!.token : randomUUID()
    db.query(`INSERT INTO project_collaboration_leases (project_id, resource_type, resource_id, user_id, device_id, session_id, token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, resource_type, resource_id) DO UPDATE SET
      user_id = excluded.user_id, device_id = excluded.device_id, session_id = excluded.session_id, token = excluded.token, expires_at = excluded.expires_at`)
      .run(...args, input.userId, input.deviceId, input.sessionId, token, now + PROJECT_EDIT_LEASE_MS)
    return result(true, { user_id: input.userId, device_id: input.deviceId, session_id: input.sessionId, token, expires_at: now + PROJECT_EDIT_LEASE_MS })
  }).immediate()
}

export function writeCollaboration(db: Database, input: {
  projectId: string, userId: string, deviceId: string, sessionId: string,
  operationId: string, mutations: CollaborationMutation[], nowMs?: number
}) {
  return db.transaction(() => {
    requireCollaboration(db, input.projectId)
    try { collaborationId(input.operationId); collaborationId(input.deviceId); collaborationId(input.sessionId) }
    catch (cause) { return invalid(cause) }
    if (!Array.isArray(input.mutations) || !input.mutations.length || input.mutations.length > 100) return invalid(new Error('每次提交需要 1 至 100 个对象修改'))
    const mutations = input.mutations.map(item => {
      try {
        const mutation = collaborationObject(item, '对象修改')
        const type = collaborationResourceType(mutation.type)
        const id = collaborationId(mutation.id)
        if (!Number.isSafeInteger(mutation.expectedRevision) || (mutation.expectedRevision as number) < 0 || mutation.expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error('基础版本无效')
        const patch = mutation.patch as CollaborationPatch[] | undefined
        if (patch !== undefined && Object.hasOwn(mutation, 'body')) throw new Error('不能同时提交完整对象和字段修改')
        const body = patch !== undefined ? undefined : mutation.body === null ? null : collaborationObject(mutation.body, '对象内容')
        return { type, id, expectedRevision: mutation.expectedRevision as number, body, ...(patch !== undefined ? { patch } : {}), leaseToken: collaborationId(mutation.leaseToken, '编辑权 token') }
      } catch (cause) { return invalid(cause) }
    })
    if (new Set(mutations.map(item => JSON.stringify([item.type, item.id]))).size !== mutations.length) return invalid(new Error('一次提交不能重复修改同一对象'))
    const fingerprint = createHash('sha256').update(canonicalJson(mutations.map(({ leaseToken: _token, ...item }) => item))).digest('hex')
    const previous = db.query('SELECT fingerprint, result_json FROM project_collaboration_operations WHERE project_id = ? AND user_id = ? AND operation_id = ?')
      .get(input.projectId, input.userId, input.operationId) as { fingerprint: string, result_json: string } | null
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw createError({ statusCode: 409, message: '操作 ID 已用于其他内容，请勿重复使用' })
      return JSON.parse(previous.result_json) as { cursor: number, resources: CollaborationResource[] }
    }
    const now = input.nowMs ?? Date.now()
    const resources = collaborationResources(db, input.projectId)
    const changed: CollaborationResource[] = []
    const patches = new Map<string, string>()
    for (const mutation of mutations) {
      const lease = db.query('SELECT * FROM project_collaboration_leases WHERE project_id = ? AND resource_type = ? AND resource_id = ?')
        .get(input.projectId, mutation.type, mutation.id) as LeaseRow | null
      if (!lease || lease.user_id !== input.userId || lease.device_id !== input.deviceId || lease.session_id !== input.sessionId || lease.token !== mutation.leaseToken || lease.expires_at <= now) {
        throw createError({ statusCode: 423, message: `对象 ${mutation.id} 的编辑权已失效`, data: { type: mutation.type, id: mutation.id } })
      }
      const index = resources.findIndex(item => item.type === mutation.type && item.id === mutation.id)
      const current = resources[index]
      if (current?.deleted || (current?.revision ?? 0) !== mutation.expectedRevision) {
        throw createError({ statusCode: 409, message: `对象 ${mutation.id} 已变化或删除，请核对该对象`, data: { type: mutation.type, id: mutation.id, revision: current?.revision ?? 0, deleted: current?.deleted ?? false } })
      }
      if (mutation.patch !== undefined) {
        try {
          if (!current?.body) throw new Error('字段修改对象不存在')
          mutation.body = applyCollaborationPatch(current.body, mutation.patch)
        } catch (cause) { return invalid(cause) }
      }
      if (mutation.body === null && (!current || mutation.type === 'settings' || mutation.type === 'directory')) return invalid(new Error('不能删除项目设置、目录或不存在的对象'))
      if (mutation.type === 'settings' && current?.body && mutation.body) {
        try {
          const before = collaborationObject(current.body.project, '项目设置')
          const after = collaborationObject(mutation.body.project, '项目设置')
          for (const key of ['id', 'ownerUserId', 'createdAt', 'projectType']) {
            if (canonicalJson(before[key]) !== canonicalJson(after[key])) throw new Error('不能通过项目设置修改项目身份')
          }
          if (canonicalJson(collaborationObject(current.body.script, '剧本设置').id)
            !== canonicalJson(collaborationObject(mutation.body.script, '剧本设置').id)) throw new Error('不能通过项目设置修改剧本身份')
        } catch (cause) { return invalid(cause) }
      }
      const resource: CollaborationResource = { type: mutation.type, id: mutation.id, revision: mutation.expectedRevision + 1, body: mutation.body!, deleted: mutation.body === null }
      if (current?.body && resource.body) {
        const patch = diffCollaborationBody(current.body, resource.body, true)
        const encoded = JSON.stringify(patch)
        if (patch.length && patch.length <= 10000 && encoded.length < JSON.stringify(resource.body).length) patches.set(JSON.stringify([resource.type, resource.id]), encoded)
      }
      if (index < 0) resources.push(resource)
      else resources[index] = resource
      changed.push(resource)
    }
    try { validateCollaborationResources(resources) }
    catch (cause) { return invalid(cause) }
    const snapshot = composeProjectSnapshot(resources)
    const metadata = collaborationObject(snapshot.project, '项目设置')
    for (const key of ['name', 'description', 'scriptParseMode', 'styleId', 'aspectRatio', 'status']) {
      if (metadata[key] != null && typeof metadata[key] !== 'string') return invalid(new Error(`项目字段 ${key} 必须是文本`))
    }
    const projectVersion = (db.query('SELECT updated_at FROM user_projects WHERE id = ?').get(input.projectId) as { updated_at: string }).updated_at
    const timestamp = nextCollaborationTimestamp(now, projectVersion)
    const upsert = db.query(`INSERT INTO project_collaboration_resources (project_id, resource_type, resource_id, revision, body_json, deleted)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, resource_type, resource_id) DO UPDATE SET
      revision = excluded.revision, body_json = excluded.body_json, deleted = excluded.deleted`)
    for (const item of changed) {
      const body = item.body == null ? null : JSON.stringify(item.body)
      upsert.run(input.projectId, item.type, item.id, item.revision, body, Number(item.deleted))
      db.query(`INSERT INTO project_collaboration_changes (project_id, resource_type, resource_id, revision, body_json, deleted, user_id, operation_id, created_at, patch_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.projectId, item.type, item.id, item.revision, body, Number(item.deleted), input.userId, input.operationId, timestamp, patches.get(JSON.stringify([item.type, item.id])) ?? null)
    }
    db.query(`UPDATE user_projects SET local_updated_at = ?, updated_at = ?, last_synced_at = ?,
      name = ?, description = ?, script_parse_mode = ?, style_id = ?, aspect_ratio = ?, status = ?, summary_json = ? WHERE id = ?`)
      .run(timestamp, timestamp, timestamp, metadata.name as string || '未命名项目', metadata.description as string || '',
        metadata.scriptParseMode as string || '', metadata.styleId as string || '', metadata.aspectRatio as string || '',
        metadata.status as string || 'draft', JSON.stringify({ sceneCount: (snapshot.scenes as unknown[]).length, characterCount: (snapshot.characters as unknown[]).length }), input.projectId)
    const result = { cursor: cursor(db, input.projectId), resources: changed }
    db.query('INSERT INTO project_collaboration_operations (project_id, user_id, operation_id, fingerprint, result_json) VALUES (?, ?, ?, ?, ?)')
      .run(input.projectId, input.userId, input.operationId, fingerprint, JSON.stringify(result))
    return result
  }).immediate()
}

export function collaborationChanges(db: Database, projectId: string, after: number, limit = 100, fieldPatches = false) {
  return db.transaction(() => {
    requireCollaboration(db, projectId)
    if (!Number.isSafeInteger(after) || after < 0) return invalid(new Error('增量游标无效'))
    const latestCursor = cursor(db, projectId)
    if (after > latestCursor) throw createError({ statusCode: 409, message: '增量游标已失效，请重新读取项目' })
    const rows = db.query(`SELECT sequence, resource_type, resource_id, revision, deleted, user_id, operation_id, created_at, patch_json,
      CASE WHEN ? = 1 AND patch_json IS NOT NULL THEN NULL ELSE body_json END AS body_json
      FROM project_collaboration_changes WHERE project_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`)
      .all(Number(fieldPatches), projectId, after, Math.min(500, Math.max(1, limit))) as Array<ResourceRow & { sequence: number, user_id: string, operation_id: string, created_at: string, patch_json: string | null }>
    const wireChanges = rows.map(row => {
      const metadata = { type: row.resource_type, id: row.resource_id, revision: row.revision, deleted: !!row.deleted, sequence: row.sequence, userId: row.user_id, operationId: row.operation_id, createdAt: row.created_at }
      if (fieldPatches && row.patch_json) return { ...metadata, baseRevision: row.revision - 1, patch: JSON.parse(row.patch_json) as CollaborationPatch[] }
      return { ...metadata, body: row.body_json == null ? null : JSON.parse(row.body_json) } as CollaborationChange
    })
    const nextCursor = rows.at(-1)?.sequence ?? after
    return { changes: wireChanges, cursor: nextCursor, hasMore: nextCursor < latestCursor }
  })()
}

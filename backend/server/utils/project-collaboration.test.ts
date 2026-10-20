import { updateCollaborationPresence } from './project-collaboration-presence'
import { updateCollaborationWindowPresence } from './project-collaboration-window-presence'
import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { AuthContext } from './auth'
import { handleProjectCollaboration } from './project-collaboration-api'
import { ensureProjectEditLeaseSchema, operateProjectEditLease } from './project-edit-leases'
import {
  collaborationChanges, collaborationResources, collaborationSnapshot, enableProjectCollaboration,
  ensureProjectCollaborationSchema, operateCollaborationLease, projectUsesCollaboration,
  rejectLegacyProjectWrite, writeCollaboration, previewProjectCollaboration
} from './project-collaboration'
import type { CollaborationMutation, CollaborationResourceType } from '../../../shared/types/project-collaboration'

describe('per resource collaboration', () => {
  it('shows online members and editing locations without acquiring leases', () => {
    const { db } = setup()
    const identity = { ownerUserId: 'owner', localProjectId: 'p1', deviceId: 'device-a', sessionId: 'window-a', action: 'changes', after: 0 }
    const response = handleProjectCollaboration(db, auth('alice'), { ...identity, activeScopes: [{ type: 'episode', id: 'e1' }] }) as { participants: Array<{ userId: string, isCurrentWindow: boolean, scopes: unknown[] }> }
    expect(response.participants).toMatchObject([{ userId: 'alice', isCurrentWindow: true, scopes: [{ type: 'episode', id: 'e1' }] }])
    const viewer = handleProjectCollaboration(db, auth('viewer'), { ...identity, sessionId: 'viewer-window', activeScopes: [{ type: 'episode', id: 'e2' }] }) as typeof response
    expect(viewer.participants.find(item => item.userId === 'alice')?.isCurrentWindow).toBe(false)
    expect(viewer.participants.find(item => item.userId === 'viewer')?.scopes).toEqual([])
    expect(db.query('SELECT * FROM project_collaboration_leases').all()).toHaveLength(0)
    expect(JSON.stringify(viewer.participants)).not.toContain('device-a')
    expect(() => handleProjectCollaboration(db, auth('stranger'), identity)).toThrow()
  })

  it('expires disconnected presence and hides removed members', () => {
    const { db } = setup()
    updateCollaborationPresence(db, 'cloud-p1', 'alice', 'd', 'a', [{ type: 'episode', id: 'e1' }], true, 1000)
    const expired = updateCollaborationPresence(db, 'cloud-p1', 'bob', 'd', 'b', [], true, 46_001)
    expect(expired.map(item => item.userId)).toEqual(['bob'])
    db.query("DELETE FROM project_members WHERE user_id = 'bob'").run()
    const removed = updateCollaborationPresence(db, 'cloud-p1', 'owner', 'd', 'o', [], true, 46_002)
    expect(removed.map(item => item.userId)).toEqual(['owner'])
  })

  const databases: Database[] = []
  afterEach(() => databases.splice(0).forEach(db => db.close()))
  function setup(migrate = true) {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    databases.push(db)
    ensureProjectEditLeaseSchema(db)
    ensureProjectCollaborationSchema(db)
    db.exec(`
      CREATE TABLE user_projects (id TEXT PRIMARY KEY, user_id TEXT, local_project_id TEXT, local_updated_at TEXT, deleted_at TEXT, updated_at TEXT, last_synced_at TEXT,
        name TEXT, description TEXT, script_parse_mode TEXT, style_id TEXT, aspect_ratio TEXT, status TEXT, summary_json TEXT);
      CREATE TABLE user_project_snapshots (project_id TEXT, snapshot_json TEXT, created_at TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY, account TEXT, display_name TEXT, status TEXT DEFAULT 'active', role TEXT DEFAULT 'user');
      INSERT INTO users (id, account, display_name) VALUES ('owner','owner','Owner'), ('alice','alice','Alice'), ('bob','bob','Bob'), ('viewer','viewer','Viewer'), ('new','new','New');
      CREATE TABLE project_members (project_id TEXT, user_id TEXT, role TEXT, permissions_json TEXT, created_at TEXT DEFAULT 'v1', updated_at TEXT DEFAULT 'v1', PRIMARY KEY(project_id, user_id));
      INSERT INTO user_projects (id, user_id, local_project_id, local_updated_at, updated_at, last_synced_at)
        VALUES ('cloud-p1', 'owner', 'p1', 'v1', 'v1', 'v1');
      INSERT INTO project_members (project_id, user_id, role, permissions_json) VALUES ('cloud-p1', 'alice', 'editor', NULL), ('cloud-p1', 'bob', 'editor', NULL), ('cloud-p1', 'viewer', 'viewer', NULL);
    `)
    const snapshot = {
      project: { id: 'p1', name: '协作项目' },
      script: { episodePlan: [{ id: 'e1', index: 1, title: '第一集' }, { id: 'e2', index: 2, title: '第二集' }] },
      scenes: [{ id: 's1', episodeId: 'e1', description: '第一集原内容' }, { id: 's2', episodeId: 'e2', description: '第二集原内容' }],
      characters: [{ id: 'c1', name: '公共角色' }]
    }
    db.query('INSERT INTO user_project_snapshots VALUES (?, ?, ?)').run('cloud-p1', JSON.stringify(snapshot), 'v1')
    const lease = operateProjectEditLease(db, { ownerUserId: 'owner', localProjectId: 'p1', userId: 'owner', deviceId: 'device', sessionId: 'window', action: 'acquire', canTakeover: true })
    const migration = { projectId: 'cloud-p1', userId: 'owner', expectedUpdatedAt: 'v1', leaseToken: lease.lease!.token }
    if (migrate) enableProjectCollaboration(db, migration)
    return { db, migration, snapshot }
  }
  function actor(userId = 'alice') {
    return { projectId: 'cloud-p1', userId, deviceId: `device-${userId}`, sessionId: `window-${userId}` }
  }
  function lease(db: Database, id: string, userId = 'alice', type: CollaborationResourceType = 'episode') {
    return operateCollaborationLease(db, { ...actor(userId), type, id, action: 'acquire', canTakeover: userId === 'owner' })
  }
  function mutation(db: Database, id: string, userId = 'alice', label = userId): CollaborationMutation {
    const token = lease(db, id, userId).token!
    const resource = collaborationResources(db, 'cloud-p1').find(item => item.type === 'episode' && item.id === id)!
    const body = structuredClone(resource.body!)
    ;(body.scenes as Array<Record<string, unknown>>)[0]!.description = label
    return { type: 'episode', id, expectedRevision: resource.revision, leaseToken: token, body }
  }
  function auth(userId: string): AuthContext {
    return { user: { id: userId, account: userId, display_name: userId, role: 'user', status: 'active' }, sessionId: 'auth-session', deviceId: 'device' }
  }

  it('authorizes generation against exact episode/settings versions and the scoped lease', () => {
    const { db } = setup()
    const token = lease(db, 'e1').token!
    const request = { action: 'generationCheck', ownerUserId: 'owner', localProjectId: 'p1', deviceId: 'device-alice', sessionId: 'window-alice', type: 'episode', id: 'e1', expectedRevision: 1, settingsRevision: 1, token }
    expect(handleProjectCollaboration(db, auth('alice'), request)).toMatchObject({ episode: { id: 'e1', revision: 1 }, settings: { revision: 1 } })
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...request, settingsRevision: 2 })).toThrow('输入已变化')
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...request, expectedRevision: 2 })).toThrow('输入已变化')
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...request, token: 'wrong' })).toThrow('编辑权')
    expect(() => handleProjectCollaboration(db, auth('viewer'), request)).toThrow()
    db.query("UPDATE project_members SET role = 'custom', permissions_json = '[\"view\",\"edit\"]' WHERE user_id = 'alice'").run()
    expect(() => handleProjectCollaboration(db, auth('alice'), request)).toThrow()
    expect(collaborationChanges(db, 'cloud-p1', 0).changes).toHaveLength(0)
  })

  it('checks public resource leases independently of episode leases', () => {
    const { db } = setup()
    lease(db, 'e1')
    for (const [type, id] of [['character', 'c1'], ['settings', 'settings']] as const) {
      const request = { action: 'generationCheck', ownerUserId: 'owner', localProjectId: 'p1', ...actor(), type, id, expectedRevision: 1, settingsRevision: 1 }
      expect(() => handleProjectCollaboration(db, auth('alice'), request)).toThrow('编辑权')
      const token = lease(db, id, 'alice', type).token!
      expect(handleProjectCollaboration(db, auth('alice'), { ...request, token })).toMatchObject({ resource: { type, id, revision: 1 }, settings: { revision: 1 } })
      expect(() => handleProjectCollaboration(db, auth('alice'), { ...request, token, expectedRevision: 2 })).toThrow('输入已变化')
      expect(() => handleProjectCollaboration(db, auth('viewer'), { ...request, token })).toThrow()
    }
    expect(collaborationChanges(db, 'cloud-p1', 0).changes).toHaveLength(0)
  })

  it('previews migration without writes and fences changes to the reviewed snapshot', () => {
    const { db, migration, snapshot } = setup(false)
    const identity = { ownerUserId: 'owner', localProjectId: 'p1' }
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...identity, action: 'migrationPreview' })).toThrow('所有者')
    const reviewed = previewProjectCollaboration(db, 'cloud-p1', 'v1')
    expect(reviewed).toMatchObject({ episodes: 2, scenes: 2, characters: 1, expectedUpdatedAt: 'v1' })
    expect(projectUsesCollaboration(db, 'cloud-p1')).toBe(false)
    db.query('UPDATE user_project_snapshots SET snapshot_json=?').run(JSON.stringify({ ...snapshot, project: { ...snapshot.project, name: 'changed' } }))
    expect(() => enableProjectCollaboration(db, { ...migration, snapshotHash: reviewed.snapshotHash })).toThrow('快照内容已变化')
    expect(projectUsesCollaboration(db, 'cloud-p1')).toBe(false)
    const next = previewProjectCollaboration(db, 'cloud-p1', 'v1')
    expect(enableProjectCollaboration(db, { ...migration, snapshotHash: next.snapshotHash }).enabled).toBe(true)
    expect(enableProjectCollaboration(db, { ...migration, snapshotHash: next.snapshotHash }).enabled).toBe(true)
  })

  it('migrates once, preserves the original snapshot and disables legacy writes', () => {
    const { db, migration, snapshot } = setup()
    expect(projectUsesCollaboration(db, 'cloud-p1')).toBe(true)
    expect(enableProjectCollaboration(db, migration).resources).toHaveLength(5)
    expect(() => rejectLegacyProjectWrite(db, 'cloud-p1')).toThrow('整项目上传')
    const backup = db.query('SELECT source_snapshot_json FROM project_collaborations').get() as { source_snapshot_json: string }
    expect(JSON.parse(backup.source_snapshot_json)).toEqual(snapshot)
    expect(db.query('SELECT * FROM project_edit_leases').all()).toHaveLength(0)
  })

  it('rolls back migration on an invalid snapshot or a changed cloud version', () => {
    const { db, migration } = setup(false)
    expect(() => enableProjectCollaboration(db, { ...migration, expectedUpdatedAt: 'stale' })).toThrow('版本已变化')
    db.query('UPDATE user_project_snapshots SET snapshot_json = ?').run(JSON.stringify({ project: {}, scenes: [{ id: 's1', episodeId: 'missing' }] }))
    expect(() => enableProjectCollaboration(db, migration)).toThrow('不存在')
    expect(projectUsesCollaboration(db, 'cloud-p1')).toBe(false)
    expect(collaborationResources(db, 'cloud-p1')).toHaveLength(0)
  })

  it('allows two members to save different episodes from the same initial project version', () => {
    const { db } = setup()
    const first = mutation(db, 'e1', 'alice')
    const second = mutation(db, 'e2', 'bob')
    writeCollaboration(db, { ...actor('alice'), operationId: 'op-a', mutations: [first] })
    writeCollaboration(db, { ...actor('bob'), operationId: 'op-b', mutations: [second] })
    const snapshot = collaborationSnapshot(db, 'cloud-p1')
    expect((snapshot.scenes as Array<Record<string, unknown>>).map(item => item.description)).toEqual(['alice', 'bob'])
    expect(snapshot.characters).toEqual([{ id: 'c1', name: '公共角色' }])
  })

  it('rejects a competing editor and fences old tokens and late releases after takeover', () => {
    const { db } = setup()
    const first = mutation(db, 'e1')
    expect(lease(db, 'e1', 'bob').editable).toBe(false)
    const taken = operateCollaborationLease(db, { ...actor('owner'), type: 'episode', id: 'e1', action: 'takeover', canTakeover: true })
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'old', mutations: [first] })).toThrow('编辑权已失效')
    operateCollaborationLease(db, { ...actor(), type: 'episode', id: 'e1', token: first.leaseToken, action: 'release', canTakeover: false })
    expect(operateCollaborationLease(db, { ...actor('owner'), type: 'episode', id: 'e1', token: taken.token, action: 'check', canTakeover: true }).editable).toBe(true)
  })

  it('rejects expired leases, stale object revisions and spoofed devices or windows', () => {
    const { db } = setup()
    const change = mutation(db, 'e1')
    expect(() => writeCollaboration(db, { ...actor(), sessionId: 'other', operationId: 'wrong-window', mutations: [change] })).toThrow('编辑权已失效')
    expect(() => writeCollaboration(db, { ...actor(), deviceId: 'other', operationId: 'wrong-device', mutations: [change] })).toThrow('编辑权已失效')
    expect(() => writeCollaboration(db, { ...actor(), nowMs: Date.now() + 100_000, operationId: 'expired', mutations: [change] })).toThrow('编辑权已失效')
    writeCollaboration(db, { ...actor(), operationId: 'valid', mutations: [change] })
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'stale', mutations: [change] })).toThrow('已变化')
    const independent = mutation(db, 'e2', 'bob')
    expect(writeCollaboration(db, { ...actor('bob'), operationId: 'independent', mutations: [independent] }).resources[0]?.revision).toBe(2)
  })

  it('replays a lost response once, even after the lease expires, and rejects reuse with different content', () => {
    const { db } = setup()
    const change = mutation(db, 'e1')
    const request = { ...actor(), operationId: 'retryable', mutations: [change] }
    const first = writeCollaboration(db, request)
    expect(writeCollaboration(db, { ...request, nowMs: Date.now() + 100_000 })).toEqual(first)
    const reorderedBody = Object.fromEntries(Object.entries(change.body!).reverse())
    expect(writeCollaboration(db, { ...request, mutations: [{ ...change, body: reorderedBody }] })).toEqual(first)
    expect(collaborationChanges(db, 'cloud-p1', 0).changes).toHaveLength(1)
    expect(() => writeCollaboration(db, { ...request, mutations: [{ ...change, body: { ...change.body, extra: true } }] })).toThrow('操作 ID')
  })

  it('atomically deletes an episode with its directory entry and keeps a tombstone', () => {
    const { db } = setup()
    const episode = mutation(db, 'e1')
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'bad-delete', mutations: [{ ...episode, body: null }] })).toThrow('不存在')
    const token = lease(db, 'directory', 'alice', 'directory').token!
    writeCollaboration(db, { ...actor(), operationId: 'delete', mutations: [
      { ...episode, body: null }, { type: 'directory', id: 'directory', expectedRevision: 1, leaseToken: token, body: { episodeIds: ['e2'] } }
    ] })
    expect(collaborationResources(db, 'cloud-p1').find(item => item.id === 'e1')?.deleted).toBe(true)
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'resurrect', mutations: [{ ...episode, expectedRevision: 2 }] })).toThrow('删除')
    const page = collaborationChanges(db, 'cloud-p1', 0, 1)
    expect(page.hasMore).toBe(true)
    expect(page.changes[0]?.deleted).toBe(true)
    expect(collaborationChanges(db, 'cloud-p1', page.cursor).changes[0]?.type).toBe('directory')
  })

  it('rolls back a batch if another episode lease is missing or scene identities collide', () => {
    const { db } = setup()
    const first = mutation(db, 'e1')
    const second = mutation(db, 'e2', 'bob')
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'mixed', mutations: [first, second] })).toThrow('编辑权已失效')
    expect(collaborationResources(db, 'cloud-p1').find(item => item.id === 'e1')?.revision).toBe(1)
    const scenes = first.body!.scenes as Array<Record<string, unknown>>
    scenes[0]!.id = 's2'
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'duplicate-scene', mutations: [first] })).toThrow('重复 ID')
    expect(collaborationChanges(db, 'cloud-p1', 0).changes).toHaveLength(0)
  })

  it('creates an episode only with its directory entry in the same transaction', () => {
    const { db } = setup()
    const episodeToken = lease(db, 'e3').token!
    const create: CollaborationMutation = {
      type: 'episode', id: 'e3', expectedRevision: 0, leaseToken: episodeToken,
      body: { plan: { id: 'e3', index: 3, title: '第三集' }, writing: null, scenes: [] }
    }
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'orphan', mutations: [create] })).toThrow('目录不一致')
    const directoryToken = lease(db, 'directory', 'alice', 'directory').token!
    writeCollaboration(db, { ...actor(), operationId: 'create-episode', mutations: [create, {
      type: 'directory', id: 'directory', expectedRevision: 1, leaseToken: directoryToken, body: { episodeIds: ['e1', 'e2', 'e3'] }
    }] })
    expect(collaborationResources(db, 'cloud-p1').find(item => item.id === 'e3')?.revision).toBe(1)
    expect((collaborationSnapshot(db, 'cloud-p1').script as Record<string, unknown>).episodePlan).toHaveLength(3)
  })

  it('updates public characters independently and prevents changing project identity', () => {
    const { db } = setup()
    const episode = mutation(db, 'e1')
    const characterToken = lease(db, 'c1', 'bob', 'character').token!
    writeCollaboration(db, { ...actor('bob'), operationId: 'character', mutations: [{ type: 'character', id: 'c1', expectedRevision: 1, leaseToken: characterToken, body: { id: 'c1', name: '更新后的公共角色' } }] })
    writeCollaboration(db, { ...actor(), operationId: 'episode', mutations: [episode] })
    expect(collaborationSnapshot(db, 'cloud-p1').characters).toEqual([{ id: 'c1', name: '更新后的公共角色' }])
    const settings = collaborationResources(db, 'cloud-p1').find(item => item.type === 'settings')!
    const settingsToken = lease(db, 'settings', 'alice', 'settings').token!
    const body = structuredClone(settings.body!)
    ;(body.project as Record<string, unknown>).id = 'different-project'
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'identity', mutations: [{ type: 'settings', id: 'settings', expectedRevision: 1, leaseToken: settingsToken, body }] })).toThrow('项目身份')
  })

  it('enforces membership, view-only access, migration ownership and removed members at the request boundary', () => {
    const { db } = setup()
    const identity = { ownerUserId: 'owner', localProjectId: 'p1' }
    expect(() => handleProjectCollaboration(db, auth('stranger'), { ...identity, action: 'read' })).toThrow('Project not found')
    expect(handleProjectCollaboration(db, auth('viewer'), { ...identity, action: 'read' })).toMatchObject({ enabled: true, editable: false })
    expect(() => handleProjectCollaboration(db, auth('viewer'), { ...identity, action: 'lease' })).toThrow('Project not found')
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...identity, action: 'enable' })).toThrow('所有者')
    expect(() => handleProjectCollaboration(db, auth('alice'), {
      ...identity, ...actor(), action: 'lease', type: 'episode', id: 'e1', leaseAction: 'takeover', canTakeover: true
    })).toThrow('所有者')
    const change = mutation(db, 'e1')
    db.query("DELETE FROM project_members WHERE user_id = 'alice'").run()
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...identity, ...actor(), action: 'write', operationId: 'removed', mutations: [change] })).toThrow('Project not found')
    db.query("UPDATE user_projects SET deleted_at = 'deleted'").run()
    expect(() => handleProjectCollaboration(db, auth('owner'), { ...identity, action: 'read' })).toThrow('已删除')
  })

  it('cleans collaboration records only when the project is physically removed', () => {
    const { db } = setup()
    writeCollaboration(db, { ...actor(), operationId: 'saved', mutations: [mutation(db, 'e1')] })
    db.query("UPDATE user_projects SET deleted_at = 'deleted'").run()
    expect(collaborationResources(db, 'cloud-p1')).toHaveLength(5)
    db.query("DELETE FROM user_projects WHERE id = 'cloud-p1'").run()
    expect(projectUsesCollaboration(db, 'cloud-p1')).toBe(false)
    expect(collaborationResources(db, 'cloud-p1')).toHaveLength(0)
    for (const table of ['project_collaboration_changes', 'project_collaboration_operations', 'project_collaboration_leases']) {
      expect(db.query(`SELECT * FROM ${table}`).all()).toHaveLength(0)
    }
  })
  it('manages canonical members without episode leases or snapshot writes', () => {
    const { db } = setup()
    const call = (body: Record<string, unknown>, userId = 'owner') => handleProjectCollaboration(db, auth(userId), { ownerUserId: 'owner', localProjectId: 'p1', ...body })
    const before = JSON.stringify(collaborationResources(db, 'cloud-p1'))
    const result = call({ action: 'memberPut', userId: 'new', role: 'editor', expectedUpdatedAt: null, account: 'spoofed', displayName: 'spoofed' }) as { members: Array<{ userId: string, account: string, updatedAt: string }> }
    const member = result.members.find(member => member.userId === 'new')!
    expect(member.account).toBe('new')
    expect(JSON.stringify(collaborationResources(db, 'cloud-p1'))).toBe(before)
    expect(() => call({ action: 'memberPut', userId: 'new', role: 'viewer', expectedUpdatedAt: null })).toThrow('已变化')
    call({ action: 'memberPut', userId: 'new', role: 'editor', expectedUpdatedAt: null }) // Lost response retry.
    call({ action: 'memberRemove', userId: 'new', expectedUpdatedAt: member.updatedAt })
    call({ action: 'memberRemove', userId: 'new', expectedUpdatedAt: member.updatedAt })
    expect(db.query("SELECT * FROM project_members WHERE user_id = 'new'").get()).toBeNull()
  })

  it('fences downgraded members and prevents permission escalation by a manager', () => {
    const { db } = setup()
    const writing = mutation(db, 'e1', 'alice')
    const call = (body: Record<string, unknown>, userId = 'owner') => handleProjectCollaboration(db, auth(userId), { ownerUserId: 'owner', localProjectId: 'p1', ...body })
    expect(call({ action: 'changes', after: 0 }, 'alice')).toHaveProperty('editable', true)
    call({ action: 'memberPut', userId: 'alice', role: 'viewer', expectedUpdatedAt: 'v1' })
    expect(call({ action: 'changes', after: 0 }, 'alice')).toHaveProperty('editable', false)
    expect(() => handleProjectCollaboration(db, auth('alice'), { action: 'write', ownerUserId: 'owner', localProjectId: 'p1', deviceId: 'device-alice', sessionId: 'window-alice', operationId: 'late', mutations: [writing] })).toThrow()
    expect(db.query("SELECT * FROM project_collaboration_leases WHERE user_id = 'alice'").all()).toHaveLength(0)
    call({ action: 'memberPut', userId: 'bob', role: 'manager', expectedUpdatedAt: 'v1' })
    expect(() => call({ action: 'memberPut', userId: 'new', role: 'custom', permissions: ['delete'], expectedUpdatedAt: null }, 'bob')).toThrow('自身范围')
    call({ action: 'memberPut', userId: 'new', role: 'viewer', expectedUpdatedAt: null }, 'bob')
    expect(() => call({ action: 'memberRemove', userId: 'bob' }, 'bob')).toThrow('自己')
    expect(() => call({ action: 'memberPut', userId: 'owner', role: 'viewer', expectedUpdatedAt: null })).toThrow('所有者')
    expect(() => call({ action: 'memberPut', userId: 'new', role: 'editor', expectedUpdatedAt: null }, 'viewer')).toThrow()
  })

  it('deletes collaboration projects idempotently and blocks late edits while retaining backups', () => {
    const { db } = setup()
    const writing = mutation(db, 'e1')
    const body = { ownerUserId: 'owner', localProjectId: 'p1', action: 'delete' }
    expect(() => handleProjectCollaboration(db, auth('alice'), body)).toThrow()
    const deleted = handleProjectCollaboration(db, auth('owner'), body)
    expect(handleProjectCollaboration(db, auth('owner'), body)).toEqual(deleted)
    expect(db.query('SELECT * FROM project_collaboration_leases').all()).toHaveLength(0)
    expect(db.query('SELECT source_snapshot_json FROM project_collaborations').get()).toBeTruthy()
    expect(() => handleProjectCollaboration(db, auth('alice'), { ...body, action: 'read' })).toThrow('已删除')
    expect(() => writeCollaboration(db, { ...actor(), operationId: 'late', mutations: [writing] })).toThrow()
  })

  it('supports a member manager without edit permission and rejects disabled targets', () => {
    const { db } = setup()
    const call = (body: Record<string, unknown>, userId = 'owner') => handleProjectCollaboration(db, auth(userId), { ownerUserId: 'owner', localProjectId: 'p1', ...body })
    call({ action: 'memberPut', userId: 'bob', role: 'custom', permissions: ['manage_members'], expectedUpdatedAt: 'v1' })
    call({ action: 'memberPut', userId: 'new', role: 'viewer', expectedUpdatedAt: null }, 'bob')
    expect(() => call({ action: 'lease', type: 'episode', id: 'e1', leaseAction: 'acquire' }, 'bob')).toThrow()
    db.query("UPDATE users SET status = 'disabled' WHERE id = 'alice'").run()
    expect(() => call({ action: 'memberPut', userId: 'alice', role: 'viewer', expectedUpdatedAt: 'v1' })).toThrow('停用')
  })

  it('keeps the project sync timestamp increasing across membership and resource commits', () => {
    const { db } = setup()
    const future = new Date(Date.now() + 60000).toISOString()
    db.query('UPDATE user_projects SET updated_at = ?').run(future)
    handleProjectCollaboration(db, auth('owner'), { ownerUserId: 'owner', localProjectId: 'p1', action: 'memberPut', userId: 'new', role: 'viewer', expectedUpdatedAt: null })
    const memberVersion = (db.query('SELECT updated_at FROM user_projects').get() as { updated_at: string }).updated_at
    expect(memberVersion > future).toBe(true)
    writeCollaboration(db, { ...actor(), operationId: 'after-member', mutations: [mutation(db, 'e1')] })
    const resourceVersion = (db.query('SELECT updated_at FROM user_projects').get() as { updated_at: string }).updated_at
    expect(resourceVersion > memberVersion).toBe(true)
  })

  it('reports online members, draft activity and exclusive leases without exposing tokens', () => {
    const { db } = setup()
    const call = (user: string, body: Record<string, unknown> = {}) => handleProjectCollaboration(db, auth(user), {
      ownerUserId: 'owner', localProjectId: 'p1', ...actor(user), action: 'presence', ...body
    }) as { collaborators: Array<{ userId: string, displayName: string, self: boolean, editing: unknown[], locked: unknown[] }> }
    lease(db, 'e1', 'alice')
    const alice = call('alice', { userId: 'owner', displayName: 'spoofed', editing: [{ type: 'episode', id: 'e1' }] })
    expect(alice.collaborators[0]).toMatchObject({ userId: 'alice', displayName: 'Alice', self: true, editing: [{ type: 'episode', id: 'e1' }], locked: [{ type: 'episode', id: 'e1' }] })
    const bob = call('bob')
    expect(bob.collaborators).toHaveLength(2)
    expect(bob.collaborators.find(item => item.userId === 'alice')?.self).toBe(false)
    expect(JSON.stringify(bob)).not.toContain('token')
    expect(call('viewer', { editing: [{ type: 'episode', id: 'e1' }] }).collaborators.find(item => item.userId === 'viewer')?.editing).toEqual([])
    call('alice', { leaving: true })
    expect(call('bob').collaborators.some(item => item.userId === 'alice')).toBe(false)
    expect(() => call('stranger')).toThrow('Project not found')
  })

  it('expires disconnected presence and immediately removes revoked member activity', () => {
    const { db } = setup()
    const presence = (userId: string, nowMs: number) => updateCollaborationWindowPresence(db, {
      projectId: 'cloud-p1', ownerId: 'owner', userId, deviceId: userId, sessionId: userId,
      editable: true, editing: [{ type: 'episode', id: 'e1' }], nowMs, resources: collaborationResources(db, 'cloud-p1')
    })
    presence('alice', 1)
    expect(presence('bob', 35_002).collaborators.map(item => item.userId)).toEqual(['bob'])
    presence('alice', Date.now())
    handleProjectCollaboration(db, auth('owner'), { ownerUserId: 'owner', localProjectId: 'p1', action: 'memberRemove', userId: 'alice', expectedUpdatedAt: 'v1' })
    expect(presence('bob', Date.now()).collaborators.some(item => item.userId === 'alice')).toBe(false)
  })

})

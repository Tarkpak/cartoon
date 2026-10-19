// Isolated integration rehearsal: real HTTP handlers, authentication, SQLite and client state.
// bun backend/scripts/check-project-collaboration-http.ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { getDb } from '../server/utils/db'
import { hashToken } from '../server/utils/crypto'
import { rehearseLocalBackends } from './project-collaboration-local-rehearsal'
import { ProjectCollaborationClient } from '../../app/lib/project-collaboration-client'

if (process.argv.includes('--serve')) {
  assert(process.env.PLAYLET_ADMIN_DATA_DIR?.includes('collaboration-http-qa-'), 'requires an isolated temporary database')
  Object.assign(globalThis, { defineEventHandler })
  const db = getDb()
  if (!db.query("SELECT id FROM users WHERE id='owner'").get()) {
    const now = new Date().toISOString()
    for (const id of ['owner', 'alice', 'bob', 'viewer']) {
      db.query('INSERT INTO users (id,account,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, id, id, 'no-password-login', now, now)
      db.query('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').run(id, id, hashToken(`qa-${id}`), '9999-12-31', now, now)
    }
    db.query('INSERT INTO user_projects (id,user_id,local_project_id,name,local_updated_at,last_synced_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('cloud', 'owner', 'p', 'HTTP rehearsal', 'v1', now, now, now)
    const snapshot = { project: { id: 'p', name: 'HTTP rehearsal' }, script: { episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }] }, scenes: [{ id: 's1', episodeId: 'a', description: 'A', videoUrl: 'https://shared.example/keep.mp4' }, { id: 's2', episodeId: 'b', description: 'B' }], characters: [{ id: 'c', name: 'keep' }] }
    db.query('INSERT INTO user_project_snapshots (id,user_id,project_id,snapshot_json,created_at) VALUES (?,?,?,?,?)').run('source', 'owner', 'cloud', JSON.stringify(snapshot), now)
    for (const id of ['alice', 'bob', 'viewer']) db.query('INSERT INTO project_members (project_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)').run('cloud', id, id === 'viewer' ? 'viewer' : 'editor', now, now)
  }
  const router = createRouter()
  router.post('/api/client/project-collaboration', (await import('../server/api/client/project-collaboration.post')).default)
  router.post('/api/client/projects/edit-session', (await import('../server/api/client/projects/edit-session.post')).default)
  router.post('/api/client/projects/sync', (await import('../server/api/client/projects/sync.post')).default)
  const server = createServer(toNodeListener(createApp().use(router)))
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: (server.address() as { port: number }).port })))
} else {
  const directory = mkdtempSync(join(tmpdir(), 'collaboration-http-qa-'))
  let child: ReturnType<typeof Bun.spawn> | undefined
  let base = ''
  async function start() {
    child = Bun.spawn([process.execPath, import.meta.path, '--serve'], { cwd: directory, env: { PATH: process.env.PATH, PLAYLET_ADMIN_DATA_DIR: directory }, stdout: 'pipe', stderr: 'pipe' })
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader()
    const first = await reader.read()
    if (first.done) throw new Error(await new Response(child.stderr as ReadableStream).text())
    base = `http://127.0.0.1:${JSON.parse(new TextDecoder().decode(first.value).trim()).port}`
    reader.releaseLock()
  }
  async function stop() { child?.kill(); await child?.exited; child = undefined }
  async function post(user: string, body: Record<string, unknown>, path = '/api/client/project-collaboration') {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer qa-${user}`, 'content-type': 'application/json' }, body: JSON.stringify({ ownerUserId: 'owner', localProjectId: 'p', deviceId: `device-${user}`, sessionId: `window-${user}`, ...body }), signal: AbortSignal.timeout(10_000) })
    const payload = await response.json() as { data: any, message?: string }
    if (!response.ok) throw Object.assign(new Error(payload.message || response.statusText), { statusCode: response.status })
    return payload.data
  }
  function device(user: string) {
    const tokens = new Map<string, string>()
    let dropResponse = false
    const request = async (body: Record<string, unknown>) => {
      const mutations = body.mutations as Array<Record<string, unknown>> | undefined
      const data = await post(user, { ...body, token: tokens.get(String(body.id)), ...(mutations ? { mutations: mutations.map(item => ({ ...item, leaseToken: tokens.get(String(item.id)) })) } : {}) })
      if (body.action === 'lease' && data.token) tokens.set(String(body.id), data.token)
      if (body.action === 'write' && dropResponse) { dropResponse = false; throw new Error('simulated lost response after real server commit') }
      return data
    }
    return { client: new ProjectCollaborationClient(request), acquire: (id: string) => request({ action: 'lease', leaseAction: 'acquire', type: 'episode', id }), loseNextResponse: () => { dropResponse = true } }
  }
  try {
    await start()
    if (process.argv.includes('--local')) {
      await rehearseLocalBackends(base, directory)
    } else {
    await assert.rejects(post('unknown', { action: 'read' }), { statusCode: 401 })
    const preview = await post('owner', { action: 'migrationPreview', expectedUpdatedAt: 'v1' })
    assert.equal(preview.episodes, 2)
    assert.equal((await post('alice', { action: 'read' })).enabled, false)
    await assert.rejects(post('alice', { action: 'migrationPreview' }), { statusCode: 403 })
    const legacy = await post('owner', { action: 'acquire' }, '/api/client/projects/edit-session')
    const migration = { action: 'enable', expectedUpdatedAt: preview.expectedUpdatedAt, snapshotHash: preview.snapshotHash, leaseToken: legacy.token }
    assert.equal((await post('owner', migration)).enabled, true)
    assert.equal((await post('owner', migration)).enabled, true)
    assert.equal((await post('owner', { action: 'acquire' }, '/api/client/projects/edit-session')).collaboration, true)
    await assert.rejects(post('owner', { projects: [{ localProjectId: 'p', name: 'must not replace', baseUpdatedAt: 'v1', snapshot: {} }] }, '/api/client/projects/sync'), { statusCode: 409 })
    await assert.rejects(post('viewer', { action: 'lease', leaseAction: 'acquire', type: 'episode', id: 'a' }), (error: any) => [403, 404].includes(error.statusCode))
    const alice = device('alice')
    const bob = device('bob')
    await Promise.all([alice.client.load(), bob.client.load()])
    assert.equal((await alice.acquire('a')).editable, true)
    assert.equal((await bob.acquire('b')).editable, true)
    assert.equal((await bob.acquire('a')).editable, false)
    for (const [member, id, description] of [[alice, 'a', 'Alice'], [bob, 'b', 'Bob']] as const) {
      const body = structuredClone(member.client.get('episode', id)!.body!)
      ;(body.scenes as Record<string, unknown>[])[0]!.description = description
      member.client.edit('episode', id, body)
    }
    await Promise.all([alice.client.save([{ type: 'episode', id: 'a' }]), bob.client.save([{ type: 'episode', id: 'b' }])])
    await Promise.all([alice.client.poll(), bob.client.poll()])
    assert.equal((alice.client.get('episode', 'b')!.body!.scenes as any[])[0].description, 'Bob')
    assert.equal((bob.client.get('episode', 'a')!.body!.scenes as any[])[0].description, 'Alice')
    assert.equal((alice.client.get('episode', 'a')!.body!.scenes as any[])[0].videoUrl, 'https://shared.example/keep.mp4')
    const body = structuredClone(alice.client.get('episode', 'a')!.body!)
    ;(body.scenes as any[])[0].description = 'lost response'
    alice.client.edit('episode', 'a', body)
    alice.loseNextResponse()
    await assert.rejects(alice.client.save([{ type: 'episode', id: 'a' }]), /lost response/)
    const pending = alice.client.backup().pending!
    await post('owner', { action: 'lease', leaseAction: 'takeover', type: 'episode', id: 'a' })
    await alice.client.retrySave() // Receipt confirmation must work even after losing the lease.
    assert.equal(alice.client.hasPendingSave, false)
    const offlineBody = structuredClone(bob.client.get('episode', 'b')!.body!)
    ;(offlineBody.scenes as any[])[0].description = 'queued while disconnected'
    bob.client.edit('episode', 'b', offlineBody)
    bob.client.prepareSave([{ type: 'episode', id: 'b' }])
    const offlineOperation = bob.client.backup().pending!.operationId
    await stop()
    await assert.rejects(bob.client.retrySave()) // Actual refused connection, not an intercepted request.
    assert.equal(bob.client.backup().pending!.operationId, offlineOperation)
    await start() // Same on-disk SQLite database; no mocks or re-seeding.
    await bob.client.retrySave()
    assert.equal(bob.client.hasPendingSave, false)
    const afterRestart = await post('bob', { action: 'read' })
    assert.equal(afterRestart.resources.find((item: any) => item.id === 'a').revision, 3)
    assert.equal(afterRestart.resources.find((item: any) => item.id === 'a').body.scenes[0].description, 'lost response')
    await post('alice', { action: 'write', ...pending, mutations: pending.mutations.map(item => ({ ...item, leaseToken: 'expired-token' })) })
    const { Database } = await import('bun:sqlite')
    const audit = new Database(join(directory, 'playlet-admin.db'), { readonly: true })
    const original = audit.query('SELECT source_snapshot_json FROM project_collaborations WHERE project_id=?').get('cloud') as { source_snapshot_json: string }
    assert.equal(JSON.parse(original.source_snapshot_json).scenes[0].description, 'A')
    assert.equal((audit.query('SELECT COUNT(*) AS count FROM project_collaboration_operations WHERE project_id=?').get('cloud') as { count: number }).count, 4)
    audit.close()
    console.log(JSON.stringify({ passed: true, transport: 'real HTTP', database: 'isolated on-disk SQLite', checks: ['authentication', 'owner-only migration preview', 'reviewed migration and idempotent retry', 'legacy lock disabled', 'two accounts concurrently save different episodes', 'same episode lease excludes other device', 'both clients receive incremental updates', 'media preserved', 'lost response replay after takeover', 'service restart preserves resources and original backup', 'exact operation replay after restart', 'queued save survives actual service disconnect and reconnect'] }, null, 2))
    }
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }) }
}

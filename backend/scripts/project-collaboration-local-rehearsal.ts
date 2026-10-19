import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { Database } from 'bun:sqlite'
import { ProjectCollaborationClient } from '../../app/lib/project-collaboration-client'

export async function rehearseLocalBackends(cloudUrl: string, directory: string) {
  const binary = resolve(import.meta.dir, '../../src-tauri/target/debug/playlet-backend')
  assert(existsSync(binary), 'Run cargo build --manifest-path src-tauri/Cargo.toml --bin playlet-backend first')
  const processes: ReturnType<typeof Bun.spawn>[] = []
  async function freePort() {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))
    return port
  }
  async function startDevice(user: string) {
    const dir = join(directory, `local-${user}`)
    mkdirSync(dir)
    const target = join(dir, 'playlet.db')
    const seed = new Database(target)
    seed.exec('CREATE TABLE system_config (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)')
    for (const [key, value] of [['cloud_admin_config', { baseUrl: cloudUrl }], ['cloud_admin_session', { token: `qa-${user}`, user: { id: user, account: user, displayName: user, role: 'user' } }]] as const) seed.query('INSERT INTO system_config VALUES (?,?,?)').run(key, JSON.stringify(value), new Date().toISOString())
    seed.close()
    const port = await freePort()
    const log = join(dir, 'backend.log')
    const env = { PATH: process.env.PATH, PLAYLET_BACKEND_HOST: '127.0.0.1', PLAYLET_BACKEND_PORT: String(port), PLAYLET_DATA_DIR: dir, PLAYLET_DB_PATH: target, PLAYLET_PUBLIC_DIR: join(dir, 'public'), PLAYLET_WEB_DIR: dir }
    const spawn = () => {
      const process = Bun.spawn([binary], { cwd: dir, env, stdout: Bun.file(log), stderr: Bun.file(join(dir, 'backend-error.log')) })
      processes.push(process)
      return process
    }
    let localProcess = spawn()
    const url = `http://127.0.0.1:${port}`
    async function ready() {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (localProcess.exitCode !== null) throw new Error(readFileSync(join(dir, 'backend-error.log'), 'utf8'))
        try { if ((await fetch(`${url}/api/project/list`, { signal: AbortSignal.timeout(500) })).ok) return } catch { /* Wait for schema initialization. */ }
        await Bun.sleep(100)
      }
      throw new Error('Local backend failed to become ready')
    }
    await ready()
    const db = new Database(target)
    db.exec('PRAGMA busy_timeout=5000')
    db.query("INSERT INTO projects (id,name,style_id,created_at,updated_at,owner_user_id,cloud_sync_status,cloud_base_updated_at) VALUES ('p','HTTP rehearsal','','v1','v1','owner','synced','v1')").run()
    db.query("INSERT INTO scripts (id,project_id,raw_text,created_at,updated_at) VALUES ('script','p',?,'v1','v1')").run(JSON.stringify({ episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }] }))
    for (const [index, id] of ['a', 'b'].entries()) db.query('INSERT INTO scenes (id,script_id,order_index,episode_id,description,video_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(`s${index + 1}`, 'script', index, id, id.toUpperCase(), index === 0 ? 'https://shared.example/keep.mp4' : null, 'v1', 'v1')
    db.query("INSERT INTO characters (id,project_id,name,appearance,created_at,updated_at) VALUES ('c','p','keep','','v1','v1')").run()
    if (user !== 'owner') db.query("INSERT INTO project_members (project_id,user_id,role,created_at,updated_at) VALUES ('p',?,?,'v1','v1')").run(user, user === 'viewer' ? 'viewer' : 'editor')
    db.close()
    let session = `window-${user}`
    let discardReply = false
    const request = async (body: Record<string, unknown>, suffix = '') => {
      const response = await fetch(`${url}/api/project/p/collaboration${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-project-edit-session': session }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
      const payload = await response.json() as { data: any, message?: string }
      if (!response.ok) throw Object.assign(new Error(payload.message || JSON.stringify(payload)), { statusCode: response.status })
      if (body.action === 'write' && discardReply) { discardReply = false; throw new Error('lost local response') }
      return payload.data
    }
    return { dir, target, request, prepare: () => request({}, '/prepare'), client: new ProjectCollaborationClient(request),
      acquire: (id: string) => request({ action: 'lease', leaseAction: 'acquire', type: 'episode', id }),
      newWindow: () => { session = `reloaded-${user}` }, loseNextResponse: () => { discardReply = true },
      restart: async () => { localProcess.kill(); await localProcess.exited; localProcess = spawn(); await ready() } }
  }
  try {
    const owner = await startDevice('owner')
    const alice = await startDevice('alice')
    const bob = await startDevice('bob')
    const viewer = await startDevice('viewer')
    await assert.rejects(alice.prepare(), { statusCode: 403 })
    const pending = new Database(owner.target)
    pending.query("UPDATE projects SET cloud_sync_status = 'conflict' WHERE id = 'p'").run()
    await assert.rejects(owner.prepare(), { statusCode: 409 })
    pending.query("UPDATE projects SET cloud_sync_status = 'synced' WHERE id = 'p'").run()
    pending.close()
    assert.equal((await owner.prepare()).enabled, true)
    assert.equal((await owner.prepare()).enabled, true)
    assert.equal((await viewer.prepare()).enabled, true)
    await assert.rejects(viewer.acquire('a'), (cause: any) => [403, 404].includes(cause.statusCode))
    assert.equal(readdirSync(join(owner.dir, 'project-collaboration-backups')).length, 1)
    const backup = JSON.parse(readFileSync(join(owner.dir, 'project-collaboration-backups', readdirSync(join(owner.dir, 'project-collaboration-backups'))[0]!), 'utf8'))
    assert.equal(backup.snapshot.data.project.id, 'p')
    await Promise.all([alice.client.load(), bob.client.load()])
    assert.equal((await alice.acquire('a')).editable, true)
    assert.equal((await bob.acquire('b')).editable, true)
    assert.equal((await bob.acquire('a')).editable, false)
    for (const [device, id, description] of [[alice, 'a', 'Alice local backend'], [bob, 'b', 'Bob local backend']] as const) {
      const body = structuredClone(device.client.get('episode', id)!.body!)
      ;(body.scenes as any[])[0].description = description
      device.client.edit('episode', id, body)
    }
    await Promise.all([alice.client.save([{ type: 'episode', id: 'a' }]), bob.client.save([{ type: 'episode', id: 'b' }])])
    await Promise.all([alice.client.poll(), bob.client.poll()])
    assert.equal((alice.client.get('episode', 'b')!.body!.scenes as any[])[0].description, 'Bob local backend')
    assert.equal((bob.client.get('episode', 'a')!.body!.scenes as any[])[0].description, 'Alice local backend')
    const body = structuredClone(alice.client.get('episode', 'a')!.body!)
    ;(body.scenes as any[])[0].description = 'committed before local response loss'
    alice.client.edit('episode', 'a', body)
    alice.loseNextResponse()
    await assert.rejects(alice.client.save([{ type: 'episode', id: 'a' }]), /lost local response/)
    const operation = alice.client.backup().pending!.operationId
    await owner.request({ action: 'lease', leaseAction: 'takeover', type: 'episode', id: 'a' })
    alice.newWindow() // No lease in the new window; the persisted original request must confirm the receipt.
    await alice.restart()
    assert.equal((await alice.acquire('a')).editable, false)
    await alice.client.retrySave()
    assert.equal(alice.client.hasPendingSave, false)
    const offline = structuredClone(bob.client.get('episode', 'b')!.body!)
    ;(offline.scenes as any[])[0].description = 'resumed with renewed window lease'
    bob.client.edit('episode', 'b', offline)
    const config = new Database(bob.target)
    const closedPort = await freePort()
    config.query("UPDATE system_config SET value=? WHERE key='cloud_admin_config'").run(JSON.stringify({ baseUrl: `http://127.0.0.1:${closedPort}` }))
    await assert.rejects(bob.client.save([{ type: 'episode', id: 'b' }]))
    const queued = bob.client.backup().pending!.operationId
    config.query("UPDATE system_config SET value=? WHERE key='cloud_admin_config'").run(JSON.stringify({ baseUrl: cloudUrl }))
    config.close()
    await owner.request({ action: 'lease', leaseAction: 'takeover', type: 'episode', id: 'b' })
    await owner.request({ action: 'lease', leaseAction: 'release', type: 'episode', id: 'b' })
    bob.newWindow()
    await bob.restart()
    assert.equal((await bob.acquire('b')).editable, true)
    assert.equal(bob.client.backup().pending!.operationId, queued)
    await bob.client.retrySave()
    assert.equal(bob.client.hasPendingSave, false)
    assert.equal((await bob.request({ action: 'read' })).resources.find((resource: any) => resource.id === 'b').body.scenes[0].description, 'resumed with renewed window lease')
    const local = new Database(alice.target)
    assert(local.query('SELECT key FROM system_config WHERE key=?').get(`project_collaboration_operation:${JSON.stringify(['alice', 'p', operation])}`))
    assert.equal((local.query("SELECT video_url FROM scenes WHERE id='s1'").get() as { video_url: string }).video_url, 'https://shared.example/keep.mp4')
    local.close()
    console.log(JSON.stringify({ passed: true, transport: 'three independent Rust backend processes → real cloud HTTP → isolated SQLite', checks: ['Rust migration preflight', 'owner migration creates real local backup', 'two member devices independently acquire and save episodes', 'incremental updates cross local backends', 'same episode exclusion', 'local outbox survives process restart and new window', 'receipt confirmation succeeds after owner takeover without a new lease', 'uncommitted offline operation resumes with a renewed lease after process restart', 'legacy local media unchanged'] }, null, 2))
  } finally { for (const process of processes) if (process.exitCode === null) process.kill(); await Promise.all(processes.map(process => process.exited)) }
}

// Bun integration test: real HTTP handlers and auth, isolated temporary database.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createApp, createRouter, defineEventHandler, toWebHandler } from '../backend/node_modules/h3/dist/index.mjs'

const data = await mkdtemp(join(tmpdir(), 'playlet-skill-log-api-'))
process.env.PLAYLET_ADMIN_DATA_DIR = data
globalThis.defineEventHandler = defineEventHandler
const { getDb } = await import('../backend/server/utils/db.ts')
const db = getDb()
const now = new Date().toISOString()
for (const [id, role] of [['admin', 'admin'], ['member', 'user']]) {
  db.prepare('INSERT INTO users (id,account,password_hash,display_name,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,id,'unused',id,role,'active',now,now)
  db.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').run(id,id,createHash('sha256').update(`fixture-${id}`).digest('hex'),'9999-01-01',now,now)
}
const router = createRouter()
for (const [method, path, source] of [
  ['post', '/api/client/skill-runs', '../backend/server/api/client/skill-runs.post.ts'],
  ['get', '/api/admin/skill-runs', '../backend/server/api/admin/skill-runs.get.ts'],
  ['post', '/api/client/model-call-logs', '../backend/server/api/client/model-call-logs.post.ts'],
  ['get', '/api/admin/model-call-logs', '../backend/server/api/admin/model-call-logs/index.get.ts'],
  ['get', '/api/client/model-call-logs', '../backend/server/api/client/model-call-logs.get.ts'],
]) router[method](path, (await import(source)).default)
const app = createApp().use(router)
const server = Bun.serve({ port: 0, fetch: toWebHandler(app) })
async function request(path, user = 'admin', body) {
  return fetch(`http://127.0.0.1:${server.port}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(user ? { Authorization: `Bearer fixture-${user}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
}
async function ok(path, user, body) {
  const r = await request(path,user,body)
  const json = await r.json()
  assert.equal(r.status,200,JSON.stringify(json))
  return json.data
}
try {
  const run = { id: 'run-1', projectId: 'p', projectName: '1105', stage: 'scene_detail', skills: [{id:'writer',name:'human-writing',version:'v1'}], createdAt: now, status: 'running' }
  assert.equal((await request('/api/admin/skill-runs','')).status,401)
  assert.equal((await request('/api/admin/skill-runs','member')).status,403)
  await ok('/api/client/skill-runs','member',{...run,userId:'admin'})
  await ok('/api/client/skill-runs','member',{...run,status:'succeeded',durationMs:1200,result:{message:'done'}})
  await ok('/api/client/skill-runs','member',run)
  let records = await ok('/api/admin/skill-runs?skill=human&userId=member','admin')
  assert.equal(records.runs.length,1)
  assert.equal(records.runs[0].status,'succeeded')
  assert.equal(records.runs[0].user_id,'member')
  assert.equal(records.runs[0].modelCallCount,0)
  const context = {runId:run.id,stage:run.stage,skills:run.skills,batchStart:1,batchEnd:3,attempt:2}
  const log = {eventId:'event-1',projectId:'p',provider:'openai',modelId:'fixture',operation:'generateText',status:'error',errorMessage:'fixture',skillContext:context,request:{prompt:'fixture'},createdAt:now}
  await ok('/api/client/model-call-logs','member',log)
  await ok('/api/client/model-call-logs','member',log)
  const {skillContext, ...legacy} = log
  await ok('/api/client/model-call-logs','member',legacy)
  const calls = await ok('/api/admin/model-call-logs?skill=human&skillRunId=run-1&userId=member','admin')
  assert.equal(calls.logs.length,1)
  assert.deepEqual(JSON.parse(calls.logs[0].skill_context_json),context)
  records = await ok('/api/admin/skill-runs?runId=run-1&userId=member','admin')
  assert.equal(records.runs[0].modelCallCount,1)
  const pulled = await ok('/api/client/model-call-logs','admin')
  assert.deepEqual(JSON.parse(pulled.modelCallLogs[0].skill_context_json),context)
  const empty = await ok('/api/admin/model-call-logs?skill=missing','admin')
  assert.equal(empty.logs.length,0)
  assert.equal((await request('/api/client/skill-runs','member',{...run,status:'invalid'})).status,400)
  console.log('PASS: skill run sync, auth/owner isolation, out-of-order updates, idempotent model logs, filters, linked call counts and metadata round-trip')
} finally { server.stop(true); db.close(); await rm(data,{recursive:true,force:true}) }

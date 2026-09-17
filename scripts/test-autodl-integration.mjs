import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Uses a separate database and synthetic credentials; never contacts AutoDL.
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'playlet-autodl-'))
let backend
const jobs = new Map()
const requests = []
let mockBase
const mock = createServer(async (req, res) => {
  if (req.url === '/video.mp4') {
    res.setHeader('content-type', 'video/mp4')
    res.end(await readFile(join(dir, 'video.mp4')))
    return
  }
  assert.equal(req.headers.authorization, 'autodl-test-token')
  res.setHeader('content-type', 'application/json')
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push({ path: req.url, body })
    const id = `job-${requests.length}`
    jobs.set(id, body)
    res.end(JSON.stringify({ code: 'Success', data: { task_id: id, status: 'QUEUED' } }))
  } else {
    const body = jobs.get(req.url.split('/').at(-1))
    res.end(JSON.stringify({ code: 'Success', data: body.prompt === 'failure'
      ? { status: 'FAILED', message: 'mock generation failed' }
      : { status: body.prompt === 'uppercase' ? 'SUCCESS' : 'completed', results: [{ type: 'video', url: `${mockBase}/video.mp4` }] } }))
  }
})

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

try {
  const generated = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'video.mp4')])
  assert.equal(generated.status, 0, 'ffmpeg fixture generation failed')
  mockBase = `http://127.0.0.1:${await listen(mock)}`
  const portProbe = createServer()
  const port = await listen(portProbe)
  await new Promise(resolve => portProbe.close(resolve))
  backend = spawn(join(root, 'src-tauri/target/debug/playlet-backend'), [], {
    cwd: dir,
    env: { ...process.env, PLAYLET_BACKEND_PORT: String(port), PLAYLET_DATA_DIR: dir, PLAYLET_DB_PATH: join(dir, 'test.db'), PLAYLET_PUBLIC_DIR: join(dir, 'public') },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let backendErrors = ''
  backend.stderr.on('data', chunk => { backendErrors += chunk })
  const base = `http://127.0.0.1:${port}`
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const value = await response.json()
    assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`)
    return value
  }
  let ready = false
  for (let i = 0; i < 60; i++) {
    assert.equal(backend.exitCode, null, backendErrors)
    try { await api('/api/model-providers'); ready = true; break } catch { await delay(200) }
  }
  assert.ok(ready, 'isolated backend failed to start')
  const credentials = await api('/api/model-providers/autodl/credentials', 'PUT', { apiKey: 'autodl-test-token', baseUrl: mockBase })
  assert.equal(credentials.data.autodl.hasApiKey, true)
  assert.ok(!JSON.stringify(credentials).includes('autodl-test-token'))
  const models = ['minimax_h3_zm_u24', 'minimax_h3_zm_u08', 'minimax_h3_lightx2v_no_pic', 'minimax_h3_lightx2v']
  await api('/api/model-providers/autodl/models', 'PUT', { models })
  for (const [index, modelId] of models.entries()) {
    const input = { provider: 'autodl', modelType: 'video', modelId, prompt: index === 0 ? 'uppercase' : 'test', duration: 1, resolution: '768p', aspectRatio: '9:16' }
    if (index < 2) Object.assign(input, { referenceImages: [`${mockBase}/image.png`], audioReferences: [`${mockBase}/audio.mp3`] })
    if (index === 3) Object.assign(input, { firstFrame: `${mockBase}/first.png`, lastFrame: `${mockBase}/last.png` })
    const submitted = await api('/api/models/test', 'POST', input)
    const taskId = submitted.data?.result?.taskId
    assert.ok(taskId, JSON.stringify(submitted))
    let result
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await api(`/api/video/status/${taskId}`)
      const task = result.task
      if (task.status === 'completed' || task.status === 'failed') break
      await delay(250)
    }
    const task = result.task
    assert.equal(task.status, 'completed', JSON.stringify(result))
    assert.ok(JSON.stringify(task).includes('/api/'), 'generated video must be persisted locally')
    assert.equal(requests[index].body.duration, 1)
    assert.equal(requests[index].body.resolution, '768p竖')
  }
  const failed = await api('/api/models/test', 'POST', { provider: 'autodl', modelType: 'video', modelId: models[2], prompt: 'failure', duration: 1 })
  const failureId = failed.data?.result?.taskId
  let failure
  for (let i = 0; i < 40; i++) {
    const response = await api(`/api/video/status/${failureId}`)
    failure = response.task
    if (failure.status === 'failed') break
    await delay(250)
  }
  assert.equal(failure.status, 'failed')
  assert.ok(JSON.stringify(failure).includes('mock generation failed'))
  const invalid = await fetch(`${base}/api/models/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'autodl', modelType: 'video', modelId: models[3], prompt: 'test', duration: 15 }) })
  assert.equal(invalid.status, 400)
  assert.equal(requests.length, 5, 'invalid request must not reach upstream')
  const db = new Database(join(dir, 'test.db'))
  try {
    const logs = db.query("SELECT operation, status FROM model_debug_logs WHERE provider = 'autodl'").all()
    assert.equal(logs.filter(log => log.status === 'success').length, 4, 'only completed generations may be billed')
    assert.ok(logs.filter(log => log.status === 'success').every(log => log.operation === 'generateVideo'))
    const completed = db.query("SELECT metadata FROM video_tasks WHERE status = 'completed'").all()
    for (const row of completed) {
      const metadata = JSON.parse(row.metadata)
      assert.equal(metadata.duration, 1)
      assert.equal(metadata.resolution, '768p')
      assert.equal(metadata.aspectRatio, '9:16')
      assert.ok(metadata.upstreamTask.request.prompt)
    }
  } finally { db.close() }
  console.log('AutoDL integration passed: credentials, four workflows, raw token, one-second duration, success aliases, saved video, failure and validation.')
} finally {
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM')
    await new Promise(resolve => backend.once('exit', resolve))
  }
  await new Promise(resolve => mock.close(resolve))
  await rm(dir, { recursive: true, force: true })
}

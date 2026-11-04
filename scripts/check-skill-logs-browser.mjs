// Exercises both UIs with API fixtures; no user records or model calls are created.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await firefox.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined })
const shots = await mkdtemp(join(tmpdir(), 'playlet-skill-logs-ui-'))
const skill = { id: 'writer', name: 'human-writing', version: 'v1', description: '中文写作', stages: ['scene_detail'], instructions: '保持自然', files: {}, enabled: true, builtin: false, unsupported: [] }
const run = { id: 'run-fixture', projectId: 'qa', projectName: '1105', stage: 'scene_detail', skills: [skill], createdAt: '2026-11-05T00:00:00Z', status: 'succeeded', durationMs: 1200, syncStatus: 'synced', result: { message: '已完成描述细化', sceneCount: 3 }, user_id: 'member', account: 'tester', modelCallCount: 1 }
const context = { runId: run.id, stage: run.stage, skills: [skill], batchStart: 1, batchEnd: 3, attempt: 2 }
const log = { id: 'log-1', timestamp: run.createdAt, provider: 'openai', model: 'fixture-model', operation: 'generateText', status: 'success', durationMs: 500, projectId: 'qa', skillContext: context, request: { prompt: '技能请求' }, response: { text: '描述结果' } }
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
page.setDefaultTimeout(15000)
page.on('pageerror', e => errors.push(e.message))
let queriedRun = ''
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (!url.pathname.startsWith('/api/')) return route.continue()
  const path = url.pathname
  let data = {}
  if (path.startsWith('/api/cloud/')) data = { success: true, data: { authenticated: true, configured: true, user: {id:'qa',role:'admin'} } }
  else if (path === '/api/skills') data = { skills: [skill] }
  else if (path === '/api/project/list') data = { projects: [{id:'qa',title:'1105'}] }
  else if (path.endsWith('/skill-runs')) data = { runs: [run] }
  else if (path.endsWith('/skills')) data = { skills: [skill], selectedIds:['writer'],projectName:'1105',canEdit:true }
  else if (path === '/api/debug/model-logs') {
    queriedRun = url.searchParams.get('skillRunId') || queriedRun
    data = {success:true,data:{logs:[log],total:1}}
  }
  await route.fulfill({json:data})
})
const admin = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
admin.setDefaultTimeout(30000)
admin.on('pageerror', e => errors.push(e.message))
admin.on('console', m => { if (m.type() === 'error') console.error('Admin console:',m.text()) })
admin.on('requestfailed', r => console.error('Admin network:',r.url(),r.failure()))
let adminQuery = ''
const adminLog = { id:'log-1',user_id:'member',account:'tester',created_at:run.createdAt,provider:'openai',model_id:'fixture-model',operation:'generateText',status:'success',duration_ms:500,skill_context_json:JSON.stringify(context),request:log.request,response:log.response }
await admin.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (!url.pathname.startsWith('/api/')) return route.continue()
  let data = {}
  if (url.pathname === '/api/me') data = {user:{id:'admin',account:'admin',role:'admin'}}
  else if (url.pathname === '/api/admin/skill-runs') data = {runs:[run,{...run,id:'run-failed',status:'failed',modelCallCount:0,result:{message:'调用前校验失败'}}],pagination:{total:2}}
  else if (url.pathname === '/api/admin/model-call-logs/log-1') data = {log:adminLog}
  else if (url.pathname === '/api/admin/model-call-logs') {
    adminQuery = url.searchParams.get('skillRunId') || adminQuery
    data = {logs:[adminLog],pagination:{total:1},summary:{total:1,failed:0,averageDuration:500,totalCost:0,totalCredits:0},options:{users:[],providers:[],models:[],operations:[],statuses:[]}}
  }
  await route.fulfill({json:{success:true,data}})
})
try {
  await page.goto('http://127.0.0.1:3000/settings?section=skills&project=qa')
  await page.getByRole('button',{name:'执行记录',exact:true}).click()
  await page.getByText('已同步后台',{exact:false}).waitFor()
  await page.getByRole('link',{name:'查看模型调用',exact:true}).click()
  await page.getByRole('cell',{name:'human-writing',exact:false}).waitFor()
  assert.equal(queriedRun,run.id)
  await page.getByRole('cell',{name:'human-writing',exact:false}).click()
  await page.getByText('第 1–3 镜 · 第 2 次尝试',{exact:true}).waitFor()
  await page.screenshot({animations:'disabled',path:join(shots,'client-call.png')})
  await page.getByRole('link',{name:'查看本次执行的全部调用'}).click()
  await page.getByRole('button',{name:'展开筛选条件'}).click()
  await page.getByRole('textbox',{name:'技能名称或 ID',exact:true}).fill('human')
  await page.getByRole('button',{name:'刷新',exact:true}).click()
  await page.screenshot({animations:'disabled',path:join(shots,'client-filters.png')})
  await admin.goto('http://127.0.0.1:43200/logs?tab=skills')
  await admin.getByText('调用前校验失败',{exact:true}).waitFor()
  assert.equal(await admin.getByRole('button',{name:'查看模型调用（0）',exact:true}).isDisabled(),true)
  await admin.screenshot({animations:'disabled',path:join(shots,'admin-runs.png')})
  await admin.getByRole('button',{name:'查看模型调用（1）',exact:true}).click()
  await admin.getByRole('cell',{name:'human-writing',exact:true}).waitFor()
  assert.equal(adminQuery,run.id)
  await admin.getByRole('cell',{name:'human-writing',exact:true}).click()
  await admin.getByText('第 1–3 镜 · 第 2 次尝试',{exact:true}).waitFor()
  await admin.screenshot({animations:'disabled',path:join(shots,'admin-call.png')})
  await admin.getByRole('button',{name:'查看技能执行',exact:true}).click()
  await admin.getByText('调用前校验失败',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: client run-to-call navigation, skill/batch details, skill filters; admin runs, no-call failure, bidirectional links')
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  console.error('Client:',page.url(),'Admin:',admin.url(),'Errors:',errors)
  console.error((await page.locator('body').innerText()).slice(-3000))
  await page.screenshot({animations:'disabled',path:join(shots,'failure-client.png')})
  await admin.screenshot({animations:'disabled',path:join(shots,'failure-admin.png')})
  console.error('Screenshots:',shots)
  throw error
} finally { await browser.close() }

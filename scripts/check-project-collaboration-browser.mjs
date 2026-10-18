// Run against dev:frontend. Every API call is mocked; this never edits real projects.
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const screenshot = join(tmpdir(), 'cartoon-collaboration-qa.png')
import assert from 'node:assert/strict'
const browser = await firefox.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const resources = [
  { type: 'settings', id: 'settings', revision: 1, deleted: false, body: { project: { name: '协作回归项目' } } },
  { type: 'directory', id: 'directory', revision: 1, deleted: false, body: { episodeIds: ['e1', 'e2'] } },
  ...['e1', 'e2'].map((id, i) => ({ type: 'episode', id, revision: 1, deleted: false, body: {
    plan: { id, index: i + 1, title: `第${i + 1}集` }, writing: { id, index: i + 1, title: `第${i + 1}集`, draft: `第${i + 1}集原正文`, summary: '梗概' },
    scenes: [{ id: `s${i}`, episodeId: id, title: '开场', description: '场景原描述', narration: '旁白', videoUrl: '/keep.mp4' }]
  } })),
  { type: 'character', id: 'c1', revision: 1, deleted: false, body: { id: 'c1', name: '主角', appearance: '短发', personality: '冷静' } }
]
const writes = []
const changes = []
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  let data = {}
  if (path === '/api/cloud/status' || path === '/api/cloud/heartbeat') data = { authenticated: true, configured: true, user: { id: 'qa-user', displayName: '测试成员', role: 'user' } }
  if (path.endsWith('/collaboration')) {
    const body = route.request().postDataJSON()
    if (body.action === 'read') data = { enabled: true, protocolVersion: 1, cursor: changes.length, resources }
    if (body.action === 'lease') data = { editable: body.leaseAction !== 'release', canTakeover: false, expiresAt: Date.now() + 90000 }
    if (body.action === 'changes') data = { changes: changes.filter(change => change.sequence > body.after), cursor: changes.length, hasMore: false }
    if (body.action === 'write') {
      writes.push(body)
      const updated = body.mutations.map(mutation => {
        const resource = resources.find(resource => resource.type === mutation.type && resource.id === mutation.id)
        assert.equal(resource.revision, mutation.expectedRevision)
        resource.body = mutation.body
        resource.revision++
        changes.push({ ...structuredClone(resource), sequence: changes.length + 1 })
        return resource
      })
      data = { cursor: changes.length, resources: updated }
    }
  }
  await route.fulfill({ json: { success: true, data } })
})
try {
  await page.goto(`${process.env.COLLABORATION_QA_URL || 'http://localhost:3000'}/projects/qa/collaboration`)
  await page.getByRole('heading', { name: '协作回归项目' }).waitFor()
  console.log('Initial snapshot:', (await page.locator('main').innerText()).slice(-1400))
  assert(await page.getByLabel('本集正文', { exact: true }).isDisabled())
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('本集正文', { exact: true }).fill('第一集独立修改')
  await page.getByRole('button', { name: '保存当前对象' }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].mutations.length, 1)
  assert.equal(writes[0].mutations[0].id, 'e1')
  assert.equal(writes[0].mutations[0].body.scenes[0].videoUrl, '/keep.mp4')
  await page.getByRole('button', { name: '第2集', exact: true }).click()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第2集原正文')
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('本集正文', { exact: true }).fill('第二集未保存草稿')
  await page.getByRole('button', { name: '主角', exact: true }).click()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('外貌描述', { exact: true }).fill('长发')
  await page.getByRole('button', { name: '保存当前对象' }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes[1].mutations[0].type, 'character')
  assert.equal(writes[1].mutations.length, 1)
  await page.reload()
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await page.getByRole('button', { name: /第2集/ }).click()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第二集未保存草稿')
  const second = resources.find(resource => resource.id === 'e2')
  second.revision++
  second.body.writing.draft = '其他成员更新的第二集'
  changes.push({ ...structuredClone(second), sequence: changes.length + 1 })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '查看远端内容', exact: true }).click()
  await page.getByText(/其他成员更新的第二集/).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第二集未保存草稿')
  await page.getByRole('button', { name: '保留本地草稿，继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes[2].mutations[0].expectedRevision, 2)
  assert.equal(writes[2].mutations[0].body.writing.draft, '第二集未保存草稿')
  await page.screenshot({ path: screenshot, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile viewport overflows horizontally')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks: ['read-only before acquire', 'episode-only mutation', 'media retained', 'other episode unchanged', 'character-only mutation', 'reload draft recovery', 'remote conflict preserves draft', 'review before rebase', 'no browser errors'], writes: writes.map(write => write.mutations.map(({ type, id, expectedRevision }) => ({ type, id, expectedRevision }))), screenshot }, null, 2))
} finally { await browser.close() }

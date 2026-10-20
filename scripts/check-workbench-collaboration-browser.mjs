// Every API is intercepted. This validates the original UI without touching real data.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const { firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await firefox.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1080 } })
const page = await context.newPage()
const errors = []
const writes = []
const legacyWrites = []
const changes = []
const collaborationRequests = []
let editable = true
const snapshot = {
  project: { id: 'qa', name: '原工作台协作回归', description: '保留原界面', styleId: 'live_action', scriptParseMode: 'short_drama', aspectRatio: '9:16' },
  script: { novelText: '女孩来到城市。', selectedStyleId: 'live_action', episodePlan: [{ id: 'a', index: 1, title: '第1集：初到城市', startOffset: 0, endOffset: 8, charCount: 8 }, { id: 'b', index: 2, title: '第2集：新的机会', startOffset: 8, endOffset: 16, charCount: 8 }] },
  scenes: [{ id: 's1', episodeId: 'a', episodeIndex: 1, title: '初到城市', description: '女孩走进城市街道。', duration: 10, characters: [], videoUrl: 'https://shared.example/keep.mp4' }, { id: 's2', episodeId: 'b', episodeIndex: 2, title: '新的机会', description: '女孩推开工作室的门。', duration: 8, characters: [] }],
  characters: []
}
let resources = [
  { type: 'settings', id: 'settings', revision: 1, deleted: false, body: { project: snapshot.project, script: { novelText: snapshot.script.novelText, selectedStyleId: 'live_action' }, extra: {} } },
  { type: 'directory', id: 'directory', revision: 1, deleted: false, body: { episodeIds: ['a', 'b'] } },
  ...['a', 'b'].map((id, i) => ({ type: 'episode', id, revision: 1, deleted: false, body: { plan: snapshot.script.episodePlan[i], writing: null, scenes: [snapshot.scenes[i]] } }))
]
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  const method = route.request().method()
  const body = route.request().postDataJSON() || {}
  let data = {}
  if (path.startsWith('/api/cloud/')) data = { authenticated: true, configured: true, user: { id: 'qa-user', displayName: '测试成员', role: 'user' } }
  if (path === '/api/project/qa/collaboration/prepare') data = { enabled: true, editable, protocolVersion: 1, resources, cursor: changes.length }
  if (path === '/api/project/qa/collaboration') {
    collaborationRequests.push(body)
    if (body.action === 'presence') data = { collaborators: [{ userId: 'qa-user', displayName: '测试成员', self: true, editing: [], locked: [] }, { userId: 'other', displayName: '小张', self: false, editing: [{ type: 'episode', id: 'b' }], locked: [] }] }
    if (body.action === 'changes') data = { changes: changes.slice(body.after || 0), cursor: changes.length, hasMore: false, editable }
    if (body.action === 'lease') data = { editable: true, expiresAt: Date.now() + 90000, canTakeover: true }
    if (body.action === 'write') {
      const stale = body.mutations.some(item => item.expectedRevision !== (resources.find(resource => resource.type === item.type && resource.id === item.id)?.revision || 0))
      if (stale) { await route.fulfill({ status: 409, json: { message: '对象版本已变化' } }); return }
      writes.push(body)
      data = { resources: body.mutations.map(item => ({ type: item.type, id: item.id, revision: item.expectedRevision + 1, deleted: item.body === null, body: item.body })) }
      const merged = new Map(resources.map(item => [`${item.type}:${item.id}`, item]))
      for (const item of data.resources) { merged.set(`${item.type}:${item.id}`, item); changes.push(item) }
      resources = [...merged.values()]
    }
  }
  if (path === '/api/project/qa/edit-session' || (path === '/api/project/qa' && method === 'PUT')) legacyWrites.push(path)
  if (path === '/api/project/qa') data = { ...snapshot, access: { isOwner: true, role: 'owner', permissions: ['view', 'edit', 'generate', 'export', 'manage_members', 'delete'] } }
  if (path.includes('/style')) data = { presets: [], categories: [] }
  await route.fulfill({ json: { success: true, data, ...(path === '/api/project/list' ? { projects: [] } : {}) } })
})
try {
  const base = process.env.COLLABORATION_QA_URL || 'http://127.0.0.1:3199'
  await page.goto(`${base}/asset-workbench?project=qa&stage=videos`)
  await page.getByText('原工作台协作回归', { exact: true }).waitFor()
  await page.getByText('初到城市', { exact: true }).first().waitFor()
  await page.getByText('协作模式', { exact: true }).waitFor()
  await page.getByText('2 人在线', { exact: true }).waitFor()
  await page.getByText('小张 · 正在编辑 第2集：新的机会', { exact: true }).waitFor()
  await page.waitForTimeout(1000)
  await page.getByText('已同步', { exact: true }).waitFor()
  assert.equal(writes.length, 0, 'opening the workbench must be read-only')
  await page.screenshot({ path: join(tmpdir(), 'cartoon-collaboration-status.png'), fullPage: true })
  assert(await page.getByText('分集目录', { exact: true }).isVisible())
  assert(await page.getByText('视频预览', { exact: true }).isVisible())
  assert.equal(await page.getByText('管理员 正在编辑，当前为只读模式。', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '进入按集协作', exact: true }).count(), 0)
  await page.locator('[title="单击选中，双击编辑场景详情"]').first().dblclick()
  await page.getByPlaceholder('输入场景标题', { exact: true }).fill('初到城市（协作修改）')
  const saved = page.waitForResponse(response => response.url().endsWith('/api/project/qa/collaboration') && response.request().postDataJSON()?.action === 'write')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await saved
  assert.deepEqual(writes[0].mutations.map(({ type, id }) => ({ type, id })), [{ type: 'episode', id: 'a' }])
  assert(writes[0].mutations[0].body.scenes[0].videoHistory.some(item => item.videoUrl === 'https://shared.example/keep.mp4'))
  assert.equal(resources.find(item => item.id === 'b').revision, 1)
  await page.waitForTimeout(1500)
  assert(writes.every(write => write.mutations.every(item => item.type === 'episode' && item.id === 'a')), 'scene editing must never write untouched episodes or settings')
  const writesBeforeRemote = writes.length
  // Another member edits a clean resource: the original UI must update without reload.
  const remote = structuredClone(resources.find(item => item.id === 'a'))
  remote.revision++
  remote.body.scenes[0].title = '初到城市（远端更新）'
  resources = resources.map(item => item.type === remote.type && item.id === remote.id ? remote : item)
  changes.push(remote)
  await page.getByText('初到城市（远端更新）', { exact: true }).first().waitFor({ timeout: 20000 })
  assert(await page.getByRole('button', { name: /历史 1/ }).count() > 0, 'remote updates must preserve resource-scoped video history')
  assert.equal(writes.length, writesBeforeRemote, 'receiving remote updates must not trigger a phantom save')
  editable = false
  await page.getByText('当前账号已调整为只读权限，本机草稿已保留。', { exact: true }).waitFor({ timeout: 20000 })
  assert(await page.locator('[inert]').count() > 0)
  editable = true
  await page.screenshot({ path: join(tmpdir(), 'cartoon-workbench-collaboration.png'), fullPage: true })
  // Existing collaboration bookmarks return to the same original workbench.
  await page.goto(`${base}/projects/qa/collaboration`)
  await page.waitForURL('**/asset-workbench?project=qa**')
  await page.getByText('原工作台协作回归', { exact: true }).waitFor()
  await page.getByText('剧本解析', { exact: true }).first().click()
  await page.waitForTimeout(300)
  const textareas = page.locator('textarea')
  if (await textareas.count()) {
    await textareas.first().fill('女孩来到城市，开始新的故事。')
    // Leaving the original workbench saves through resource writes.
    await page.getByRole('button', { name: /返回/ }).first().click()
    await page.waitForTimeout(500)
  }
  assert.deepEqual(legacyWrites, [])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks: ['original four-stage workbench', 'episode directory and video preview retained', 'no project-wide lock', 'original scene dialog writes only its episode and retains media', 'old collaboration bookmark returns to original UI', 'no legacy edit-session or snapshot PUT', 'collaboration status and another member editing an episode are visible', 'remote changes appear without reload or phantom saves', 'permission downgrade makes the original UI read-only', 'no browser errors'], writes: writes.map(item => item.mutations.map(({ type, id }) => ({ type, id }))), screenshot: join(tmpdir(), 'cartoon-workbench-collaboration.png') }, null, 2))
} catch (cause) {
  console.error(JSON.stringify({ collaborationRequests, errors }))
  console.error((await page.locator('body').innerText()).slice(-6000))
  await page.screenshot({ path: join(tmpdir(), 'cartoon-workbench-collaboration-failed.png'), fullPage: true })
  throw cause
} finally { await browser.close() }

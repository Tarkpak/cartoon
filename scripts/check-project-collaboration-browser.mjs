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
  { type: 'settings', id: 'settings', revision: 1, deleted: false, body: { project: { id: 'qa', name: '协作回归项目', description: '原简介', aspectRatio: '16:9' }, script: { storyBible: { tone: '冒险' } }, extra: { custom: '保留' } } },
  { type: 'directory', id: 'directory', revision: 1, deleted: false, body: { episodeIds: ['e1', 'e2'] } },
  ...['e1', 'e2'].map((id, i) => ({ type: 'episode', id, revision: 1, deleted: false, body: {
    plan: { id, index: i + 1, title: `第${i + 1}集` }, writing: { id, index: i + 1, title: `第${i + 1}集`, draft: `第${i + 1}集原正文`, summary: '梗概' },
    scenes: [{ id: `s${i}`, episodeId: id, title: '开场', description: '场景原描述', narration: '旁白', videoUrl: '/keep.mp4' }]
  } })),
  { type: 'character', id: 'c1', revision: 1, deleted: false, body: { id: 'c1', name: '主角', appearance: '短发', personality: '冷静' } }
]
const mediaResults = []
const draftResults = []
const writes = []
const changes = []
const memberWrites = []
let deniedEpisode = ''
let rejectNextWrite = false
let disconnectNextWrite = false
const offlineOperationIds = []
let migrationEnabled = false
const migrationRequests = []
let members = [{ userId: 'bob', account: 'bob', displayName: 'Bob', role: 'editor', permissions: ['view', 'edit'], createdAt: 'v1', updatedAt: 'v1' }]
const qaVideoBase64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAINEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggH37AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIwP0mYp2nkaicgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QdzWUA4JCwgSC6gSCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIwP0mYp2nkahnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1z+eBAKOzgQAAgJACAJ0BKiAAIAAARwiFhYiFhIgCAgJ1qgIH+SJMIP7+ZqH/VeIMz2v/xbSOhSeAo5WBAfQAsQEABRCsABgAGFgv9AAIcAAcU7trkbuPs4EAt4r3gQHxggGj8IED'
const qaAudio = Buffer.alloc(44 + 1600)
qaAudio.write('RIFF', 0); qaAudio.writeUInt32LE(qaAudio.length - 8, 4); qaAudio.write('WAVEfmt ', 8); qaAudio.writeUInt32LE(16, 16); qaAudio.writeUInt16LE(1, 20); qaAudio.writeUInt16LE(1, 22); qaAudio.writeUInt32LE(8000, 24); qaAudio.writeUInt32LE(16000, 28); qaAudio.writeUInt16LE(2, 32); qaAudio.writeUInt16LE(16, 34); qaAudio.write('data', 36); qaAudio.writeUInt32LE(1600, 40)
await page.route('https://media.example/**', route => route.fulfill(route.request().url().endsWith('.wav') ? { contentType: 'audio/wav', body: qaAudio } : route.request().url().endsWith('.mp4') ? { contentType: 'video/webm', body: Buffer.from(qaVideoBase64, 'base64') } : { contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }))
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  let data = {}
  if (['/api/cloud/status', '/api/cloud/heartbeat', '/api/cloud/bootstrap'].includes(path)) data = { authenticated: true, configured: true, user: { id: 'qa-user', displayName: '测试成员', role: 'user' } }
  if (path === '/api/project/list') {
    await route.fulfill({ json: { success: true, projects: [{ id: 'qa', title: '迁移试点项目', description: 'preview', styleId: '', aspectRatio: '16:9', totalScenes: 2, createdAt: '2026-10-19', updatedAt: '2026-10-19', ownerUserId: 'qa-user', collaboration: migrationEnabled, cloudSyncStatus: 'synced', access: { isOwner: true, role: 'owner', permissions: ['view','edit','generate','manage_members','delete'] } }] } })
    return
  }
  if (path.endsWith('/collaboration/draft-results')) data = draftResults
  if (path.endsWith('/collaboration/media-results')) data = mediaResults
  if (path.endsWith('/collaboration/asset-image')) {
    const body = route.request().postDataJSON()
    const resource = resources.find(item => item.type === (body.kind === 'character' ? 'character' : 'settings') && item.id === (body.kind === 'character' ? body.assetId : 'settings'))
    assert.equal(resource.revision, body.collaborationInput.revision)
    data = { id: `asset-result-${body.assetId}`, kind: 'asset-image', status: 'completed', createdAt: '2026-10-19', url: 'https://media.example/image.gif', collaboration: { projectId: 'qa', actorId: 'qa-user', assetKind: body.kind, assetId: body.assetId, resourceType: resource.type, resourceId: resource.id, revision: resource.revision, settingsRevision: body.collaborationInput.settingsRevision } }
    mediaResults.push(data)
  }
  if (path.endsWith('/collaboration/scene-image') || path === '/api/video/generate') {
    const body = route.request().postDataJSON()
    const episode = resources.find(item => item.type === 'episode' && item.id === body.collaborationInput.episodeId)
    assert.equal(body.collaborationInput.revision, episode.revision)
    assert(episode.body.scenes.some(item => item.id === body.sceneId))
    const kind = path === '/api/video/generate' ? 'video' : 'image'
    const result = { id: `${kind}-result`, kind, status: kind === 'image' ? 'completed' : 'processing', progress: kind === 'image' ? 100 : 30, createdAt: '2026-10-19T01:00:00Z', collaboration: { projectId: 'qa', actorId: 'qa-user', episodeId: episode.id, sceneId: body.sceneId, revision: episode.revision, settingsRevision: body.collaborationInput.settingsRevision }, url: kind === 'image' ? 'https://media.example/image.gif' : null }
    mediaResults.push(result)
    if (kind === 'video') { await route.fulfill({ json: { success: true, taskId: result.id } }); return }
    data = result
  }
  if (path === '/api/video/status/video-result') {
    const result = mediaResults.find(item => item.id === 'video-result')
    Object.assign(result, { status: 'completed', progress: 100, url: 'https://media.example/video.mp4' })
  }

  if (path === '/api/script/write') {
    const body = route.request().postDataJSON()
    const episode = resources.find(item => item.type === 'episode' && item.id === body.collaborationInput.episodeId)
    const settings = resources.find(item => item.type === 'settings')
    assert.equal(body.collaborationInput.revision, episode.revision)
    assert.equal(body.collaborationInput.settingsRevision, settings.revision)
    const result = { id: 'generated-1', createdAt: '2026-10-19T00:00:00Z', collaboration: { projectId: 'qa', actorId: 'qa-user', episodeId: episode.id, revision: episode.revision, settingsRevision: settings.revision }, data: { episodeId: episode.id, draft: '单集生成的正文预览', continuityNotes: '生成的连续性备注' } }
    draftResults.push(result)
    await route.fulfill({ json: { success: true, ...result } })
    return
  }
  if (path === '/api/library/members') data = { members: [{ id: 'new', account: 'new', displayName: 'New', role: 'user' }] }
  if (path === '/api/project/qa/members') data = {
    owner: { userId: 'owner', account: 'owner', displayName: 'Owner', role: 'owner', permissions: ['view', 'manage_members'] },
    members, access: { role: 'manager', permissions: ['view', 'manage_members'], isOwner: false }, currentUserId: 'qa-user'
  }
  if (path === '/api/project/qa/members/bob') {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      memberWrites.push(body)
      assert.equal(body.expectedUpdatedAt, 'v1')
      members = members.map(member => ({ ...member, role: body.role, permissions: body.permissions, updatedAt: 'v2' }))
    } else {
      const expectedUpdatedAt = new URL(route.request().url()).searchParams.get('expectedUpdatedAt')
      assert.equal(expectedUpdatedAt, 'v2')
      memberWrites.push({ expectedUpdatedAt, remove: true })
      members = []
    }
  }
  if (path.endsWith('/collaboration')) {
    const body = route.request().postDataJSON()
    if (body.action === 'migrationPreview') { migrationRequests.push(body); data = { expectedUpdatedAt: 'reviewed-v1', snapshotHash: 'reviewed-hash', projectName: '迁移试点项目', episodes: 2, scenes: 2, characters: 1 } }
    if (body.action === 'enable') { assert.equal(body.expectedUpdatedAt, 'reviewed-v1'); assert.equal(body.snapshotHash, 'reviewed-hash'); migrationRequests.push(body); migrationEnabled = true; data = { enabled: true } }
    if (body.action === 'generationCheck') {
      const episode = resources.find(item => item.type === body.type && item.id === body.id)
      const settings = resources.find(item => item.type === 'settings')
      assert.equal(body.expectedRevision, episode.revision)
      assert.equal(body.settingsRevision, settings.revision)
      data = { episode, resource: episode, settings }
    }
    if (body.action === 'read') data = { enabled: true, protocolVersion: 1, cursor: changes.length, resources }
    if (body.action === 'lease') data = { editable: body.leaseAction !== 'release' && body.id !== deniedEpisode, canTakeover: false, expiresAt: Date.now() + 90000 }
    if (body.action === 'changes') data = { changes: changes.filter(change => change.sequence > body.after), cursor: changes.length, hasMore: false }
    if (body.action === 'write') {
      if (disconnectNextWrite) { offlineOperationIds.push(body.operationId); await route.fulfill({ status: 503, json: { message: '模拟连接暂不可用' } }); return }
      if (offlineOperationIds.length) offlineOperationIds.push(body.operationId)

      if (rejectNextWrite) {
        rejectNextWrite = false
        await route.fulfill({ status: 409, json: { message: '目录已更新，请处理冲突' } })
        return
      }
      writes.push(body)
      const updated = body.mutations.map(mutation => {
        let resource = resources.find(resource => resource.type === mutation.type && resource.id === mutation.id)
        if (!resource) { resource = { type: mutation.type, id: mutation.id, revision: 0, deleted: true, body: null }; resources.push(resource) }
        assert.equal(resource.revision, mutation.expectedRevision)
        resource.body = mutation.body
        resource.deleted = mutation.body === null
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
  await page.locator('button[aria-current="true"]').filter({ hasText: '第2集' }).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第2集原正文')
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('本集正文', { exact: true }).fill('第二集未保存草稿')
  await page.getByRole('button', { name: '主角', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '主角' }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('外貌描述', { exact: true }).fill('长发')
  await page.getByRole('button', { name: '保存当前对象' }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes[1].mutations[0].type, 'character')
  assert.equal(writes[1].mutations.length, 1)
  await page.reload()
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await page.getByRole('button', { name: /第2集/ }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '第2集' }).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第二集未保存草稿')
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  const second = resources.find(resource => resource.id === 'e2')
  second.revision++
  second.body.writing.draft = '其他成员更新的第二集'
  changes.push({ ...structuredClone(second), sequence: changes.length + 1 })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  assert(await page.getByLabel('本集正文', { exact: true }).isDisabled(), 'remote conflict must block editing even with a lease')
  assert(await page.getByRole('button', { name: '保存当前对象', exact: true }).isDisabled())
  await page.getByRole('button', { name: '查看远端内容', exact: true }).click()
  await page.getByText(/其他成员更新的第二集/).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第二集未保存草稿')
  await page.getByRole('button', { name: '保留本地草稿，继续编辑', exact: true }).click()
  assert(await page.getByLabel('本集正文', { exact: true }).isEnabled())
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes[2].mutations[0].expectedRevision, 2)
  assert.equal(writes[2].mutations[0].body.writing.draft, '第二集未保存草稿')
  await page.getByRole('button', { name: '成员', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '项目成员', exact: true })
  await dialog.getByText('Bob', { exact: true }).waitFor()
  console.log('Members snapshot:', await dialog.innerText())
  await dialog.getByRole('combobox').last().click()
  await page.getByRole('option', { name: '查看者', exact: true }).click()
  await dialog.getByRole('combobox').last().getByText('查看者', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '移除项目成员', exact: true }).click()
  await page.getByRole('button', { name: '移除成员', exact: true }).click()
  await dialog.getByText('当前还没有协作成员', { exact: true }).waitFor()
  assert.equal(memberWrites.length, 2)
  assert.equal(writes.length, 3, 'member management must not submit project resources')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '项目设置', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '项目设置' }).waitFor()
  assert(await page.getByLabel('项目名称', { exact: true }).isDisabled())
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('独立设置修改')
  await page.getByLabel('项目简介', { exact: true }).fill('新的简介')
  await page.getByLabel('画幅', { exact: true }).selectOption('9:16')
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes.length, 4)
  assert.equal(writes[3].mutations.length, 1)
  const settingsMutation = writes[3].mutations[0]
  assert.equal(settingsMutation.type, 'settings')
  assert.deepEqual(settingsMutation.body.project, { id: 'qa', name: '独立设置修改', description: '新的简介', aspectRatio: '9:16' })
  assert.deepEqual(settingsMutation.body.script, { storyBible: { tone: '冒险' } })
  assert.deepEqual(settingsMutation.body.extra, { custom: '保留' })
  assert.equal(second.body.writing.draft, '第二集未保存草稿')
  await page.getByRole('button', { name: '第1集', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '第1集' }).waitFor()
  assert(await page.getByRole('button', { name: '添加分镜', exact: true }).isDisabled())
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '添加分镜', exact: true }).click()
  await page.getByLabel('分镜 2 标题', { exact: true }).fill('新增分镜')
  await page.getByRole('button', { name: '上移分镜 2', exact: true }).click()
  assert.equal(await page.getByLabel('分镜 1 标题', { exact: true }).inputValue(), '新增分镜')
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes.length, 5)
  assert.equal(writes[4].mutations.length, 1)
  const sceneMutation = writes[4].mutations[0]
  assert.equal(sceneMutation.id, 'e1')
  assert.equal(sceneMutation.body.scenes[0].episodeId, 'e1')
  assert.equal(sceneMutation.body.scenes[0].title, '新增分镜')
  assert.equal(sceneMutation.body.scenes[1].videoUrl, '/keep.mp4')
  await page.getByRole('button', { name: '删除分镜 1', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.getByLabel('分镜 1 标题', { exact: true }).inputValue(), '新增分镜')
  await page.getByRole('button', { name: '删除分镜 1', exact: true }).click()
  await page.getByRole('button', { name: '删除分镜', exact: true }).click()
  await page.getByLabel('分镜 2 标题', { exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。').waitFor()
  assert.equal(writes.length, 6)
  assert.equal(writes[5].mutations.length, 1)
  assert.equal(writes[5].mutations[0].id, 'e1')
  assert.equal(writes[5].mutations[0].body.scenes.length, 1)
  assert.equal(writes[5].mutations[0].body.scenes[0].videoUrl, '/keep.mp4')
  assert.equal(second.body.writing.draft, '第二集未保存草稿')
  await page.getByRole('button', { name: '集数目录', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '集数目录' }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '新增集数', exact: true }).click()
  await page.getByText('集数目录已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 7)
  assert.equal(writes[6].mutations.length, 2)
  assert.equal(writes[6].mutations[0].type, 'directory')
  const addedEpisode = writes[6].mutations[1]
  assert.equal(addedEpisode.expectedRevision, 0)
  assert.deepEqual(writes[6].mutations[0].body.episodeIds, ['e1', 'e2', addedEpisode.id])
  await page.getByRole('button', { name: '上移集数 3', exact: true }).click()
  await page.getByText('集数目录已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 8)
  assert.equal(writes[7].mutations.length, 3)
  assert.deepEqual(writes[7].mutations[0].body.episodeIds, ['e1', addedEpisode.id, 'e2'])
  assert.equal(writes[7].mutations.find(item => item.id === 'e2').body.writing.draft, '第二集未保存草稿')
  await page.getByRole('button', { name: '删除集数 2', exact: true }).click()
  await page.getByRole('button', { name: '删除集数', exact: true }).click()
  await page.getByText('集数目录已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 9)
  assert.equal(writes[8].mutations.length, 2)
  assert.equal(writes[8].mutations[1].id, addedEpisode.id)
  assert.equal(writes[8].mutations[1].body, null)
  deniedEpisode = 'e1'
  await page.getByRole('button', { name: '下移集数 1', exact: true }).click()
  await page.getByText('受影响集数正在由其他成员编辑，目录未修改。', { exact: true }).waitFor()
  assert.equal(writes.length, 9)
  deniedEpisode = ''
  rejectNextWrite = true
  await page.getByRole('button', { name: '新增集数', exact: true }).click()
  await page.getByRole('button', { name: '查看远端目录', exact: true }).click()
  await page.getByRole('button', { name: '放弃本次目录调整', exact: true }).click()
  await page.getByText('已放弃本次目录调整，其他草稿已保留。', { exact: true }).waitFor()
  assert.equal(writes.length, 9)
  assert.equal(await page.getByRole('button', { name: /删除集数 \d/ }).count(), 2)
  await page.getByLabel('来源集数', { exact: true }).selectOption('e1')
  await page.getByLabel('要移动的分镜', { exact: true }).selectOption('s0')
  await page.getByLabel('目标集数', { exact: true }).selectOption('e2')
  await page.getByRole('button', { name: '移动分镜并保存', exact: true }).click()
  await page.getByText('集数目录已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 10)
  assert.equal(writes[9].mutations.length, 3)
  assert.deepEqual(writes[9].mutations.find(item => item.id === 'e1').body.scenes, [])
  assert.equal(writes[9].mutations.find(item => item.id === 'e2').body.scenes.at(-1).id, 's0')
  assert.equal(writes[9].mutations.find(item => item.id === 'e2').body.scenes.at(-1).videoUrl, '/keep.mp4')
  assert.equal(writes[9].mutations.find(item => item.id === 'e2').body.scenes.at(-1).episodeId, 'e2')
  await page.getByRole('button', { name: '第1集', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '第1集' }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '生成正文预览', exact: true }).click()
  await page.getByText('单集生成的正文预览', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '第一集独立修改')
  assert.equal(writes.length, 10, 'generation preview must not write any resource')
  await page.reload()
  await page.getByText('单集生成的正文预览', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '采用到本集草稿', exact: true }).click()
  await page.getByText('生成正文已加入本集草稿，请检查后保存。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '单集生成的正文预览')
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 11)
  assert.equal(writes[10].mutations.length, 1)
  assert.equal(writes[10].mutations[0].id, 'e1')
  assert.equal(writes[10].mutations[0].body.writing.continuityNotes, '生成的连续性备注')
  await page.getByRole('button', { name: '采用到本集草稿', exact: true }).click()
  await page.getByText('生成输入已变化，请导出结果后手动合并', { exact: true }).waitFor()
  assert.equal(writes.length, 11)
  await page.getByRole('button', { name: '第2集', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '第2集' }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('生成目标分镜', { exact: true }).selectOption('s1')
  await page.getByRole('button', { name: '生成首帧预览', exact: true }).click()
  await page.getByRole('img', { name: '生成首帧预览', exact: true }).waitFor()
  assert.equal(writes.length, 11, 'image generation must not save a project resource')
  await page.getByRole('button', { name: '采用媒体到本集草稿', exact: true }).click()
  await page.getByText('生成媒体已加入本集草稿，请检查后保存。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 12)
  assert.equal(writes[11].mutations.length, 1)
  assert.equal(writes[11].mutations[0].id, 'e2')
  assert.equal(writes[11].mutations[0].body.scenes[0].firstFrame, 'https://media.example/image.gif')
  assert.equal(writes[11].mutations[0].body.scenes[0].videoUrl, '/keep.mp4')
  await page.getByRole('button', { name: '生成视频预览', exact: true }).click()
  await page.getByText('正在生成 · 30%', { exact: true }).waitFor()
  assert.equal(writes.length, 12, 'video task submission must not save a project resource')
  await page.getByRole('button', { name: '刷新媒体任务', exact: true }).click()
  await page.getByText('已完成 · 100%', { exact: true }).waitFor()
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 2 && !video.error })
  await page.getByRole('button', { name: '采用媒体到本集草稿', exact: true }).click()
  await page.getByText('生成媒体已加入本集草稿，请检查后保存。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 13)
  assert.equal(writes[12].mutations.length, 1)
  const adoptedVideo = writes[12].mutations[0].body.scenes[0]
  assert.equal(adoptedVideo.videoUrl, 'https://media.example/video.mp4')
  assert.equal(adoptedVideo.firstFrame, 'https://media.example/image.gif')
  assert.equal(adoptedVideo.videoHistory[0].videoUrl, '/keep.mp4')
  await page.reload()
  await page.getByRole('button', { name: '第2集', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '第2集' }).waitFor()
  await page.getByText('已完成 · 100%', { exact: true }).waitFor()
  assert(await page.getByRole('button', { name: '采用媒体到本集草稿', exact: true }).isDisabled())
  assert(await page.getByRole('button', { name: '导出媒体结果', exact: true }).isEnabled())
  await page.getByRole('button', { name: '主角', exact: true }).click()
  await page.locator('button[aria-current="true"]').filter({ hasText: '主角' }).waitFor()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '生成公共资产图片', exact: true }).click()
  await page.getByRole('img', { name: '公共资产生成图片', exact: true }).waitFor()
  assert.equal(writes.length, 13, 'public image generation must not write resources')
  await page.getByRole('button', { name: '采用到公共资产草稿', exact: true }).click()
  await page.getByText('生成媒体已加入公共资产草稿，请检查后保存。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 14)
  assert.equal(writes[13].mutations.length, 1)
  assert.equal(writes[13].mutations[0].type, 'character')
  assert.equal(writes[13].mutations[0].body.baseImage, 'https://media.example/image.gif')
  await page.reload()
  await page.getByRole('button', { name: '主角', exact: true }).click()
  await page.getByRole('img', { name: '公共资产生成图片', exact: true }).waitFor()
  assert(await page.getByRole('button', { name: '采用到公共资产草稿', exact: true }).isDisabled())
  const publicSettings = resources.find(item => item.type === 'settings')
  publicSettings.body.script.assetWorkflow = { props: [{ id: 'prop1', name: '钥匙', referenceImage: 'old' }, { id: 'prop2', name: '背包', referenceImage: 'keep' }] }
  publicSettings.revision++
  await page.reload()
  await page.getByRole('button', { name: '项目设置', exact: true }).click()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('生成目标道具', { exact: true }).selectOption('prop1')
  await page.getByRole('button', { name: '生成公共资产图片', exact: true }).click()
  await page.getByRole('img', { name: '公共资产生成图片', exact: true }).waitFor()
  assert.equal(writes.length, 14)
  await page.getByRole('button', { name: '采用到公共资产草稿', exact: true }).click()
  await page.getByText('生成媒体已加入公共资产草稿，请检查后保存。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 15)
  assert.equal(writes[14].mutations.length, 1)
  assert.equal(writes[14].mutations[0].type, 'settings')
  assert.deepEqual(writes[14].mutations[0].body.script.assetWorkflow.props, [{ id: 'prop1', name: '钥匙', referenceImage: 'https://media.example/image.gif' }, { id: 'prop2', name: '背包', referenceImage: 'keep' }])
  console.log('QA: public voice')
  const character = resources.find(item => item.type === 'character')
  mediaResults.push({ id: 'voice-result', kind: 'asset-voice', status: 'completed', createdAt: '2026-10-19', url: 'https://media.example/voice.wav', voiceAsset: { audioUrl: 'https://media.example/voice.wav', transcript: '自动提取的对白', sourceTaskId: 'video-result' }, collaboration: { projectId: 'qa', actorId: 'qa-user', assetKind: 'character', assetId: character.id, resourceType: 'character', resourceId: character.id, revision: character.revision, settingsRevision: publicSettings.revision } })
  await page.getByRole('button', { name: '主角', exact: true }).click()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByRole('button', { name: '刷新公共媒体结果', exact: true }).click()
  await page.getByText('自动提取的对白', { exact: true }).waitFor()
  assert.equal(writes.length, 15)
  await page.getByRole('button', { name: '采用到公共资产草稿', exact: true }).last().click()
  await page.getByText('生成媒体已加入公共资产草稿，请检查后保存。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('当前对象已保存到云端。', { exact: true }).waitFor()
  assert.equal(writes.length, 16)
  assert.equal(writes[15].mutations[0].type, 'character')
  assert.equal(writes[15].mutations[0].body.voiceAsset.locked, true)
  assert.equal(writes[15].mutations[0].body.baseImage, 'https://media.example/image.gif')
  await page.getByRole('button', { name: '第2集', exact: true }).click()
  await page.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByLabel('本集正文', { exact: true }).fill('断网后自动续传的正文')
  console.log('QA: offline queue')
  disconnectNextWrite = true
  await page.getByRole('button', { name: '保存当前对象', exact: true }).click()
  await page.getByText('提交已保存在本机队列，连接恢复后自动重试；发生版本冲突时停止并保留草稿。', { exact: true }).waitFor()
  assert(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('project-collaboration-outbox:'))))
  await page.reload()
  await page.getByRole('button', { name: /^第2集/ }).click()
  await page.getByText('提交已保存在本机队列，连接恢复后自动重试；发生版本冲突时停止并保留草稿。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('本集正文', { exact: true }).inputValue(), '断网后自动续传的正文')
  disconnectNextWrite = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByText('提交已保存在本机队列，连接恢复后自动重试；发生版本冲突时停止并保留草稿。', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(writes.length, 17)
  assert(offlineOperationIds.length >= 2)
  assert(offlineOperationIds.every(id => id === offlineOperationIds[0]))
  assert.equal(writes[16].mutations[0].body.writing.draft, '断网后自动续传的正文')
  assert(!await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('project-collaboration-outbox:'))))
  console.log('QA: migration dialog')
  await page.goto(`${process.env.COLLABORATION_QA_URL || 'http://localhost:3000'}/projects`)
  await page.getByRole('button', { name: '按集协作', exact: true }).click()
  await page.getByRole('heading', { name: '启用按集协作', exact: true }).waitFor()
  assert(await page.getByRole('button', { name: '备份并启用按集协作', exact: true }).isDisabled())
  await page.getByRole('button', { name: '重新预检', exact: true }).click()
  await page.getByText('迁移试点项目：2 集 · 2 个分镜 · 1 个角色', { exact: true }).waitFor()
  assert.equal(migrationRequests.length, 1)
  assert(await page.getByRole('button', { name: '备份并启用按集协作', exact: true }).isDisabled())
  await page.screenshot({ path: screenshot.replace('.png', '-migration.png'), fullPage: true })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '备份并启用按集协作', exact: true }).click()
  await page.waitForURL('**/projects/qa/collaboration')
  await page.getByRole('heading', { name: '独立设置修改', exact: true }).waitFor()
  assert.equal(migrationRequests.length, 2)
  await page.screenshot({ path: screenshot, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile viewport overflows horizontally')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks: ['read-only before acquire', 'episode-only mutation', 'media retained', 'other episode unchanged', 'character-only mutation', 'reload draft recovery', 'remote conflict preserves draft', 'review before rebase', 'member change CAS', 'member removal CAS', 'settings-only mutation preserves metadata', 'scene creation and reorder', 'scene deletion cancel and confirm', 'atomic episode creation reorder deletion', 'locked episode blocks directory mutation', 'directory conflict review and discard', 'atomic scene transfer retains media', 'generation preview writes nothing', 'generation result survives reload', 'adoption only changes one episode', 'stale generation result blocked', 'image preview does not write resources', 'video task submission does not write resources', 'media adopted into target episode only', 'previous video retained in history', 'media results recover after reload without lease', 'public character image preview and scoped adoption', 'public asset result reload recovery', 'prop adoption preserves other public settings', 'automatic voice candidate adoption preserves image', 'durable offline save resumes after reload with same operation', 'migration preview and confirmation use reviewed versions', 'no browser errors'], writes: writes.map(write => write.mutations.map(({ type, id, expectedRevision }) => ({ type, id, expectedRevision }))), screenshot }, null, 2))
} catch (error) {
  console.error('Failed QA screen:', (await page.locator('main').innerText()).slice(-6000))
  await page.screenshot({ path: screenshot, fullPage: true })
  throw error
} finally { await browser.close() }

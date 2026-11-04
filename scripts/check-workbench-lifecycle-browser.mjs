// Every API is mocked: no project changes and no model calls.
// Exercise real KeepAlive updates; stage controls remain inside their panel.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const engine = playwright[process.env.PLAYWRIGHT_BROWSER || 'firefox']
const browser = await engine.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(15000)
const shots = await mkdtemp(join(tmpdir(), 'playlet-stage-controls-'))
const errors = []
page.on('pageerror', error => errors.push(error.message))

function snapshot(id) {
  return {
    project: {
      id, name: id === 'qa' ? '有分镜项目' : id === 'planned' ? '待解析项目' : '空项目', styleId: 'live_action',
      scriptParseMode: 'premium_drama', aspectRatio: '9:16'
    },
    script: {
      novelText: '甲：“你好。”',
      episodePlan: id === 'qa'
        ? [{ id: 'a', index: 1, title: '第1集', startOffset: 0, endOffset: 8, charCount: 8 }]
        : id === 'planned' ? [1, 2, 3].map(index => ({ id: `episode-${index}`, index, title: `第${index}集`, startOffset: 0, endOffset: 8, charCount: 8 })) : []
    },
    scenes: id === 'qa'
      ? [{ id: 's1', episodeId: 'a', episodeIndex: 1, title: '测试分镜', description: '甲：“你好。”', duration: 8, characters: [] }]
      : [],
    characters: []
  }
}

function resources(id) {
  const project = snapshot(id)
  return [
    {
      type: 'settings', id: 'settings', revision: 1, deleted: false,
      body: { project: project.project, script: { novelText: project.script.novelText }, extra: {} }
    },
    {
      type: 'directory', id: 'directory', revision: 1, deleted: false,
      body: { episodeIds: project.script.episodePlan.map(episode => episode.id) }
    },
    ...project.script.episodePlan.map(plan => ({
      type: 'episode', id: plan.id, revision: 1, deleted: false,
      body: { plan, scenes: project.scenes, writing: null, workbench: { sceneConfigs: {} } }
    }))
  ]
}

await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  const body = route.request().postDataJSON() || {}
  const id = path.match(/^\/api\/project\/([^/]+)/)?.[1]
  let data = {}
  if (path.startsWith('/api/cloud/')) {
    data = { authenticated: true, configured: true, user: { id: 'qa-user', displayName: '测试', role: 'user' } }
  }
  if (path.endsWith('/collaboration/prepare')) {
    // Allow the old project's cached children to update before the new data arrives.
    await new Promise(resolve => setTimeout(resolve, 100))
    data = { enabled: true, editable: true, protocolVersion: 1, resources: resources(id), cursor: 0 }
  } else if (path.endsWith('/collaboration')) {
    if (body.action === 'presence') data = { collaborators: [] }
    if (body.action === 'changes') data = { changes: [], cursor: 0, hasMore: false, editable: true }
    if (body.action === 'lease') data = { editable: true, expiresAt: Date.now() + 90000 }
    if (body.action === 'write') {
      data = {
        resources: (body.mutations || []).map(mutation => ({
          type: mutation.type, id: mutation.id, revision: mutation.expectedRevision + 1,
          deleted: mutation.body === null, body: mutation.body
        }))
      }
    }
  } else if (/^\/api\/project\/(qa|empty|planned)$/.test(path)) {
    data = {
      ...snapshot(id),
      access: { isOwner: true, role: 'owner', permissions: ['view', 'edit', 'generate', 'export', 'manage_members', 'delete'] }
    }
  }
  if (path.includes('/style')) data = { presets: [], categories: [] }
  await route.fulfill({ json: { success: true, data, ...(path === '/api/project/list' ? { projects: [] } : {}) } })
})

async function navigate(url) {
  // Use the application's router so the page is cached instead of reloaded.
  await page.evaluate(url => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url), url)
  await page.waitForTimeout(350)
}

try {
  const base = process.env.WORKBENCH_QA_URL || 'http://127.0.0.1:3000'
  await page.goto(`${base}/asset-workbench?project=qa&stage=videos`)
  await page.getByText('有分镜项目', { exact: true }).waitFor()
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const label of ['资产准备', '分镜视频', '剧本解析', '分镜视频', '成片导出', '资产准备']) {
      await page.getByRole('navigation', { name: '工作台阶段' }).getByRole('button', { name: new RegExp(label) }).click()
      await page.waitForTimeout(80)
      assert.equal(await page.locator('#workbench-stage-toolbar').count(), 0)
      assert.equal(await page.locator('[data-assets-toolbar]:visible').count(), label === '资产准备' ? 1 : 0)
      assert.equal(await page.locator('[data-video-list-toolbar]:visible').count(), label === '分镜视频' ? 1 : 0)
      assert.equal(await page.getByRole('button', { name: '分镜操作', exact: true }).count(), label === '分镜视频' ? 1 : 0)
    }
    await navigate('/projects')
    await navigate('/asset-workbench?project=empty&stage=videos')
    await page.getByText('空项目', { exact: true }).waitFor()
    await page.getByRole('navigation', { name: '工作台阶段' }).getByRole('button', { name: /资产准备/ }).click()
    await navigate('/projects')
    await navigate('/asset-workbench?project=qa&stage=videos')
    await page.getByText('有分镜项目', { exact: true }).waitFor()
  }
  await navigate('/asset-workbench?project=planned&stage=videos')
  await page.getByText('待解析项目', { exact: true }).waitFor()
  await page.getByText('共 3 集', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-video-list-toolbar]:visible').count(), 1)
  assert.equal(await page.getByText(/0\s*\/\s*0 已出片/).count(), 0)
  await page.getByRole('button', { name: '分镜操作', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: '导出格式化 DOCX' }).getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: join(shots, 'planned-dark.png'), animations: 'disabled' })
  await navigate('/asset-workbench?project=qa&stage=videos')
  await page.getByText('有分镜项目', { exact: true }).waitFor()
  await page.getByRole('button', { name: '分镜操作', exact: true }).click()
  assert.notEqual(await page.getByRole('menuitem', { name: '导出格式化 DOCX' }).getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(shots, 'populated-dark.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 900, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: join(shots, 'compact.png'), animations: 'disabled' })
  console.log(`Screenshots: ${shots}`)
  assert.deepEqual(errors, [])
  console.log('PASS: stage switches, toolbar visibility, cached route reactivation, populated/empty project switches')
} finally {
  await browser.close()
}

// Online API fixtures: exercises the real settings UI without installing to the user's database.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await playwright[process.env.PLAYWRIGHT_BROWSER || 'firefox'].launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined })
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const skills = []
let selectedIds = []
let lastInstall
let rateLimited = false
let expired = false
const origin = { provider: 'github', repository: 'example/storyboards', path: 'skills/film', commit: '0123456789012345678901234567890123456789', contentHash: 'fixture', url: 'https://github.com/example/storyboards/tree/0123456789012345678901234567890123456789/skills/film' }
const skill = { id: 'online-film', name: '镜头调度', description: '细化空间关系与动作节奏', version: '012345678901', stages: [], instructions: '明确站位、动作过程、镜头和光线。', files: { 'references/a.md': '动作示例' }, unsupported: [], enabled: true, builtin: false, origin }
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  const path = url.pathname
  const body = route.request().postDataJSON() || {}
  let data = {}
  if (path.startsWith('/api/cloud/')) data = { success: true, data: { authenticated: true, configured: true, user: { id: 'qa', displayName: '测试用户', role: 'user' } } }
  else if (path === '/api/skills/online/search') {
    if (rateLimited) return route.fulfill({ status: 502, json: { message: '在线服务访问受限，请稍后重试' } })
    data = { skills: url.searchParams.get('q') === 'empty' ? [] : [{ name: skill.name, source: 'example/storyboards@film', repository: origin.repository, skillId: 'film', installs: 1234, url: 'https://skills.sh/example/storyboards/film' }] }
  } else if (path === '/api/skills/online/preview') {
    if (body.source === 'example/large@human-writing') {
      data = { kind: 'preview', token: 'large-token', skill: { ...skill, id: 'online-human', name: 'human-writing', instructions: '可完整查看的正文', files: { 'references/long.md': '参考内容'.repeat(12000) + '附件末尾标记' } }, origin, blockingIssues: [], contextSizeBytes: 68000, warnings: ['脚本附件保留，不自动执行'], packageSizeBytes: 92901, fileCount: 11, expiresInSeconds: 900 }
    } else if (body.source === 'example/storyboards' && body.path === undefined) data = { kind: 'choose', repository: origin.repository, commit: origin.commit, paths: ['skills/film', 'skills/blocked'] }
    else {
      if (body.path) assert.equal(body.commit, origin.commit)
      data = { kind: 'preview', token: 'preview-token', skill, origin, blockingIssues: body.path === 'skills/blocked' ? ['不支持 allowed-tools，当前只支持文本指令'] : [], expiresInSeconds: 900 }
    }
  } else if (path === '/api/skills/online/install') {
    if (expired) return route.fulfill({ status: 410, json: { message: '预览已过期，请重新预览' } })
    lastInstall = body
    assert.deepEqual(Object.keys(body).sort(), ['stages', 'token'])
    const installed = { ...skill, ...(body.token === 'large-token' ? { id: 'online-human', name: 'human-writing' } : {}), stages: body.stages, originalDocument: '---\nname: film\n---\n作者原文' }
    skills.push(installed)
    data = { skill: installed }
  } else if (path === '/api/skills') data = { skills }
  else if (path === '/api/project/list') data = { projects: [{ id: 'qa', title: '在线技能测试' }] }
  else if (path.endsWith('/skill-runs')) data = { runs: [] }
  else if (path.endsWith('/skills')) {
    if (route.request().method() === 'PUT') selectedIds = body.selectedIds
    data = { skills, selectedIds, projectName: '在线技能测试', canEdit: true }
  }
  await route.fulfill({ json: data })
})
try {
  const base = process.env.WORKBENCH_QA_URL || 'http://127.0.0.1:3000'
  await page.goto(`${base}/settings?section=skills&project=qa`)
  await page.getByRole('navigation', { name: '技能视图' }).getByRole('button', { name: '发现技能', exact: true }).click()
  const query = page.getByRole('textbox', { name: '技能关键词或链接' })
  await query.fill('storyboard')
  await page.getByRole('button', { name: '搜索技能', exact: true }).click()
  await page.getByRole('button', { name: '预览镜头调度', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: '安装 镜头调度' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '安装到本机', exact: true }).isDisabled(), true)
  await dialog.getByRole('checkbox', { name: '解析后的分镜细化' }).check()
  expired = true
  await dialog.getByRole('button', { name: '安装到本机', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /过期/)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expired = false
  await query.fill('example/storyboards')
  await page.getByRole('button', { name: '预览链接', exact: true }).click()
  await page.getByRole('button', { name: 'skills/blocked', exact: true }).click()
  await dialog.getByText('可以查看，暂不能安装', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '安装到本机', exact: true }).isDisabled(), true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '预览链接', exact: true }).click()
  await page.getByRole('button', { name: 'skills/film', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '解析后的分镜细化' }).check()
  const temp = await mkdtemp(join(tmpdir(), 'playlet-online-skills-ui-'))
  await page.screenshot({ path: join(temp, 'preview.png'), fullPage: true, animations: 'disabled' })
  await dialog.getByRole('button', { name: '安装到本机', exact: true }).click()
  await page.getByRole('switch', { name: '项目使用镜头调度', exact: true }).waitFor()
  assert.deepEqual(lastInstall, { token: 'preview-token', stages: ['scene_detail'] })
  assert.deepEqual(selectedIds, [])
  await page.getByRole('switch', { name: '项目使用镜头调度', exact: true }).click()
  assert.equal(await page.getByRole('navigation', { name: '技能视图' }).getByRole('button', { name: '发现技能', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '保存项目选择', exact: true }).click()
  await page.getByText('项目技能已保存，下次执行时生效。', { exact: true }).waitFor()
  assert.deepEqual(selectedIds, ['online-film'])
  await page.screenshot({ path: join(temp, 'installed-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('navigation', { name: '技能视图' }).getByRole('button', { name: '发现技能', exact: true }).click()
  await query.fill('storyboard')
  await page.getByRole('button', { name: '搜索技能', exact: true }).click()
  await page.getByRole('button', { name: '预览镜头调度', exact: true }).click()
  await dialog.getByText('此技能已安装。如需更换版本或流程绑定，请先在已安装列表卸载。', { exact: true }).waitFor()
  await dialog.getByRole('checkbox', { name: '视频抽帧审片' }).check()
  assert.equal(await dialog.getByRole('button', { name: '安装到本机', exact: true }).isDisabled(), true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await query.fill('example/large@human-writing')
  await page.getByRole('button', { name: '预览链接', exact: true }).click()
  await dialog.getByRole('heading', { name: '安装 human-writing', exact: true }).waitFor()
  await dialog.getByText('脚本附件保留，不自动执行', { exact: true }).waitFor()
  assert.match(await dialog.locator('pre').first().innerText(), /可完整查看的正文/)
  await dialog.getByText('references/long.md', { exact: true }).click()
  assert.match(await dialog.locator('pre').last().innerText(), /附件末尾标记$/)
  await dialog.getByRole('checkbox', { name: '解析后的分镜细化' }).check()
  assert.equal(await dialog.getByRole('button', { name: '安装到本机', exact: true }).isDisabled(), false)
  await dialog.getByRole('button', { name: '安装到本机', exact: true }).click()
  await page.getByRole('switch', { name: '项目使用human-writing', exact: true }).waitFor()
  assert.deepEqual(lastInstall, { token: 'large-token', stages: ['scene_detail'] })
  await page.getByRole('navigation', { name: '技能视图' }).getByRole('button', { name: '发现技能', exact: true }).click()
  rateLimited = true
  await query.fill('lighting')
  await page.getByRole('button', { name: '搜索技能', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /访问受限/)
  assert.equal(await page.getByText('没有找到匹配的技能', { exact: true }).count(), 0)
  rateLimited = false
  await query.fill('empty')
  await page.getByRole('button', { name: '搜索技能', exact: true }).click()
  await page.getByText('没有找到匹配的技能', { exact: true }).waitFor()
  await page.setViewportSize({ width: 820, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: join(temp, 'discover-compact.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('navigation', { name: '技能视图' }).getByRole('button', { name: /已安装/ }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.getByRole('region', { name: '已安装技能' }).waitFor()
  await page.screenshot({ path: join(temp, 'installed-dark.png'), fullPage: true, animations: 'disabled' })
  assert.deepEqual(errors, [])
  console.log('PASS: search, source links, pinned directory selection, preview, explicit binding, incompatibility, expiry, install, duplicate prevention, project activation, network/empty states')
  console.log(`Screenshots: ${temp}`)
} finally { await browser.close() }

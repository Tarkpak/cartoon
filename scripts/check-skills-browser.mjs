// Isolated UI regression: every API is mocked; no project or provider is touched.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await playwright[process.env.PLAYWRIGHT_BROWSER || 'firefox'].launch({
  headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined
})
const temp = await mkdtemp(join(tmpdir(), 'playlet-skills-ui-'))
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
let skills = [
  { id: 'builtin-scene-detail', name: '分镜细化', description: '补全动作和时间轴', version: '1.0.0', stages: ['scene_detail'], instructions: '保留时长', files: {}, unsupported: [], enabled: true, builtin: true },
  { id: 'builtin-video-review', name: '视频审片', description: '检查真实视频抽帧', version: '1.0.0', stages: ['video_review'], instructions: '报告未验证项', files: {}, unsupported: [], enabled: true, builtin: true }
]
let selectedIds = skills.map(skill => skill.id)
const installs = []
let readonly = false
let failSave = false
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  const body = route.request().postDataJSON() || {}
  let data = {}
  if (path.startsWith('/api/cloud/')) {
    data = { success: true, data: { authenticated: true, configured: true, user: { id: 'qa', displayName: '测试用户', role: 'user' } } }
  } else if (path === '/api/project/list') {
    data = { projects: [{ id: 'qa', title: '技能测试项目' }, { id: 'denied', title: '不可访问项目' }, { id: 'untitled', title: '' }] }
  } else if (path === '/api/skills') {
    data = { skills }
  } else if (path === '/api/skills/install') {
    installs.push(body)
    const name = body.zip ? 'ZIP 技能' : '目录技能'
    const skill = { ...skills[0], id: `test-${installs.length}`, name, builtin: false, instructions: '自定义细化指令', files: { 'references/a.md': '细节示例' } }
    skills.push(skill)
    data = { skill }
  } else if (path.startsWith('/api/skills/')) {
    const id = path.split('/').at(-1)
    if (body.remove) { skills = skills.filter(skill => skill.id !== id); selectedIds = selectedIds.filter(value => value !== id) }
    else skills.find(skill => skill.id === id).enabled = body.enabled
    data = { success: true }
  } else if (path.endsWith('/skills')) {
    if (path.includes('/denied/')) return route.fulfill({ status: 403, json: { message: '项目不可访问' } })
    if (route.request().method() === 'PUT') {
      assert.equal(readonly, false)
      if (failSave) return route.fulfill({ status: 503, json: { message: '暂时无法保存，请重试' } })
      selectedIds = body.selectedIds
    }
    data = { skills, selectedIds, projectName: '技能测试项目', canEdit: !readonly }
  } else if (path.endsWith('/skill-runs')) {
    data = { runs: [{ id: 'r1', projectId: 'qa', stage: 'scene_detail', status: 'succeeded', createdAt: new Date().toISOString(), skills: [{ id: 'builtin-scene-detail', name: '分镜细化', version: '1.0.0' }], result: { sceneCount: 3, message: '时间轴与对白校验通过' } }] }
  }
  await route.fulfill({ json: data })
})

try {
  const base = process.env.WORKBENCH_QA_URL || 'http://127.0.0.1:3000'
  await page.goto(`${base}/settings?section=skills&project=qa`)
  await page.getByRole('heading', { name: '技能中心', exact: true }).waitFor()
  await page.getByRole('button', { name: '执行记录', exact: true }).click()
  await page.getByText('时间轴与对白校验通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭执行记录', exact: true }).click()
  await page.getByText('时间轴与对白校验通过', { exact: true }).waitFor({ state: 'hidden' })
  assert.match(await page.locator('body').innerText(), /技能测试项目/)
  await page.getByLabel('配置项目技能').click()
  const picker = page.getByRole('dialog')
  const currentProject = picker.getByRole('button', { name: '技能测试项目', exact: true })
  await currentProject.waitFor()
  assert.equal(await currentProject.getAttribute('aria-current'), 'true')
  await picker.getByRole('button', { name: '未命名项目', exact: true }).waitFor()
  await page.screenshot({ path: join(temp, 'project-picker.png'), fullPage: true, animations: 'disabled' })
  await currentProject.click()

  assert.equal(await page.getByRole('switch', { name: '项目使用分镜细化', exact: true }).getAttribute('aria-checked'), 'true')
  await page.getByRole('switch', { name: '项目使用分镜细化', exact: true }).click()
  assert.equal(await page.getByLabel('配置项目技能').isDisabled(), true)
  failSave = true
  await page.getByRole('button', { name: '保存项目选择', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('switch', { name: '项目使用分镜细化', exact: true }).getAttribute('aria-checked'), 'false')
  assert.deepEqual(selectedIds, ['builtin-scene-detail', 'builtin-video-review'])
  failSave = false
  await page.getByRole('button', { name: '保存项目选择', exact: true }).click()
  await page.getByText('项目技能已保存，下次执行时生效。', { exact: true }).waitFor()
  assert.deepEqual(selectedIds, ['builtin-video-review'])

  const dir = join(temp, 'sample')
  await mkdir(dir)
  await writeFile(join(dir, 'SKILL.md'), '---\nname: ui-example\ndescription: UI测试\nstages: [scene_detail]\n---\n细化描述。')
  await page.getByLabel('选择技能目录', { exact: true }).setInputFiles(dir)
  await page.getByRole('dialog').getByRole('heading', { name: '目录技能', exact: true }).waitFor()
  assert.ok(Object.keys(installs[0].files).some(path => path.endsWith('/SKILL.md')))
  await page.keyboard.press('Escape')
  await page.getByRole('switch', { name: '项目使用目录技能', exact: true }).click()
  await page.getByRole('button', { name: '保存项目选择', exact: true }).click()
  await page.getByText('项目技能已保存，下次执行时生效。', { exact: true }).waitFor()
  assert.ok(selectedIds.includes('test-1'))

  const zip = join(temp, 'sample.zip')
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"SKILL.md"); z.close()', zip, join(dir, 'SKILL.md')])
  await page.getByLabel('选择技能 ZIP', { exact: true }).setInputFiles(zip)
  await page.getByRole('dialog').getByRole('heading', { name: 'ZIP 技能', exact: true }).waitFor()
  assert.equal(Buffer.from(installs[1].zip, 'base64').subarray(0, 2).toString(), 'PK')
  await page.keyboard.press('Escape')
  const row = page.getByRole('article').filter({ has: page.getByRole('button', { name: '目录技能', exact: true }) })
  await row.getByRole('button', { name: '管理目录技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '在本机停用', exact: true }).click()
  await row.getByText('本机已停用', { exact: true }).waitFor()
  assert.equal(skills.find(skill => skill.id === 'test-1').enabled, false)
  await row.getByRole('button', { name: '管理目录技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '卸载技能', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '卸载', exact: true }).click()
  await page.getByText('技能已卸载，项目选择已清理。', { exact: true }).waitFor()
  assert.equal(selectedIds.includes('test-1'), false)

  readonly = true
  await page.getByRole('button', { name: '刷新技能和执行记录', exact: true }).click()
  await page.getByText('当前项目只读，不能修改技能选择。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('switch', { name: '项目使用视频审片', exact: true }).isDisabled(), true)
  await page.screenshot({ path: join(temp, 'skills-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '技能使用帮助', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: '使用技能', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 820, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: join(temp, 'skills-compact.png'), fullPage: true, animations: 'disabled' })
  readonly = false
  await page.getByLabel('配置项目技能').click()
  await page.getByRole('dialog').getByRole('button', { name: '不可访问项目', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('button', { name: '保存项目选择', exact: true }).count(), 0)
  assert.equal(await page.getByRole('switch').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: directory/ZIP uploads, project selection, global disable, uninstall cleanup, execution history, readonly/error states, responsive layout')
  console.log(`Screenshots: ${temp}`)
} finally {
  await browser.close()
  // Keep screenshots for visual inspection; remove only uploaded fixtures.
  await rm(join(temp, 'sample'), { recursive: true, force: true })
  await rm(join(temp, 'sample.zip'), { force: true })
}

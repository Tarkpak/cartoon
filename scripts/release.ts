#!/usr/bin/env bun
/**
 * 自动发版脚本
 * 用法:
 *   bun run release patch   # 1.0.0 -> 1.0.1
 *   bun run release minor   # 1.0.0 -> 1.1.0
 *   bun run release major   # 1.0.0 -> 2.0.0
 *   bun run release 1.2.3   # 指定版本号
 *   bun run release --force # 强制重新发布当前版本（删除旧tag）
 *   bun run release -y      # 跳过确认直接发布
 *
 * 特性:
 *   - 自动将私有仓库临时设为公开（免费使用 GitHub Actions）
 *   - 等待 Actions 构建完成后自动设回私有
 *   - 需要在 .env 中配置 GITHUB_TOKEN
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// 加载 .env 配置
const ENV_FILE = join(ROOT, '.env')
if (existsSync(ENV_FILE)) {
  const envContent = readFileSync(ENV_FILE, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const [, key, value] = match
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value.trim()
      }
    }
  }
}

// GitHub 配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// 文件路径
const PACKAGE_JSON = join(ROOT, 'package.json')

interface PackageJson {
  version: string
  [key: string]: unknown
}

interface GitHubRepo {
  owner: string
  repo: string
}

interface RepoInfo {
  private: boolean
  [key: string]: unknown
}

interface WorkflowRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  head_branch: string
  head_sha: string
  html_url: string
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[]
}

// 读取 JSON 文件
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

// 写入 JSON 文件
function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

// 解析版本号
function parseVersion(version: string): { major: number, minor: number, patch: number } {
  const [major, minor, patch] = version.split('.').map(Number)
  return { major, minor, patch }
}

// 版本号转字符串
function versionToString({ major, minor, patch }: { major: number, minor: number, patch: number }): string {
  return `${major}.${minor}.${patch}`
}

// 递增版本号
function bumpVersion(currentVersion: string, type: string): string {
  const v = parseVersion(currentVersion)

  switch (type) {
    case 'major':
      v.major++
      v.minor = 0
      v.patch = 0
      break
    case 'minor':
      v.minor++
      v.patch = 0
      break
    case 'patch':
      v.patch++
      break
    default:
      // 直接使用指定的版本号
      if (/^\d+\.\d+\.\d+$/.test(type)) {
        return type
      }
      throw new Error(`无效的版本类型: ${type}`)
  }

  return versionToString(v)
}

// 执行命令
function run(cmd: string, options: { cwd?: string, stdio?: 'inherit' | 'pipe' } = {}): void {
  console.log(`> ${cmd}`)
  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: 'inherit',
      ...options
    })
  } catch {
    console.error(`命令执行失败: ${cmd}`)
    process.exit(1)
  }
}

// 获取命令输出
function getOutput(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
}

// ==================== GitHub API 函数 ====================

// 获取仓库信息（从 git remote）
function getRepoFromRemote(): GitHubRepo | null {
  try {
    const url = getOutput('git remote get-url origin')

    // 支持 SSH 和 HTTPS 格式
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
    const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/)

    const match = sshMatch || httpsMatch
    if (match) {
      return { owner: match[1], repo: match[2] }
    }
  } catch {
    // 忽略错误
  }
  return null
}

/**
 * 获取仓库信息（从 GitHub API）
 */
async function getRepoInfo(repo: GitHubRepo): Promise<RepoInfo> {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (!response.ok) {
    throw new Error(`获取仓库信息失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 设置仓库可见性
 */
async function setRepoVisibility(repo: GitHubRepo, isPrivate: boolean): Promise<RepoInfo> {
  const visibility = isPrivate ? '私有' : '公开'
  console.log(`🔄 正在将仓库设为${visibility}...`)

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ private: isPrivate })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`设置仓库可见性失败: ${response.status} - ${error}`)
  }

  console.log(`✅ 仓库已设为${visibility}`)
  return response.json()
}

/**
 * 获取最新的 workflow run
 */
async function getLatestWorkflowRun(repo: GitHubRepo, tagName: string): Promise<WorkflowRun | null> {
  // 等待几秒让 GitHub 处理 push 事件
  await sleep(5000)

  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs?per_page=5`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`获取 workflow runs 失败: ${response.status}`)
  }

  const data: WorkflowRunsResponse = await response.json()

  // 查找与当前 tag 相关的 run
  const run
    = data.workflow_runs.find(r => r.head_branch === tagName || r.head_sha === tagName)
      || data.workflow_runs[0]

  return run || null
}

/**
 * 获取 workflow run 状态
 */
async function getWorkflowRunStatus(repo: GitHubRepo, runId: number): Promise<WorkflowRun> {
  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`获取 workflow run 状态失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 等待 workflow 完成
 */
async function waitForWorkflowCompletion(
  repo: GitHubRepo,
  tagName: string
): Promise<{ success: boolean, run?: WorkflowRun, timeout?: boolean } | null> {
  console.log('\n⏳ 等待 GitHub Actions 开始...')

  const run = await getLatestWorkflowRun(repo, tagName)

  if (!run) {
    console.log('⚠️  未找到 workflow run，跳过等待')
    return null
  }

  console.log(`📋 Workflow: ${run.name}`)
  console.log(`🔗 查看: ${run.html_url}`)

  const startTime = Date.now()
  const maxWaitTime = 60 * 60 * 1000 // 最多等待 60 分钟
  const pollInterval = 30 * 1000 // 每 30 秒检查一次

  while (true) {
    const status = await getWorkflowRunStatus(repo, run.id)
    const elapsed = Math.floor((Date.now() - startTime) / 1000 / 60)

    if (status.status === 'completed') {
      if (status.conclusion === 'success') {
        console.log(`\n✅ Workflow 完成！耗时 ${elapsed} 分钟`)
        return { success: true, run: status }
      } else {
        console.log(`\n❌ Workflow 失败: ${status.conclusion}`)
        return { success: false, run: status }
      }
    }

    // 显示进度
    process.stdout.write(`\r⏳ 状态: ${status.status} | 已等待: ${elapsed} 分钟`)

    if (Date.now() - startTime > maxWaitTime) {
      console.log('\n⚠️  等待超时，将继续设为私有')
      return { success: false, timeout: true }
    }

    await sleep(pollInterval)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 播放提示音
function playSound(): void {
  try {
    // macOS 系统提示音
    execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' })
  } catch {
    // 静默失败，不影响主流程
  }
}

// ==================== Git 相关函数 ====================

// 检查工作区是否干净
function checkWorkingDirectory(): void {
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' })
    if (status.trim()) {
      console.log('\n⚠️  工作区有未提交的更改:')
      console.log(status)
      console.log('请先提交或暂存更改后再发版。\n')
      process.exit(1)
    }
  } catch {
    console.error('Git 检查失败')
    process.exit(1)
  }
}

// 删除本地和远程 tag
function deleteTag(version: string): void {
  const tag = `v${version}`
  console.log(`正在删除旧 tag: ${tag}`)

  // 删除本地 tag
  try {
    execSync(`git tag -d ${tag}`, { cwd: ROOT, stdio: 'pipe' })
    console.log(`✅ 已删除本地 tag: ${tag}`)
  } catch {
    console.log(`ℹ️  本地 tag 不存在: ${tag}`)
  }

  // 删除远程 tag
  try {
    execSync(`git push origin :refs/tags/${tag}`, { cwd: ROOT, stdio: 'pipe' })
    console.log(`✅ 已删除远程 tag: ${tag}`)
  } catch {
    console.log(`ℹ️  远程 tag 不存在: ${tag}`)
  }
}

// 询问用户确认
async function askConfirmation(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return true
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

/**
 * 处理仓库可见性切换的完整流程
 */
async function handleVisibilityToggle(repo: GitHubRepo, tagName: string): Promise<void> {
  let wasPrivate = false

  try {
    // 检查当前状态
    const repoInfo = await getRepoInfo(repo)
    wasPrivate = repoInfo.private

    if (wasPrivate) {
      console.log('\n📦 仓库当前是私有的，临时设为公开以使用免费 Actions...')
      await setRepoVisibility(repo, false)

      // 等待 Actions 完成
      const result = await waitForWorkflowCompletion(repo, tagName)

      // 设回私有
      console.log('\n🔒 正在将仓库设回私有...')
      await setRepoVisibility(repo, true)

      if (result?.success) {
        console.log('\n🎊 构建成功完成，仓库已设回私有！')
      } else if (result?.timeout) {
        console.log('\n⚠️  构建超时，但仓库已设回私有。请手动检查 Actions 状态。')
      } else {
        console.log('\n⚠️  构建可能失败，请检查 Actions 日志。仓库已设回私有。')
      }
    } else {
      console.log('\n📦 仓库已经是公开的，无需切换可见性')
    }
  } catch (error) {
    console.error(`\n❌ 可见性切换出错: ${(error as Error).message}`)

    // 确保在出错时也尝试设回私有
    if (wasPrivate) {
      console.log('🔒 尝试将仓库设回私有...')
      try {
        await setRepoVisibility(repo, true)
        console.log('✅ 仓库已设回私有')
      } catch (e) {
        console.error(`❌ 无法设回私有: ${(e as Error).message}`)
        console.log('⚠️  请手动将仓库设为私有！')
      }
    }
  }
}

// 主函数
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const forceMode = args.includes('--force') || args.includes('-f')
  const skipConfirm = args.includes('--yes') || args.includes('-y')
  const versionType = args.filter(a => !a.startsWith('-'))[0] || (forceMode ? null : 'patch')

  console.log('\n🚀 Manju AI 影视 自动发版\n')

  // 获取仓库信息
  const repo = getRepoFromRemote()

  // 读取当前版本
  const packageJson = readJson<PackageJson>(PACKAGE_JSON)
  const currentVersion = packageJson.version

  // 强制模式：使用当前版本重新发布
  if (forceMode && !versionType) {
    console.log(`🔄 强制重新发布: v${currentVersion}\n`)

    // 确认
    if (!skipConfirm) {
      const confirmed = await askConfirmation(
        '确认强制重新发布? 这将删除旧的 tag 并重新创建 (y/N) '
      )
      if (!confirmed) {
        console.log('已取消')
        process.exit(0)
      }
    }

    // 同步远程
    console.log('正在同步远程仓库...')
    run('git pull --rebase origin master')

    // 删除旧 tag
    deleteTag(currentVersion)

    // 创建新 tag
    run(`git tag v${currentVersion}`)
    console.log(`✅ 创建 tag: v${currentVersion}`)

    // 推送
    run('git push origin master')
    run('git push --tags')
    console.log(`✅ 推送完成`)

    // 如果有 Token，等待 Actions 完成后设回私有
    if (GITHUB_TOKEN && repo) {
      await handleVisibilityToggle(repo, `v${currentVersion}`)
    }

    console.log(`
🎉 强制发版成功！版本: v${currentVersion}
查看构建状态: https://github.com/${repo?.owner}/${repo?.repo}/actions
`)
    playSound()
    return
  }

  // 检查工作区
  checkWorkingDirectory()

  // 计算新版本
  const newVersion = bumpVersion(currentVersion, versionType || 'patch')

  console.log(`📦 版本: ${currentVersion} → ${newVersion}\n`)

  // 确认
  if (!skipConfirm) {
    const confirmed = await askConfirmation('确认发布? (y/N) ')
    if (!confirmed) {
      console.log('已取消')
      process.exit(0)
    }
  }

  // 先拉取远程更改
  console.log('正在同步远程仓库...')
  run('git pull --rebase origin master')
  console.log(`✅ 远程同步完成`)

  // 更新 package.json
  packageJson.version = newVersion
  writeJson(PACKAGE_JSON, packageJson)
  console.log(`✅ 更新 package.json`)

  // Git 提交
  run('git add .')
  run(`git commit -m "chore: release v${newVersion}"`)
  console.log(`✅ Git 提交完成`)

  // 创建 tag
  run(`git tag v${newVersion}`)
  console.log(`✅ 创建 tag: v${newVersion}`)

  // 推送
  run('git push origin master')
  run('git push --tags')
  console.log(`✅ 推送完成`)

  // 如果有 Token，等待 Actions 完成后设回私有
  if (GITHUB_TOKEN && repo) {
    await handleVisibilityToggle(repo, `v${newVersion}`)
  }

  console.log(`
🎉 发版成功！版本: v${newVersion}
查看构建状态: https://github.com/${repo?.owner}/${repo?.repo}/actions
`)
  playSound()
}

main().catch(console.error)

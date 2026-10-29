import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const log = message => console.log(`[desktop:install:windows] ${message}`)

function run(command, args, acceptedCodes = [0]) {
  if (dryRun) {
    log(JSON.stringify([command, ...args]))
    return
  }
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (!acceptedCodes.includes(result.status)) throw new Error(`${command} 执行失败，退出码：${result.status}`)
}

function main() {
  if (process.platform !== 'win32') throw new Error('此脚本仅支持 Windows')
  if (!process.env.LOCALAPPDATA) throw new Error('未找到 LOCALAPPDATA，无法定位客户端安装目录')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const installer = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `Playlet Desktop_${version}_x64-setup.exe`)
  const executable = join(process.env.LOCALAPPDATA, 'Playlet Desktop', 'playlet-desktop.exe')

  log('开始构建 Windows 本地安装包；构建完成后将关闭客户端并安装，请先保存当前工作。')
  run('bun.exe', ['run', 'desktop:build:windows'])
  if (!dryRun && !existsSync(installer)) throw new Error(`未找到安装包：${installer}`)

  // Do not force termination: if Windows cannot close the app, leave it open
  // and stop before installing over its files. 128 means it is not running.
  log('关闭客户端...')
  run('taskkill.exe', ['/IM', 'playlet-desktop.exe', '/T'], [0, 128])
  log('静默安装...')
  run(installer, ['/S'])
  if (!dryRun && !existsSync(executable)) throw new Error(`安装后未找到客户端：${executable}`)
  if (dryRun) {
    log(`启动：${executable}`)
    return
  }
  const child = spawn(executable, [], { cwd: dirname(executable), detached: true, stdio: 'ignore' })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.once('spawn', () => log('安装完成，已启动客户端。'))
  child.unref()
}

try { main() } catch (error) {
  console.error(`[desktop:install:windows] ${error.message}`)
  process.exitCode = 1
}

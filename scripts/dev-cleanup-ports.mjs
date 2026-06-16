import { execFileSync } from 'node:child_process'

const devPorts = [3000, 3001, 3002, 3003, 3004, 3005, 43127]
const allowedProcessNames = ['node', 'bun', 'playlet-desktop', 'playlet-backend']

function normalizeProcessName(name) {
  return name.trim().replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') ?? ''
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function cleanupWindows() {
  const ports = devPorts.join(',')
  const allowed = allowedProcessNames.map(name => `'${name}'`).join(',')
  const script = [
    `$ports = @(${ports})`,
    `$allowed = @(${allowed})`,
    '$connections = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue',
    '$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique',
    'foreach ($processId in $processIds) {',
    '  if ($processId -eq $PID) { continue }',
    '  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue',
    '  if (-not $process) { continue }',
    '  $processName = $process.ProcessName.Replace(".exe", "")',
    '  if ($allowed -notcontains $processName) {',
    '    Write-Host "[dev-cleanup] skip PID $processId ($($process.ProcessName))"',
    '    continue',
    '  }',
    '  Write-Host "[dev-cleanup] stop PID $processId ($($process.ProcessName))"',
    '  Stop-Process -Id $processId -Force',
    '}'
  ].join('; ')

  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script])
}

function cleanupPosix() {
  for (const port of devPorts) {
    let output = ''
    try {
      output = run('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'])
    } catch {
      continue
    }

    for (const pid of output.split(/\r?\n/).filter(Boolean)) {
      let processName = ''
      try {
        processName = normalizeProcessName(run('ps', ['-p', pid, '-o', 'comm=']))
      } catch {
        continue
      }

      if (!allowedProcessNames.includes(processName)) {
        console.log(`[dev-cleanup] skip PID ${pid} (${processName})`)
        continue
      }

      console.log(`[dev-cleanup] stop PID ${pid} (${processName})`)
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        // The process may already have exited.
      }
    }
  }
}

if (process.platform === 'win32') {
  cleanupWindows()
} else {
  cleanupPosix()
}

export async function parseSettingsConfigImportFile(file: File): Promise<unknown> {
  const rawText = await file.text()
  return JSON.parse(rawText)
}

export function buildSettingsConfigExportFileName(kind: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `playlet-${kind}-${timestamp}.json`
}

export function downloadSettingsConfigExport(payload: unknown, kind: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = buildSettingsConfigExportFileName(kind)
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}

function resolveDownloadFileName(response: Response, fallbackKind: string): string {
  const contentDisposition = response.headers.get('content-disposition') || ''
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (asciiMatch?.[1]) {
    return asciiMatch[1]
  }

  return buildSettingsConfigExportFileName(fallbackKind)
}

export interface SettingsConfigExportResult {
  status: 'saved' | 'downloaded' | 'cancelled'
  fileName?: string
  path?: string
}

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const runtime = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
  return !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__
}

function ensureJsonFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith('.json') ? fileName : `${fileName}.json`
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

async function fetchSettingsConfigExportText(url: string, kind: string): Promise<{
  fileName: string
  text: string
}> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('导出配置失败')
  }

  return {
    fileName: resolveDownloadFileName(response, kind),
    text: await response.text()
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }, 1000)
}

export async function downloadSettingsConfigExportUrl(
  url: string,
  kind: string
): Promise<SettingsConfigExportResult> {
  if (isDesktopRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const defaultFileName = buildSettingsConfigExportFileName(kind)
    const selectedPath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
    })

    if (!selectedPath) {
      return { status: 'cancelled' }
    }

    const targetPath = ensureJsonFileName(selectedPath)
    const { text } = await fetchSettingsConfigExportText(url, kind)
    await invoke('save_settings_config_export', {
      path: targetPath,
      content: text
    })

    return {
      status: 'saved',
      fileName: baseName(targetPath),
      path: targetPath
    }
  }

  const { fileName, text } = await fetchSettingsConfigExportText(url, kind)
  downloadBlob(new Blob([text], { type: 'application/json' }), fileName)
  return {
    status: 'downloaded',
    fileName
  }
}

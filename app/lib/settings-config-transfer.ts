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
  anchor.click()

  URL.revokeObjectURL(url)
}

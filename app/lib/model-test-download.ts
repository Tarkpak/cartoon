export async function downloadModelTestMedia(source: string, name: string, fallbackExtension: string) {
  const url = new URL(source, window.location.href)
  const downloadUrl = ['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin
    ? `/api/video/download?${new URLSearchParams({ url: url.href })}`
    : source
  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  const blob = await response.blob()
  const extensions: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
    'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/webm': 'webm'
  }
  const extension = extensions[blob.type.split(';')[0] || ''] || fallbackExtension
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${name}.${extension}`
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }
}

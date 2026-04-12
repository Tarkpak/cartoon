function inferMimeTypeFromBase64(imageData: string): string {
  const head = imageData.slice(0, 16)

  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBOR')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'

  return 'image/png'
}

function looksLikeBase64Image(imageData: string): boolean {
  const head = imageData.slice(0, 16)
  return (
    head.startsWith('/9j/') // jpeg
    || head.startsWith('iVBOR') // png
    || head.startsWith('R0lGOD') // gif
    || head.startsWith('UklGR') // webp
  )
}

/**
 * 将图片字段统一转换为浏览器可直接渲染的 src
 * - 支持 data URL / http(s) URL / 站内相对路径 / blob URL
 * - 对纯 base64 自动补 data URL 前缀
 */
export function toImageSrc(image?: string | null): string {
  if (!image) return ''

  const value = image.trim()
  if (!value) return ''

  // 先判断纯 base64，避免 JPEG 的 /9j/ 被误判为站内路径
  if (looksLikeBase64Image(value)) {
    const mimeType = inferMimeTypeFromBase64(value)
    return `data:${mimeType};base64,${value}`
  }

  if (
    value.startsWith('data:')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('/')
    || value.startsWith('blob:')
  ) {
    if (value.startsWith('/generated-images/')) {
      const filename = value.slice('/generated-images/'.length)
      return filename ? `/api/image/file/${encodeURIComponent(filename)}` : ''
    }
    return value
  }

  if (value.startsWith('ref:')) {
    return ''
  }

  const mimeType = inferMimeTypeFromBase64(value)
  return `data:${mimeType};base64,${value}`
}

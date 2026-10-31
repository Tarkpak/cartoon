export interface ImageTestOptions {
  sizeMode: 'preset' | 'ratio' | 'size' | 'auto'
  ratio: string
  size: string
  background: string
  output_format: string
  output_compression: number
  n: number
  moderation: string
  input_fidelity: string
  mask: string
  markup: string
  stream: boolean
  partial_images: number
}

export function defaultImageTestOptions(): ImageTestOptions {
  return { sizeMode: 'preset', ratio: '16:9', size: '1536x864', background: 'auto', output_format: 'png', output_compression: 100, n: 1, moderation: 'auto', input_fidelity: '', mask: '', markup: '', stream: false, partial_images: 0 }
}

export function imageTestCapabilities(provider = '', model = '') {
  const id = model.trim().replace(/^models\//, '').trim().toLowerCase()
  const gpt = ['openai', 'custom_openai'].includes(provider) && (id.startsWith('gpt-image') || id === 'chatgpt-image-latest')
  return {
    gpt,
    customSize: gpt && id.startsWith('gpt-image-2'),
    fidelity: gpt && (id.startsWith('gpt-image-1.5') || id.startsWith('gpt-image-1-mini')),
    highFidelity: id.startsWith('gpt-image-1.5'),
    markup: gpt && /^gpt-image-2\.[56]/.test(id)
  }
}

export function buildImageTestOptions(options: ImageTestOptions, provider: string, model: string, references: number) {
  const capabilities = imageTestCapabilities(provider, model)
  if (!capabilities.gpt) return undefined
  if (!Number.isInteger(options.n) || options.n < 1 || options.n > 10) throw new Error('生成数量需为 1–10 的整数')
  if (options.output_format !== 'png' && (!Number.isInteger(options.output_compression) || options.output_compression < 0 || options.output_compression > 100)) throw new Error('压缩质量需为 0–100 的整数')
  if (options.stream && (!Number.isInteger(options.partial_images) || options.partial_images < 0 || options.partial_images > 3)) throw new Error('中间预览数量需为 0–3 的整数')
  if (options.background === 'transparent' && options.output_format === 'jpeg') throw new Error('透明背景请选择 PNG 或 WebP')
  if (options.mask && options.markup) throw new Error('蒙版与标注图不能同时使用')
  if ((options.mask || options.markup) && references === 0) throw new Error('使用蒙版或标注图前请先上传参考图')
  const result: Record<string, string | number | boolean> = {
    background: options.background, output_format: options.output_format, n: options.n, moderation: options.moderation
  }
  if (options.output_format !== 'png') result.output_compression = options.output_compression
  if (references > 0) {
    if (capabilities.fidelity && options.input_fidelity) result.input_fidelity = options.input_fidelity
    if (options.mask) result.mask = options.mask
    if (capabilities.markup && options.markup) result.markup = options.markup
  }
  if (options.stream) { result.stream = true; result.partial_images = options.partial_images }
  return result
}

export function normalizeImageTestRatio(value: string): string {
  const match = value.trim().match(/^(\d+(?:\.\d{1,4})?)\s*:\s*(\d+(?:\.\d{1,4})?)$/)
  if (!match) throw new Error('请输入有效比例，例如 16:9 或 2.39:1')
  const decimals = Math.max((match[1]!.split('.')[1] || '').length, (match[2]!.split('.')[1] || '').length)
  const scale = 10 ** decimals
  const width = Math.round(Number(match[1]) * scale)
  const height = Math.round(Number(match[2]) * scale)
  if (width <= 0 || height <= 0 || width > 1e9 || height > 1e9) throw new Error('请输入有效的正数比例')
  if (Math.max(width, height) > Math.min(width, height) * 3) throw new Error('图片长短边比例不能超过 3:1')
  let a = width
  let b = height
  while (b) { const remainder = a % b; a = b; b = remainder }
  return `${width / a}:${height / a}`
}

export interface ImageTestSizeSelection {
  provider: string
  model: string
  aspectRatio: string
  resolution: string
  size: string
  hasResolution: boolean
  hasSize: boolean
}

export function buildImageTestSizeParameters(options: ImageTestOptions, selection: ImageTestSizeSelection): Record<string, string> {
  const capabilities = imageTestCapabilities(selection.provider, selection.model)
  if (capabilities.gpt) {
    if (options.sizeMode === 'auto') return { imageSize: 'auto' }
    if (options.sizeMode === 'size') {
      if (!capabilities.customSize) throw new Error('当前模型不支持自定义像素尺寸')
      const size = options.size.toLowerCase().replace(/[×*]/g, 'x').replace(/\s/g, '')
      const match = size.match(/^(\d+)x(\d+)$/)
      const width = Number(match?.[1])
      const height = Number(match?.[2])
      if (!width || !height || width % 16 || height % 16 || Math.max(width, height) > 3840
        || Math.max(width, height) > Math.min(width, height) * 3
        || width * height < 655360 || width * height > 8294400) {
        throw new Error('尺寸需为 16 的倍数，长短边比不超过 3:1，最长边不超过 3840，总像素在 655360–8294400 之间')
      }
      return { imageSize: size }
    }
    if (options.sizeMode === 'ratio') {
      if (!capabilities.customSize) throw new Error('当前模型不支持自定义比例')
      return { imageAspectRatio: normalizeImageTestRatio(options.ratio), imageResolution: selection.resolution }
    }
  }
  const result: Record<string, string> = {}
  if (selection.aspectRatio) result.imageAspectRatio = selection.aspectRatio
  if (selection.hasResolution) result.imageResolution = selection.resolution
  else if (selection.hasSize) result.imageSize = selection.size
  return result
}

export function resolveImageTestResolution(current: string, supported: readonly string[]): string {
  return supported.includes(current) ? current : supported.includes('4K') ? '4K' : supported[0] || ''
}

export function imageTestResultUrls(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const image = result as { imageUrl?: unknown, imageUrls?: unknown }
  const urls = Array.isArray(image.imageUrls)
    ? image.imageUrls.filter((url): url is string => typeof url === 'string' && !!url.trim())
    : []
  return urls.length ? urls : typeof image.imageUrl === 'string' && image.imageUrl.trim() ? [image.imageUrl] : []
}

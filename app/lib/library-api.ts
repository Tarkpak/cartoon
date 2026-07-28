import type {
  LibraryAsset,
  LibraryAssetCategory,
  LibraryAssetShare,
  LibraryAssetVersion,
  LibraryMediaType,
  LibrarySourceType,
  LibraryVisibility
} from '#shared/types/library'

export interface LibraryAssetListResponse {
  success: boolean
  data: {
    items: LibraryAsset[]
    total: number
    page: number
    pageSize: number
  }
}

export interface CreateLibraryAssetInput {
  id?: string
  mediaType: LibraryMediaType
  category: LibraryAssetCategory
  name: string
  description?: string
  tags?: string[]
  mediaData?: string
  sourceUrl?: string
  sourceType?: LibrarySourceType
  sourceProjectId?: string
  mimeType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentHash?: string
  perceptualHash?: string
  copyrightNote?: string
  licenseExpiresAt?: string
  favorite?: boolean
  visibility?: LibraryVisibility
  bundle?: LibraryAsset['bundle']
  shares?: LibraryAssetShare[]
}

export async function listLibraryAssets(filters: {
  mediaType?: LibraryMediaType
  category?: LibraryAssetCategory
  keyword?: string
  favorite?: boolean
  includeDeleted?: boolean
  page?: number
  pageSize?: number
} = {}) {
  return await $fetch<LibraryAssetListResponse>('/api/library/assets', {
    query: filters
  })
}

export async function listAllLibraryAssets(filters: Omit<Parameters<typeof listLibraryAssets>[0], 'page' | 'pageSize'> = {}) {
  const pageSize = 200
  const items: LibraryAsset[] = []
  let page = 1
  let total = 0
  do {
    const response = await listLibraryAssets({ ...filters, page, pageSize })
    items.push(...response.data.items)
    total = response.data.total
    page += 1
  } while (items.length < total)

  return items
}

export async function createLibraryAsset(input: CreateLibraryAssetInput) {
  const response = await $fetch<{ success: boolean, data: { asset: LibraryAsset } }>('/api/library/assets', {
    method: 'POST',
    body: input
  })
  return response.data.asset
}

export async function getLibraryAsset(id: string) {
  const response = await $fetch<{
    success: boolean
    data: { asset: LibraryAsset, versions: LibraryAssetVersion[] }
  }>(`/api/library/assets/${encodeURIComponent(id)}`)
  return response.data
}

export async function updateLibraryAsset(id: string, input: Partial<CreateLibraryAssetInput> & {
  url?: string
  restore?: boolean
  changeNote?: string
}) {
  const response = await $fetch<{ success: boolean, data: { asset: LibraryAsset } }>(`/api/library/assets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input
  })
  return response.data.asset
}

export async function deleteLibraryAsset(id: string) {
  await $fetch(`/api/library/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function batchUpdateLibraryAssets(input: {
  ids: string[]
  action: 'favorite' | 'tags' | 'category' | 'delete'
  favorite?: boolean
  tags?: string[]
  category?: LibraryAssetCategory
}) {
  const response = await $fetch<{ success: boolean, data: { items: LibraryAsset[] } }>('/api/library/assets/batch', {
    method: 'POST',
    body: input
  })
  return response.data.items
}

export async function markLibraryAssetUsed(id: string) {
  const response = await $fetch<{ success: boolean, data: { asset: LibraryAsset } }>(`/api/library/assets/${encodeURIComponent(id)}/mark-used`, {
    method: 'POST'
  })
  return response.data.asset
}

export async function listLibraryMembers() {
  const response = await $fetch<{
    success: boolean
    data: { members: Array<{ id: string, account: string, displayName: string, role: string }> }
  }>('/api/library/members')
  return response.data.members
}

export async function fileToLibraryDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export async function fileSha256(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function readImageMetadata(file: File): Promise<{
  width?: number
  height?: number
  perceptualHash?: string
}> {
  if (!file.type.startsWith('image/')) return {}
  const source = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片解析失败'))
      element.src = source
    })
    const canvas = document.createElement('canvas')
    canvas.width = 9
    canvas.height = 8
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return { width: image.naturalWidth, height: image.naturalHeight }
    context.drawImage(image, 0, 0, 9, 8)
    const pixels = context.getImageData(0, 0, 9, 8).data
    let bits = ''
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const left = (y * 9 + x) * 4
        const right = left + 4
        const leftLuma = pixels[left]! * 0.299 + pixels[left + 1]! * 0.587 + pixels[left + 2]! * 0.114
        const rightLuma = pixels[right]! * 0.299 + pixels[right + 1]! * 0.587 + pixels[right + 2]! * 0.114
        bits += leftLuma > rightLuma ? '1' : '0'
      }
    }
    const perceptualHash = bits.match(/.{4}/g)?.map(chunk => Number.parseInt(chunk, 2).toString(16)).join('')
    return { width: image.naturalWidth, height: image.naturalHeight, perceptualHash }
  } finally {
    URL.revokeObjectURL(source)
  }
}

export async function readAudioDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith('audio/')) return undefined
  const source = URL.createObjectURL(file)
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio()
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('音频解析失败'))
      audio.src = source
    })
    return Number.isFinite(duration) ? Math.round(duration * 1000) : undefined
  } finally {
    URL.revokeObjectURL(source)
  }
}

export async function readRemoteLibraryMetadata(url: string, mediaType: LibraryMediaType): Promise<Partial<CreateLibraryAssetInput>> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取素材元数据失败 (${response.status})`)
  const blob = await response.blob()
  const extension = blob.type.split('/').at(-1) || (mediaType === 'image' ? 'png' : 'mp3')
  const file = new File([blob], `library-asset.${extension}`, { type: blob.type })
  const [contentHash, imageMetadata, durationMs] = await Promise.all([
    fileSha256(file),
    readImageMetadata(file).catch(() => ({})),
    readAudioDuration(file).catch(() => undefined)
  ])
  return {
    mimeType: blob.type || undefined,
    sizeBytes: blob.size,
    contentHash,
    durationMs,
    ...imageMetadata
  }
}

export function perceptualHashDistance(left?: string, right?: string): number | undefined {
  if (!left || !right || left.length !== right.length) return undefined
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16)
    distance += xor.toString(2).replaceAll('0', '').length
  }
  return distance
}

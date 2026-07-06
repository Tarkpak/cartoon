import type { ArkVirtualAssetBinding, ArkVirtualAssetStatus } from '~/lib/asset-workbench-types'

interface ArkAssetResponse {
  Id?: string
  GroupId?: string
  Status?: string
  ProjectName?: string
  URL?: string
  Name?: string
  AssetType?: 'Image' | 'Video' | 'Audio'
}

function normalizeStatus(status: unknown): ArkVirtualAssetStatus {
  if (status === 'Processing' || status === 'Active' || status === 'Failed') return status
  return 'Unknown'
}

function normalizeAssetResponse(asset: ArkAssetResponse | undefined, fallback: Partial<ArkVirtualAssetBinding>): ArkVirtualAssetBinding {
  return {
    provider: 'volcengine',
    libraryType: 'virtual_human',
    projectName: asset?.ProjectName || fallback.projectName || 'default',
    groupId: asset?.GroupId || fallback.groupId || '',
    assetId: asset?.Id || fallback.assetId,
    assetType: asset?.AssetType || fallback.assetType || 'Image',
    sourceUrl: asset?.URL || fallback.sourceUrl,
    name: asset?.Name || fallback.name,
    status: normalizeStatus(asset?.Status || fallback.status || 'Processing'),
    errorMessage: fallback.errorMessage,
    updatedAt: new Date().toISOString()
  }
}

export async function createArkVirtualAssetGroup(input: {
  name: string
  description?: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: { Id?: string }
    message?: string
  }>('/api/ark-assets/virtual/groups', {
    method: 'POST',
    body: input
  })

  if (!response.success || !response.data?.Id) {
    throw new Error(response.message || '创建火山虚拟人像素材组失败')
  }

  return response.data.Id
}

export async function uploadArkVirtualAsset(input: {
  groupId: string
  name: string
  sourceUrl?: string
  imageData?: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: {
      sourceUrl?: string
      asset?: ArkAssetResponse
    }
    message?: string
  }>('/api/ark-assets/virtual/assets/upload', {
    method: 'POST',
    body: input
  })

  if (!response.success || !response.data?.asset?.Id) {
    throw new Error(response.message || '上传火山虚拟人像素材失败')
  }

  return normalizeAssetResponse(response.data.asset, {
    groupId: input.groupId,
    projectName: input.projectName,
    sourceUrl: response.data.sourceUrl || input.sourceUrl,
    name: input.name,
    status: 'Processing'
  })
}

export async function pollArkVirtualAsset(input: {
  assetId: string
  projectName?: string
  timeoutMs?: number
  intervalMs?: number
  fallback?: Partial<ArkVirtualAssetBinding>
}) {
  const response = await $fetch<{
    success: boolean
    data?: {
      asset?: ArkAssetResponse
      status?: string
    }
    timeout?: boolean
    message?: string
  }>(`/api/ark-assets/virtual/assets/${encodeURIComponent(input.assetId)}/poll`, {
    method: 'POST',
    body: {
      projectName: input.projectName,
      timeoutMs: input.timeoutMs,
      intervalMs: input.intervalMs
    }
  })

  if (!response.success || !response.data?.asset) {
    throw new Error(response.message || '查询火山虚拟人像素材状态失败')
  }

  return {
    asset: normalizeAssetResponse(response.data.asset, {
      ...input.fallback,
      assetId: input.assetId,
      projectName: input.projectName || input.fallback?.projectName,
      status: normalizeStatus(response.data.status)
    }),
    timeout: response.timeout === true
  }
}

import type { ArkVirtualAssetBinding, ArkVirtualAssetStatus } from '~/lib/asset-workbench-types'
import { resolveApiErrorMessage } from '~/lib/api-error'

export interface ArkVirtualAssetGroup {
  Id: string
  Name?: string
  Title?: string
  Description?: string
  GroupType?: string
  ProjectName?: string
  CreateTime?: string
  UpdateTime?: string
}

export interface ArkVirtualAssetListItem {
  Id: string
  GroupId?: string
  Status?: string
  ProjectName?: string
  URL?: string
  Name?: string
  AssetType?: 'Image' | 'Video' | 'Audio'
  CreateTime?: string
  UpdateTime?: string
  Moderation?: unknown
}

export interface ArkVirtualAssetPage<T> {
  items: T[]
  totalCount: number
  pageNumber: number
  pageSize: number
  credentialFingerprint?: string
}

interface ArkAssetResponse {
  Id?: string
  GroupId?: string
  Status?: string
  ProjectName?: string
  URL?: string
  Name?: string
  AssetType?: 'Image' | 'Video' | 'Audio'
}

interface ArkListResponse<T> {
  Items?: T[]
  TotalCount?: number
  PageNumber?: number
  PageSize?: number
  CredentialFingerprint?: string
}

function normalizePage<T>(data: ArkListResponse<T> | undefined, fallbackPageNumber: number, fallbackPageSize: number): ArkVirtualAssetPage<T> {
  return {
    items: Array.isArray(data?.Items) ? data.Items : [],
    totalCount: Number(data?.TotalCount || 0),
    pageNumber: Number(data?.PageNumber || fallbackPageNumber),
    pageSize: Number(data?.PageSize || fallbackPageSize),
    credentialFingerprint: data?.CredentialFingerprint
  }
}

function normalizeStatus(status: unknown): ArkVirtualAssetStatus {
  if (status === 'Processing' || status === 'Active' || status === 'Failed' || status === 'Stale') return status
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
    credentialFingerprint: fallback.credentialFingerprint,
    updatedAt: new Date().toISOString()
  }
}

export async function getArkCredentialContext() {
  const response = await $fetch<{
    success: boolean
    data?: { credentialFingerprint?: string }
  }>('/api/ark-assets/context')

  return {
    credentialFingerprint: response.data?.credentialFingerprint?.trim() || undefined
  }
}

export function applyArkVirtualAssetBinding(
  target: { arkAsset?: ArkVirtualAssetBinding, baseImage?: string },
  asset: ArkVirtualAssetBinding
) {
  target.arkAsset = asset
  target.baseImage = asset.sourceUrl?.trim() || undefined
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

export async function listArkVirtualAssetGroups(input: {
  name?: string
  groupId?: string
  projectName?: string
  pageNumber?: number
  pageSize?: number
} = {}) {
  const pageNumber = input.pageNumber || 1
  const pageSize = input.pageSize || 20
  const response = await $fetch<{
    success: boolean
    data?: ArkListResponse<ArkVirtualAssetGroup>
    message?: string
  }>('/api/ark-assets/virtual/groups', {
    query: {
      name: input.name || undefined,
      groupId: input.groupId || undefined,
      projectName: input.projectName || undefined,
      pageNumber,
      pageSize
    }
  })

  if (!response.success) {
    throw new Error(response.message || '查询火山虚拟人像素材组失败')
  }

  return normalizePage(response.data, pageNumber, pageSize)
}

export async function updateArkVirtualAssetGroup(input: {
  groupId: string
  name?: string
  title?: string
  description?: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: unknown
    message?: string
  }>(`/api/ark-assets/virtual/groups/${encodeURIComponent(input.groupId)}`, {
    method: 'PUT',
    body: {
      name: input.name,
      title: input.title,
      description: input.description,
      projectName: input.projectName
    }
  })

  if (!response.success) {
    throw new Error(response.message || '更新火山虚拟人像素材组失败')
  }

  return response.data
}

export async function deleteArkVirtualAssetGroup(input: {
  groupId: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: unknown
    message?: string
  }>(`/api/ark-assets/virtual/groups/${encodeURIComponent(input.groupId)}`, {
    method: 'DELETE',
    query: {
      projectName: input.projectName || undefined
    }
  })

  if (!response.success) {
    throw new Error(response.message || '删除火山虚拟人像素材组失败')
  }

  return response.data
}

export async function uploadArkVirtualAsset(input: {
  groupId: string
  name: string
  sourceUrl?: string
  imageData?: string
  projectName?: string
}) {
  let response: {
    success: boolean
    data?: {
      sourceUrl?: string
      asset?: ArkAssetResponse
      credentialFingerprint?: string
    }
    message?: string
  }

  try {
    response = await $fetch('/api/ark-assets/virtual/assets/upload', {
      method: 'POST',
      body: input
    })
  } catch (error) {
    throw new Error(resolveApiErrorMessage(error, '上传火山虚拟人像素材失败'))
  }

  if (!response.success || !response.data?.asset?.Id) {
    throw new Error(response.message || '上传火山虚拟人像素材失败')
  }

  return normalizeAssetResponse(response.data.asset, {
    groupId: input.groupId,
    projectName: input.projectName,
    sourceUrl: response.data.sourceUrl || input.sourceUrl,
    name: input.name,
    credentialFingerprint: response.data.credentialFingerprint,
    status: 'Processing'
  })
}

export async function listArkVirtualAssets(input: {
  groupId?: string
  name?: string
  status?: string
  projectName?: string
  pageNumber?: number
  pageSize?: number
} = {}) {
  const pageNumber = input.pageNumber || 1
  const pageSize = input.pageSize || 20
  const response = await $fetch<{
    success: boolean
    data?: ArkListResponse<ArkVirtualAssetListItem>
    message?: string
  }>('/api/ark-assets/virtual/assets', {
    method: 'POST',
    body: {
      groupId: input.groupId,
      name: input.name,
      status: input.status,
      projectName: input.projectName,
      pageNumber,
      pageSize,
      sortBy: 'UpdateTime',
      sortOrder: 'Desc'
    }
  })

  if (!response.success) {
    throw new Error(response.message || '查询火山虚拟人像素材失败')
  }

  return normalizePage(response.data, pageNumber, pageSize)
}

export async function updateArkVirtualAsset(input: {
  assetId: string
  name?: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: unknown
    message?: string
  }>(`/api/ark-assets/virtual/assets/${encodeURIComponent(input.assetId)}`, {
    method: 'PUT',
    body: {
      name: input.name,
      projectName: input.projectName
    }
  })

  if (!response.success) {
    throw new Error(response.message || '更新火山虚拟人像素材失败')
  }

  return response.data
}

export async function getArkVirtualAsset(input: {
  assetId: string
  projectName?: string
  fallback?: Partial<ArkVirtualAssetBinding>
}) {
  const response = await $fetch<{
    success: boolean
    data?: {
      asset?: ArkAssetResponse
      status?: string
      credentialFingerprint?: string
    }
    message?: string
  }>(`/api/ark-assets/virtual/assets/${encodeURIComponent(input.assetId)}`, {
    query: {
      projectName: input.projectName || undefined
    }
  })

  if (!response.success || !response.data?.asset) {
    throw new Error(response.message || '当前火山账号无法访问该素材')
  }

  return normalizeAssetResponse(response.data.asset, {
    ...input.fallback,
    assetId: input.assetId,
    projectName: input.projectName || input.fallback?.projectName,
    credentialFingerprint: response.data.credentialFingerprint,
    status: normalizeStatus(response.data.status)
  })
}

export async function deleteArkVirtualAsset(input: {
  assetId: string
  projectName?: string
}) {
  const response = await $fetch<{
    success: boolean
    data?: unknown
    message?: string
  }>(`/api/ark-assets/virtual/assets/${encodeURIComponent(input.assetId)}`, {
    method: 'DELETE',
    query: {
      projectName: input.projectName || undefined
    }
  })

  if (!response.success) {
    throw new Error(response.message || '删除火山虚拟人像素材失败')
  }

  return response.data
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
      credentialFingerprint?: string
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
      credentialFingerprint: response.data.credentialFingerprint || input.fallback?.credentialFingerprint,
      status: normalizeStatus(response.data.status)
    }),
    timeout: response.timeout === true
  }
}

export const COLLABORATION_PROTOCOL_VERSION = 1
export const COLLABORATION_RESOURCE_TYPES = ['settings', 'directory', 'episode', 'character'] as const
export type CollaborationResourceType = typeof COLLABORATION_RESOURCE_TYPES[number]
export type CollaborationBody = Record<string, unknown>

export interface CollaborationResource {
  type: CollaborationResourceType
  id: string
  revision: number
  body: CollaborationBody | null
  deleted: boolean
}

export interface CollaborationMutation {
  type: CollaborationResourceType
  id: string
  expectedRevision: number
  leaseToken: string
  body: CollaborationBody | null
}

export interface CollaborationChange extends CollaborationResource {
  sequence: number
  userId: string
  operationId: string
  createdAt: string
}

export interface CollaborationLease {
  editable: boolean
  token?: string
  expiresAt: number | null
  holderUserId?: string
  canTakeover: boolean
}

export function collaborationObject(value: unknown, label: string): CollaborationBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as CollaborationBody
}

export function collaborationId(value: unknown, label = '对象 ID'): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128) {
    throw new Error(`${label}无效`)
  }
  return value
}

export function collaborationResourceType(value: unknown): CollaborationResourceType {
  if (!COLLABORATION_RESOURCE_TYPES.includes(value as CollaborationResourceType)) throw new Error('对象类型无效')
  return value as CollaborationResourceType
}

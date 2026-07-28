import { z } from 'zod'

export const LibraryMediaTypeSchema = z.enum(['image', 'audio'])
export type LibraryMediaType = z.infer<typeof LibraryMediaTypeSchema>

export const LibraryAssetCategorySchema = z.enum([
  'character',
  'environment',
  'prop',
  'style',
  'character_voice',
  'narration',
  'bgm',
  'sfx',
  'other'
])
export type LibraryAssetCategory = z.infer<typeof LibraryAssetCategorySchema>

export const LibraryVisibilitySchema = z.enum(['private', 'shared'])
export type LibraryVisibility = z.infer<typeof LibraryVisibilitySchema>

export const LibrarySharePermissionSchema = z.enum(['view', 'use', 'edit'])
export type LibrarySharePermission = z.infer<typeof LibrarySharePermissionSchema>

export const LibrarySourceTypeSchema = z.enum(['upload', 'url', 'generated', 'project'])
export type LibrarySourceType = z.infer<typeof LibrarySourceTypeSchema>

export const LibraryCharacterBundleSchema = z.object({
  characterName: z.string().optional(),
  appearance: z.string().optional(),
  generationPrompt: z.string().optional(),
  role: z.string().optional(),
  gender: z.string().optional(),
  age: z.number().optional(),
  clothing: z.string().optional(),
  baseImageAssetId: z.string().optional(),
  viewAssetIds: z.record(z.string(), z.string()).optional(),
  expressionAssetIds: z.array(z.string()).optional(),
  poseAssetIds: z.array(z.string()).optional(),
  voiceAssetId: z.string().optional()
})
export type LibraryCharacterBundle = z.infer<typeof LibraryCharacterBundleSchema>

export const LibraryAssetReferenceSchema = z.object({
  assetId: z.string(),
  version: z.number().int().positive(),
  url: z.string()
})
export type LibraryAssetReference = z.infer<typeof LibraryAssetReferenceSchema>

export const LibraryAssetShareSchema = z.object({
  userId: z.string(),
  account: z.string(),
  displayName: z.string(),
  permission: LibrarySharePermissionSchema
})
export type LibraryAssetShare = z.infer<typeof LibraryAssetShareSchema>

export const LibraryAssetSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  ownerAccount: z.string().optional(),
  ownerDisplayName: z.string().optional(),
  mediaType: LibraryMediaTypeSchema,
  category: LibraryAssetCategorySchema,
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  url: z.string(),
  objectKey: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  contentHash: z.string().optional(),
  perceptualHash: z.string().optional(),
  sourceType: LibrarySourceTypeSchema,
  sourceUrl: z.string().optional(),
  sourceProjectId: z.string().optional(),
  copyrightNote: z.string().default(''),
  licenseExpiresAt: z.string().optional(),
  favorite: z.boolean().default(false),
  visibility: LibraryVisibilitySchema.default('private'),
  permission: LibrarySharePermissionSchema.default('edit'),
  useCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().optional(),
  bundle: LibraryCharacterBundleSchema.optional(),
  shares: z.array(LibraryAssetShareSchema).default([]),
  version: z.number().int().positive().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional()
})
export type LibraryAsset = z.infer<typeof LibraryAssetSchema>

export const LibraryAssetVersionSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  version: z.number().int().positive(),
  url: z.string(),
  objectKey: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  contentHash: z.string().optional(),
  changeNote: z.string().default(''),
  createdAt: z.string()
})
export type LibraryAssetVersion = z.infer<typeof LibraryAssetVersionSchema>

export const LIBRARY_CATEGORY_LABELS: Record<LibraryAssetCategory, string> = {
  character: '角色图',
  environment: '场景图',
  prop: '道具图',
  style: '画风参考',
  character_voice: '角色音色',
  narration: '旁白',
  bgm: '背景音乐',
  sfx: '音效',
  other: '其他'
}

export function libraryCategoryMediaType(category: LibraryAssetCategory): LibraryMediaType {
  return ['character_voice', 'narration', 'bgm', 'sfx'].includes(category) ? 'audio' : 'image'
}

export function libraryPermissionCanUse(permission: LibrarySharePermission): boolean {
  return permission === 'use' || permission === 'edit'
}

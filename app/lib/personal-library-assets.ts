import type { LibraryAsset } from '#shared/types/library'
import type { CreateLibraryAssetInput } from './library-api'

/** Same names may have different generated results; shared assets are not ours. */
export function findPersonalLibraryAsset(assets: LibraryAsset[], input: CreateLibraryAssetInput, userId?: string) {
  const sourceUrl = input.sourceUrl?.trim()
  if (!sourceUrl) return undefined
  return assets.find(asset => !asset.deletedAt && asset.permission === 'edit'
    && (!asset.ownerUserId || asset.ownerUserId === userId)
    && asset.category === input.category && asset.mediaType === input.mediaType
    && (asset.url === sourceUrl || asset.sourceUrl === sourceUrl))
}

import type { LibraryAsset } from '#shared/types/library'
import type { CreateLibraryAssetInput } from './library-api'
import type { ComputedRef, InjectionKey } from 'vue'

export const personalLibraryFavoriteKeys: InjectionKey<ComputedRef<ReadonlySet<string>>> = Symbol('personal-library-favorites')
export type PersonalLibrarySource = Pick<CreateLibraryAssetInput, 'sourceUrl' | 'category' | 'mediaType'>

/** Same names may have different generated results; shared assets are not ours. */
export function findPersonalLibraryAsset(assets: LibraryAsset[], input: PersonalLibrarySource, userId?: string) {
  const sourceUrl = input.sourceUrl?.trim()
  if (!sourceUrl) return undefined
  return assets.find(asset => !asset.deletedAt && asset.permission === 'edit'
    && (!asset.ownerUserId || asset.ownerUserId === userId)
    && asset.category === input.category && asset.mediaType === input.mediaType
    && (asset.url === sourceUrl || asset.sourceUrl === sourceUrl))
}

export function isPersonalLibraryFavorite(assets: LibraryAsset[], sources: PersonalLibrarySource[], userId?: string) {
  const available = sources.filter(source => source.sourceUrl?.trim())
  return available.length > 0 && available.every(source => findPersonalLibraryAsset(assets, source, userId)?.favorite === true)
}

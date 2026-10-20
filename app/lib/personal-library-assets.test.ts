import { describe, expect, it } from 'vitest'
import { LibraryAssetSchema } from '#shared/types/library'
import { findPersonalLibraryAsset, isPersonalLibraryFavorite } from './personal-library-assets'

const asset = (input = {}) => LibraryAssetSchema.parse({ id: 'saved', ownerUserId: 'me', name: '角色', category: 'character', mediaType: 'image', url: 'https://cdn/saved.png', sourceUrl: 'https://source/old.png', sourceType: 'project', createdAt: 'now', updatedAt: 'now', ...input })
const job = { name: '角色', category: 'character' as const, mediaType: 'image' as const, sourceUrl: 'https://source/old.png' }

describe('personal library asset reuse', () => {
  it('reuses the same owned media but keeps a regenerated result with the same name', () => {
    const stored = asset()
    expect(findPersonalLibraryAsset([stored], job, 'me')).toBe(stored)
    expect(findPersonalLibraryAsset([stored], { ...job, sourceUrl: stored.url }, 'me')).toBe(stored)
    expect(findPersonalLibraryAsset([stored], { ...job, sourceUrl: 'https://source/new.png' }, 'me')).toBeUndefined()
  })

  it('does not modify someone else’s shared asset or reuse deleted or mismatched media', () => {
    for (const stored of [asset({ ownerUserId: 'other' }), asset({ permission: 'use' }), asset({ deletedAt: 'now' }), asset({ category: 'prop' }), asset({ mediaType: 'audio' })]) {
      expect(findPersonalLibraryAsset([stored], job, 'me')).toBeUndefined()
    }
  })

  it('shows a favorite only for the current owned media and clears it after regeneration', () => {
    const stored = asset({ favorite: true })
    expect(isPersonalLibraryFavorite([stored], [job], 'me')).toBe(true)
    expect(isPersonalLibraryFavorite([stored], [{ ...job, sourceUrl: 'https://source/new.png' }], 'me')).toBe(false)
    expect(isPersonalLibraryFavorite([stored], [job], 'other')).toBe(false)
    expect(isPersonalLibraryFavorite([asset({ favorite: false })], [job], 'me')).toBe(false)
    expect(isPersonalLibraryFavorite([], [job], 'me')).toBe(false)
  })

  it('requires all available media to be favorited and does not mark an empty asset', () => {
    const voice = { category: 'character_voice' as const, mediaType: 'audio' as const, sourceUrl: 'https://source/voice.mp3' }
    const stored = asset({ favorite: true })
    expect(isPersonalLibraryFavorite([stored], [job, voice], 'me')).toBe(false)
    expect(isPersonalLibraryFavorite([stored, asset({ ...voice, url: voice.sourceUrl, favorite: true })], [job, voice], 'me')).toBe(true)
    expect(isPersonalLibraryFavorite([stored], [], 'me')).toBe(false)
  })
})

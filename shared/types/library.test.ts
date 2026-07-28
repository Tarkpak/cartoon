import { describe, expect, it } from 'vitest'
import {
  LibraryAssetSchema,
  libraryCategoryMediaType,
  libraryPermissionCanUse
} from './library'

describe('library asset schema', () => {
  it('normalizes defaults for a reusable character asset', () => {
    const asset = LibraryAssetSchema.parse({
      id: 'lib_character',
      mediaType: 'image',
      category: 'character',
      name: '林默',
      url: 'https://cdn.example.com/lin-mo.webp',
      sourceType: 'project',
      bundle: {
        characterName: '林默',
        generationPrompt: '稳定二维角色设定',
        gender: '男',
        age: 24,
        clothing: '深色风衣',
        viewAssetIds: { front: 'lib_front', side: 'lib_side' },
        expressionAssetIds: ['lib_smile'],
        poseAssetIds: ['lib_running'],
        voiceAssetId: 'lib_voice'
      },
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z'
    })

    expect(asset.tags).toEqual([])
    expect(asset.visibility).toBe('private')
    expect(asset.permission).toBe('edit')
    expect(asset.bundle?.voiceAssetId).toBe('lib_voice')
    expect(asset.bundle?.generationPrompt).toBe('稳定二维角色设定')
    expect(asset.bundle?.expressionAssetIds).toEqual(['lib_smile'])
  })

  it('maps audio and image categories to the expected media type', () => {
    expect(libraryCategoryMediaType('character')).toBe('image')
    expect(libraryCategoryMediaType('environment')).toBe('image')
    expect(libraryCategoryMediaType('character_voice')).toBe('audio')
    expect(libraryCategoryMediaType('bgm')).toBe('audio')
    expect(libraryCategoryMediaType('sfx')).toBe('audio')
  })

  it('keeps view-only resources out of project usage flows', () => {
    expect(libraryPermissionCanUse('view')).toBe(false)
    expect(libraryPermissionCanUse('use')).toBe(true)
    expect(libraryPermissionCanUse('edit')).toBe(true)
  })
})

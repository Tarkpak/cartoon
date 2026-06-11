import { describe, expect, it } from 'vitest'
import {
  buildLoadedCharacters,
  buildSaveCharactersPayload
} from './asset-workbench-project-serialization'

describe('asset workbench project serialization', () => {
  it('loads character baseImage when imageUrl is empty', () => {
    const characters = buildLoadedCharacters([
      {
        id: 'char_1',
        name: '沈砚秋',
        appearance: '白衣画修',
        imageUrl: null,
        baseImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
      }
    ])

    expect(characters[0]?.baseImage).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')
  })

  it('preserves character variant metadata while loading and saving', () => {
    const characters = buildLoadedCharacters([
      {
        id: 'char_chen_modern',
        parentCharacterId: 'char_compound',
        variantName: '现代形态',
        name: '陈泽-现代形态',
        appearance: '现代形态为25岁男性'
      }
    ])

    expect(characters[0]).toMatchObject({
      parentCharacterId: 'char_compound',
      variantName: '现代形态'
    })

    expect(buildSaveCharactersPayload(characters)[0]).toMatchObject({
      parentCharacterId: 'char_compound',
      variantName: '现代形态'
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildLoadedCharacters,
  buildLoadedScenes,
  buildSaveCharactersPayload,
  buildSaveScenesPayload
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

  it('preserves scene props while loading and saving', () => {
    const scenes = buildLoadedScenes([
      {
        id: 'scene_1',
        title: '烧烤摊开场',
        description: '陈泽骑着烧烤三轮车驶入。',
        duration: 8,
        props: [
          {
            name: '烧烤三轮车',
            description: '老旧三轮车改装烧烤摊'
          }
        ]
      }
    ])

    expect(scenes[0]?.props).toEqual([
      {
        name: '烧烤三轮车',
        description: '老旧三轮车改装烧烤摊'
      }
    ])

    expect(buildSaveScenesPayload(scenes)[0]?.props).toEqual(scenes[0]?.props)
  })
})

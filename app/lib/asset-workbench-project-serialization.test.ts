import { describe, expect, it } from 'vitest'
import {
  applyScopedEntityIds,
  buildLoadedCharacters,
  buildLoadedScenes,
  buildSaveCharactersPayload,
  buildSaveScenesPayload
} from './asset-workbench-project-serialization'

describe('asset workbench project serialization', () => {
  it('preserves the selected character form while loading and saving scenes', () => {
    const scenes = buildLoadedScenes([{
      id: 'scene_variant',
      title: '泳池边',
      description: '燕声走到泳池边。',
      duration: 8,
      characters: [{
        name: '燕声',
        assetId: 'char:char_yansheng_swimsuit',
        appearance: '头发沾水'
      }]
    }])

    expect(scenes[0]?.characters[0]).toMatchObject({
      assetId: 'char:char_yansheng_swimsuit',
      appearance: '头发沾水'
    })
    expect(buildSaveScenesPayload(scenes)[0]?.characters[0]).toMatchObject({
      assetId: 'char:char_yansheng_swimsuit'
    })
  })

  it('scopes scene character asset ids together with character ids', () => {
    const scenes = buildLoadedScenes([{
      id: 'scene_1',
      title: '泳池边',
      description: '燕声走到泳池边。',
      duration: 8,
      characters: [{ name: '燕声', assetId: 'char:char_variant' }]
    }])
    const characters = buildLoadedCharacters([{
      id: 'char_variant',
      name: '燕声-泳装',
      appearance: '泳装形态'
    }])

    applyScopedEntityIds('project_1', scenes, characters)

    expect(characters[0]?.id).toBe('char_project_1_char_variant')
    expect(scenes[0]?.characters[0]?.assetId).toBe('char:char_project_1_char_variant')
  })

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

  it('preserves character Ark virtual asset binding while loading and saving', () => {
    const characters = buildLoadedCharacters([
      {
        id: 'char_linwan',
        name: '林婉',
        appearance: '红裙少女',
        arkAsset: {
          provider: 'volcengine',
          libraryType: 'virtual_human',
          projectName: 'default',
          groupId: 'group-1',
          assetId: 'asset-linwan',
          assetType: 'Image',
          sourceUrl: 'https://example.com/linwan.png',
          name: '林婉-1',
          status: 'Active',
          updatedAt: '2026-07-06T09:18:09Z'
        }
      }
    ])

    expect(characters[0]?.arkAsset).toMatchObject({
      assetId: 'asset-linwan',
      status: 'Active'
    })
    expect(buildSaveCharactersPayload(characters)[0]?.arkAsset).toMatchObject({
      assetId: 'asset-linwan',
      status: 'Active'
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

  it('preserves open-ended model metadata while loading and saving', () => {
    const scenes = buildLoadedScenes([{
      id: 'scene_open_metadata',
      title: '极地观察',
      description: '观察员记录极夜中的异常光带。',
      duration: 8,
      setting: {
        location: '极地观测站',
        timeOfDay: '极夜，无自然日照'
      }
    }])
    const characters = buildLoadedCharacters([{
      id: 'char_open_metadata',
      name: '零号',
      appearance: '银色仿生外壳',
      role: '失忆的叙事观察者',
      gender: '无性别机械生命',
      speakingStyle: '克制疏离，带机械式停顿'
    }])

    expect(buildSaveScenesPayload(scenes)[0]?.setting?.timeOfDay).toBe('极夜，无自然日照')
    expect(buildSaveCharactersPayload(characters)[0]).toMatchObject({
      role: '失忆的叙事观察者',
      gender: '无性别机械生命',
      speakingStyle: '克制疏离，带机械式停顿'
    })
  })

  it('normalizes legacy environment capture modes while loading', () => {
    const scenes = buildLoadedScenes([
      {
        id: 'scene_legacy',
        title: '旧场景',
        description: '旧项目场景',
        duration: 8,
        environmentCaptureMode: 'four_view'
      }
    ])

    expect(scenes[0]?.environmentCaptureMode).toBe('四视角')
  })
})

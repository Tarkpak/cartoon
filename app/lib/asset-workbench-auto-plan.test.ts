import { describe, expect, it } from 'vitest'
import type { CharacterData, SceneData } from './asset-workbench-models'
import { applyAutomaticAssetPlan } from './asset-workbench-auto-plan'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'

function createCharacter(input: Partial<CharacterData> & Pick<CharacterData, 'id' | 'name'>): CharacterData {
  return {
    id: input.id,
    name: input.name,
    appearance: input.appearance || '',
    role: input.role || 'supporting',
    generating: false,
    generatingViews: false
  }
}

function createScene(input: Partial<SceneData> & Pick<SceneData, 'id' | 'title' | 'description'>): SceneData {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    dramatic: input.dramatic,
    characters: input.characters || [],
    props: input.props,
    narration: input.narration,
    duration: input.duration || 8,
    setting: input.setting,
    active: input.active ?? false,
    referenceStatus: input.referenceStatus || 'pending',
    videoStatus: input.videoStatus || 'pending'
  }
}

function createProp(input: Partial<PropAsset> & Pick<PropAsset, 'id' | 'name'>): PropAsset {
  return {
    id: input.id,
    name: input.name,
    description: input.description || '',
    category: input.category || 'prop',
    mediaType: input.mediaType,
    referenceImage: input.referenceImage
  }
}

describe('asset-workbench-auto-plan', () => {
  it('uses structured scene characters without matching assets from description text', () => {
    const characters = [
      createCharacter({ id: 'char_chen', name: '陈泽' })
    ]
    const propAssets = [
      createProp({ id: 'prop_truck', name: '白色大卡车' })
    ]
    const scene = createScene({
      id: 'scene_1',
      title: '摆烂摊贩的黄昏',
      description: [
        '戏剧冲突：陈泽的摆烂日常被突发死亡危机撕开。',
        '0-2秒：，中景，跟拍。白色大卡车从街口冲出。',
        '2-5秒：，近景，缓慢推近。哼笑说：\'今天也是混吃等死的一天。\''
      ].join('\n'),
      characters: [
        { name: '陈泽' }
      ],
      setting: {
        location: '现代都市老街路口',
        timeOfDay: '傍晚'
      }
    })
    const sceneConfigs: Record<string, SceneConsistencyConfig> = {}

    const result = applyAutomaticAssetPlan({
      scenes: [scene],
      characters,
      sceneConfigs,
      propAssets,
      environmentAssetIds: ['env:modern_street'],
      resolveSceneEnvironmentAssetId: () => 'env:modern_street'
    })

    expect(result.characterChanged).toBe(false)
    expect(result.nextSceneConfigs.scene_1?.mustReferenceAssetIds).toEqual([
      'char:char_chen',
      'env:modern_street'
    ])
  })

  it('uses structured scene props to resolve prop references', () => {
    const propAssets = [
      createProp({ id: 'prop_truck', name: '白色大卡车' })
    ]
    const scene = createScene({
      id: 'scene_1',
      title: '摆烂摊贩的黄昏',
      description: '0-2秒：，中景，跟拍。街口喇叭声压过环境音。',
      props: [
        { name: '白色大卡车' }
      ],
      setting: {
        location: '现代都市老街路口',
        timeOfDay: '傍晚'
      }
    })

    const result = applyAutomaticAssetPlan({
      scenes: [scene],
      characters: [],
      sceneConfigs: {},
      propAssets,
      environmentAssetIds: ['env:modern_street'],
      resolveSceneEnvironmentAssetId: () => 'env:modern_street'
    })

    expect(result.nextSceneConfigs.scene_1?.mustReferenceAssetIds).toEqual([
      'env:modern_street',
      'prop:prop_truck'
    ])
  })

  it('creates scene-specific character assets for compound identity names', () => {
    const characters = [
      createCharacter({
        id: 'char_compound',
        name: '陈泽/白叙',
        appearance: '现代身份陈泽为25岁卖烧烤青年；穿越后身体为18岁白叙。'
      })
    ]
    const scenes = [
      createScene({
        id: 'scene_modern',
        title: '黄昏老街的摆烂人生',
        description: '0-5秒：陈泽骑着烧烤三轮车穿过老街，陈泽懒散地哼着小调。',
        characters: [
          {
            name: '陈泽/白叙',
            appearance: '现代形态为25岁男性，歪戴鸭舌帽，白T恤沾油渍。'
          }
        ],
        setting: {
          location: '现代都市老街路口',
          timeOfDay: '傍晚'
        }
      }),
      createScene({
        id: 'scene_wasteland',
        title: '三百年后醒成白叙',
        description: '0-5秒：白叙在破败窝棚里猛地睁眼，低头看见手臂淤青。',
        characters: [
          {
            name: '陈泽/白叙',
            appearance: '18岁身体，偏瘦身形，穿破旧灰麻布短褐，手臂有旧伤痕。'
          }
        ],
        setting: {
          location: '末日荒野破败窝棚',
          timeOfDay: '白天'
        }
      })
    ]
    const generatedIds = ['char_chen', 'char_bai']

    const result = applyAutomaticAssetPlan({
      scenes,
      characters,
      sceneConfigs: {},
      propAssets: [],
      environmentAssetIds: ['env:modern_street', 'env:wasteland_hut'],
      resolveSceneEnvironmentAssetId: scene => scene.id === 'scene_modern'
        ? 'env:modern_street'
        : 'env:wasteland_hut',
      createCharacterId: () => generatedIds.shift() || 'char_extra'
    })

    expect(result.characterChanged).toBe(true)
    expect(characters.map(character => character.name)).toEqual([
      '陈泽/白叙',
      '陈泽-现代形态',
      '白叙-废土形态'
    ])
    expect(characters[1]).toMatchObject({
      parentCharacterId: 'char_compound',
      variantName: '现代形态'
    })
    expect(characters[2]).toMatchObject({
      parentCharacterId: 'char_compound',
      variantName: '废土形态'
    })
    expect(result.nextSceneConfigs.scene_modern?.mustReferenceAssetIds).toEqual([
      'char:char_chen',
      'env:modern_street'
    ])
    expect(result.nextSceneConfigs.scene_wasteland?.mustReferenceAssetIds).toEqual([
      'char:char_bai',
      'env:wasteland_hut'
    ])
  })
})

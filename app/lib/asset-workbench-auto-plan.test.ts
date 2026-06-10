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
})

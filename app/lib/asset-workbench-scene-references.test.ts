import { describe, expect, it } from 'vitest'
import type { CharacterData, SceneData } from './asset-workbench-models'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { resolveSceneVideoReferenceAssets } from './asset-workbench-scene-references'

function createCharacter(input: Partial<CharacterData> & Pick<CharacterData, 'id' | 'name'>): CharacterData {
  return {
    id: input.id,
    name: input.name,
    appearance: input.appearance || '',
    role: input.role || 'supporting',
    baseImage: input.baseImage,
    assetHistory: input.assetHistory,
    expressions: input.expressions,
    views: input.views,
    generating: input.generating ?? false,
    generatingViews: input.generatingViews ?? false,
    personality: input.personality,
    traits: input.traits,
    background: input.background,
    motivation: input.motivation,
    speakingStyle: input.speakingStyle,
    catchphrase: input.catchphrase,
    voiceTone: input.voiceTone,
    voiceAsset: input.voiceAsset,
    age: input.age,
    gender: input.gender
  }
}

function createScene(input: Partial<SceneData> & Pick<SceneData, 'id' | 'title' | 'description'>): SceneData {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    characters: input.characters || [],
    dialogues: input.dialogues || [],
    narration: input.narration,
    duration: input.duration || 8,
    setting: input.setting,
    active: input.active ?? false,
    shotType: input.shotType,
    cameraMovement: input.cameraMovement,
    cameraNote: input.cameraNote,
    transitionIn: input.transitionIn,
    transitionOut: input.transitionOut,
    transitionDuration: input.transitionDuration,
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
    videoUrl: input.videoUrl,
    videoHistory: input.videoHistory,
    referenceError: input.referenceError,
    videoError: input.videoError,
    referenceStatus: input.referenceStatus || 'pending',
    videoStatus: input.videoStatus || 'pending'
  }
}

function createSceneConfig(sceneId: string, mustReferenceAssetIds: string[]): SceneConsistencyConfig {
  return {
    sceneId,
    mustReferenceAssetIds,
    consistencyLevel: mustReferenceAssetIds.length > 0 ? 'lock' : 'soft',
    continuityNotes: ''
  }
}

describe('scene video reference assets', () => {
  it('does not fallback to dialogue-detected characters when scene config exists', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '病房',
      description: '阿强走进病房。',
      dialogues: [{ character: '阿强', text: '阿明，你快过来。' }]
    })
    const characters = [
      createCharacter({ id: 'char_qiang', name: '阿强', baseImage: 'char_qiang.png' }),
      createCharacter({ id: 'char_ming', name: '阿明', baseImage: 'char_ming.png' })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, [])
      }
    })

    expect(assets).toEqual([])
  })

  it('keeps fallback behavior for legacy scenes without scene config', () => {
    const scene = createScene({
      id: 'scene_legacy',
      title: '巷口',
      description: '阿强站在巷口。',
      dialogues: [{ character: '阿强', text: '快走。' }]
    })
    const characters = [
      createCharacter({ id: 'char_qiang', name: '阿强', baseImage: 'char_qiang.png' })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {}
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_qiang',
      source: 'fallback'
    })
  })

  it('uses configured character references as the source of truth when config exists', () => {
    const scene = createScene({
      id: 'scene_2',
      title: '走廊',
      description: '阿强在走廊回头。',
      dialogues: [{ character: '阿强', text: '阿明，跟上。' }]
    })
    const characters = [
      createCharacter({ id: 'char_qiang', name: '阿强', baseImage: 'char_qiang.png' }),
      createCharacter({ id: 'char_ming', name: '阿明', baseImage: 'char_ming.png' })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['char:char_ming'])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_ming',
      source: 'configured'
    })
  })
})

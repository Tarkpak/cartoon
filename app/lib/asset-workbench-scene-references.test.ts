import { describe, expect, it } from 'vitest'
import type { CharacterData, SceneData } from './asset-workbench-models'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import {
  resolveSceneNarrationVoiceAsset,
  resolveSceneVideoReferenceAssets
} from './asset-workbench-scene-references'

function createCharacter(input: Partial<CharacterData> & Pick<CharacterData, 'id' | 'name'>): CharacterData {
  return {
    id: input.id,
    parentCharacterId: input.parentCharacterId,
    variantName: input.variantName,
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
  it('does not fallback to dialogue-detected characters when description has no @ mention', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '病房',
      description: '阿强走进病房。'
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

  it('does not use legacy fallback for scenes without scene config', () => {
    const scene = createScene({
      id: 'scene_legacy',
      title: '巷口',
      description: '阿强站在巷口。'
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

    expect(assets).toEqual([])
  })

  it('uses explicitly mentioned character references when config exists', () => {
    const scene = createScene({
      id: 'scene_2',
      title: '走廊',
      description: '阿强在走廊回头。\n\n[引用资产]\n@阿明'
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
        [scene.id]: createSceneConfig(scene.id, ['char:char_qiang'])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_ming',
      source: 'configured'
    })
  })

  it('falls back to scene-config character references when no character @mention exists', () => {
    const scene = createScene({
      id: 'scene_2b',
      title: '走廊',
      description: '阿强在走廊回头。\n\n[引用资产]\n@医院走廊'
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
        [scene.id]: createSceneConfig(scene.id, ['char:char_qiang'])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_qiang',
      source: 'configured'
    })
  })

  it('keeps only the default form when a character and its variant are both referenced', () => {
    const scene = createScene({
      id: 'scene_variant_default',
      title: '酒会大厅',
      description: '燕声站在立柱旁，眼神放空。\n\n[引用资产]\n@燕声\n@燕声-泳装',
      characters: [{ name: '燕声' }]
    })
    const characters = [
      createCharacter({ id: 'char_yansheng', name: '燕声', baseImage: 'yansheng.png' }),
      createCharacter({
        id: 'char_yansheng_swimsuit',
        parentCharacterId: 'char_yansheng',
        variantName: '泳装',
        name: '燕声-泳装',
        baseImage: 'yansheng-swimsuit.png'
      })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, [
          'char:char_yansheng',
          'char:char_yansheng_swimsuit'
        ])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_yansheng',
      image: 'yansheng.png'
    })
  })

  it('prefers an explicitly requested variant when both character forms are referenced', () => {
    const scene = createScene({
      id: 'scene_variant_swimsuit',
      title: '泳池边',
      description: '燕声换上泳装走到泳池边。\n\n[引用资产]\n@燕声\n@燕声-泳装',
      characters: [{ name: '燕声', appearance: '泳装造型' }]
    })
    const characters = [
      createCharacter({ id: 'char_yansheng', name: '燕声', baseImage: 'yansheng.png' }),
      createCharacter({
        id: 'char_yansheng_swimsuit',
        parentCharacterId: 'char_yansheng',
        variantName: '泳装',
        name: '燕声-泳装',
        baseImage: 'yansheng-swimsuit.png'
      })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, [
          'char:char_yansheng',
          'char:char_yansheng_swimsuit'
        ])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_yansheng_swimsuit',
      image: 'yansheng-swimsuit.png'
    })
  })

  it('uses the persisted scene character asset even when legacy references point to the default form', () => {
    const scene = createScene({
      id: 'scene_persisted_variant',
      title: '酒会大厅',
      description: '燕声站在立柱旁。\n\n[引用资产]\n@燕声',
      characters: [{
        name: '燕声',
        assetId: 'char:char_yansheng_swimsuit'
      }]
    })
    const characters = [
      createCharacter({ id: 'char_yansheng', name: '燕声', baseImage: 'yansheng.png' }),
      createCharacter({
        id: 'char_yansheng_swimsuit',
        parentCharacterId: 'char_yansheng',
        variantName: '泳装',
        name: '燕声-泳装',
        baseImage: 'yansheng-swimsuit.png'
      })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['char:char_yansheng'])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'char:char_yansheng_swimsuit',
      image: 'yansheng-swimsuit.png'
    })
  })

  it('ignores a narrator pronoun asset that is not a structured scene character', () => {
    const scene = createScene({
      id: 'scene_first_person_narration',
      title: '三年的老样子',
      description: '主人公坐下吃饭。\n\n[引用资产]\n@主人公\n@老板娘\n@我',
      narration: '我在这儿吃了三年。',
      characters: [{ name: '主人公' }, { name: '老板娘' }]
    })
    const characters = [
      createCharacter({ id: 'char_protagonist', name: '主人公', baseImage: 'protagonist.png' }),
      createCharacter({ id: 'char_owner', name: '老板娘', baseImage: 'owner.png' }),
      createCharacter({ id: 'char_i', name: '我', baseImage: 'narrator.png' })
    ]

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters,
      propAssets: [],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, [
          'char:char_protagonist',
          'char:char_owner',
          'char:char_i'
        ])
      }
    })

    expect(assets.map(asset => asset.assetId)).toEqual([
      'char:char_protagonist',
      'char:char_owner'
    ])
  })

  it('ignores config-only prop references that are not @ mentioned', () => {
    const scene = createScene({
      id: 'scene_3',
      title: '桌面',
      description: '镜头扫过桌面。\n\n[引用资产]\n@工作证'
    })

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'prop_card',
          name: '工作证',
          description: '',
          category: 'prop',
          referenceImage: 'card.png'
        },
        {
          id: 'prop_flashlight',
          name: '手电筒',
          description: '',
          category: 'other',
          referenceImage: 'flashlight.png'
        }
      ],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['prop:prop_flashlight'])
      }
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'prop:prop_card',
      name: '工作证',
      source: 'configured'
    })
  })

  it('resolves typed @mentions for prop and other assets', () => {
    const scene = createScene({
      id: 'scene_4',
      title: '楼道',
      description: '镜头掠过楼道尽头。\n\n[引用资产]\n@道具:工作证\n@其他:手电筒'
    })

    const assets = resolveSceneVideoReferenceAssets({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'prop_card',
          name: '工作证',
          description: '',
          category: 'prop',
          referenceImage: 'card.png'
        },
        {
          id: 'prop_flashlight',
          name: '手电筒',
          description: '',
          category: 'other',
          referenceImage: 'flashlight.png'
        }
      ],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, [])
      }
    })

    expect(assets).toHaveLength(2)
    expect(assets[0]).toMatchObject({
      assetId: 'prop:prop_card',
      type: 'prop',
      image: 'card.png'
    })
    expect(assets[1]).toMatchObject({
      assetId: 'prop:prop_flashlight',
      type: 'other',
      image: 'flashlight.png'
    })
  })

  it('resolves narration voice asset from explicitly referenced other asset', () => {
    const scene = createScene({
      id: 'scene_narration_1',
      title: '旁白场景',
      description: '镜头推进。\n\n[引用资产]\n@其他:旁白音色',
      narration: '画外音（音色：女性，沉稳）说：夜色渐深。'
    })

    const narrationVoice = resolveSceneNarrationVoiceAsset({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'other_narration_voice',
          name: '旁白音色',
          description: '女性，沉稳',
          category: 'other',
          voiceAsset: {
            audioUrl: 'https://example.com/narration.mp3',
            locked: true,
            updatedAt: new Date().toISOString()
          }
        }
      ],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['prop:other_narration_voice'])
      }
    })

    expect(narrationVoice).toMatchObject({
      assetId: 'prop:other_narration_voice',
      audioUrl: 'https://example.com/narration.mp3',
      locked: true,
      source: 'manual'
    })
  })

  it('falls back to hinted narration voice asset when no explicit reference exists', () => {
    const scene = createScene({
      id: 'scene_narration_2',
      title: '旁白场景',
      description: '镜头推进。',
      narration: '旁白：故事才刚开始。'
    })

    const narrationVoice = resolveSceneNarrationVoiceAsset({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'other_misc',
          name: '环境底噪',
          description: '',
          category: 'other',
          voiceAsset: {
            audioUrl: 'https://example.com/noise.mp3',
            updatedAt: new Date().toISOString()
          }
        },
        {
          id: 'other_narration_voice',
          name: '旁白音色',
          description: '',
          category: 'other',
          voiceAsset: {
            audioUrl: 'https://example.com/narration.mp3',
            updatedAt: new Date().toISOString()
          }
        }
      ],
      sceneConfigs: {}
    })

    expect(narrationVoice?.assetId).toBe('prop:other_narration_voice')
    expect(narrationVoice?.audioUrl).toBe('https://example.com/narration.mp3')
  })

  it('falls back to hinted narration voice asset when explicit references contain no voice asset', () => {
    const scene = createScene({
      id: 'scene_narration_3',
      title: '旁白场景',
      description: '镜头推进。\n\n[引用资产]\n@道具:手电筒',
      narration: '旁白：故事继续。'
    })

    const narrationVoice = resolveSceneNarrationVoiceAsset({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'prop_flashlight',
          name: '手电筒',
          description: '',
          category: 'prop',
          referenceImage: 'https://example.com/flashlight.png'
        },
        {
          id: 'other_narration_voice',
          name: '旁白音色',
          description: '',
          category: 'other',
          voiceAsset: {
            audioUrl: 'https://example.com/narration.mp3',
            updatedAt: new Date().toISOString()
          }
        }
      ],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['prop:prop_flashlight'])
      }
    })

    expect(narrationVoice?.assetId).toBe('prop:other_narration_voice')
    expect(narrationVoice?.audioUrl).toBe('https://example.com/narration.mp3')
  })

  it('does not guess between multiple generic voice assets', () => {
    const scene = createScene({
      id: 'scene_narration_ambiguous',
      title: '旁白场景',
      description: '镜头推进。',
      narration: '旁白：故事继续。'
    })

    const narrationVoice = resolveSceneNarrationVoiceAsset({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'voice_a',
          name: '沉稳女声',
          description: '',
          category: 'other',
          mediaType: 'voice',
          voiceAsset: {
            audioUrl: 'https://example.com/a.mp3',
            updatedAt: new Date().toISOString()
          }
        },
        {
          id: 'voice_b',
          name: '磁性男声',
          description: '',
          category: 'other',
          mediaType: 'voice',
          voiceAsset: {
            audioUrl: 'https://example.com/b.mp3',
            updatedAt: new Date().toISOString()
          }
        }
      ],
      sceneConfigs: {}
    })

    expect(narrationVoice).toBeNull()
  })

  it('uses an explicitly referenced generic voice asset', () => {
    const scene = createScene({
      id: 'scene_narration_explicit',
      title: '旁白场景',
      description: '镜头推进。',
      narration: '旁白：故事继续。'
    })

    const narrationVoice = resolveSceneNarrationVoiceAsset({
      scene,
      characters: [],
      propAssets: [
        {
          id: 'voice_a',
          name: '沉稳女声',
          description: '',
          category: 'other',
          mediaType: 'voice',
          voiceAsset: {
            audioUrl: 'https://example.com/a.mp3',
            updatedAt: new Date().toISOString()
          }
        },
        {
          id: 'voice_b',
          name: '磁性男声',
          description: '',
          category: 'other',
          mediaType: 'voice',
          voiceAsset: {
            audioUrl: 'https://example.com/b.mp3',
            updatedAt: new Date().toISOString()
          }
        }
      ],
      sceneConfigs: {
        [scene.id]: createSceneConfig(scene.id, ['prop:voice_b'])
      }
    })

    expect(narrationVoice?.assetId).toBe('prop:voice_b')
    expect(narrationVoice?.audioUrl).toBe('https://example.com/b.mp3')
  })
})

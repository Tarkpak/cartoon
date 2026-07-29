import { describe, expect, it } from 'vitest'
import type { CharacterData, SceneData } from './asset-workbench-models'
import {
  collectSceneCharacterCandidates,
  resolveCharacterRefsFromScene
} from './asset-workbench-reference-detection'

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

describe('scene character reference detection', () => {
  it('uses the explicitly selected variant instead of its parent character', () => {
    const scene = createScene({
      id: 'scene_variant',
      title: '三年的老样子',
      description: '主人公-白色体恤走向炒鸡摊。',
      characters: [{
        name: '主人公',
        assetId: 'char:char_protagonist_white'
      }]
    })
    const characters = [
      createCharacter({ id: 'char_protagonist', name: '主人公' }),
      createCharacter({
        id: 'char_protagonist_white',
        parentCharacterId: 'char_protagonist',
        variantName: '白色体恤',
        name: '主人公-白色体恤'
      })
    ]

    expect(resolveCharacterRefsFromScene({ scene, characters })).toEqual({
      refs: ['char:char_protagonist_white'],
      matchedCharacterNames: ['主人公-白色体恤']
    })
  })

  it('uses structured scene characters without inferring characters from dialogue text', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '巷口对话',
      description: '0-8秒：中景，固定镜头。张三站在巷口。张三说：\'李四，你别过来\'',
      characters: [
        { name: '张三' }
      ]
    })
    const characters = [
      createCharacter({ id: 'char_1', name: '张三' }),
      createCharacter({ id: 'char_2', name: '李四' })
    ]

    const candidates = collectSceneCharacterCandidates(scene)
    const candidateNames = candidates.map(item => item.primaryName)
    expect(candidateNames).toEqual(['张三'])
    expect(candidateNames).not.toContain('李四')

    const { refs } = resolveCharacterRefsFromScene({
      scene,
      characters
    })
    expect(refs).toEqual(['char:char_1'])
  })

  it('does not parse malformed speaker fields as character references', () => {
    const scene = createScene({
      id: 'scene_2',
      title: '争执',
      description: '0-6秒：中景，固定镜头。阿强皱眉。\n- 阿强：阿明，你给我闭嘴',
      characters: []
    })
    const characters = [
      createCharacter({ id: 'char_qiang', name: '阿强' }),
      createCharacter({ id: 'char_ming', name: '阿明' })
    ]

    const { refs } = resolveCharacterRefsFromScene({
      scene,
      characters
    })

    expect(refs).toEqual([])
  })

  it('matches structured scene characters by normalized exact name only', () => {
    const scene = createScene({
      id: 'scene_3',
      title: '争执',
      description: '0-6秒：中景，固定镜头。阿强哥皱眉。',
      characters: [
        { name: '阿强哥' }
      ]
    })
    const characters = [
      createCharacter({ id: 'char_qiang', name: '阿强' })
    ]

    const { refs } = resolveCharacterRefsFromScene({
      scene,
      characters
    })

    expect(refs).toEqual([])
  })

  it('selects the active alias for compound character names from scene context', () => {
    const modernScene = createScene({
      id: 'scene_modern',
      title: '黄昏老街的摆烂人生',
      description: '0-5秒：陈泽骑着烧烤三轮车穿过孜然烟雾。陈泽抬头看向卡车。',
      characters: [
        {
          name: '陈泽/白叙',
          appearance: '现代形态为25岁男性，歪戴鸭舌帽，白T恤沾油渍。'
        }
      ]
    })
    const wastelandScene = createScene({
      id: 'scene_wasteland',
      title: '三百年后醒成白叙',
      description: '0-5秒：白叙在破败窝棚里猛地睁眼，手臂带着淤青。',
      characters: [
        {
          name: '陈泽/白叙',
          appearance: '18岁身体，偏瘦身形，破旧灰麻布短褐。'
        }
      ]
    })

    expect(collectSceneCharacterCandidates(modernScene)[0]).toMatchObject({
      primaryName: '陈泽',
      aliases: ['陈泽', '白叙', '陈泽/白叙']
    })
    expect(collectSceneCharacterCandidates(wastelandScene)[0]).toMatchObject({
      primaryName: '白叙',
      aliases: ['白叙', '陈泽', '陈泽/白叙']
    })
  })

  it('falls back to the compound character asset when no scene-specific alias asset exists', () => {
    const scene = createScene({
      id: 'scene_compound',
      title: '黄昏老街的摆烂人生',
      description: '0-5秒：陈泽骑车穿过老街。',
      characters: [
        { name: '陈泽/白叙' }
      ]
    })
    const characters = [
      createCharacter({ id: 'char_compound', name: '陈泽/白叙' })
    ]

    const { refs } = resolveCharacterRefsFromScene({
      scene,
      characters
    })

    expect(refs).toEqual(['char:char_compound'])
  })

  it('prefers compound character variants when a matching form exists', () => {
    const scene = createScene({
      id: 'scene_modern',
      title: '黄昏老街的摆烂人生',
      description: '0-5秒：陈泽骑着烧烤三轮车穿过孜然烟雾。',
      characters: [
        {
          name: '陈泽/白叙',
          appearance: '现代形态为25岁男性，歪戴鸭舌帽，白T恤沾油渍。'
        }
      ]
    })
    const characters = [
      createCharacter({ id: 'char_compound', name: '陈泽/白叙' }),
      createCharacter({
        id: 'char_chen_modern',
        parentCharacterId: 'char_compound',
        variantName: '现代形态',
        name: '陈泽-现代形态',
        appearance: '现代形态为25岁男性，歪戴鸭舌帽，白T恤沾油渍。'
      })
    ]

    const { refs, matchedCharacterNames } = resolveCharacterRefsFromScene({
      scene,
      characters
    })

    expect(refs).toEqual(['char:char_chen_modern'])
    expect(matchedCharacterNames).toEqual(['陈泽-现代形态'])
  })
})

import { describe, expect, it } from 'vitest'
import type { CharacterData, SceneData } from './asset-workbench-models'
import {
  collectSceneCharacterCandidates,
  resolveCharacterRefsFromScene
} from './asset-workbench-reference-detection'

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
})

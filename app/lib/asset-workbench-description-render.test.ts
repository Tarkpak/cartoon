import { describe, expect, it } from 'vitest'
import type { SceneData } from './asset-workbench-models'
import type { DisplayAsset } from './asset-workbench-types'
import { resolveSceneDescriptionRenderSegments } from './asset-workbench-description-render'

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

describe('scene description render segments', () => {
  it('renders inline asset mention tokens as asset segments', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '医院门口',
      description: '@阿强 推门冲进 @医院走廊。'
    })
    const assets: DisplayAsset[] = [
      {
        id: 'char:char_1',
        name: '阿强',
        type: 'character',
        referenceImage: 'char.png'
      },
      {
        id: 'env:scene_1',
        name: '医院走廊',
        type: 'environment',
        referenceImage: 'env.png'
      }
    ]

    const segments = resolveSceneDescriptionRenderSegments({
      scene,
      assets,
      uniqueSorted: values => Array.from(new Set(values))
    })

    expect(segments).toHaveLength(4)
    expect(segments[0]).toMatchObject({
      type: 'asset',
      asset: { id: 'char:char_1' }
    })
    expect(segments[1]).toMatchObject({
      type: 'text',
      text: ' 推门冲进 '
    })
    expect(segments[2]).toMatchObject({
      type: 'asset',
      asset: { id: 'env:scene_1' }
    })
    expect(segments[3]).toMatchObject({
      type: 'text',
      text: '。'
    })
  })

  it('renders referenced prop names as inline asset segments after save normalization', () => {
    const scene = createScene({
      id: 'scene_2',
      title: '病房取证',
      description: '阿强拿起线索照片。\n\n[引用资产]\n@阿强\n@线索照片'
    })
    const assets: DisplayAsset[] = [
      {
        id: 'char:char_1',
        name: '阿强',
        type: 'character',
        referenceImage: 'char.png'
      },
      {
        id: 'prop:prop_1',
        name: '线索照片',
        type: 'other',
        referenceImage: 'prop.png'
      }
    ]

    const segments = resolveSceneDescriptionRenderSegments({
      scene,
      assets,
      uniqueSorted: values => Array.from(new Set(values))
    })

    expect(segments).toHaveLength(4)
    expect(segments[0]).toMatchObject({
      type: 'asset',
      asset: { id: 'char:char_1' }
    })
    expect(segments[1]).toMatchObject({
      type: 'text',
      text: '拿起'
    })
    expect(segments[2]).toMatchObject({
      type: 'asset',
      asset: { id: 'prop:prop_1' }
    })
    expect(segments[3]).toMatchObject({
      type: 'text',
      text: '。'
    })
  })

  it('does not render character names inside dialogue text as asset segments', () => {
    const scene = createScene({
      id: 'scene_3',
      title: '病房对话',
      description: '0-3秒：对白：阿强：“快走，别回头。”\n\n[引用资产]\n@阿强'
    })
    const assets: DisplayAsset[] = [
      {
        id: 'char:char_1',
        name: '阿强',
        type: 'character',
        referenceImage: 'char.png'
      }
    ]

    const segments = resolveSceneDescriptionRenderSegments({
      scene,
      assets,
      uniqueSorted: values => Array.from(new Set(values))
    })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'text',
      text: '0-3秒：对白：阿强：“快走，别回头。”'
    })
  })
})

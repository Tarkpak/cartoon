import { describe, expect, it } from 'vitest'
import type { SceneData } from './asset-workbench-models'
import {
  buildSceneEnvironmentCrossSpaceNote,
  resolveSceneEnvironmentAssetLabel,
  resolveSceneEnvironmentAssetId,
  resolveSceneSpatialViewpoint
} from './asset-workbench-environment-core'

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

describe('environment asset grouping', () => {
  it('reuses the same environment asset id when only weather differs', () => {
    const daytimeLivingRoom = createScene({
      id: 'scene_1',
      title: '客厅对白',
      description: '老旧出租屋客厅里，两人正在对峙。',
      setting: {
        location: '老旧出租屋-客厅',
        timeOfDay: 'day',
        weather: '晴天'
      }
    })

    const samePlaceWithoutWeather = createScene({
      id: 'scene_2',
      title: '客厅沉默',
      description: '同一客厅里，空气变得更紧张。',
      setting: {
        location: '老旧出租屋-客厅',
        timeOfDay: 'day'
      }
    })

    expect(resolveSceneEnvironmentAssetId(daytimeLivingRoom)).toBe(
      resolveSceneEnvironmentAssetId(samePlaceWithoutWeather)
    )
  })

  it('keeps different time-of-day scenes as separate environment assets', () => {
    const daytimeLivingRoom = createScene({
      id: 'scene_1',
      title: '客厅白天',
      description: '白天的客厅。',
      setting: {
        location: '老旧出租屋-客厅',
        timeOfDay: 'day'
      }
    })

    const nightLivingRoom = createScene({
      id: 'scene_2',
      title: '客厅夜晚',
      description: '夜晚的客厅。',
      setting: {
        location: '老旧出租屋-客厅',
        timeOfDay: 'night'
      }
    })

    expect(resolveSceneEnvironmentAssetId(daytimeLivingRoom)).not.toBe(
      resolveSceneEnvironmentAssetId(nightLivingRoom)
    )
  })

  it('uses location plus time-of-day as the environment asset label', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '客厅对白',
      description: '老旧出租屋客厅里，两人正在对峙。',
      setting: {
        location: '老旧出租屋-客厅',
        timeOfDay: 'day',
        weather: '晴天'
      }
    })

    expect(resolveSceneEnvironmentAssetLabel(scene)).toBe('老旧出租屋 / 白天')
  })

  it('groups sibling subspaces under the same root environment asset', () => {
    const ancestralHall = createScene({
      id: 'scene_1',
      title: '祠堂夜祭',
      description: '顾家老宅祠堂里烛火摇曳。',
      setting: {
        location: '顾家老宅祠堂',
        timeOfDay: 'night'
      }
    })
    const sideRoom = createScene({
      id: 'scene_2',
      title: '侧室密谈',
      description: '顾家老宅祠堂侧室里有人低声密谈。',
      setting: {
        location: '顾家老宅祠堂侧室',
        timeOfDay: 'night'
      }
    })

    expect(resolveSceneEnvironmentAssetId(ancestralHall)).toBe(
      resolveSceneEnvironmentAssetId(sideRoom)
    )
    expect(resolveSceneEnvironmentAssetLabel(sideRoom)).toBe('顾家老宅 / 夜晚')
  })

  it('detects interior and exterior viewpoints from scene metadata', () => {
    const exteriorScene = createScene({
      id: 'scene_ext',
      title: '老宅外景',
      description: '0-8秒：，全景，固定镜头。夜雨里，屋外窗户透出暖黄灯光。',
      setting: {
        location: '老宅-院子',
        timeOfDay: 'night'
      }
    })
    const interiorScene = createScene({
      id: 'scene_int',
      title: '客厅对峙',
      description: '0-8秒：，中景，固定镜头。客厅里两人隔着茶几对峙。',
      setting: {
        location: '老宅-客厅',
        timeOfDay: 'night'
      }
    })

    expect(resolveSceneSpatialViewpoint(exteriorScene)).toBe('exterior')
    expect(resolveSceneSpatialViewpoint(interiorScene)).toBe('interior')
  })

  it('builds a cross-space continuity note for matching exterior and interior scenes', () => {
    const exteriorScene = createScene({
      id: 'scene_ext',
      title: '老宅外景',
      description: '0-8秒：，全景，固定镜头。门外雨夜里，窗内暖黄灯光照亮客厅轮廓。',
      setting: {
        location: '老宅-院子',
        timeOfDay: 'night'
      }
    })
    const interiorScene = createScene({
      id: 'scene_int',
      title: '客厅对峙',
      description: '0-8秒：，中景，固定镜头。客厅里两人对峙，背后窗外还能看到雨夜院子。',
      setting: {
        location: '老宅-客厅',
        timeOfDay: 'night'
      }
    })

    const note = buildSceneEnvironmentCrossSpaceNote(exteriorScene, [exteriorScene, interiorScene])

    expect(note).toContain('同一主环境子空间：老宅-院子、老宅-客厅')
    expect(note).toContain('若外景镜头透过门窗看到室内')
    expect(note).toContain('不得重置为另一套室内或室外设计')
  })
})

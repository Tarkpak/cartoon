import { describe, expect, it } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import {
  applySceneBaselineReference,
  applySceneVideoUrl
} from './asset-workbench-scene-generation'

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
    environmentCaptureMode: input.environmentCaptureMode,
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

describe('asset-workbench-scene-generation', () => {
  it('keeps previous video in history when applying new baseline reference', () => {
    const scene = createScene({
      id: 'scene_baseline',
      title: '环境更新场景',
      description: '上传新环境图后应保留旧视频',
      videoUrl: 'https://example.com/video-before-baseline.mp4',
      videoStatus: 'done',
      referenceStatus: 'done'
    })

    applySceneBaselineReference(scene, 'https://example.com/new-env.png')

    expect(scene.firstFrame).toBe('https://example.com/new-env.png')
    expect(scene.videoUrl).toBeUndefined()
    expect(scene.videoStatus).toBe('pending')
    expect(scene.videoHistory?.[0]?.videoUrl).toBe('https://example.com/video-before-baseline.mp4')
  })

  it('keeps previous current video in history before overriding with new video', () => {
    const scene = createScene({
      id: 'scene_replace_video',
      title: '视频重生成场景',
      description: '重新生成视频时应先保留旧版本',
      videoUrl: 'https://example.com/video-old.mp4',
      videoStatus: 'done',
      referenceStatus: 'done'
    })

    applySceneVideoUrl(scene, 'https://example.com/video-new.mp4')

    expect(scene.videoUrl).toBe('https://example.com/video-new.mp4')
    expect(scene.videoStatus).toBe('done')
    expect(scene.videoHistory?.[0]?.videoUrl).toBe('https://example.com/video-old.mp4')
  })
})

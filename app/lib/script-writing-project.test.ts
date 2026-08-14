import { describe, expect, it } from 'vitest'
import {
  buildPublishedWritingEpisodePlan,
  clearParsedWorkflowForPublishedWriting
} from './script-writing-project'

describe('script writing project publication', () => {
  it('preserves episode boundaries and initializes empty asset plans', () => {
    const result = buildPublishedWritingEpisodePlan({
      text: '第一集正文',
      episodes: [{
        id: 'episode_1',
        index: 1,
        title: '开局',
        startOffset: 0,
        endOffset: 5,
        charCount: 5
      }]
    })

    expect(result[0]).toMatchObject({
      id: 'episode_1',
      title: '开局',
      episodeAssets: { characters: [], environments: [], props: [] }
    })
  })

  it('clears parsed scene state while retaining reusable assets', () => {
    expect(clearParsedWorkflowForPublishedWriting({
      version: 8,
      sceneConfigs: { scene_1: { sceneId: 'scene_1' } },
      sceneVideoHistories: { scene_1: [{ url: '/old.mp4' }] },
      finalVideo: { videoUrl: '/final.mp4' },
      props: [{ id: 'prop_1', name: '钥匙' }],
      environmentHistories: { room: [{ url: '/room.png' }] }
    })).toEqual({
      version: 8,
      sceneConfigs: {},
      sceneVideoHistories: {},
      finalVideo: null,
      props: [{ id: 'prop_1', name: '钥匙' }],
      environmentHistories: { room: [{ url: '/room.png' }] }
    })
  })
})

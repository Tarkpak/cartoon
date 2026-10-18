import { describe, expect, it } from 'vitest'
import { patchCollaborationEpisode, patchCollaborationScene } from './project-collaboration-editor'

const episode = {
  plan: { id: 'e1', index: 1, title: '原标题', custom: 'keep' },
  writing: { id: 'e1', index: 1, title: '原标题', draft: '正文', review: '审阅' },
  scenes: [{ id: 's1', episodeId: 'e1', description: '原描述', videoUrl: '/media/video', custom: { keep: true } }],
  custom: { keep: true }
}

describe('collaboration editor patches', () => {
  it('updates both episode titles while retaining unknown fields and media', () => {
    const result = patchCollaborationEpisode(episode, 'title', '新标题')
    expect(result).toEqual({ ...episode, plan: { ...episode.plan, title: '新标题' }, writing: { ...episode.writing, title: '新标题' } })
    expect(episode.plan.title).toBe('原标题')
  })
  it('creates a writing draft with the existing episode identity', () => {
    const result = patchCollaborationEpisode({ ...episode, writing: null }, 'draft', '新正文')
    expect(result.writing).toMatchObject({ id: 'e1', index: 1, title: '原标题', draft: '新正文' })
  })
  it('patches only a selected scene and rejects unknown scene IDs', () => {
    const result = patchCollaborationScene(episode, 's1', 'description', '新描述')
    expect(result.scenes).toEqual([{ ...episode.scenes[0], description: '新描述' }])
    expect(episode.scenes[0]?.description).toBe('原描述')
    expect(() => patchCollaborationScene(episode, 'other', 'description', '错误')).toThrow('分镜不存在')
  })
})

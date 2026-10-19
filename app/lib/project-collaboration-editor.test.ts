import { describe, expect, it } from 'vitest'
import { addCollaborationScene, removeCollaborationScene, moveCollaborationScene, patchCollaborationEpisode, patchCollaborationScene, patchCollaborationSettings } from './project-collaboration-editor'

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
  it('adds, reorders and removes scenes without changing existing media or the source', () => {
    const added = addCollaborationScene(episode, 's2')
    expect(added.scenes).toHaveLength(2)
    expect((added.scenes as Record<string, unknown>[])[1]).toMatchObject({ id: 's2', episodeId: 'e1', episodeIndex: 1, active: true, characters: [], referenceStatus: 'pending' })
    const moved = moveCollaborationScene(added, 's2', -1)
    expect((moved.scenes as Record<string, unknown>[]).map(scene => scene.id)).toEqual(['s2', 's1'])
    expect(removeCollaborationScene(moved, 's2')).toEqual(episode)
    expect(moveCollaborationScene(episode, 's1', -1)).toEqual(episode)
    expect(episode.scenes).toHaveLength(1)
  })
  it('rejects duplicate scene identities and operations on missing scenes', () => {
    expect(() => addCollaborationScene(episode, 's1')).toThrow('分镜 ID')
    expect(() => addCollaborationScene(episode, '')).toThrow('分镜 ID')
    expect(() => addCollaborationScene({ scenes: [] }, 's2')).toThrow('分镜数据无效')
    expect(() => removeCollaborationScene(episode, 'missing')).toThrow('分镜不存在')
    expect(() => moveCollaborationScene(episode, 'missing', 1)).toThrow('分镜不存在')
  })
  it('updates shared settings while preserving project identity and other resources', () => {
    const settings = { project: { id: 'p1', name: '旧名', ownerUserId: 'owner', aspectRatio: '16:9' }, script: { writingStudio: { storyBible: { premise: 'keep' } } }, extra: { keep: true } }
    const result = patchCollaborationSettings(settings, 'name', '新名')
    expect(result).toEqual({ ...settings, project: { ...settings.project, name: '新名' } })
    expect(settings.project.name).toBe('旧名')
    expect(() => patchCollaborationSettings(settings, 'aspectRatio', 'invalid')).toThrow('画幅无效')
  })

})

import { describe, expect, it } from 'vitest'
import { composeProjectSnapshot, splitProjectSnapshot, validateCollaborationResources } from './project-collaboration'

const source = () => ({
  project: { id: 'p1', name: '测试项目' },
  script: {
    rawText: '原始剧本',
    episodePlan: [{ id: 'e1', index: 1, title: '第一集' }, { id: 'e2', index: 2, title: '第二集' }],
    writingStudio: { storyBible: { premise: '故事' }, episodes: [{ id: 'e1', index: 1, title: '第一集', draft: '正文' }] }
  },
  scenes: [{ id: 's1', episodeId: 'e1', videoUrl: 'https://example.com/video.mp4' }, { id: 's2', episodeId: 'e2' }],
  characters: [{ id: 'c1', name: '主角', baseImage: 'https://example.com/role.png' }],
  finalVideo: { videoUrl: 'https://example.com/final.mp4' }
})

describe('collaboration snapshot migration', () => {
  it('round trips episode text, scenes, media, public characters and project extras', () => {
    const snapshot = source()
    const resources = splitProjectSnapshot(snapshot)
    validateCollaborationResources(resources)
    expect(composeProjectSnapshot(resources)).toEqual(snapshot)
    expect(resources.filter(item => item.type === 'episode')).toHaveLength(2)
    expect(resources.find(item => item.type === 'settings')?.body?.script).not.toHaveProperty('episodePlan')
    expect(snapshot.script.episodePlan).toHaveLength(2)
  })

  it('moves unassigned legacy scenes to a stable explicit episode without losing media', () => {
    const resources = splitProjectSnapshot({ project: { id: 'p1' }, script: null, characters: [], scenes: [{ id: 's1', episodeId: null, videoUrl: 'video.mp4' }] })
    const episode = resources.find(item => item.type === 'episode')!
    expect(episode.body?.scenes).toEqual([{ id: 's1', episodeId: episode.id, videoUrl: 'video.mp4' }])
    expect(() => validateCollaborationResources(resources)).not.toThrow()
  })

  it('rejects duplicate IDs, conflicting episode identities and dangling scene references', () => {
    const duplicate = source()
    duplicate.script.episodePlan.push(duplicate.script.episodePlan[0]!)
    expect(() => splitProjectSnapshot(duplicate)).toThrow('重复 ID')
    const mismatch = source()
    mismatch.script.writingStudio.episodes[0]!.id = 'other-id'
    expect(() => splitProjectSnapshot(mismatch)).toThrow('序号重复')
    const dangling = source()
    dangling.scenes[0]!.episodeId = 'missing'
    expect(() => splitProjectSnapshot(dangling)).toThrow('不存在')
  })

  it('rejects cross episode writes and deletion without an atomic directory change', () => {
    const resources = splitProjectSnapshot(source())
    const episode = resources.find(item => item.type === 'episode')!
    ;(episode.body!.scenes as Array<Record<string, unknown>>)[0]!.episodeId = 'e2'
    expect(() => validateCollaborationResources(resources)).toThrow('其他集数')
    const deleted = splitProjectSnapshot(source())
    deleted.find(item => item.type === 'episode')!.deleted = true
    expect(() => validateCollaborationResources(deleted)).toThrow('不存在')
  })
})

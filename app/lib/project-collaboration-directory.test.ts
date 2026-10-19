import { describe, expect, it } from 'vitest'
import { buildDirectoryChange, buildSceneTransfer } from './project-collaboration-directory'
import { splitProjectSnapshot, validateCollaborationResources } from '../../shared/utils/project-collaboration'
import { ProjectCollaborationClient } from './project-collaboration-client'

const initial = () => splitProjectSnapshot({
  project: { id: 'p' }, script: { episodePlan: [{ id: 'a', index: 1, title: 'A' }, { id: 'b', index: 2, title: 'B' }], writingStudio: { episodes: [{ id: 'a', index: 1, draft: '保留' }] } },
  scenes: [{ id: 's', episodeId: 'a', episodeIndex: 1, videoUrl: 'keep.mp4' }], characters: []
})
const read = (resources = initial()) => ({ enabled: true, protocolVersion: 1, cursor: 0, resources })

describe('atomic episode directory changes', () => {
  it('moves a scene atomically with its media and stable identity, without mutating either episode', () => {
    const resources = initial()
    const changes = buildSceneTransfer(resources, 'a', 'b', 's')
    expect(changes).toHaveLength(3)
    expect(changes[1]?.body?.scenes).toEqual([])
    expect(changes[2]?.body?.scenes).toEqual([{ id: 's', episodeId: 'b', episodeIndex: 2, episodeTitle: 'B', videoUrl: 'keep.mp4' }])
    expect(resources.find(item => item.id === 'a')?.body?.scenes).toHaveLength(1)
    expect(() => buildSceneTransfer(resources, 'a', 'a', 's')).toThrow('其他目标')
    expect(() => buildSceneTransfer(resources, 'a', 'missing', 's')).toThrow('不存在')
    expect(() => buildSceneTransfer(resources, 'a', 'b', 'missing')).toThrow('来源分镜不存在')
    const client = new ProjectCollaborationClient(async () => read(resources))
    return client.load().then(() => {
      expect(() => client.stageStructure(changes)).not.toThrow()
      expect(client.structureScopes).toHaveLength(3)
    })
  })

  it('adds, deletes and reorders valid resource groups with stable IDs and media', () => {
    for (const action of [{ kind: 'add', id: 'c' }, { kind: 'remove', id: 'b' }, { kind: 'move', id: 'a', direction: 1 }] as const) {
      const resources = initial()
      const changes = buildDirectoryChange(resources, action)
      const merged = new Map(resources.map(item => [JSON.stringify([item.type, item.id]), item]))
      for (const item of changes) merged.set(JSON.stringify([item.type, item.id]), { ...item, revision: 2, deleted: item.body === null })
      expect(() => validateCollaborationResources([...merged.values()])).not.toThrow()
      if (action.kind === 'move') {
        expect(changes).toHaveLength(3)
        expect(changes[0]?.body?.episodeIds).toEqual(['b', 'a'])
        expect(changes[1]?.body).toMatchObject({ plan: { id: 'a', index: 2 }, writing: { index: 2, draft: '保留' }, scenes: [{ episodeIndex: 2, videoUrl: 'keep.mp4' }] })
      }
    }
    expect(() => buildDirectoryChange(initial(), { kind: 'add', id: 'a' })).toThrow('重复')
    expect(() => buildDirectoryChange(initial().filter(item => item.id !== 'b').map(item => item.type === 'directory' ? { ...item, body: { episodeIds: ['a'] } } : item), { kind: 'remove', id: 'a' })).toThrow('至少保留')
  })

  it('saves a new episode and directory together and restores an uncertain revision-zero creation', async () => {
    const writes: Record<string, unknown>[] = []
    const original = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return read()
      writes.push(body)
      throw new Error('timeout')
    })
    await original.load()
    original.stageStructure(buildDirectoryChange(initial(), { kind: 'add', id: 'c' }))
    await expect(original.save([{ type: 'directory', id: 'directory' }])).rejects.toThrow('timeout')
    expect((writes[0]?.mutations as { expectedRevision: number }[]).map(item => item.expectedRevision)).toEqual([1, 0])
    const backup = JSON.parse(JSON.stringify(original.backup()))
    const invalid = new ProjectCollaborationClient(async () => read())
    await invalid.load()
    const broken = structuredClone(backup)
    broken.pending.mutations.pop()
    expect(() => invalid.restore(broken)).toThrow('缺少关联修改')
    expect(invalid.hasUnsavedChanges).toBe(false)
    const restored = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return read()
      expect(body).toEqual(writes[0])
      return { resources: (body.mutations as { type: 'episode' | 'directory', id: string, body: Record<string, unknown>, expectedRevision: number }[]).map(item => ({ ...item, revision: item.expectedRevision + 1, deleted: false })) }
    })
    await restored.load()
    restored.restore(backup)
    expect(restored.get('episode', 'c')?.conflict).toBe(false)
    await restored.retrySave()
    expect(restored.structureScopes).toEqual([])
    expect(restored.hasUnsavedChanges).toBe(false)
  })

  it('rejects dirty target episodes before staging and never exposes half a group', async () => {
    const client = new ProjectCollaborationClient(async () => read())
    await client.load()
    client.edit('episode', 'a', { keep: 'local' })
    expect(() => client.stageStructure(buildDirectoryChange(initial(), { kind: 'move', id: 'a', direction: 1 }))).toThrow('草稿')
    expect(client.get('directory', 'directory')?.dirty).toBe(false)
    expect(client.structureScopes).toEqual([])
  })

  it('retains the complete rejected group, reviews again before discard, and preserves unrelated drafts', async () => {
    let resources = initial()
    const client = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return read(resources)
      throw Object.assign(new Error('conflict'), { statusCode: 409 })
    })
    await client.load()
    client.edit('settings', 'settings', { local: 'keep' })
    client.stageStructure(buildDirectoryChange(initial(), { kind: 'add', id: 'c' }))
    expect(() => client.edit('episode', 'c', {})).toThrow('目录调整')
    await expect(client.save([{ type: 'directory', id: 'directory' }])).rejects.toThrow('conflict')
    expect(client.structureScopes).toHaveLength(2)
    const preview = await client.reviewStructure()
    resources = resources.map(item => item.type === 'directory' ? { ...item, revision: 2 } : item)
    await expect(client.discardStructure(preview)).rejects.toThrow('再次更新')
    expect(client.get('episode', 'c')).toBeDefined()
    await client.discardStructure(await client.reviewStructure())
    expect(client.get('episode', 'c')).toBeUndefined()
    expect(client.get('directory', 'directory')?.base.revision).toBe(2)
    expect(client.get('settings', 'settings')?.body).toEqual({ local: 'keep' })
  })
})

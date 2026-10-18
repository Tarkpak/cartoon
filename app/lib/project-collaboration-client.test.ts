import { describe, expect, it } from 'vitest'
import { ProjectCollaborationClient } from './project-collaboration-client'

const episode = (id: string, revision = 1) => ({ type: 'episode' as const, id, revision, body: { title: id }, deleted: false })
const snapshot = { enabled: true, protocolVersion: 1, cursor: 0, resources: [episode('a'), episode('b')] }

describe('project collaboration client', () => {
  it('preserves dirty episodes and applies unrelated remote changes', async () => {
    const client = new ProjectCollaborationClient(async body => body.action === 'read' ? snapshot : {
      changes: [episode('a', 2), episode('b', 2)], cursor: 2, hasMore: false
    })
    await client.load()
    client.edit('episode', 'a', { title: 'local' })
    await client.poll()
    expect(client.get('episode', 'a')).toMatchObject({ body: { title: 'local' }, conflict: true, base: { revision: 1 } })
    expect(client.get('episode', 'b')?.base.revision).toBe(2)
    await expect(client.load()).rejects.toThrow('未保存')
  })

  it('retries uncertain writes with the original operation and preserves later edits', async () => {
    const writes: Record<string, unknown>[] = []
    const client = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return snapshot
      writes.push(body)
      if (writes.length === 1) throw new Error('timeout')
      return { cursor: 99, resources: [episode('a', 2)] }
    })
    await client.load()
    client.edit('episode', 'a', { title: 'first' })
    await expect(client.save([{ type: 'episode', id: 'a' }])).rejects.toThrow('timeout')
    client.edit('episode', 'a', { title: 'second' })
    await client.retrySave()
    expect(writes[1]).toEqual(writes[0])
    expect(client.cursor).toBe(0)
    expect(client.get('episode', 'a')).toMatchObject({ dirty: true, body: { title: 'second' }, base: { revision: 2 } })
  })

  it('marks rejected submissions as conflicts and retains deleted remote drafts', async () => {
    const client = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return snapshot
      if (body.action === 'write') throw Object.assign(new Error('lease lost'), { statusCode: 423 })
      return { changes: [{ ...episode('a', 2), deleted: true, body: null }], cursor: 1, hasMore: false }
    })
    await client.load()
    client.edit('episode', 'a', { title: 'keep' })
    await expect(client.save([{ type: 'episode', id: 'a' }])).rejects.toThrow('lease lost')
    await client.poll()
    expect(client.backup().drafts[0]).toMatchObject({ dirty: true, conflict: true, body: { title: 'keep' } })
  })
  it('resolves only the reviewed resource without skipping the change feed', async () => {
    let reads = 0
    const client = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return ++reads === 1 ? snapshot : { ...snapshot, cursor: 20, resources: [episode('a', 3), episode('b', 2)] }
      return { changes: [episode('a', 2)], cursor: 1, hasMore: false }
    })
    await client.load()
    client.edit('episode', 'a', { title: 'local a' })
    client.edit('episode', 'b', { title: 'local b' })
    await client.poll()
    await client.resolve('episode', 'a', true)
    expect(client.get('episode', 'a')).toMatchObject({ base: { revision: 3 }, body: { title: 'local a' }, dirty: true, conflict: false })
    expect(client.get('episode', 'b')).toMatchObject({ base: { revision: 1 }, body: { title: 'local b' } })
    expect(client.cursor).toBe(1)
  })

  it('restores uncertain submissions with their original identity against a fresh snapshot', async () => {
    const original = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return snapshot
      throw new Error('timeout')
    })
    await original.load()
    original.edit('episode', 'a', { title: 'unsure' })
    await expect(original.save([{ type: 'episode', id: 'a' }])).rejects.toThrow()
    const saved = original.backup()
    const writes: Record<string, unknown>[] = []
    const restored = new ProjectCollaborationClient(async body => {
      if (body.action === 'read') return { ...snapshot, cursor: 15, resources: [episode('a', 2), episode('b', 3)] }
      writes.push(body)
      return { resources: [episode('a', 2)] }
    })
    await restored.load()
    restored.restore(JSON.parse(JSON.stringify(saved)))
    expect(restored.get('episode', 'a')).toMatchObject({ conflict: true, body: { title: 'unsure' } })
    expect(restored.get('episode', 'b')?.base.revision).toBe(3)
    await restored.retrySave()
    expect(writes[0]).toEqual({ action: 'write', ...saved.pending })
    expect(restored.cursor).toBe(15)
    expect(restored.hasUnsavedChanges).toBe(false)
  })

  it('rejects corrupt backup submissions atomically', async () => {
    const client = new ProjectCollaborationClient(async () => snapshot)
    await client.load()
    const saved = { cursor: 0, drafts: snapshot.resources.map(base => ({ base, body: base.body, dirty: true, conflict: false })) }
    expect(() => client.restore({ ...saved, pending: { operationId: 'op', mutations: [{ type: 'episode', id: 'a', expectedRevision: 999, body: {} }] } })).toThrow('不匹配')
    expect(client.hasUnsavedChanges).toBe(false)
  })

  it('requires another review if remote content changes after preview', async () => {
    const client = new ProjectCollaborationClient(async () => ({ ...snapshot, resources: [episode('a', 3)] }))
    await client.load()
    client.edit('episode', 'a', { title: 'local' })
    await expect(client.resolve('episode', 'a', true, 2)).rejects.toThrow('再次更新')
    expect(client.get('episode', 'a')?.body).toEqual({ title: 'local' })
  })

})

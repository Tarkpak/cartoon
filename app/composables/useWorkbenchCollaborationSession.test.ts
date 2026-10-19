import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
import { prepareWorkbenchRequest } from '../lib/workbench-collaboration'
import { useWorkbenchCollaborationSession } from './useWorkbenchCollaborationSession'

const fixture = () => splitProjectSnapshot({ project: { id: 'p', name: '原工作台' }, script: { episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }] }, scenes: [{ id: 's1', episodeId: 'a', description: 'A' }, { id: 's2', episodeId: 'b', description: 'B' }], characters: [] })
const view = () => ({ name: '原工作台', episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }], scenes: [{ id: 's1', episodeId: 'a', description: 'A' }, { id: 's2', episodeId: 'b', description: 'B' }], characters: [] })
let server = fixture()
let writes: Array<Record<string, any>>
let blocked: string
let loseReply: boolean
let store: Map<string, string>
const sessions: ReturnType<typeof useWorkbenchCollaborationSession>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  server = fixture(); writes = []; blocked = ''; loseReply = false; store = new Map()
  vi.stubGlobal('useCloudAdmin', () => ({ loadStatus: async () => ({ user: { id: 'owner' } }) }))
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
  const receipts = new Map<string, unknown>()
  vi.stubGlobal('$fetch', vi.fn(async (path: string, options: { body?: Record<string, any> }) => {
    if (path.endsWith('/prepare')) return { data: { enabled: true, protocolVersion: 1, resources: structuredClone(server) } }
    const body = options.body!
    if (body.action === 'lease') return { data: { editable: body.id !== blocked, expiresAt: Date.now() + 90000, canTakeover: true } }
    if (body.action === 'write') {
      writes.push(structuredClone(body))
      if (receipts.has(body.operationId)) return { data: receipts.get(body.operationId) }
      if (body.mutations.some((item: any) => item.expectedRevision !== (server.find(resource => resource.type === item.type && resource.id === item.id)?.revision ?? 0))) throw { statusCode: 409, message: '对象版本冲突' }
      const changed = body.mutations.map((item: any) => ({ type: item.type, id: item.id, revision: item.expectedRevision + 1, body: item.body, deleted: item.body === null }))
      for (const resource of changed) { const index = server.findIndex(item => item.type === resource.type && item.id === resource.id); if (index < 0) server.push(resource); else server[index] = resource }
      receipts.set(body.operationId, { resources: changed })
      if (loseReply) { loseReply = false; throw new Error('response lost') }
      return { data: { resources: changed } }
    }
    throw new Error(`Unexpected request: ${path}`)
  }))
})
afterEach(async () => { for (const session of sessions.splice(0)) await session.releaseEditSession(); vi.unstubAllGlobals(); vi.useRealTimers() })
const createSession = () => { const session = useWorkbenchCollaborationSession(async () => true); sessions.push(session); return session }

describe('collaboration in the original workbench', () => {
  it('lets two stale windows save different episodes without overwriting each other', async () => {
    const first = createSession(), second = createSession()
    await first.openEditSession('p'); await second.openEditSession('p')
    const a = view(), b = view()
    a.scenes[0]!.description = '成员 A'; b.scenes[1]!.description = '成员 B'
    await first.saveSnapshot(view(), a); await second.saveSnapshot(view(), b)
    expect(writes.map(item => item.mutations.map((mutation: any) => mutation.id))).toEqual([['a'], ['b']])
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: '成员 A' }])
    expect(server.find(item => item.id === 'b')!.body!.scenes).toMatchObject([{ description: '成员 B' }])
  })
  it('keeps one occupied episode from freezing another episode', async () => {
    const session = createSession(); await session.openEditSession('p'); blocked = 'a'
    const a = view(); a.scenes[0]!.description = '本地草稿'
    await expect(session.saveSnapshot(view(), a)).rejects.toThrow('其他集仍可编辑')
    expect(session.projectEditable.value).toBe(true)
    expect(writes).toHaveLength(0)
    const b = view(); b.scenes[1]!.description = '可保存'
    await session.saveSnapshot(view(), b)
    expect(writes[0]!.mutations[0].id).toBe('b')
  })
  it('rejects a same-episode stale write while retaining the draft', async () => {
    const first = createSession(), second = createSession()
    await first.openEditSession('p'); await second.openEditSession('p')
    const a = view(); a.scenes[0]!.description = '第一份'
    await first.saveSnapshot(view(), a)
    const stale = view(); stale.scenes[0]!.description = '第二份草稿'
    await expect(second.saveSnapshot(view(), stale)).rejects.toMatchObject({ statusCode: 409 })
    expect([...store.keys()].some(key => key.startsWith('workbench-collaboration-draft:'))).toBe(true)
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: '第一份' }])
  })
  it('confirms a lost response after reopening using the original operation ID', async () => {
    const first = createSession(); await first.openEditSession('p')
    const a = view(); a.scenes[0]!.description = '已提交'
    loseReply = true
    await expect(first.saveSnapshot(view(), a)).rejects.toThrow('response lost')
    await first.releaseEditSession()
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.projectEditable.value).toBe(true)
    expect(writes).toHaveLength(2)
    expect(writes[1]!.operationId).toBe(writes[0]!.operationId)
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '已提交' }, { description: 'B' }])
  })
  it('adds object revisions to the existing scene and writing requests', async () => {
    const session = createSession(); await session.openEditSession('p')
    expect(await prepareWorkbenchRequest('/api/asset-workflow/reference/generate', { projectId: 'p', scene: { id: 's2' } })).toMatchObject({ collaborationInput: { type: 'episode', id: 'b', episodeId: 'b', revision: 1, settingsRevision: 1 } })
    expect(await prepareWorkbenchRequest('/api/script/write', { projectId: 'p', action: 'episode_draft', context: { targetEpisode: { id: 'a' } } })).toMatchObject({ collaborationInput: { id: 'a' } })
  })
  it('restores conflicting drafts without overwriting cloud content and can read the latest version', async () => {
    const first = createSession(); await first.openEditSession('p')
    const remote = server.find(item => item.id === 'a')!
    remote.revision = 2
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.description = '云端更新'
    const local = view(); local.scenes[0]!.description = '本机草稿'
    await expect(first.saveSnapshot(view(), local)).rejects.toMatchObject({ statusCode: 409 })
    await first.releaseEditSession()
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.editSession.value.scopeConflict).toBe(true)
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '本机草稿' }, { description: 'B' }])
    reopened.discardDraft()
    await reopened.openEditSession('p')
    expect(reopened.editSession.value.scopeConflict).toBe(false)
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '云端更新' }, { description: 'B' }])
    expect([...store.keys()].some(key => key.endsWith(':archived'))).toBe(true)
  })

})

import { ref, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
import { prepareWorkbenchRequest } from '../lib/workbench-collaboration'
import { useWorkbenchCollaborationSession } from './useWorkbenchCollaborationSession'
import type { ProjectAccess } from '#shared/types/project'
import { createProjectDraftSession } from '~/lib/project-edit-session'

const draftSession = vi.hoisted(() => ({ windowId: 'test-runtime', recoveryKey: (() => undefined) as (prefix: string, actor: string, project: string) => string | undefined }))
vi.mock('~/lib/project-edit-session', async importOriginal => ({ ...await importOriginal<object>(), projectDraftSession: draftSession }))

function setDraftRuntime(id: string, source?: string) {
  const values = new Map<string, string>(source ? [['workbench-collaboration-window', source]] : [])
  Object.assign(draftSession, createProjectDraftSession(id, { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }))
}

const fixture = () => splitProjectSnapshot({ project: { id: 'p', name: '原工作台' }, script: { episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }] }, scenes: [{ id: 's1', episodeId: 'a', description: 'A' }, { id: 's2', episodeId: 'b', description: 'B' }], characters: [] })
const view = () => ({ name: '原工作台', episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }], scenes: [{ id: 's1', episodeId: 'a', description: 'A' }, { id: 's2', episodeId: 'b', description: 'B' }], characters: [] })
let server = fixture()
let writes: Array<Record<string, any>>
let blocked: string
let loseReply: boolean
let store: Map<string, string>
let currentUser = ref<{ id: string } | null>({ id: 'owner' })
let changes: typeof server
let readError: unknown
let editable: boolean
let access: ProjectAccess | undefined
const sessions: ReturnType<typeof useWorkbenchCollaborationSession>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  setDraftRuntime('test-runtime'); access = undefined
  currentUser = ref<{ id: string } | null>({ id: 'owner' }); changes = []; readError = undefined; editable = true
  server = fixture(); writes = []; blocked = ''; loseReply = false; store = new Map()
  vi.stubGlobal('useCloudAdmin', () => ({ currentUser, loadStatus: async () => ({ user: currentUser.value }) }))
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
  const receipts = new Map<string, unknown>()
  vi.stubGlobal('$fetch', vi.fn(async (path: string, options: { body?: Record<string, any> }) => {
    if (path.endsWith('/prepare')) return { data: { enabled: true, editable, access, protocolVersion: 1, resources: structuredClone(server) } }
    const body = options.body!
    if (body.action === 'read') return { data: { enabled: true, editable, resources: structuredClone(server), cursor: 1 } }
    if (body.action === 'presence') return { data: { collaborators: [{ userId: 'owner', displayName: 'Owner', self: true, editing: [], locked: [] }] } }
    if (body.action === 'changes') {
      if (readError) throw readError
      return { data: { changes: structuredClone(changes), cursor: 1, hasMore: false, editable, access } }
    }
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
  it('copies recovery drafts without sharing writable keys or resurrecting discarded drafts', async () => {
    setDraftRuntime('original')
    const first = createSession()
    await first.openEditSession('p')
    const a = view(), b = view()
    a.scenes[0]!.description = '原窗口草稿'
    b.scenes[0]!.description = '复制窗口草稿'
    first.stashDraft(view(), a)
    setDraftRuntime('copy', 'original')
    const second = createSession()
    await second.openEditSession('p')
    expect(second.snapshot().scenes).toMatchObject([{ description: '原窗口草稿' }, { description: 'B' }])
    second.stashDraft(view(), b)
    await first.openEditSession('p')
    expect(first.snapshot().scenes).toMatchObject([{ description: '原窗口草稿' }, { description: 'B' }])
    await second.openEditSession('p')
    expect(second.snapshot().scenes).toMatchObject([{ description: '复制窗口草稿' }, { description: 'B' }])
    second.discardDraft()
    await second.releaseEditSession()
    const remounted = createSession()
    await remounted.openEditSession('p')
    expect(remounted.snapshot().scenes).toMatchObject([{ description: 'A' }, { description: 'B' }])
  })

  it('recovers an uncertain operation and its newer draft under a fresh runtime identity', async () => {
    const first = createSession()
    await first.openEditSession('p')
    const submitted = view()
    submitted.scenes[0]!.description = '已经提交'
    loseReply = true
    await expect(first.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    const current = view()
    current.scenes[0]!.description = '回执丢失后继续输入'
    first.stashDraft(view(), current)
    await first.releaseEditSession()
    setDraftRuntime('reloaded-runtime', draftSession.windowId)
    const reopened = createSession()
    await reopened.openEditSession('p')
    expect(reopened.editSession.value.pendingSave).toBeFalsy()
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '回执丢失后继续输入' }, { description: 'B' }])
    expect(writes[1]!.operationId).toBe(writes[0]!.operationId)
  })

  it('publishes canonical permissions on open and polling without replacing a draft', async () => {
    access = { role: 'viewer', isOwner: false, permissions: ['view'] }
    editable = false
    const changed = vi.fn()
    const current = view()
    const session = useWorkbenchCollaborationSession(async () => true, { access: changed, draft: () => ({ before: view(), after: current }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    expect(changed).toHaveBeenLastCalledWith(access)
    access = { role: 'editor', isOwner: false, permissions: ['view', 'edit', 'generate', 'export'] }
    editable = true
    await session.poll()
    expect(changed).toHaveBeenLastCalledWith(access)
    expect(session.projectEditable.value).toBe(true)
    current.scenes[0]!.description = '保留本机输入'
    access = { role: 'custom', isOwner: false, permissions: ['view', 'edit'] }
    await session.poll()
    expect(changed).toHaveBeenLastCalledWith(access)
    expect(current.scenes[0]!.description).toBe('保留本机输入')
  })

  it('preserves a revert to the original text after a lost receipt, including reopening', async () => {
    const session = createSession()
    await session.openEditSession('p')
    const submitted = view()
    submitted.scenes[0]!.description = '已提交'
    loseReply = true
    await expect(session.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    session.stashDraft(view(), view())
    await session.releaseEditSession()
    const reopened = createSession()
    await reopened.openEditSession('p')
    expect(reopened.snapshot().scenes).toMatchObject([{ description: 'A' }, { description: 'B' }])
    const baseline = reopened.restoredBaseline()!
    expect(baseline.scenes).toMatchObject([{ description: '已提交' }, { description: 'B' }])
    await reopened.saveSnapshot(baseline, view())
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: 'A' }])
  })

  it('preserves a partial revert alongside edits in another episode after a lost receipt', async () => {
    const first = createSession()
    await first.openEditSession('p')
    const submitted = view()
    submitted.scenes[0]!.description = '第一集已提交'
    submitted.scenes[1]!.description = '第二集已提交'
    loseReply = true
    await expect(first.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    const current = view()
    current.scenes[1]!.description = '第二集继续输入'
    first.stashDraft(view(), current)
    await first.releaseEditSession()
    const reopened = createSession()
    await reopened.openEditSession('p')
    expect(reopened.snapshot().scenes).toMatchObject([{ description: 'A' }, { description: '第二集继续输入' }])
    await reopened.saveSnapshot(reopened.restoredBaseline()!, current)
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: 'A' }])
    expect(server.find(item => item.id === 'b')!.body!.scenes).toMatchObject([{ description: '第二集继续输入' }])
  })

  it('preserves a live revert while confirming a lost receipt', async () => {
    let current = view()
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before: view(), after: current }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    current.scenes[0]!.description = '已提交'
    loseReply = true
    await expect(session.saveSnapshot(view(), current)).rejects.toThrow('response lost')
    current = view()
    await session.confirmPending()
    await session.openEditSession('p')
    expect(session.snapshot().scenes).toMatchObject([{ description: 'A' }, { description: 'B' }])
  })

  it('updates upgraded permissions and retains content conflicts across permission changes', async () => {
    editable = false
    const current = view()
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before: view(), after: current }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    editable = true
    await session.poll()
    expect(session.projectEditable.value).toBe(true)
    expect(session.editSession.value.reason).toBeUndefined()
    editable = false
    await session.poll()
    expect(session.projectEditable.value).toBe(false)
    expect(session.editSession.value.scopeConflict).toBe(true)
    editable = true
    await session.poll()
    expect(session.projectEditable.value).toBe(true)
    expect(session.editSession.value.scopeConflict).toBe(false)
    expect(session.editSession.value.reason).toBeUndefined()
    current.scenes[0]!.description = '本机修改'
    const remote = structuredClone(server.find(item => item.id === 'a')!)
    remote.revision++
    changes = [remote]
    await session.poll()
    expect(session.editSession.value.scopeConflict).toBe(true)
    editable = false
    await session.poll()
    expect(session.projectEditable.value).toBe(false)
    editable = true
    await session.poll()
    expect(session.projectEditable.value).toBe(true)
    expect(session.editSession.value.scopeConflict).toBe(true)
    expect(session.editSession.value.reason).toContain('合并')
  })

  it('preserves newer live input when confirming a lost receipt and reopening', async () => {
    let current = view()
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before: view(), after: current }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    current.scenes[0]!.description = '已提交内容'
    loseReply = true
    await expect(session.saveSnapshot(view(), current)).rejects.toThrow('response lost')
    current = view()
    current.scenes[0]!.description = '提交后继续输入'
    await session.confirmPending()
    await session.openEditSession('p')
    expect(session.snapshot().scenes).toMatchObject([{ description: '提交后继续输入' }, { description: 'B' }])
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: '已提交内容' }])
    expect(writes[1]!.operationId).toBe(writes[0]!.operationId)
  })

  it('preserves the latest save payload when retrying an uncertain submission', async () => {
    const session = createSession()
    await session.openEditSession('p')
    const submitted = view()
    submitted.scenes[0]!.description = '已提交'
    loseReply = true
    await expect(session.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    const advanced = view()
    advanced.scenes[0]!.description = '重试时的新输入'
    await expect(session.saveSnapshot(view(), advanced)).rejects.toThrow('上次提交已确认')
    await session.openEditSession('p')
    expect(session.snapshot().scenes).toMatchObject([{ description: '重试时的新输入' }, { description: 'B' }])
  })

  it('reports recent typing after autosave and stops reporting it when idle', async () => {
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before: view(), after: view() }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    session.updateCollaborationActivity({ type: 'episode', id: 'a' })
    await session.poll()
    const requests = () => vi.mocked($fetch).mock.calls.map(([, options]) => options?.body as Record<string, unknown>).filter(body => body?.action === 'changes')
    expect(requests().at(-1)?.activeScopes).toContainEqual({ type: 'episode', id: 'a' })
    vi.setSystemTime(Date.now() + 31_000)
    await session.poll()
    expect(requests().at(-1)?.activeScopes).toEqual([])
  })

  it('fences another cloud edit made after the merge preview', async () => {
    let before = view(), after = view()
    after.scenes[0]!.description = '我的画面'
    const session = useWorkbenchCollaborationSession(async () => true, {
      draft: () => ({ before, after }),
      apply: (baseline, current) => {
        before = { ...view(), scenes: baseline.scenes as typeof before.scenes }
        after = { ...view(), scenes: current.scenes as typeof after.scenes }
      }
    })
    sessions.push(session)
    await session.openEditSession('p')
    await session.previewMerge()
    const remote = server.find(item => item.id === 'a')!
    remote.revision++
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.description = '对方后来保存'
    session.applyMerge({})
    await expect(session.saveSnapshot(before, after)).rejects.toMatchObject({ statusCode: 409 })
    expect(remote.body!.scenes).toMatchObject([{ description: '对方后来保存' }])
    expect([...store.values()].some(value => value.includes('我的画面'))).toBe(true)
  })

  it('merges different fields of the same episode and saves against the latest revision', async () => {
    let before = view(), after = view()
    after.scenes[0]!.description = '我的画面'
    const session = useWorkbenchCollaborationSession(async () => true, {
      draft: () => ({ before, after }),
      apply: (baseline, current) => {
        before = { ...view(), scenes: baseline.scenes as typeof before.scenes }
        after = { ...view(), scenes: current.scenes as typeof after.scenes }
      }
    })
    sessions.push(session)
    await session.openEditSession('p')
    const remote = server.find(item => item.id === 'a')!
    remote.revision++
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.dialogue = '对方对白'
    await session.previewMerge()
    expect(session.mergePreview.value?.conflicts).toHaveLength(0)
    session.applyMerge({})
    expect(after.scenes[0]).toMatchObject({ description: '我的画面', dialogue: '对方对白' })
    await session.saveSnapshot(before, after)
    expect(writes[0]!.mutations[0].expectedRevision).toBe(2)
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: '我的画面', dialogue: '对方对白' }])
  })

  it('requires explicit choices and rejects a draft changed after comparison', async () => {
    const before = view(), after = view()
    after.scenes[0]!.description = '本机修改'
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before, after }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    const remote = server.find(item => item.id === 'a')!
    remote.revision++
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.description = '云端修改'
    await session.previewMerge()
    expect(session.mergePreview.value?.conflicts).toHaveLength(1)
    expect(() => session.applyMerge({})).toThrow('每一处冲突')
    after.scenes[0]!.description = '继续输入'
    expect(() => session.applyMerge({})).toThrow('草稿已变化')
    session.cancelMerge()
    expect(session.mergePreview.value).toBeUndefined()
    expect(writes).toHaveLength(0)
  })

  it('keeps temporary occupation recoverable without asking to discard a draft', async () => {
    const session = createSession()
    await session.openEditSession('p')
    const local = view()
    local.scenes[0]!.description = '待保存内容'
    blocked = 'a'
    await expect(session.saveSnapshot(view(), local)).rejects.toThrow('正在由其他成员编辑')
    expect(session.editSession.value.syncStatus).toBe('editing')
    expect(session.editSession.value.scopeConflict).not.toBe(true)
    expect(session.editSession.value.reason).toContain('当前修改已保留')
    blocked = ''
    await session.saveSnapshot(view(), local)
    expect(session.editSession.value.reason).toBeUndefined()
    expect(server.find(item => item.id === 'a')!.body!.scenes).toMatchObject([{ description: '待保存内容' }])
  })

  it('backs up unsaved edits on connection loss and clears the warning after recovery', async () => {
    const before = view(), after = view()
    after.scenes[0]!.description = '断网前输入'
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before, after }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    readError = new Error('网络暂时不可用')
    await session.poll()
    expect(session.projectEditable.value).toBe(true)
    expect(session.editSession.value.scopeConflict).not.toBe(true)
    expect(session.editSession.value.reason).toContain('网络暂时不可用')
    expect([...store.values()].some(value => value.includes('断网前输入'))).toBe(true)
    readError = undefined
    await session.poll()
    expect(session.editSession.value.reason).toBeUndefined()
  })

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
  it('receives remote changes while preserving another episode draft and runtime baseline', async () => {
    const before = view(), after = view()
    after.scenes[0]!.description = '本机 A 草稿'
    const apply = vi.fn()
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before, after }), apply })
    sessions.push(session)
    await session.openEditSession('p')
    const remote = structuredClone(server.find(item => item.id === 'b')!)
    remote.revision++
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.description = '成员 B 更新'
    changes = [remote]
    await session.poll()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]![0].scenes).toMatchObject([{ description: 'A' }, { description: '成员 B 更新' }])
    expect(apply.mock.calls[0]![1].scenes).toMatchObject([{ description: '本机 A 草稿' }, { description: '成员 B 更新' }])
    expect(session.editSession.value.scopeConflict).not.toBe(true)
  })
  it('preserves a dirty object when its remote revision changes', async () => {
    const before = view(), after = view()
    after.scenes[0]!.description = '本机 A 草稿'
    const apply = vi.fn()
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before, after }), apply })
    sessions.push(session)
    await session.openEditSession('p')
    const remote = structuredClone(server.find(item => item.id === 'a')!)
    remote.revision++
    changes = [remote]
    await session.poll()
    expect(apply).not.toHaveBeenCalled()
    expect(session.editSession.value.scopeConflict).toBe(true)
    expect(session.projectEditable.value).toBe(true)
    expect([...store.values()].some(value => value.includes('本机 A 草稿'))).toBe(true)
  })
  it('fences permission removal and account switching without losing the draft', async () => {
    const before = view(), after = view()
    after.scenes[0]!.description = '权限变更前草稿'
    const session = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before, after }), apply: vi.fn() })
    sessions.push(session)
    await session.openEditSession('p')
    session.stashDraft(before, after)
    readError = { statusCode: 403, message: '成员已移除' }
    await session.poll()
    expect(session.projectEditable.value).toBe(false)
    currentUser.value = { id: 'other' }
    await nextTick()
    expect(session.projectEditable.value).toBe(false)
    expect(session.editSession.value.reason).toContain('账号已切换')
    expect([...store.values()].some(value => value.includes('权限变更前草稿'))).toBe(true)
  })
  it('does not discard edits made after an uncertain submission when reopening', async () => {
    const first = createSession(); await first.openEditSession('p')
    const submitted = view(); submitted.scenes[0]!.description = '已提交'
    loseReply = true
    await expect(first.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    const advanced = view(); advanced.scenes[0]!.description = '提交之后继续输入'
    first.stashDraft(view(), advanced)
    await first.releaseEditSession()
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '提交之后继续输入' }, { description: 'B' }])
    expect([...store.values()].some(value => value.includes('提交之后继续输入'))).toBe(true)
  })
  it('does not disable the entire workbench when a recovered submission conflicts', async () => {
    const first = createSession(); await first.openEditSession('p')
    const submitted = view(); submitted.scenes[0]!.description = '待确认'
    loseReply = true
    await expect(first.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    const fetch = vi.mocked($fetch)
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation(async (path: any, options: any) => {
      if (options?.body?.action === 'write') throw { statusCode: 409, message: '对象已更新' }
      return original(path, options)
    })
    await first.releaseEditSession()
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.projectEditable.value).toBe(true)
    expect(reopened.editSession.value.scopeConflict).toBe(true)
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '待确认' }, { description: 'B' }])
  })
  it('loads viewers read-only and reacts to an editor downgrade through polling', async () => {
    editable = false
    const viewer = createSession(); await viewer.openEditSession('p')
    expect(viewer.projectEditable.value).toBe(false)
    expect(viewer.ready.value).toBe(true)
    expect(viewer.snapshot().scenes).toHaveLength(2)
    editable = true
    const editor = useWorkbenchCollaborationSession(async () => true, { draft: () => ({ before: view(), after: view() }), apply: vi.fn() })
    sessions.push(editor)
    await editor.openEditSession('p')
    editable = false
    await editor.poll()
    expect(editor.projectEditable.value).toBe(false)
    expect(editor.editSession.value.reason).toContain('只读权限')
  })
  it('restores a draft even when another member deleted its episode', async () => {
    const first = createSession(); await first.openEditSession('p')
    const local = view(); local.scenes[0]!.description = '已删除集的本机草稿'
    first.stashDraft(view(), local)
    await first.releaseEditSession()
    server.find(item => item.id === 'directory')!.body!.episodeIds = ['b']
    server.find(item => item.id === 'directory')!.revision++
    const episode = server.find(item => item.id === 'a')!
    episode.deleted = true; episode.body = null; episode.revision++
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.projectEditable.value).toBe(true)
    expect(reopened.editSession.value.scopeConflict).toBe(true)
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '已删除集的本机草稿' }, { description: 'B' }])
  })
  it('isolates drafts and pending operations for two windows of the same account', async () => {
    const createWindow = (windowId: string) => {
      const session = useWorkbenchCollaborationSession(async () => true, { windowId, draft: () => undefined, apply: vi.fn() })
      sessions.push(session); return session
    }
    const first = createWindow('window-a'), second = createWindow('window-b')
    await first.openEditSession('p'); await second.openEditSession('p')
    const a = view(), b = view()
    a.scenes[0]!.description = '窗口 A 草稿'; b.scenes[1]!.description = '窗口 B 草稿'
    first.stashDraft(view(), a); second.stashDraft(view(), b)
    await first.releaseEditSession(); await second.releaseEditSession()
    const reopenedA = createWindow('window-a'), reopenedB = createWindow('window-b')
    await reopenedA.openEditSession('p'); await reopenedB.openEditSession('p')
    expect(reopenedA.snapshot().scenes).toMatchObject([{ description: '窗口 A 草稿' }, { description: 'B' }])
    expect(reopenedB.snapshot().scenes).toMatchObject([{ description: 'A' }, { description: '窗口 B 草稿' }])
  })
  it('does not roll back a newer cloud version when confirming an old receipt', async () => {
    const first = createSession(); await first.openEditSession('p')
    const submitted = view(); submitted.scenes[0]!.description = '原提交'
    loseReply = true
    await expect(first.saveSnapshot(view(), submitted)).rejects.toThrow('response lost')
    await first.releaseEditSession()
    const remote = server.find(item => item.id === 'a')!
    remote.revision++
    ;(remote.body!.scenes as Array<Record<string, unknown>>)[0]!.description = '其他成员后续更新'
    const reopened = createSession(); await reopened.openEditSession('p')
    expect(reopened.snapshot().scenes).toMatchObject([{ description: '其他成员后续更新' }, { description: 'B' }])
    expect(reopened.editSession.value.scopeConflict).toBe(false)
  })
  it('releases acquired objects when a later object in the save is occupied', async () => {
    const session = createSession(); await session.openEditSession('p')
    const local = view(); local.scenes[0]!.description = 'A 草稿'; local.scenes[1]!.description = 'B 草稿'
    blocked = 'b'
    await expect(session.saveSnapshot(view(), local)).rejects.toThrow('正在由其他成员编辑')
    expect(vi.mocked($fetch).mock.calls.some(([, options]) => {
      const body = options?.body as Record<string, unknown>
      return body?.leaseAction === 'release' && body.id === 'a'
    })).toBe(true)
    expect(writes).toHaveLength(0)
  })
  it('describes online activity using canonical resource names without treating draft editing as a lock', async () => {
    const session = createSession(); await session.openEditSession('p')
    await vi.advanceTimersByTimeAsync(0)
    const fetch = vi.mocked($fetch), original = fetch.getMockImplementation()!
    fetch.mockImplementation(async (path: any, options: any) => {
      if (options?.body?.action === 'presence') return { data: { collaborators: [
        { userId: 'owner', displayName: 'Owner', self: true, editing: [], locked: [] },
        { userId: 'alice', displayName: '小张', self: false, editing: [{ type: 'episode', id: 'b' }], locked: [] }
      ] } }
      return original(path, options)
    })
    await session.refreshPresence()
    expect(session.editSession.value.onlineCount).toBe(2)
    expect(session.editSession.value.collaborators).toEqual([{ userId: 'alice', displayName: '小张', activity: '正在编辑 第2集', locked: false }])
    expect(session.projectEditable.value).toBe(true)
    expect(session.editSession.value.syncStatus).toBe('synced')
  })
  it('adds object revisions to the existing scene and writing requests', async () => {
    const session = createSession(); await session.openEditSession('p')
    expect(await prepareWorkbenchRequest('/api/asset-workflow/reference/generate', { projectId: 'p', scene: { id: 's2' } })).toMatchObject({ collaborationInput: { type: 'episode', id: 'b', episodeId: 'b', revision: 1, settingsRevision: 1 } })
    expect(await prepareWorkbenchRequest('/api/script/write', { projectId: 'p', action: 'episode_draft', context: { targetEpisode: { id: 'a' } } })).toMatchObject({ collaborationInput: { id: 'a' } })
  })
  it('releases a generation lease after the last request settles without another save', async () => {
    const session = createSession(); await session.openEditSession('p')
    const cleanups: Array<() => Promise<void>> = []
    const prepare = () => prepareWorkbenchRequest('/api/script/write', { projectId: 'p', context: { targetEpisode: { id: 'a' } } }, cleanup => cleanups.push(cleanup))
    await prepare()
    await prepare()
    const fetch = vi.mocked($fetch)
    const releases = () => fetch.mock.calls.filter(([, options]) => {
      const body = options?.body
      return body && typeof body === 'object' && 'action' in body && body.action === 'lease' && 'leaseAction' in body && body.leaseAction === 'release'
    })
    await cleanups[0]!()
    expect(releases()).toHaveLength(0)
    await cleanups[1]!()
    expect(releases()).toHaveLength(1)
    fetch.mockClear()
    await session.heartbeat()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not release a new session lease when an old generation settles', async () => {
    const session = createSession(); await session.openEditSession('p')
    let cleanup: (() => Promise<void>) | undefined
    await prepareWorkbenchRequest('/api/script/write', { projectId: 'p' }, value => { cleanup = value })
    await session.openEditSession('other')
    vi.mocked($fetch).mockClear()
    await cleanup!()
    expect($fetch).not.toHaveBeenCalled()
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

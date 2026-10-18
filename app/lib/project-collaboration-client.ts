import { collaborationId, collaborationObject, collaborationResourceType, type CollaborationBody, type CollaborationChange, type CollaborationResource } from '../../shared/types/project-collaboration'

export interface CollaborationDraft {
  base: CollaborationResource
  body: CollaborationBody | null
  dirty: boolean
  conflict: boolean
  remoteRevision?: number
}
type Mutation = { type: CollaborationResource['type'], id: string, expectedRevision: number, body: CollaborationBody | null }
export type CollaborationBackup = ReturnType<ProjectCollaborationClient['backup']>

type Transport = (body: Record<string, unknown>) => Promise<unknown>
const keyOf = (resource: Pick<CollaborationResource, 'type' | 'id'>) => JSON.stringify([resource.type, resource.id])
const copy = <T>(value: T): T => structuredClone(value)

/** One instance belongs to one project/window. Transport supplies authentication and timeouts. */
export class ProjectCollaborationClient {
  readonly drafts = new Map<string, CollaborationDraft>()
  cursor = 0
  private pending?: { operationId: string, mutations: Mutation[] }
  private polling?: Promise<void>
  private generation = 0

  constructor(private readonly request: Transport) {}

  get(type: CollaborationResource['type'], id: string) {
    return this.drafts.get(keyOf({ type, id }))
  }

  async load() {
    if (this.pending || [...this.drafts.values()].some(draft => draft.dirty)) throw new Error('请先保存或备份未保存的修改')
    const generation = ++this.generation
    const result = await this.request({ action: 'read' }) as { enabled: boolean, protocolVersion: number, cursor: number, resources: CollaborationResource[] }
    if (generation !== this.generation) return
    if (!result.enabled || result.protocolVersion !== 1) throw new Error('项目尚未启用支持的协作协议')
    this.drafts.clear()
    for (const resource of result.resources) this.apply(resource)
    this.cursor = result.cursor
  }

  edit(type: CollaborationResource['type'], id: string, body: CollaborationBody | null) {
    const draft = this.get(type, id)
    if (!draft || draft.base.deleted) throw new Error('编辑对象不存在或已删除')
    draft.body = copy(body)
    draft.dirty = true
  }

  private apply(resource: CollaborationResource) {
    const key = keyOf(resource)
    const draft = this.drafts.get(key)
    if (draft && draft.base.revision >= resource.revision) return
    if (draft?.dirty) {
      // Keep the original revision and local body until the user resolves this object.
      draft.conflict = true
      draft.remoteRevision = Math.max(draft.remoteRevision ?? 0, resource.revision)
      return
    }
    this.drafts.set(key, { base: copy(resource), body: copy(resource.body), dirty: false, conflict: false })
  }

  poll(): Promise<void> {
    if (this.polling) return this.polling
    const generation = this.generation
    const run = async () => {
      let hasMore = true
      while (hasMore && generation === this.generation) {
        const after = this.cursor
        const page = await this.request({ action: 'changes', after }) as { changes: CollaborationChange[], cursor: number, hasMore: boolean }
        if (generation !== this.generation) return
        if (page.cursor < after || (page.hasMore && page.cursor <= after)) throw new Error('协作增量游标无效')
        for (const change of page.changes) this.apply(change)
        this.cursor = page.cursor
        hasMore = page.hasMore
      }
    }
    this.polling = run().finally(() => { this.polling = undefined })
    return this.polling
  }

  async save(resources: Pick<CollaborationResource, 'type' | 'id'>[]) {
    if (this.pending) throw new Error('上次提交结果尚未确认，请重试原提交')
    const mutations: Mutation[] = []
    for (const resource of resources) {
      const draft = this.get(resource.type, resource.id)
      if (!draft?.dirty) continue
      if (draft.conflict) throw new Error('该对象存在远端修改，请先处理冲突')
      mutations.push({ ...resource, expectedRevision: draft.base.revision, body: copy(draft.body) })
    }
    if (!mutations.length) return
    this.pending = { operationId: crypto.randomUUID(), mutations }
    return this.retrySave()
  }

  /** Explicitly review one conflicting object; other drafts and the feed cursor stay intact. */
  async readResource(type: CollaborationResource['type'], id: string) {
    const result = await this.request({ action: 'read' }) as { resources: CollaborationResource[] }
    const remote = result.resources.find(resource => resource.type === type && resource.id === id)
    if (!remote) throw new Error('远端编辑对象不存在')
    return copy(remote)
  }

  async resolve(type: CollaborationResource['type'], id: string, keepLocal: boolean, reviewedRevision?: number) {
    if (this.pending || this.saving) throw new Error('请先确认正在提交的修改')
    const draft = this.get(type, id)
    if (!draft) throw new Error('编辑对象不存在')
    const generation = this.generation
    const remote = await this.readResource(type, id)
    if (generation !== this.generation) return
    if (reviewedRevision !== undefined && reviewedRevision !== remote.revision) throw new Error('远端内容再次更新，请重新查看后处理')
    if (keepLocal && remote.deleted) throw new Error('该对象已删除，请先导出本地草稿')
    draft.base = copy(remote)
    if (!keepLocal) draft.body = copy(remote.body)
    draft.dirty = keepLocal
    draft.conflict = false
    draft.remoteRevision = undefined
  }

  private saving = false

  async retrySave() {
    if (!this.pending) return
    if (this.saving) throw new Error('提交正在进行中')
    this.saving = true
    const pending = this.pending
    try {
      const result = await this.request({ action: 'write', ...copy(pending) }) as { resources: CollaborationResource[] }
      for (const resource of result.resources) {
        const draft = this.get(resource.type, resource.id)
        const sent = pending.mutations.find(item => keyOf(item) === keyOf(resource))
        if (!draft || !sent) continue
        // Editing may continue while a request is in flight.
        const editedAgain = JSON.stringify(draft.body) !== JSON.stringify(sent.body)
        draft.base = copy(resource)
        draft.dirty = editedAgain
        draft.conflict = (draft.remoteRevision ?? 0) > resource.revision
        if (!draft.conflict) draft.remoteRevision = undefined
        if (!editedAgain) draft.body = copy(resource.body)
      }
      // Only the feed advances the cursor: a write response may include unseen changes.
      this.pending = undefined
    } catch (error) {
      const status = (error as { statusCode?: number, status?: number }).statusCode ?? (error as { status?: number }).status
      if (status === 409 || status === 423) {
        for (const mutation of pending.mutations) {
          const draft = this.get(mutation.type, mutation.id)
          if (draft) draft.conflict = true
        }
        this.pending = undefined
      } else if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // A definitive rejection did not commit; let the user correct the draft or permissions.
        this.pending = undefined
      }
      throw error
    } finally { this.saving = false }
  }

  get hasPendingSave() { return !!this.pending }
  get hasUnsavedChanges() { return this.hasPendingSave || [...this.drafts.values()].some(draft => draft.dirty) }

  restore(value: unknown) {
    if (this.hasUnsavedChanges) throw new Error('请先处理当前未保存的修改')
    const backup = collaborationObject(value, '草稿备份')
    if (!Array.isArray(backup.drafts)) throw new Error('草稿备份格式无效')
    const resource = (value: unknown): CollaborationResource => {
      const item = collaborationObject(value, '备份对象')
      const type = collaborationResourceType(item.type)
      const id = collaborationId(item.id)
      if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || typeof item.deleted !== 'boolean') throw new Error('备份对象版本无效')
      const body = item.body === null ? null : collaborationObject(item.body, '对象内容')
      return { type, id, revision: item.revision as number, deleted: item.deleted, body }
    }
    const drafts = backup.drafts.map(value => {
      const item = collaborationObject(value, '备份草稿')
      if (typeof item.dirty !== 'boolean' || typeof item.conflict !== 'boolean') throw new Error('备份草稿状态无效')
      return { base: resource(item.base), body: item.body === null ? null : collaborationObject(item.body, '草稿内容'), dirty: item.dirty, conflict: item.conflict }
    })
    if (new Set(drafts.map(draft => keyOf(draft.base))).size !== drafts.length) throw new Error('备份对象重复')
    let pending: typeof this.pending
    if (backup.pending != null) {
      const operation = collaborationObject(backup.pending, '待确认提交')
      const operationId = collaborationId(operation.operationId)
      if (!Array.isArray(operation.mutations) || !operation.mutations.length || operation.mutations.length > 100) throw new Error('备份提交无效')
      const mutations = operation.mutations.map(value => {
        const item = collaborationObject(value, '备份修改')
        const type = collaborationResourceType(item.type)
        const id = collaborationId(item.id)
        const expectedRevision = item.expectedRevision
        const draft = drafts.find(draft => keyOf(draft.base) === keyOf({ type, id }))
        if (!draft?.dirty || expectedRevision !== draft.base.revision) throw new Error('备份提交与草稿不匹配')
        return { type, id, expectedRevision: expectedRevision as number, body: item.body === null ? null : collaborationObject(item.body, '提交内容') }
      })
      if (new Set(mutations.map(keyOf)).size !== mutations.length) throw new Error('备份提交重复')
      pending = { operationId, mutations }
    }
    // Validate everything before modifying live drafts. Keep the freshly read feed cursor.
    for (const draft of drafts.filter(draft => draft.dirty)) {
      const current = this.drafts.get(keyOf(draft.base))
      const conflict = draft.conflict || !current || current.base.deleted || current.base.revision !== draft.base.revision
      this.drafts.set(keyOf(draft.base), { ...copy(draft), conflict, remoteRevision: current?.base.revision })
    }
    this.pending = copy(pending)
  }

  /** Export before navigation or lease loss; includes uncertain operations for safe recovery. */
  backup() {
    return copy({ cursor: this.cursor, drafts: [...this.drafts.values()].filter(draft => draft.dirty), pending: this.pending })
  }
}

import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { CollaborationBody, CollaborationLease, CollaborationResource } from '../../shared/types/project-collaboration'
import { projectEditSessionId } from '~/lib/project-edit-session'
import type { CollaborationAssetResult } from '~/lib/project-collaboration-assets'
import type { ProjectEditSessionState } from './useProjectEditSession'
import { buildWorkbenchMutations, composeWorkbenchSnapshot, patchWorkbenchFields, workbenchSaveView, registerWorkbenchCollaboration } from '~/lib/workbench-collaboration'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

type Mutation = ReturnType<typeof buildWorkbenchMutations>[number]
interface PendingSave { operationId: string, mutations: Mutation[] }
interface WorkbenchDraft { before: CollaborationBody, after: CollaborationBody }
interface WorkbenchSync {
  windowId?: string
  draft: () => WorkbenchDraft | undefined
  apply: (baseline: CollaborationBody, current: CollaborationBody) => void
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const keyOf = (scope: { type: string, id: string }) => JSON.stringify([scope.type, scope.id])

/** Adapts the original workbench to resource writes without changing its UI. */
export function useWorkbenchCollaborationSession(saveCurrent: () => Promise<boolean>, sync?: WorkbenchSync) {
  const editSession = ref<ProjectEditSessionState>({ editable: false, collaboration: true, canTakeover: false, reason: '正在准备协作项目…' })
  const acquiring = ref(false)
  const resources = shallowRef<CollaborationResource[]>([])
  const held = new Map<string, { type: CollaborationResource['type'], id: string }>()
  let activeId = ''
  let actorId = ''
  let sequence = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let unregister: (() => void) | undefined
  let pending: PendingSave | undefined
  let recovered: { before: CollaborationBody, after: CollaborationBody, resources: CollaborationResource[] } | undefined
  const cloud = useCloudAdmin()
  const windowId = sync?.windowId || (() => {
    try {
      const existing = sessionStorage.getItem('workbench-collaboration-window')
      if (existing) return existing
      sessionStorage.setItem('workbench-collaboration-window', projectEditSessionId)
    } catch { /* A runtime-specific ID still isolates tabs when sessionStorage is unavailable. */ }
    return projectEditSessionId
  })()
  let cursor = 0
  let polling = false
  let connectionLost = false
  let exportedDraftKey = ''
  let exportedConflictKey = ''
  let heartbeatBusy = false
  let saving = false
  const storageKey = () => `workbench-collaboration-pending:${JSON.stringify([actorId, activeId, windowId])}`
  const request = async <T>(body: CollaborationBody): Promise<T> => {
    const response = await $fetch<{ data: T }>(`/api/project/${encodeURIComponent(activeId)}/collaboration`, { method: 'POST', body, retry: 0, timeout: 60_000 })
    return response.data
  }
  const draftKey = () => `workbench-collaboration-draft:${JSON.stringify([actorId, activeId, windowId])}`
  function snapshot() {
    const base = composeWorkbenchSnapshot(resources.value)
    return recovered ? patchWorkbenchFields(base, workbenchSaveView(recovered.before), workbenchSaveView(recovered.after)) as CollaborationBody : base
  }
  function restoredBaseline() { return recovered?.before }
  function downloadDraft() {
    const data = localStorage.getItem(draftKey()) || localStorage.getItem(`${storageKey()}:conflict`) || (exportedDraftKey ? localStorage.getItem(exportedDraftKey) : null) || (exportedConflictKey ? localStorage.getItem(exportedConflictKey) : null)
    if (!data) return
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `协作草稿-${activeId}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function discardDraft() {
    if (pending) throw new Error('上次提交结果尚未确认，请先重试保存，避免丢失后续草稿')
    const draft = localStorage.getItem(draftKey())
    if (draft) localStorage.setItem(`${draftKey()}:archived`, draft)
    localStorage.removeItem(draftKey())
    recovered = undefined
  }
  function stashDraft(before: CollaborationBody, after: CollaborationBody) {
    if (!activeId || !actorId) return
    if (JSON.stringify(before) === JSON.stringify(after)) { localStorage.removeItem(draftKey()); return }
    localStorage.setItem(draftKey(), JSON.stringify({ before, after, resources: resources.value }))
  }
  async function acquire(scope: { type: CollaborationResource['type'], id: string }, takeover = false) {
    const version = sequence
    const lease = await request<CollaborationLease>({ action: 'lease', leaseAction: takeover ? 'takeover' : 'acquire', ...scope })
    if (version !== sequence) throw new Error('项目已切换，原项目的修改仍保留在本机')
    if (!lease.editable) throw new Error(`${scope.type === 'episode' ? '此集' : scope.type === 'character' ? '此角色' : '公共设置或目录'}正在由其他成员编辑，其他集仍可编辑；当前修改已保留，请稍后重试。`)
    held.set(keyOf(scope), scope)
  }
  function fenceAccess(cause: unknown) {
    const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
    if ([401, 403, 404, 410].includes(status || 0)) {
      editSession.value = { ...editSession.value, editable: false, scopeConflict: true, reason: getDisplayErrorMessage(cause, '协作权限已变化，请重新连接；本机草稿已保留。') }
    }
  }
  async function poll() {
    if (!activeId || polling || saving || pending || !sync) return
    polling = true
    const version = sequence
    try {
      // Fetch the complete batch before applying: directory and episodes are atomic.
      const updates = new Map<string, CollaborationResource>()
      let nextCursor = cursor
      let hasMore = true
      while (hasMore) {
        const page = await request<{ changes: CollaborationResource[], cursor: number, hasMore: boolean, editable?: boolean }>({ action: 'changes', after: nextCursor })
        if (version !== sequence || saving || pending) return
        if (!Array.isArray(page.changes) || !Number.isSafeInteger(page.cursor) || page.cursor < nextCursor || (page.hasMore && page.cursor === nextCursor)) throw new Error('协作增量响应无效，请重新连接')
        if (page.editable === false) {
          const draft = sync.draft()
          if (draft) stashDraft(draft.before, draft.after)
          editSession.value = { ...editSession.value, editable: false, scopeConflict: true, reason: '当前账号已调整为只读权限，本机草稿已保留。' }
        }
        for (const item of page.changes) updates.set(keyOf(item), item)
        nextCursor = page.cursor
        hasMore = page.hasMore
      }
      if (version !== sequence || saving || pending) return
      const draft = sync.draft()
      if (!draft) return // Initial project loading has not established the UI baseline yet.
      const dirty = new Set(buildWorkbenchMutations(resources.value, draft.before, draft.after).map(keyOf))
      const next = new Map(resources.value.map(item => [keyOf(item), item]))
      let conflict = false
      let changed = false
      // A structural change must be applied together. Preserve the complete local
      // structure when a changed episode also has a local draft.
      const structureConflict = [...updates.values()].some(item => item.type === 'directory')
        && [...updates.values()].some(item => dirty.has(keyOf(item)))
      for (const [key, item] of updates) {
        if ((next.get(key)?.revision ?? 0) >= item.revision) continue
        if (dirty.has(key) || (structureConflict && ['directory', 'episode'].includes(item.type))) { conflict = true; continue }
        next.set(key, item)
        changed = true
      }
      if (changed) {
        const baseline = composeWorkbenchSnapshot([...next.values()])
        const current = patchWorkbenchFields(baseline, workbenchSaveView(draft.before), workbenchSaveView(draft.after)) as CollaborationBody
        sync.apply(baseline, current)
        resources.value = [...next.values()]
      }
      cursor = nextCursor
      if (connectionLost && !editSession.value.scopeConflict) editSession.value.reason = undefined
      connectionLost = false
      if (conflict) {
        stashDraft(draft.before, draft.after)
        editSession.value.scopeConflict = true
        editSession.value.reason = '其他成员已更新当前修改的对象。本机草稿已保留，其他对象继续同步；请下载草稿后读取最新内容。'
      }
    } catch (cause) {
      if (version === sequence) {
        fenceAccess(cause)
        connectionLost = true
        editSession.value.reason = getDisplayErrorMessage(cause, '协作连接中断，本机草稿已保留，正在重试。')
      }
    } finally { polling = false }
  }
  async function heartbeat() {
    if (!activeId || heartbeatBusy) return
    heartbeatBusy = true
    const version = sequence
    try {
      for (const [key, scope] of [...held]) {
        try {
          const lease = await request<CollaborationLease>({ action: 'lease', leaseAction: 'heartbeat', ...scope })
          if (version !== sequence) return
          if (!lease.editable) held.delete(key)
        } catch (cause) { if (version === sequence) { held.delete(key); fenceAccess(cause) } }
      }
    } finally { heartbeatBusy = false }
  }
  async function releaseEditSession() {
    const id = activeId
    if (activeId && actorId) { exportedDraftKey = draftKey(); exportedConflictKey = `${storageKey()}:conflict` }
    sequence++
    cursor = 0
    unregister?.()
    unregister = undefined
    if (timer) clearInterval(timer)
    timer = undefined
    const scopes = [...held.values()]
    held.clear()
    activeId = ''
    actorId = ''
    resources.value = []
    pending = undefined
    recovered = undefined
    editSession.value.editable = false
    await Promise.allSettled(scopes.map(scope => $fetch(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, timeout: 10_000, body: { action: 'lease', leaseAction: 'release', ...scope } })))
  }
  async function openEditSession(id: string) {
    const releasing = releaseEditSession()
    const version = sequence
    await releasing
    if (version !== sequence) return
    acquiring.value = true
    activeId = id
    editSession.value = { editable: false, collaboration: true, canTakeover: false, reason: '正在同步、备份并准备协作项目…' }
    try {
      const status = await cloud.loadStatus()
      if (version !== sequence) return
      actorId = status?.user?.id || ''
      if (!actorId) throw new Error('请先登录云端账号')
      const response = await $fetch<{ data: { enabled: boolean, protocolVersion: number, editable?: boolean, cursor?: number, resources: CollaborationResource[] } }>(`/api/project/${encodeURIComponent(id)}/collaboration/prepare`, { method: 'POST', retry: 0, timeout: 180_000 })
      if (version !== sequence) return
      if (!response.data?.enabled || response.data.protocolVersion !== 1 || !Array.isArray(response.data.resources)) throw new Error('云端尚未确认协作迁移完成，请重试')
      resources.value = copy(response.data.resources)
      cursor = response.data.cursor ?? 0
      // Adopt the old single-window storage once; new tabs keep independent drafts/outboxes.
      for (const [prefix, key] of [['workbench-collaboration-draft:', draftKey()], ['workbench-collaboration-pending:', storageKey()]] as const) {
        const legacyKey = `${prefix}${JSON.stringify([actorId, activeId])}`
        const legacy = localStorage.getItem(legacyKey)
        if (legacy && !localStorage.getItem(key)) { localStorage.setItem(key, legacy); localStorage.removeItem(legacyKey) }
      }
      const saved = localStorage.getItem(storageKey())
      pending = saved ? JSON.parse(saved) : undefined
      if (pending) {
        try { await sendPending(true) }
        catch (cause) {
          const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
          if (![409, 423].includes(status || 0)) throw cause
        }
        if (version !== sequence) return
      }
      const draft = localStorage.getItem(draftKey())
      if (draft) {
        const value = JSON.parse(draft) as NonNullable<typeof recovered>
        const changes = buildWorkbenchMutations(value.resources, value.before, value.after)
        const baseline = new Map(value.resources.map(item => [keyOf(item), item]))
        const changed = new Set(changes.map(keyOf))
        const structureChanged = changes.some(change => change.type === 'directory' || (change.type === 'episode' && !resources.value.some(item => keyOf(item) === keyOf(change) && !item.deleted)))
          && baseline.get(keyOf({ type: 'directory', id: 'directory' }))?.revision !== resources.value.find(item => item.type === 'directory')?.revision
        if (structureChanged) for (const item of [...baseline.values(), ...resources.value]) {
          if (['directory', 'episode'].includes(item.type)) changed.add(keyOf(item))
        }
        // Only changed objects keep their original version. They must conflict if
        // another member updated them while this window was closed.
        resources.value = resources.value.filter(item => !changed.has(keyOf(item)))
          .concat([...baseline.values()].filter(item => changed.has(keyOf(item))))
        recovered = value
      }
      const conflicts = recovered ? buildWorkbenchMutations(recovered.resources, recovered.before, recovered.after).some(change => response.data.resources.find(item => keyOf(item) === keyOf(change))?.revision !== change.expectedRevision) : false
      editSession.value = { editable: response.data.editable !== false, collaboration: true, canTakeover: false, scopeConflict: conflicts, reason: response.data.editable === false ? '当前账号只有查看权限。' : conflicts ? '本机草稿与云端内容有冲突。草稿已保留，可先下载，再读取最新内容并手动合并。' : undefined }
      unregister = registerWorkbenchCollaboration(id, async (_path, body) => {
        if (!await saveCurrent()) throw new Error('请先保存当前修改并处理协作冲突后再生成')
        if (version !== sequence) throw new Error('项目已切换，请在当前项目重新生成')
        const scene = body.scene && typeof body.scene === 'object' ? body.scene as CollaborationBody : {}
        const sceneId = typeof body.sceneId === 'string' ? body.sceneId : typeof scene.id === 'string' ? scene.id : undefined
        const context = body.context && typeof body.context === 'object' ? body.context as CollaborationBody : {}
        const targetEpisode = context.targetEpisode && typeof context.targetEpisode === 'object' ? context.targetEpisode as CollaborationBody : {}
        const episodeId = body.targetEpisodeId || body.episodeId || context.episodeId || targetEpisode.id
        const character = body.character && typeof body.character === 'object' ? body.character as CollaborationBody : {}
        const characterId = character.id || body.characterId
        const resource = resources.value.find(item => !item.deleted && (
          (sceneId && item.type === 'episode' && Array.isArray(item.body?.scenes) && item.body.scenes.some(scene => (scene as CollaborationBody).id === sceneId))
          || (episodeId && item.type === 'episode' && item.id === episodeId)
          || (characterId && item.type === 'character' && item.id === characterId)
        )) ?? resources.value.find(item => item.type === 'settings' && !item.deleted)
        if (!resource) throw new Error('协作对象不存在，请刷新项目')
        await acquire(resource)
        const settings = resources.value.find(item => item.type === 'settings' && !item.deleted)!
        if (resource.type === 'character' && body.regeneration && typeof body.regeneration === 'object') {
          body = { ...body, regeneration: { referenceImage: resource.body?.baseImage || resource.body?.imageUrl, ...body.regeneration } }
        }
        return { ...body, collaborationInput: { type: resource.type, id: resource.id, episodeId: resource.type === 'episode' ? resource.id : undefined, revision: resource.revision, settingsRevision: settings.revision } }
      })
      timer = setInterval(() => { void heartbeat(); void poll() }, 10_000)
    } catch (cause) {
      if (version === sequence) editSession.value = { editable: false, collaboration: true, canTakeover: false, reason: getDisplayErrorMessage(cause, '协作项目准备失败，请重试') }
    } finally { if (version === sequence) acquiring.value = false }
  }
  async function sendPending(confirmReceipt = false) {
    if (!pending) return
    const sent = pending
    const version = sequence
    const pendingKey = storageKey()
    const savedDraftKey = draftKey()
    try {
      let result: { resources: CollaborationResource[] }
      try { result = await request<{ resources: CollaborationResource[] }>({ action: 'write', ...sent }) }
      catch (cause) {
        const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
        if (version !== sequence || !confirmReceipt || status !== 423) throw cause
        for (const scope of sent.mutations) await acquire(scope)
        result = await request<{ resources: CollaborationResource[] }>({ action: 'write', ...sent })
      }
      if (version !== sequence) throw new Error('项目已切换，原提交结果会在重新打开后确认')
      if (!Array.isArray(result.resources) || sent.mutations.some(scope => !result.resources.some(item => keyOf(item) === keyOf(scope)))) throw new Error('保存回执不完整，请重试原提交')
      const updated = new Map(resources.value.map(item => [keyOf(item), item]))
      for (const item of result.resources) {
        if ((updated.get(keyOf(item))?.revision ?? 0) <= item.revision) updated.set(keyOf(item), item)
      }
      resources.value = [...updated.values()]
      pending = undefined
      localStorage.removeItem(pendingKey)
      // A draft may have advanced while this operation was in flight. Preserve
      // edits made after the submitted snapshot, including across a reload.
      const storedDraft = localStorage.getItem(savedDraftKey)
      const draft = storedDraft ? JSON.parse(storedDraft) as NonNullable<typeof recovered> : undefined
      if (draft) {
        const draftChanges = buildWorkbenchMutations(draft.resources, draft.before, draft.after)
        const advanced = draftChanges.some(change => {
          const mutation = sent.mutations.find(item => keyOf(item) === keyOf(change))
          return !mutation || JSON.stringify(mutation.body) !== JSON.stringify(change.body)
        })
        if (advanced) {
          // Keep the original baseline rather than silently dropping newer text.
          // A version conflict will require explicit review before it can save.
          recovered = draft
        } else { localStorage.removeItem(savedDraftKey); recovered = undefined }
      } else recovered = undefined
      editSession.value.scopeConflict = false
      editSession.value.reason = undefined
      // A successful save ends this edit operation. Do not hold every episode
      // visited by an otherwise idle workbench window until it is closed.
      const scopes = sent.mutations.filter(scope => held.has(keyOf(scope)))
      for (const scope of scopes) held.delete(keyOf(scope))
      await Promise.allSettled(scopes.map(scope => request({ action: 'lease', leaseAction: 'release', type: scope.type, id: scope.id })))
    } catch (cause) {
      const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
      if (version === sequence && (status === 409 || status === 423)) {
        // Keep the exact rejected draft for export/review, but do not replay it indefinitely.
        localStorage.setItem(`${storageKey()}:conflict`, JSON.stringify(sent))
        pending = undefined
        localStorage.removeItem(storageKey())
      }
      if (version === sequence) fenceAccess(cause)
      throw cause
    }
  }
  async function saveSnapshot(before: CollaborationBody, after: CollaborationBody) {
    if (saving) throw new Error('协作保存正在进行，请稍后重试')
    saving = true
    const version = sequence
    try {
      if (pending) {
        await sendPending(true)
        // The recovered operation may differ from the current UI; reload before another edit.
        throw new Error('上次提交已确认，请重新加载项目核对已保存内容后继续')
      }
      stashDraft(before, after)
      const mutations = buildWorkbenchMutations(resources.value, before, after)
      if (!mutations.length) return
      for (const scope of mutations) await acquire(scope)
      if (version !== sequence) throw new Error('项目已切换，请重新打开原项目继续保存')
      pending = { operationId: crypto.randomUUID(), mutations }
      localStorage.setItem(storageKey(), JSON.stringify(pending))
      await sendPending()
    } catch (cause) {
      if (version === sequence) {
        fenceAccess(cause)
        editSession.value.scopeConflict = true
        editSession.value.reason = getDisplayErrorMessage(cause, '当前对象尚未保存，本地草稿已保留，其他对象可以继续编辑。')
      }
      throw cause
    } finally {
      // Failed partial acquisition must not leave unrelated resources locked.
      if (version === sequence && !pending) {
        const scopes = [...held.values()]
        held.clear()
        await Promise.allSettled(scopes.map(scope => request({ action: 'lease', leaseAction: 'release', ...scope })))
      }
      saving = false
    }
  }
  function canAdoptAsset(result: CollaborationAssetResult) {
    const meta = result.collaboration
    const draft = sync?.draft()
    const dirty = draft ? buildWorkbenchMutations(resources.value, draft.before, draft.after) : []
    if (dirty.some(item => item.type === 'settings' || (item.type === meta.resourceType && item.id === meta.resourceId))) return false
    return editSession.value.editable && !pending && !saving && meta.projectId === activeId && meta.actorId === actorId
      && resources.value.some(item => !item.deleted && item.type === meta.resourceType && item.id === meta.resourceId && item.revision === meta.revision)
      && resources.value.some(item => !item.deleted && item.type === 'settings' && item.revision === meta.settingsRevision)
  }
  if (cloud.currentUser) watch(() => cloud.currentUser.value?.id, id => {
    if (activeId && actorId && id !== actorId) {
      const draft = sync?.draft()
      if (draft) stashDraft(draft.before, draft.after)
      void releaseEditSession()
      editSession.value = { editable: false, collaboration: true, canTakeover: false, scopeConflict: true, reason: '云端账号已切换，本机草稿已保留，请重新打开项目。' }
    }
  })
  if (getCurrentInstance()) onBeforeUnmount(() => {
    const draft = sync?.draft()
    if (draft) stashDraft(draft.before, draft.after)
    void releaseEditSession()
  })
  return { editSession, projectEditable: computed(() => editSession.value.editable), acquiring, openEditSession, releaseEditSession, heartbeat, poll, canAdoptAsset, ready: computed(() => resources.value.length > 0), snapshot, saveSnapshot, stashDraft, restoredBaseline, downloadDraft, discardDraft }
}

import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { CollaborationBody, CollaborationLease, CollaborationPresence, CollaborationWindowPresence, CollaborationResource } from '../../shared/types/project-collaboration'
import { projectDraftSession } from '~/lib/project-edit-session'
import type { ProjectAccess } from '#shared/types/project'
import type { CollaborationAssetResult } from '~/lib/project-collaboration-assets'
import type { ProjectEditSessionState } from './useProjectEditSession'
import { buildWorkbenchMutations, composeWorkbenchSnapshot, patchWorkbenchFields, workbenchSaveView, registerWorkbenchCollaboration } from '~/lib/workbench-collaboration'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
import { mergeCollaborationValue, type MergeChoices, type MergeConflict } from '~/lib/collaboration-merge'
import { validateCollaborationResources } from '#shared/utils/project-collaboration'

type Mutation = ReturnType<typeof buildWorkbenchMutations>[number]
interface PendingSave { operationId: string, mutations: Mutation[] }
interface WorkbenchDraft { before: CollaborationBody, after: CollaborationBody }
interface WorkbenchSync {
  windowId?: string
  access?: (value: ProjectAccess) => void
  draft: () => WorkbenchDraft | undefined
  apply: (baseline: CollaborationBody, current: CollaborationBody) => void
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const keyOf = (scope: { type: string, id: string }) => JSON.stringify([scope.type, scope.id])

/** Adapts the original workbench to resource writes without changing its UI. */
export function useWorkbenchCollaborationSession(saveCurrent: () => Promise<boolean>, sync?: WorkbenchSync) {
  const editSession = ref<ProjectEditSessionState>({ editable: false, collaboration: true, canTakeover: false, reason: '正在打开项目…' })
  const acquiring = ref(false)
  const resources = shallowRef<CollaborationResource[]>([])
  const participants = shallowRef<CollaborationPresence[]>([])
  let presenceUpdatedAt = 0
  let activity: { type: CollaborationResource['type'], id: string, at: number } | undefined
  function updateCollaborationActivity(scope: { type: CollaborationResource['type'], id: string }) {
    if (activeId && editSession.value.editable) activity = { ...scope, at: Date.now() }
  }
  const collaborationParticipants = computed(() => participants.value.filter(item => !item.isCurrentWindow).map(item => ({
    ...item,
    locations: item.scopes.map(scope => {
      const resource = resources.value.find(value => keyOf(value) === keyOf(scope))
      const plan = resource?.body?.plan as CollaborationBody | undefined
      if (scope.type === 'episode') return typeof plan?.title === 'string' && plan.title ? plan.title : `第 ${plan?.index || '?'} 集`
      if (scope.type === 'character') return String(resource?.body?.name || '公共角色')
      return scope.type === 'directory' ? '集数目录' : '项目设置'
    })
  })))
  const mergePreview = shallowRef<{ conflicts: MergeConflict[] }>()
  let mergeContext: { version: number, draft: WorkbenchDraft, latest: CollaborationResource[], cursor: number, local: CollaborationResource[], baseline: CollaborationResource[] } | undefined
  const held = new Map<string, { type: CollaborationResource['type'], id: string }>()
  let activeId = ''
  let actorId = ''
  let sequence = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let presenceTimer: ReturnType<typeof setTimeout> | undefined
  let presenceBusy = false
  let unregister: (() => void) | undefined
  let pending: PendingSave | undefined
  let recovered: { before: CollaborationBody, after: CollaborationBody, resources: CollaborationResource[] } | undefined
  const cloud = useCloudAdmin()
  const windowId = sync?.windowId || projectDraftSession.windowId
  const recoveryKey = sync?.windowId ? undefined : projectDraftSession.recoveryKey
  let cursor = 0
  let polling = false
  let connectionLost = false
  let permissionOnlyConflict = false
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
    if (!pending && JSON.stringify(before) === JSON.stringify(after)) {
      localStorage.removeItem(draftKey())
      if (!saving && !pending && !connectionLost) editSession.value.syncStatus = 'synced'
      schedulePresence()
      return
    }
    if (!saving && !pending && !connectionLost) editSession.value.syncStatus = 'editing'
    schedulePresence()
    localStorage.setItem(draftKey(), JSON.stringify({ before, after, resources: resources.value }))
  }
  async function acquire(scope: { type: CollaborationResource['type'], id: string }, takeover = false) {
    const version = sequence
    const lease = await request<CollaborationLease>({ action: 'lease', leaseAction: takeover ? 'takeover' : 'acquire', type: scope.type, id: scope.id })
    if (version !== sequence) throw new Error('项目已切换，原项目的修改仍保留在本机')
    const holder = editSession.value.collaborators?.find(item => item.userId === lease.holderUserId)?.displayName || '其他成员'
    if (!lease.editable) throw Object.assign(new Error(`${resourceLabel(scope)}正在由${holder}编辑，其他集仍可编辑；当前修改已保留，请稍后重试。`), { statusCode: 423 })
    held.set(keyOf(scope), { type: scope.type, id: scope.id })
  }
  function resourceLabel(scope: { type: CollaborationResource['type'], id: string }) {
    const resource = resources.value.find(item => keyOf(item) === keyOf(scope))
    if (scope.type === 'episode') {
      const plan = resource?.body?.plan as CollaborationBody | undefined
      return String(plan?.title || `第${plan?.index || '?'}集`)
    }
    if (scope.type === 'character') return `角色「${resource?.body?.name || scope.id}」`
    return scope.type === 'settings' ? '公共资产或项目设置' : '分集目录'
  }
  function schedulePresence() {
    if (presenceTimer || !sync) return
    presenceTimer = setTimeout(() => { presenceTimer = undefined; void refreshPresence() }, 500)
  }
  async function refreshPresence() {
    if (!activeId || presenceBusy) return
    presenceBusy = true
    const version = sequence
    try {
      const draft = sync?.draft()
      const editing = draft && editSession.value.editable ? buildWorkbenchMutations(resources.value, draft.before, draft.after).map(({ type, id }) => ({ type, id })) : []
      const response = await request<{ collaborators: CollaborationWindowPresence[] }>({ action: 'presence', editing })
      if (version !== sequence) return
      if (!Array.isArray(response.collaborators)) throw new Error('成员状态响应无效')
      editSession.value.presenceAvailable = true
      editSession.value.onlineCount = new Set(response.collaborators.map(item => item.userId)).size
      editSession.value.collaborators = response.collaborators.filter(item => !item.self).map(item => ({
        userId: item.userId, displayName: item.userId === actorId ? '你（其他窗口）' : item.displayName,
        activity: item.locked.length ? `占用 ${item.locked.map(resourceLabel).join('、')}` : item.editing.length ? `正在编辑 ${item.editing.map(resourceLabel).join('、')}` : '正在查看',
        locked: item.locked.length > 0
      }))
    } catch (cause) {
      if (version === sequence) { editSession.value.presenceAvailable = false; editSession.value.collaborators = []; fenceAccess(cause) }
    } finally { presenceBusy = false }
  }

  function fenceAccess(cause: unknown) {
    const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
    if ([401, 403, 404, 410].includes(status || 0)) {
      editSession.value = { ...editSession.value, editable: false, scopeConflict: true, reason: getDisplayErrorMessage(cause, '协作权限已变化，请重新连接；本机草稿已保留。') }
    }
  }
  async function poll() {
    if (!activeId || polling || saving || pending || mergePreview.value || !sync) return
    polling = true
    const version = sequence
    try {
      // Fetch the complete batch before applying: directory and episodes are atomic.
      const updates = new Map<string, CollaborationResource>()
      let nextCursor = cursor
      let hasMore = true
      const localDraft = sync.draft()
      const activeScopes = [...held.values(), ...(localDraft && editSession.value.editable ? buildWorkbenchMutations(resources.value, localDraft.before, localDraft.after).map(item => ({ type: item.type, id: item.id })) : [])]
      if (activity && activity.at > Date.now() - 30_000 && editSession.value.editable) activeScopes.push({ type: activity.type, id: activity.id })
      while (hasMore) {
        const page = await request<{ changes: CollaborationResource[], cursor: number, hasMore: boolean, editable?: boolean, access?: ProjectAccess, participants?: CollaborationPresence[] }>({ action: 'changes', after: nextCursor, activeScopes })
        if (version !== sequence || saving || pending) return
        participants.value = Array.isArray(page.participants) ? page.participants : []
        presenceUpdatedAt = Date.now()
        if (!Array.isArray(page.changes) || !Number.isSafeInteger(page.cursor) || page.cursor < nextCursor || (page.hasMore && page.cursor === nextCursor)) throw new Error('协作增量响应无效，请重新连接')
        if (page.access) sync.access?.(page.access)
        if (page.editable === false) {
          const draft = sync.draft()
          if (draft) stashDraft(draft.before, draft.after)
          if (!editSession.value.scopeConflict) permissionOnlyConflict = true
          editSession.value = { ...editSession.value, editable: false, scopeConflict: true, reason: '当前账号已调整为只读权限，本机草稿已保留。' }
        } else if (page.editable === true && !editSession.value.editable) {
          const scopeConflict = !!editSession.value.scopeConflict && !permissionOnlyConflict
          permissionOnlyConflict = false
          editSession.value = { ...editSession.value, editable: true, scopeConflict, reason: scopeConflict ? '本机草稿与云端内容有冲突，点击“对比并合并”处理。' : undefined }
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
      editSession.value.syncStatus = dirty.size ? 'editing' : 'synced'
      if (changed) editSession.value.lastRemoteUpdate = '已收到其他成员的更新'
      if (conflict) {
        permissionOnlyConflict = false
        stashDraft(draft.before, draft.after)
        editSession.value.scopeConflict = true
        editSession.value.reason = '其他成员更新了你正在修改的内容。本机草稿已保留，点击“对比并合并”选择要保留的修改。'
      }
    } catch (cause) {
      if (version === sequence) {
        const draft = sync.draft()
        if (draft) stashDraft(draft.before, draft.after)
        fenceAccess(cause)
        connectionLost = true
        participants.value = []
        editSession.value.syncStatus = 'offline'
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
    permissionOnlyConflict = false
    if (presenceTimer) clearTimeout(presenceTimer)
    presenceTimer = undefined
    unregister?.()
    unregister = undefined
    if (timer) clearInterval(timer)
    timer = undefined
    const scopes = [...held.values()]
    held.clear()
    activeId = ''
    actorId = ''
    resources.value = []
    participants.value = []
    activity = undefined
    mergePreview.value = undefined
    mergeContext = undefined
    pending = undefined
    recovered = undefined
    editSession.value.pendingSave = false
    editSession.value.editable = false
    const leaving = id ? $fetch(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, timeout: 10_000, body: { action: 'presence', leaving: true } }).catch(() => {}) : Promise.resolve()
    await Promise.allSettled([leaving, ...scopes.map(scope => $fetch(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, timeout: 10_000, body: { action: 'lease', leaseAction: 'release', ...scope } }))])
  }
  async function openEditSession(id: string) {
    const releasing = releaseEditSession()
    const version = sequence
    await releasing
    if (version !== sequence) return
    acquiring.value = true
    activeId = id
    editSession.value = { editable: false, collaboration: true, syncStatus: 'connecting', canTakeover: false, reason: '正在同步、备份并准备协作项目…' }
    try {
      const status = await cloud.loadStatus()
      if (version !== sequence) return
      actorId = status?.user?.id || ''
      if (!actorId) throw new Error('请先登录云端账号')
      const response = await $fetch<{ data: { enabled: boolean, protocolVersion: number, editable?: boolean, access?: ProjectAccess, cursor?: number, resources: CollaborationResource[] } }>(`/api/project/${encodeURIComponent(id)}/collaboration/prepare`, { method: 'POST', retry: 0, timeout: 180_000 })
      if (version !== sequence) return
      if (!response.data?.enabled || response.data.protocolVersion !== 1 || !Array.isArray(response.data.resources)) throw new Error('项目尚未准备完成，请重试')
      resources.value = copy(response.data.resources)
      if (response.data.access) sync?.access?.(response.data.access)
      cursor = response.data.cursor ?? 0
      // Adopt the old single-window storage once; new tabs keep independent drafts/outboxes.
      for (const [prefix, key] of [['workbench-collaboration-draft:', draftKey()], ['workbench-collaboration-pending:', storageKey()]] as const) {
        // Copy once per project/account. Never consume another live tab's backup
        // or resurrect it after this document has saved/discarded its own draft.
        const source = recoveryKey?.(prefix, actorId, activeId)
        if (source) {
          const previous = localStorage.getItem(source)
          if (previous && !localStorage.getItem(key)) localStorage.setItem(key, previous)
        }
        const legacyKey = `${prefix}${JSON.stringify([actorId, activeId])}`
        const legacy = localStorage.getItem(legacyKey)
        if (legacy && !localStorage.getItem(key)) { localStorage.setItem(key, legacy); localStorage.removeItem(legacyKey) }
      }
      const saved = localStorage.getItem(storageKey())
      pending = saved ? JSON.parse(saved) : undefined
      editSession.value.pendingSave = !!pending
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
      editSession.value = { editable: response.data.editable !== false, collaboration: true, syncStatus: recovered ? 'editing' : 'synced', canTakeover: false, scopeConflict: conflicts, reason: response.data.editable === false ? '当前账号只有查看权限。' : conflicts ? '本机草稿与云端内容有冲突。草稿已保留，可点击“对比并合并”处理。' : undefined }
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
      void refreshPresence()
      timer = setInterval(() => {
        if (Date.now() - presenceUpdatedAt > 45_000) participants.value = []
        void heartbeat()
        void poll()
        void refreshPresence()
      }, 10_000)
    } catch (cause) {
      if (version === sequence) editSession.value = { editable: false, collaboration: true, canTakeover: false, reason: getDisplayErrorMessage(cause, '项目打开失败，请重试') }
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
      // Capture edits made while waiting for the receipt, before advancing revisions.
      const liveDraft = sync?.draft()
      if (liveDraft) stashDraft(liveDraft.before, liveDraft.after)
      const updated = new Map(resources.value.map(item => [keyOf(item), item]))
      for (const item of result.resources) {
        if ((updated.get(keyOf(item))?.revision ?? 0) <= item.revision) updated.set(keyOf(item), item)
      }
      resources.value = [...updated.values()]
      pending = undefined
      editSession.value.pendingSave = false
      localStorage.removeItem(pendingKey)
      // A draft may have advanced while this operation was in flight. Preserve
      // edits made after the submitted snapshot, including across a reload.
      const storedDraft = localStorage.getItem(savedDraftKey)
      const draft = storedDraft ? JSON.parse(storedDraft) as NonNullable<typeof recovered> : undefined
      if (draft) {
        // Rebase on the acknowledged operation, including fields reverted to
        // their old values. Comparing only the old dirty set misses those reverts.
        const baseline = new Map(draft.resources.map(item => [keyOf(item), item]))
        for (const mutation of sent.mutations) {
          const receipt = result.resources.find(item => keyOf(item) === keyOf(mutation))!
          baseline.set(keyOf(mutation), { ...receipt, body: copy(mutation.body), deleted: mutation.body === null })
        }
        const flatten = (items: CollaborationResource[]) => {
          const snapshot = composeWorkbenchSnapshot(items)
          return { ...(snapshot.project as CollaborationBody), ...(snapshot.script as CollaborationBody), scenes: snapshot.scenes, characters: snapshot.characters }
        }
        const rebased = {
          before: patchWorkbenchFields(draft.before, flatten(draft.resources), flatten([...baseline.values()])) as CollaborationBody,
          after: draft.after,
          resources: [...baseline.values()]
        }
        if (buildWorkbenchMutations(rebased.resources, rebased.before, rebased.after).length) {
          recovered = rebased
          localStorage.setItem(savedDraftKey, JSON.stringify(rebased))
        } else { localStorage.removeItem(savedDraftKey); recovered = undefined }
      } else recovered = undefined
      editSession.value.scopeConflict = false
      editSession.value.syncStatus = 'synced'
      editSession.value.lastRemoteUpdate = undefined
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
        editSession.value.pendingSave = false
        localStorage.removeItem(storageKey())
      }
      if (version === sequence) fenceAccess(cause)
      throw cause
    }
  }
  async function saveSnapshot(before: CollaborationBody, after: CollaborationBody) {
    if (mergePreview.value) throw new Error('请先完成或取消冲突对比')
    if (saving) throw new Error('协作保存正在进行，请稍后重试')
    saving = true
    editSession.value.syncStatus = 'saving'
    const version = sequence
    try {
      stashDraft(before, after)
      if (pending) {
        await sendPending(true)
        // The recovered operation may differ from the current UI; reload before another edit.
        throw new Error('上次提交已确认，请重新加载项目核对已保存内容后继续')
      }
      const mutations = buildWorkbenchMutations(resources.value, before, after)
      if (!mutations.length) return
      for (const scope of mutations) await acquire(scope)
      if (version !== sequence) throw new Error('项目已切换，请重新打开原项目继续保存')
      pending = { operationId: crypto.randomUUID(), mutations }
      editSession.value.pendingSave = true
      localStorage.setItem(storageKey(), JSON.stringify(pending))
      await sendPending()
    } catch (cause) {
      if (version === sequence) {
        fenceAccess(cause)
        const status = (cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status
        editSession.value.syncStatus = !status || status >= 500 ? 'offline' : 'editing'
        if (status === 409) editSession.value.scopeConflict = true
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
      if (version === sequence && editSession.value.syncStatus === 'saving') editSession.value.syncStatus = 'synced'
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
  function mergeResources(context: NonNullable<typeof mergeContext>, choices: MergeChoices) {
    const key = (item: CollaborationResource) => keyOf(item)
    const baseline = new Map(context.baseline.map(item => [key(item), item]))
    const local = new Map(context.local.map(item => [key(item), item]))
    const remote = new Map(context.latest.map(item => [key(item), item]))
    const merged: CollaborationResource[] = []
    const conflicts: MergeConflict[] = []
    for (const id of new Set([...baseline.keys(), ...local.keys(), ...remote.keys()])) {
      const old = baseline.get(id), mine = local.get(id), theirs = remote.get(id)
      const scope = theirs || mine || old!
      const result = mergeCollaborationValue(old?.body ?? null, mine?.body ?? null, theirs?.body ?? null, choices, [scope.type, scope.id])
      const body = mine?.body || theirs?.body || old?.body
      const plan = body?.plan as CollaborationBody | undefined
      const title = scope.type === 'episode' ? `第 ${plan?.index || '?'} 集${plan?.title ? ` · ${plan.title}` : ''}` : scope.type === 'character' ? String(body?.name || '公共角色') : scope.type === 'directory' ? '集数顺序' : '基本信息'
      conflicts.push(...result.conflicts.map(conflict => ({ ...conflict, path: conflict.path.map((part, index) => {
        if (index === 1) return title
        if (conflict.path[index - 1] === 'scenes' && Array.isArray(body?.scenes)) {
          const sceneIndex = body.scenes.findIndex(item => (item as CollaborationBody).id === part)
          if (sceneIndex >= 0) return `分镜 ${sceneIndex + 1}`
        }
        return part
      }) })))
      if (theirs?.deleted && result.value !== null) throw new Error('此对象已被删除，请选择云端版本；本机内容可从对比窗口复制。')
      merged.push({ ...scope, revision: theirs?.revision ?? 0, deleted: result.value === null, body: result.value as CollaborationBody | null })
    }
    return { resources: merged, conflicts }
  }
  async function previewMerge() {
    if (!sync || saving || pending) throw new Error('请先重试保存，确认上次提交结果后再对比内容')
    const version = sequence
    const draft = sync.draft()
    if (!draft) throw new Error('项目尚未加载完成')
    const baseline = copy(resources.value)
    const mutations = buildWorkbenchMutations(baseline, draft.before, draft.after)
    const local = baseline.map(item => {
      const mutation = mutations.find(value => keyOf(value) === keyOf(item))
      return mutation ? { ...item, body: mutation.body, deleted: mutation.body === null } : item
    })
    for (const mutation of mutations) if (!local.some(item => keyOf(item) === keyOf(mutation))) local.push({ ...mutation, revision: 0, deleted: mutation.body === null })
    const latest = await request<{ resources: CollaborationResource[], cursor: number, editable?: boolean }>({ action: 'read' })
    if (version !== sequence) throw new Error('项目已切换，请重新打开对比')
    if (latest.editable === false) {
      stashDraft(draft.before, draft.after)
      editSession.value = { ...editSession.value, editable: false, scopeConflict: true, reason: '当前账号只有查看权限，本机草稿已保留。' }
      throw new Error('当前账号只有查看权限，无法合并保存')
    }
    if (!Array.isArray(latest.resources) || !Number.isSafeInteger(latest.cursor)) throw new Error('最新内容读取失败，请重试')
    mergeContext = { version, draft: copy(draft), latest: copy(latest.resources), cursor: latest.cursor, local, baseline }
    // Deletion conflicts are presented for review before choosing the cloud version.
    const choices: MergeChoices = {}
    for (const item of latest.resources.filter(item => item.deleted)) choices[JSON.stringify([item.type, item.id])] = 'remote'
    mergePreview.value = { conflicts: mergeResources(mergeContext, choices).conflicts }
  }
  function cancelMerge() { mergePreview.value = undefined; mergeContext = undefined }
  function applyMerge(choices: MergeChoices) {
    const context = mergeContext
    if (!context || context.version !== sequence || !sync) throw new Error('对比已过期，请重新打开')
    if (JSON.stringify(sync.draft()) !== JSON.stringify(context.draft)) throw new Error('本机草稿已变化，请取消并重新对比')
    if (mergePreview.value?.conflicts.some(item => !choices[item.key])) throw new Error('请为每一处冲突选择要保留的内容')
    const merged = mergeResources(context, choices)
    try { validateCollaborationResources(merged.resources) }
    catch { throw new Error('所选内容的集数或分镜结构不一致，请重新选择对应的目录和集数版本。') }
    const baseline = composeWorkbenchSnapshot(context.latest)
    const current = composeWorkbenchSnapshot(merged.resources)
    stashDraft(context.draft.before, context.draft.after)
    const draft = localStorage.getItem(draftKey())
    if (draft) localStorage.setItem(`${draftKey()}:archived`, draft)
    sync.apply(baseline, current)
    resources.value = context.latest
    cursor = context.cursor
    recovered = undefined
    const updated = sync.draft()
    if (updated) stashDraft(updated.before, updated.after)
    editSession.value.scopeConflict = false
    editSession.value.reason = undefined
    cancelMerge()
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
  return { editSession, projectEditable: computed(() => editSession.value.editable), acquiring, openEditSession, releaseEditSession, heartbeat, poll, refreshPresence, confirmPending: () => sendPending(true), canAdoptAsset, ready: computed(() => resources.value.length > 0), snapshot, saveSnapshot, stashDraft, restoredBaseline, downloadDraft, discardDraft, mergePreview, previewMerge, cancelMerge, applyMerge, collaborationParticipants, updateCollaborationActivity }
}

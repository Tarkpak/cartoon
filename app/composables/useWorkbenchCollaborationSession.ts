import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { CollaborationBody, CollaborationLease, CollaborationResource } from '../../shared/types/project-collaboration'
import type { ProjectEditSessionState } from './useProjectEditSession'
import { buildWorkbenchMutations, composeWorkbenchSnapshot, patchWorkbenchFields, workbenchSaveView, registerWorkbenchCollaboration } from '~/lib/workbench-collaboration'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

type Mutation = ReturnType<typeof buildWorkbenchMutations>[number]
interface PendingSave { operationId: string, mutations: Mutation[] }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const keyOf = (scope: { type: string, id: string }) => JSON.stringify([scope.type, scope.id])

/** Adapts the original workbench to resource writes without changing its UI. */
export function useWorkbenchCollaborationSession(saveCurrent: () => Promise<boolean>) {
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
  let heartbeatBusy = false
  let saving = false
  const storageKey = () => `workbench-collaboration-pending:${JSON.stringify([actorId, activeId])}`
  const request = async <T>(body: CollaborationBody): Promise<T> => {
    const response = await $fetch<{ data: T }>(`/api/project/${encodeURIComponent(activeId)}/collaboration`, { method: 'POST', body, retry: 0, timeout: 60_000 })
    return response.data
  }
  const draftKey = () => `workbench-collaboration-draft:${JSON.stringify([actorId, activeId])}`
  function snapshot() {
    const base = composeWorkbenchSnapshot(resources.value)
    return recovered ? patchWorkbenchFields(base, workbenchSaveView(recovered.before), workbenchSaveView(recovered.after)) as CollaborationBody : base
  }
  function restoredBaseline() { return recovered?.before }
  function downloadDraft() {
    const data = localStorage.getItem(draftKey()) || localStorage.getItem(`${storageKey()}:conflict`)
    if (!data) return
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `协作草稿-${activeId}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function discardDraft() {
    const draft = localStorage.getItem(draftKey())
    if (draft) localStorage.setItem(`${draftKey()}:archived`, draft)
    localStorage.removeItem(draftKey())
    recovered = undefined
  }
  function stashDraft(before: CollaborationBody, after: CollaborationBody) {
    if (!activeId || !actorId || !editSession.value.editable) return
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
        } catch { if (version === sequence) held.delete(key) }
      }
    } finally { heartbeatBusy = false }
  }
  async function releaseEditSession() {
    const id = activeId
    sequence++
    unregister?.()
    unregister = undefined
    if (timer) clearInterval(timer)
    timer = undefined
    const scopes = [...held.values()]
    held.clear()
    activeId = ''
    resources.value = []
    pending = undefined
    recovered = undefined
    editSession.value.editable = false
    await Promise.allSettled(scopes.map(scope => $fetch(`/api/project/${encodeURIComponent(id)}/collaboration`, { method: 'POST', retry: 0, body: { action: 'lease', leaseAction: 'release', ...scope } })))
  }
  async function openEditSession(id: string) {
    await releaseEditSession()
    const version = sequence
    acquiring.value = true
    activeId = id
    editSession.value = { editable: false, collaboration: true, canTakeover: false, reason: '正在同步、备份并准备协作项目…' }
    try {
      const status = await useCloudAdmin().loadStatus()
      if (version !== sequence) return
      actorId = status?.user?.id || ''
      if (!actorId) throw new Error('请先登录云端账号')
      const response = await $fetch<{ data: { enabled: boolean, protocolVersion: number, resources: CollaborationResource[] } }>(`/api/project/${encodeURIComponent(id)}/collaboration/prepare`, { method: 'POST', retry: 0, timeout: 180_000 })
      if (version !== sequence) return
      if (!response.data?.enabled || response.data.protocolVersion !== 1 || !Array.isArray(response.data.resources)) throw new Error('云端尚未确认协作迁移完成，请重试')
      resources.value = copy(response.data.resources)
      const saved = localStorage.getItem(storageKey())
      pending = saved ? JSON.parse(saved) : undefined
      if (pending) await sendPending(true)
      const draft = localStorage.getItem(draftKey())
      if (draft) {
        const value = JSON.parse(draft) as NonNullable<typeof recovered>
        const changes = buildWorkbenchMutations(value.resources, value.before, value.after)
        const baseline = new Map(value.resources.map(item => [keyOf(item), item]))
        const changed = new Set(changes.map(keyOf))
        // Only changed objects keep their original version. They must conflict if
        // another member updated them while this window was closed.
        resources.value = resources.value.filter(item => !changed.has(keyOf(item)))
          .concat([...baseline.values()].filter(item => changed.has(keyOf(item))))
        recovered = value
      }
      const conflicts = recovered ? buildWorkbenchMutations(recovered.resources, recovered.before, recovered.after).some(change => response.data.resources.find(item => keyOf(item) === keyOf(change))?.revision !== change.expectedRevision) : false
      editSession.value = { editable: true, collaboration: true, canTakeover: false, scopeConflict: conflicts, reason: conflicts ? '本机草稿与云端内容有冲突。草稿已保留，可先下载，再读取最新内容并手动合并。' : undefined }
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
      timer = setInterval(() => { void heartbeat() }, 30_000)
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
      for (const item of result.resources) updated.set(keyOf(item), item)
      resources.value = [...updated.values()]
      pending = undefined
      localStorage.removeItem(pendingKey)
      localStorage.removeItem(savedDraftKey)
      recovered = undefined
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
        editSession.value.scopeConflict = true
        editSession.value.reason = getDisplayErrorMessage(cause, '当前对象尚未保存，本地草稿已保留，其他对象可以继续编辑。')
      }
      throw cause
    } finally { saving = false }
  }
  if (getCurrentInstance()) onBeforeUnmount(() => { void releaseEditSession() })
  return { editSession, projectEditable: computed(() => editSession.value.editable), acquiring, openEditSession, releaseEditSession, heartbeat, snapshot, saveSnapshot, stashDraft, restoredBaseline, downloadDraft, discardDraft }
}

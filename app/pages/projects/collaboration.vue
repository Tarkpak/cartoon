<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Download, Loader2, RefreshCw, Save, Users } from 'lucide-vue-next'
import ProjectCollaborationAssetMedia from '@/components/projects/ProjectCollaborationAssetMedia.vue'
import { adoptCollaborationAsset, assetGenerationInput, type CollaborationAssetResult } from '~/lib/project-collaboration-assets'
import ProjectCollaborationSceneMedia from '@/components/projects/ProjectCollaborationSceneMedia.vue'
import { adoptCollaborationMedia, mediaGenerationInput, type CollaborationMediaResult } from '~/lib/project-collaboration-media'
import ProjectMembersDialog from '@/components/projects/ProjectMembersDialog.vue'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useProjectCollaboration, type CollaborationScope } from '~/composables/useProjectCollaboration'
import type { CollaborationResource } from '#shared/types/project-collaboration'
import { collaborationRecord as record, collaborationText as text, collaborationReviewText, addCollaborationScene, removeCollaborationScene, moveCollaborationScene, patchCollaborationEpisode, patchCollaborationScene, patchCollaborationSettings } from '~/lib/project-collaboration-editor'
import { adoptCollaborationDraft, generationInput, parseCollaborationDraftResult, type CollaborationDraftResult } from '~/lib/project-collaboration-generation'
import { buildDirectoryChange, buildSceneTransfer, type DirectoryAction } from '~/lib/project-collaboration-directory'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const route = useRoute()
const router = useRouter()
const { currentUser, loadStatus } = useCloudAdmin()
const { confirm } = useConfirm()
const session = useProjectCollaboration()
const { client, error, revision, recovery } = session
const showMembers = ref(false)
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const selected = ref('')
const generating = ref(false)
const generationError = ref('')
const generationInstruction = ref('')
const generationResults = ref<CollaborationDraftResult[]>([])
const chosenGeneration = ref('')
const episodeResults = computed(() => generationResults.value.filter(item => item.collaboration.episodeId === scope.value?.id))
const generationResult = computed(() => episodeResults.value.find(item => item.id === chosenGeneration.value) ?? episodeResults.value.at(-1))
const transferSource = ref('')
const transferTarget = ref('')
const transferScene = ref('')
const transferScenes = computed(() => {
  void revision.value
  const body = client.value?.get('episode', transferSource.value)?.body
  return Array.isArray(body?.scenes) ? body.scenes.map(record) : []
})
watch(transferSource, () => { transferScene.value = '' })
const reviewed = ref<CollaborationResource>()
const reviewedStructure = ref<CollaborationResource[]>()
const structureScopes = computed(() => { void revision.value; return client.value?.structureScopes ?? [] })
let loadSequence = 0
let openedActor = ''
let exportedDraft = ''
const keyOf = (scope: CollaborationScope) => JSON.stringify([scope.type, scope.id])
const drafts = computed(() => { void revision.value; return [...client.value?.drafts.values() ?? []] })
const settings = computed(() => { void revision.value; return record(drafts.value.find(item => item.base.type === 'settings')?.body) })
const title = computed(() => text(record(settings.value.project).name) || '按集协作')
const directory = computed(() => {
  const ids = drafts.value.find(item => item.base.type === 'directory')?.body?.episodeIds
  return Array.isArray(ids) ? ids : []
})
const episodes = computed(() => drafts.value.filter(item => item.base.type === 'episode' && !!item.body && (!item.base.deleted || item.dirty))
  .sort((a, b) => directory.value.indexOf(a.base.id) - directory.value.indexOf(b.base.id)))
const characters = computed(() => drafts.value.filter(item => item.base.type === 'character' && (!item.base.deleted || item.dirty)))
// The client mutates plain draft objects; publish a new view whenever its revision changes.
const active = computed(() => {
  const draft = drafts.value.find(item => keyOf(item.base) === selected.value)
  return draft ? { ...draft } : undefined
})
const scope = computed(() => active.value && { type: active.value.base.type, id: active.value.base.id })
const body = computed(() => { void revision.value; return record(active.value?.body) })
const projectSettings = computed(() => record(body.value.project))
const plan = computed(() => record(body.value.plan))
const writing = computed(() => record(body.value.writing))
const scenes = computed(() => Array.isArray(body.value.scenes) ? body.value.scenes.map(record) : [])
const hasLease = computed(() => !!scope.value && session.canEdit(scope.value))
const editable = computed(() => hasLease.value && !busy.value && !active.value?.conflict && !active.value?.base.deleted && (!structureScopes.value.length || scope.value?.type === 'directory'))
const pending = computed(() => { void revision.value; return !!client.value?.hasPendingSave })
const dirtyCount = computed(() => drafts.value.filter(item => item.dirty).length)
const currentLease = computed(() => scope.value && session.leases.value.get(keyOf(scope.value)))

async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try { await action() }
  catch (cause) { error.value = getDisplayErrorMessage(cause, '操作未完成，请重试') }
  finally { busy.value = false; revision.value++ }
}

watch(() => route.params.id, async raw => {
  const id = typeof raw === 'string' ? raw : ''
  const version = ++loadSequence
  loading.value = true
  selected.value = ''
  generationResults.value = []
  generationError.value = ''
  reviewed.value = undefined
  try {
    if (!id) throw new Error('缺少项目 ID')
    const status = await loadStatus()
    if (version !== loadSequence) return
    openedActor = status?.user?.id || ''
    await session.open(id, openedActor)
    if (version !== loadSequence) return
    selected.value = episodes.value[0] ? keyOf(episodes.value[0].base) : characters.value[0] ? keyOf(characters.value[0].base) : client.value?.get('settings', 'settings') ? keyOf({ type: 'settings', id: 'settings' }) : ''
    void loadDraftResults()
  } catch (cause) {
    if (version === loadSequence) error.value = getDisplayErrorMessage(cause, '项目加载失败')
  } finally { if (version === loadSequence) loading.value = false }
}, { immediate: true })

watch(() => currentUser.value?.id, id => {
  if (openedActor && id !== openedActor) {
    void session.close().catch(cause => { error.value = getDisplayErrorMessage(cause, '草稿备份失败') })
    error.value = '账号已切换，请重新打开项目。'
  }
})
watch(selected, () => { reviewed.value = undefined; reviewedStructure.value = undefined; message.value = '' })

async function loadDraftResults() {
  const activeClient = client.value
  const id = String(route.params.id)
  try {
    const response = await $fetch<{ data: unknown[] }>(`/api/project/${encodeURIComponent(id)}/collaboration/draft-results`, { timeout: 30_000, retry: 0 })
    const results = response.data.map(parseCollaborationDraftResult).filter(item => item.collaboration.projectId === id && item.collaboration.actorId === openedActor)
    if (activeClient === client.value) { generationResults.value = [...new Map([...generationResults.value, ...results].map(item => [item.id, item])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-20); generationError.value = '' }
  } catch (cause) { if (activeClient === client.value) generationError.value = getDisplayErrorMessage(cause, '生成结果读取失败') }
}
async function generateDraft() {
  const activeClient = client.value
  const target = scope.value
  if (!activeClient || target?.type !== 'episode' || !editable.value || generating.value) return
  const id = String(route.params.id)
  const actor = openedActor
  generating.value = true
  generationError.value = ''
  try {
    const input = generationInput(activeClient, target.id)
    const response = await $fetch<unknown>('/api/script/write', {
      method: 'POST', timeout: 600_000, retry: 0,
      body: { projectId: id, action: 'episode_draft', collaborationInput: input, context: { instruction: generationInstruction.value } }
    })
    const result = parseCollaborationDraftResult(response)
    if (result.collaboration.projectId !== id || result.collaboration.actorId !== actor) throw new Error('生成结果不属于当前项目或账号')
    if (activeClient === client.value) { generationResults.value = [...generationResults.value.filter(item => item.id !== result.id), result].slice(-20); chosenGeneration.value = result.id }
  } catch (cause) {
    if (activeClient === client.value) generationError.value = getDisplayErrorMessage(cause, '生成失败。若响应丢失，可刷新生成结果查看已完成内容。')
  } finally { generating.value = false }
}
async function adoptAssetMedia(result: CollaborationAssetResult) {
  const activeClient = client.value
  const meta = result.collaboration
  if (!activeClient || !editable.value || scope.value?.type !== meta.resourceType || scope.value.id !== meta.resourceId) return
  await run(async () => {
    if (meta.projectId !== String(route.params.id) || meta.actorId !== openedActor) throw new Error('图片结果不属于当前项目或账号')
    const input = assetGenerationInput(activeClient, meta.assetKind, meta.assetId)
    if (input.revision !== meta.revision || input.settingsRevision !== meta.settingsRevision) throw new Error('生成输入已变化，请保留结果后手动处理')
    await $fetch(`/api/project/${encodeURIComponent(String(route.params.id))}/collaboration`, {
      method: 'POST', retry: 0, timeout: 30_000,
      body: { action: 'generationCheck', type: input.type, id: input.id, expectedRevision: input.revision, settingsRevision: input.settingsRevision }
    })
    if (activeClient !== client.value) return
    adoptCollaborationAsset(activeClient, result)
    session.backup()
    message.value = '生成媒体已加入公共资产草稿，请检查后保存。'
  })
}
async function adoptSceneMedia(result: CollaborationMediaResult) {
  const activeClient = client.value
  if (!activeClient || !editable.value || scope.value?.type !== 'episode' || scope.value.id !== result.collaboration.episodeId) return
  await run(async () => {
    if (result.collaboration.projectId !== String(route.params.id) || result.collaboration.actorId !== openedActor) throw new Error('媒体结果不属于当前项目或账号')
    const input = mediaGenerationInput(activeClient, result.collaboration.episodeId, result.collaboration.sceneId)
    if (input.revision !== result.collaboration.revision || input.settingsRevision !== result.collaboration.settingsRevision) throw new Error('生成输入已变化，请保留结果后手动处理')
    await $fetch(`/api/project/${encodeURIComponent(String(route.params.id))}/collaboration`, {
      method: 'POST', retry: 0, timeout: 30_000,
      body: { action: 'generationCheck', type: 'episode', id: input.episodeId, expectedRevision: input.revision, settingsRevision: input.settingsRevision }
    })
    if (activeClient !== client.value) return
    adoptCollaborationMedia(activeClient, result)
    session.backup()
    message.value = '生成媒体已加入本集草稿，请检查后保存。'
  })
}
async function adoptDraftResult() {
  const result = generationResult.value
  const activeClient = client.value
  if (!result || !activeClient || !editable.value) return
  await run(async () => {
    const input = generationInput(activeClient, result.collaboration.episodeId)
    if (input.revision !== result.collaboration.revision || input.settingsRevision !== result.collaboration.settingsRevision) throw new Error('生成输入已变化，请导出结果后手动合并')
    await $fetch(`/api/project/${encodeURIComponent(String(route.params.id))}/collaboration`, {
      method: 'POST', retry: 0, timeout: 30_000,
      body: { action: 'generationCheck', type: 'episode', id: input.episodeId, expectedRevision: input.revision, settingsRevision: input.settingsRevision }
    })
    if (activeClient !== client.value) return
    adoptCollaborationDraft(activeClient, result)
    session.backup()
    message.value = '生成正文已加入本集草稿，请检查后保存。'
  })
}
function exportDraftResult() {
  const result = generationResult.value
  if (!result) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `单集生成结果-${result.id}.json`
  link.click()
  URL.revokeObjectURL(url)
}
function edit(next: Record<string, unknown>) {
  if (!editable.value || !scope.value || !client.value) return
  client.value.edit(scope.value.type, scope.value.id, next)
  revision.value++
  try { session.backup() }
  catch { error.value = '本窗口草稿备份失败，请保存到云端或导出草稿后再离开。' }
}
function editEpisode(field: 'title' | 'summary' | 'draft', value: string | number) {
  edit(patchCollaborationEpisode(body.value, field, String(value)))
}
function editSettings(field: 'name' | 'description' | 'aspectRatio', value: string | number) {
  edit(patchCollaborationSettings(body.value, field, String(value)))
}
function editScene(id: string, field: 'title' | 'description' | 'narration', value: string | number) {
  edit(patchCollaborationScene(body.value, id, field, String(value)))
}
function newEpisode() { void changeDirectory({ kind: 'add', id: crypto.randomUUID() }) }
function addScene() {
  if (editable.value) edit(addCollaborationScene(body.value, crypto.randomUUID()))
}
function moveScene(id: string, direction: -1 | 1) {
  if (editable.value) edit(moveCollaborationScene(body.value, id, direction))
}
async function removeScene(id: string) {
  if (!editable.value || !scope.value) return
  const selectedKey = keyOf(scope.value)
  const accepted = await confirm({ title: '删除分镜', description: '分镜将从当前集的草稿中移除，保存当前对象后才会更新云端。已有媒体文件不会被删除。', confirmText: '删除分镜', variant: 'destructive' })
  if (accepted && editable.value && scope.value && keyOf(scope.value) === selectedKey) edit(removeCollaborationScene(body.value, id))
}
async function changeDirectory(action: DirectoryAction | { kind: 'transfer', sourceId: string, targetId: string, sceneId: string }) {
  if (!editable.value || structureScopes.value.length) return
  const activeClient = client.value
  if (!activeClient) return
  if (action.kind === 'remove' && !await confirm({ title: '删除集数', description: '将删除此集的正文和分镜。已有媒体文件不会删除，其他集数不受影响。', confirmText: '删除集数', variant: 'destructive' })) return
  await run(async () => {
    if (activeClient !== client.value || scope.value?.type !== 'directory' || !session.canEdit({ type: 'directory', id: 'directory' })) return
    const resources = [...activeClient.drafts.values()].map(item => item.base)
    const changes = action.kind === 'transfer' ? buildSceneTransfer(resources, action.sourceId, action.targetId, action.sceneId) : buildDirectoryChange(resources, action)
    const acquired: CollaborationScope[] = []
    let staged = false
    try {
      for (const change of changes.filter(item => item.type === 'episode')) {
        if (!await session.acquire(change)) throw new Error('受影响集数正在由其他成员编辑，目录未修改。')
        acquired.push(change)
      }
      if (activeClient !== client.value) return
      activeClient.stageStructure(changes)
      staged = true
      session.backup()
      revision.value++
      await session.save(changes)
      message.value = '集数目录已保存到云端。'
    } finally {
      // Keep leases for a recoverable failed group; successful writes release affected episodes.
      if (activeClient === client.value && (!staged || !activeClient.structureScopes.length)) await Promise.allSettled(acquired.map(item => session.release(item)))
      revision.value++
    }
  })
}
async function reviewDirectory() {
  await run(async () => { reviewedStructure.value = await client.value?.reviewStructure() })
}
async function discardDirectory() {
  const preview = reviewedStructure.value
  if (!preview || !client.value) return
  await run(async () => {
    const activeClient = client.value!
    const held = activeClient.structureScopes.filter(item => item.type === 'episode')
    await activeClient.discardStructure(preview)
    if (activeClient !== client.value) return
    session.backup()
    reviewedStructure.value = undefined
    await Promise.allSettled(held.map(item => session.release(item)))
    message.value = '已放弃本次目录调整，其他草稿已保留。'
  })
}
async function selectResource(target: CollaborationScope) {
  if (busy.value || keyOf(target) === selected.value) return
  const previous = scope.value
  await run(async () => {
    session.backup()
    if (previous) {
      try { await session.release(previous) }
      catch { message.value = '上一个对象的编辑权将在租约到期后自动释放。' }
    }
    selected.value = keyOf(target)
  })
}
async function acquire(takeover = false) {
  const target = scope.value
  if (!target) return
  if (takeover && !await confirm({ title: '接管当前对象', description: '当前编辑者将失去此对象的编辑权，其未提交修改会保留。其他集数不受影响。', confirmText: '接管' })) return
  await run(async () => {
    if (!await session.acquire(target, takeover)) error.value = '该对象正在由其他成员编辑，当前可以查看。'
  })
}
async function save() {
  const target = scope.value
  if (target) await run(async () => {
    const activeClient = client.value
    const group = activeClient?.structureScopes ?? []
    for (const item of group) if (!session.canEdit(item) && !await session.acquire(item)) throw new Error('受影响对象正在由其他成员编辑')
    if (activeClient !== client.value) return
    await session.save([target])
    if (activeClient !== client.value) return
    await Promise.allSettled(group.filter(item => item.type === 'episode').map(item => session.release(item)))
    message.value = '当前对象已保存到云端。'
  })
}
async function review() {
  const target = scope.value
  if (target) await run(async () => { reviewed.value = await client.value?.readResource(target.type, target.id) })
}
async function resolve(keepLocal: boolean) {
  const target = scope.value
  const remote = reviewed.value
  if (!target || !remote) return
  await run(async () => {
    await client.value?.resolve(target.type, target.id, keepLocal, remote.revision)
    session.backup()
    reviewed.value = undefined
    message.value = keepLocal ? '本地草稿已保留，请取得编辑权并检查后保存。' : '已采用远端版本。'
  })
}
function downloadBackup() {
  const data = recovery.value ?? client.value?.backup()
  if (!data) return
  const serialized = JSON.stringify(data)
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `协作草稿-${String(route.params.id)}.json`
  link.click()
  exportedDraft = serialized
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function discardRecovery() {
  if (await confirm({ title: '放弃窗口备份', description: '此操作会删除本窗口的未保存草稿备份。建议先导出草稿。', confirmText: '放弃备份', variant: 'destructive' })) {
    session.discardRecovery()
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  try { session.backup() }
  catch {
    if (JSON.stringify(recovery.value ?? client.value?.backup()) !== exportedDraft) { event.preventDefault(); event.returnValue = '' }
  }
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => { loadSequence++; window.removeEventListener('beforeunload', beforeUnload) })
onBeforeRouteLeave(() => {
  try { session.backup(); return true }
  catch {
    if (JSON.stringify(recovery.value ?? client.value?.backup()) === exportedDraft) return true
    error.value = '未保存草稿尚未备份，请先保存或导出后再离开。'
    return false
  }
})
</script>

<template>
  <AppPage>
    <AppPageHeader :title="title" description="按集编辑与保存；公共角色和项目设置使用独立编辑权。">
      <template #actions>
        <Button variant="outline" size="sm" @click="router.push('/projects')"><ArrowLeft class="mr-1 h-4 w-4" />项目列表</Button>
        <Button variant="outline" size="sm" :disabled="!client" @click="showMembers = true"><Users class="mr-1 h-4 w-4" />成员</Button>
        <Button variant="outline" size="sm" :disabled="!client" @click="downloadBackup"><Download class="mr-1 h-4 w-4" />导出草稿</Button>
        <Button variant="outline" size="sm" :disabled="!client || busy" @click="run(session.refresh)"><RefreshCw class="mr-1 h-4 w-4" />刷新</Button>
      </template>
    </AppPageHeader>
    <AppPageContent scroll inner-class="space-y-4">
      <p v-if="loading" class="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 class="h-4 w-4 animate-spin" />正在读取云端协作项目…</p>
      <p v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{{ error }}</p>
      <p v-if="message" class="text-sm text-muted-foreground" role="status">{{ message }}</p>
      <template v-if="client && !loading">
        <div v-if="recovery !== undefined" class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <span class="flex-1">此窗口有未保存的草稿备份。恢复后会核对远端版本。</span>
          <Button size="sm" :disabled="busy" @click="run(async () => session.recover())">恢复草稿</Button>
          <Button size="sm" variant="outline" @click="downloadBackup">导出备份</Button>
          <Button size="sm" variant="ghost" @click="discardRecovery">放弃备份</Button>
        </div>
        <p v-if="pending" role="status" class="text-sm text-muted-foreground">提交已保存在本机队列，连接恢复后自动重试；发生版本冲突时停止并保留草稿。</p>
        <div v-if="pending" class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <span class="flex-1">上次保存结果尚未确认。请先重试原提交，再保存后续修改。</span>
          <Button size="sm" :disabled="busy || recovery !== undefined" @click="run(session.retrySave)">确认上次提交</Button>
        </div>
        <p class="text-xs text-muted-foreground">当前支持正文、分镜文本、公共角色和项目设置编辑。支持集数新增、删除、排序、跨集移动分镜及单集正文生成。{{ dirtyCount ? ` ${dirtyCount} 个对象有未保存修改。` : '' }}</p>
        <div class="grid min-h-[32rem] gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="协作对象" class="space-y-4 rounded-lg border p-3">
            <div>
              <button type="button" :disabled="busy" :aria-current="scope?.type === 'settings' ? 'true' : undefined" class="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="scope?.type === 'settings' ? 'bg-muted font-medium' : ''" @click="selectResource({ type: 'settings', id: 'settings' })">
                项目设置<span v-if="client.get('settings', 'settings')?.conflict" class="ml-1 text-destructive">冲突</span><span v-else-if="client.get('settings', 'settings')?.dirty" class="ml-1 text-muted-foreground">未保存</span>
              </button>
            </div>
            <button type="button" :disabled="busy" :aria-current="scope?.type === 'directory' ? 'true' : undefined" class="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="scope?.type === 'directory' ? 'bg-muted font-medium' : ''" @click="selectResource({ type: 'directory', id: 'directory' })">集数目录<span v-if="structureScopes.length" class="ml-1 text-muted-foreground">待处理</span></button>
            <div>
              <h2 class="mb-2 text-xs font-medium text-muted-foreground">集数</h2>
              <button v-for="item in episodes" :key="keyOf(item.base)" type="button" :disabled="busy" :aria-current="selected === keyOf(item.base) ? 'true' : undefined" class="mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="selected === keyOf(item.base) ? 'bg-muted font-medium' : ''" @click="selectResource(item.base)">
                {{ text(record(item.body?.plan).title) || item.base.id }}<span v-if="item.conflict" class="ml-1 text-destructive">冲突</span><span v-else-if="item.dirty" class="ml-1 text-muted-foreground">未保存</span>
              </button>
              <p v-if="!episodes.length" class="px-3 text-xs text-muted-foreground">暂无集数</p>
            </div>
            <div>
              <h2 class="mb-2 text-xs font-medium text-muted-foreground">公共角色</h2>
              <button v-for="item in characters" :key="keyOf(item.base)" type="button" :disabled="busy" :aria-current="selected === keyOf(item.base) ? 'true' : undefined" class="mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="selected === keyOf(item.base) ? 'bg-muted font-medium' : ''" @click="selectResource(item.base)">
                {{ text(item.body?.name) || item.base.id }}<span v-if="item.conflict" class="ml-1 text-destructive">冲突</span><span v-else-if="item.dirty" class="ml-1 text-muted-foreground">未保存</span>
              </button>
            </div>
          </nav>
          <section v-if="active" class="min-w-0 space-y-4 rounded-lg border p-4 md:p-5" aria-label="当前对象编辑">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <p class="text-sm text-muted-foreground">{{ hasLease ? '已取得当前对象编辑权' : '当前对象为只读' }} · 版本 {{ active.base.revision }}</p>
              <div class="flex flex-wrap gap-2">
                <Button v-if="!hasLease" size="sm" variant="outline" :disabled="busy || recovery !== undefined || active.base.deleted" @click="acquire()">取得编辑权</Button>
                <Button v-if="currentLease?.canTakeover && !currentLease.editable" size="sm" variant="outline" :disabled="busy" @click="acquire(true)">接管此对象</Button>
                <Button size="sm" :disabled="!editable || !active.dirty || pending" @click="save"><Save class="mr-1 h-4 w-4" />保存当前对象</Button>
              </div>
            </div>
            <div v-if="active.conflict && !structureScopes.length" class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>此对象有远端更新或编辑权已失效，本地草稿已保留。请查看远端内容后选择处理方式。</p>
              <Button size="sm" variant="outline" :disabled="busy || pending" @click="review">查看远端内容</Button>
              <template v-if="reviewed">
                <pre class="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans leading-6">{{ collaborationReviewText(reviewed) }}</pre>
                <div class="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" :disabled="busy" @click="resolve(false)">采用远端版本</Button>
                  <Button size="sm" variant="outline" :disabled="busy || reviewed.deleted" @click="resolve(true)">保留本地草稿，继续编辑</Button>
                </div>
              </template>
            </div>
            <div v-if="structureScopes.length" class="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
              <p>有一组目录调整尚未完成。请在集数目录重试保存，或查看远端内容后放弃本次调整。原提交结果不确定时，请先确认上次提交。</p>
              <Button v-if="scope?.type !== 'directory'" size="sm" variant="outline" @click="selectResource({ type: 'directory', id: 'directory' })">前往集数目录</Button>
              <Button size="sm" variant="outline" :disabled="busy || pending" @click="reviewDirectory">查看远端目录</Button>
              <template v-if="reviewedStructure">
                <div v-for="item in reviewedStructure" :key="keyOf(item)" class="rounded-md bg-background p-3"><p class="mb-2 font-medium">{{ item.type === 'directory' ? '远端集数目录' : text(record(item.body?.plan).title) || '未创建或已删除的集数' }} · 版本 {{ item.revision }}</p><pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{{ collaborationReviewText(item) }}</pre></div>
                <Button size="sm" variant="outline" :disabled="busy || pending" @click="discardDirectory">放弃本次目录调整</Button>
              </template>
            </div>
            <div v-if="scope?.type === 'episode'" class="space-y-3">
              <p v-if="generationError" class="text-sm text-destructive" role="alert">{{ generationError }}</p>
              <Button size="sm" variant="outline" :disabled="busy" @click="loadDraftResults">刷新生成结果</Button>
              <div v-if="generationResult" class="space-y-3 rounded-md border p-3">
                <label class="block space-y-2 text-sm"><span>已保存的生成结果</span><select v-model="chosenGeneration" aria-label="已保存的生成结果" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">最新结果</option><option v-for="item in episodeResults" :key="item.id" :value="item.id">{{ new Date(item.createdAt).toLocaleString() }}</option></select></label>
                <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7">{{ generationResult.data.draft }}</pre>
                <p class="text-xs text-muted-foreground">结果已保存在本机，最多保留最近 20 次。输入版本变化时请导出后手动合并。</p>
                <div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" :disabled="!editable || generating" @click="adoptDraftResult">采用到本集草稿</Button><Button size="sm" variant="outline" @click="exportDraftResult">导出生成结果</Button></div>
              </div>
            </div>
            <ProjectCollaborationAssetMedia v-if="(scope?.type === 'character' || scope?.type === 'settings') && client" :project-id="String(route.params.id)" :actor-id="openedActor" :resource-type="scope.type" :resource-id="scope.id" :client="client" :revision="revision" :editable="editable" :busy="busy" @adopt="adoptAssetMedia" />
            <ProjectCollaborationSceneMedia v-if="scope?.type === 'episode' && client" :project-id="String(route.params.id)" :actor-id="openedActor" :episode-id="scope.id" :client="client" :revision="revision" :editable="editable" :busy="busy" @adopt="adoptSceneMedia" />
            <fieldset :disabled="!editable" class="min-w-0 space-y-4 disabled:opacity-75">
              <template v-if="active.base.type === 'directory'">
                <div class="flex items-center justify-between gap-3"><h2 class="text-sm font-medium">集数目录</h2><Button size="sm" variant="outline" :disabled="!!structureScopes.length" @click="newEpisode">新增集数</Button></div>
                <p class="text-xs text-muted-foreground">目录操作会立即保存，并检查受影响集数的编辑权。请先保存这些集数的草稿。</p>
                <div v-for="(item, index) in episodes.filter(item => !!item.body)" :key="item.base.id" class="flex flex-wrap items-center gap-2 rounded-md border p-3">
                  <span class="mr-auto text-sm">{{ text(record(item.body?.plan).title) || item.base.id }}</span>
                  <Button size="sm" variant="ghost" :disabled="!!structureScopes.length || index === 0" :aria-label="`上移集数 ${index + 1}`" @click="changeDirectory({ kind: 'move', id: item.base.id, direction: -1 })">上移</Button>
                  <Button size="sm" variant="ghost" :disabled="!!structureScopes.length || index === episodes.length - 1" :aria-label="`下移集数 ${index + 1}`" @click="changeDirectory({ kind: 'move', id: item.base.id, direction: 1 })">下移</Button>
                  <Button size="sm" variant="ghost" class="text-destructive" :disabled="!!structureScopes.length || episodes.length <= 1" :aria-label="`删除集数 ${index + 1}`" @click="changeDirectory({ kind: 'remove', id: item.base.id })">删除</Button>
                </div>
                <div class="space-y-3 border-t pt-4">
                  <h2 class="text-sm font-medium">跨集移动分镜</h2>
                  <p class="text-xs text-muted-foreground">将分镜移到目标集末尾，保留已有媒体；来源集和目标集会一起保存。</p>
                  <label class="block space-y-2 text-sm"><span>来源集数</span><select v-model="transferSource" aria-label="来源集数" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">选择来源集</option><option v-for="item in episodes" :key="item.base.id" :value="item.base.id">{{ text(record(item.body?.plan).title) || item.base.id }}</option></select></label>
                  <label class="block space-y-2 text-sm"><span>要移动的分镜</span><select v-model="transferScene" aria-label="要移动的分镜" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">选择分镜</option><option v-for="(item, index) in transferScenes" :key="text(item.id)" :value="text(item.id)">{{ index + 1 }} · {{ text(item.title) || '未命名分镜' }}</option></select></label>
                  <label class="block space-y-2 text-sm"><span>目标集数</span><select v-model="transferTarget" aria-label="目标集数" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">选择目标集</option><option v-for="item in episodes.filter(item => item.base.id !== transferSource)" :key="item.base.id" :value="item.base.id">{{ text(record(item.body?.plan).title) || item.base.id }}</option></select></label>
                  <Button size="sm" variant="outline" :disabled="!!structureScopes.length || !transferSource || !transferTarget || !transferScene || transferSource === transferTarget" @click="changeDirectory({ kind: 'transfer', sourceId: transferSource, targetId: transferTarget, sceneId: transferScene })">移动分镜并保存</Button>
                </div>
              </template>
              <template v-else-if="active.base.type === 'episode'">
                <label class="block space-y-2 text-sm"><span>集数标题</span><Input :model-value="text(plan.title)" @update:model-value="editEpisode('title', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>本集梗概</span><Textarea :model-value="text(writing.summary)" class="min-h-24" @update:model-value="editEpisode('summary', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>本集正文</span><Textarea :model-value="text(writing.draft)" class="min-h-72 leading-7" @update:model-value="editEpisode('draft', $event)" /></label>
                <div class="space-y-3 rounded-md border p-3">
                  <h2 class="text-sm font-medium">生成单集正文</h2>
                  <p class="text-xs text-muted-foreground">使用云端项目设定和本集大纲生成。请先保存正文和设置；生成结果先预览，采用后再保存。</p>
                  <label class="block space-y-2 text-sm"><span>创作要求</span><Textarea v-model="generationInstruction" class="min-h-20" /></label>
                  <Button size="sm" variant="outline" :disabled="generating" @click="generateDraft">{{ generating ? '正在生成正文…' : '生成正文预览' }}</Button>
                </div>
                <div class="flex items-center justify-between gap-3 border-t pt-4">
                  <h2 class="text-sm font-medium">本集分镜 · {{ scenes.length }}</h2>
                  <Button size="sm" variant="outline" @click="addScene">添加分镜</Button>
                </div>
                <p v-if="!scenes.length" class="text-sm text-muted-foreground">本集暂无分镜，可以添加后编辑。</p>
                <div v-for="(scene, index) in scenes" :key="text(scene.id)" class="space-y-3 rounded-md border p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="mr-auto text-xs text-muted-foreground">分镜 {{ index + 1 }}</span>
                    <Button size="sm" variant="ghost" :disabled="index === 0" :aria-label="`上移分镜 ${index + 1}`" @click="moveScene(text(scene.id), -1)">上移</Button>
                    <Button size="sm" variant="ghost" :disabled="index === scenes.length - 1" :aria-label="`下移分镜 ${index + 1}`" @click="moveScene(text(scene.id), 1)">下移</Button>
                    <Button size="sm" variant="ghost" class="text-destructive" :aria-label="`删除分镜 ${index + 1}`" @click="removeScene(text(scene.id))">删除</Button>
                  </div>
                  <label class="block space-y-2 text-sm"><span>分镜 {{ index + 1 }} 标题</span><Input :model-value="text(scene.title)" @update:model-value="editScene(text(scene.id), 'title', $event)" /></label>
                  <label class="block space-y-2 text-sm"><span>画面描述</span><Textarea :model-value="text(scene.description)" @update:model-value="editScene(text(scene.id), 'description', $event)" /></label>
                  <label class="block space-y-2 text-sm"><span>旁白</span><Textarea :model-value="text(scene.narration)" @update:model-value="editScene(text(scene.id), 'narration', $event)" /></label>
                </div>
              </template>
              <template v-else-if="active.base.type === 'settings'">
                <label class="block space-y-2 text-sm"><span>项目名称</span><Input :model-value="text(projectSettings.name)" @update:model-value="editSettings('name', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>项目简介</span><Textarea :model-value="text(projectSettings.description)" class="min-h-40" @update:model-value="editSettings('description', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>画幅</span>
                  <select aria-label="画幅" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :value="text(projectSettings.aspectRatio) || '16:9'" @change="editSettings('aspectRatio', ($event.target as HTMLSelectElement).value)">
                    <option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option>
                  </select>
                </label>
              </template>
              <template v-else-if="active.base.type === 'character'">
                <label class="block space-y-2 text-sm"><span>角色名称</span><Input :model-value="text(body.name)" @update:model-value="edit({ ...body, name: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>角色定位</span><Input :model-value="text(body.role)" @update:model-value="edit({ ...body, role: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>外貌描述</span><Textarea :model-value="text(body.appearance)" class="min-h-40" @update:model-value="edit({ ...body, appearance: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>性格描述</span><Textarea :model-value="text(body.personality)" class="min-h-32" @update:model-value="edit({ ...body, personality: String($event) })" /></label>
              </template>
            </fieldset>
          </section>
          <p v-else class="p-6 text-sm text-muted-foreground">选择项目设置、集数或公共角色开始查看。</p>
        </div>
      </template>
    </AppPageContent>
    <ProjectMembersDialog v-model:open="showMembers" :project-id="String(route.params.id || '')" />
  </AppPage>
</template>

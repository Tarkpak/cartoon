<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Download, Loader2, RefreshCw, Save } from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useProjectCollaboration, type CollaborationScope } from '~/composables/useProjectCollaboration'
import type { CollaborationResource } from '#shared/types/project-collaboration'
import { collaborationRecord as record, collaborationText as text, collaborationReviewText, patchCollaborationEpisode, patchCollaborationScene } from '~/lib/project-collaboration-editor'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const route = useRoute()
const router = useRouter()
const { currentUser, loadStatus } = useCloudAdmin()
const { confirm } = useConfirm()
const session = useProjectCollaboration()
const { client, error, revision, recovery } = session
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const selected = ref('')
const reviewed = ref<CollaborationResource>()
let loadSequence = 0
let openedActor = ''
let exportedDraft = ''
const keyOf = (scope: CollaborationScope) => JSON.stringify([scope.type, scope.id])
const drafts = computed(() => { void revision.value; return [...client.value?.drafts.values() ?? []] })
const settings = computed(() => record(drafts.value.find(item => item.base.type === 'settings')?.body))
const title = computed(() => text(record(settings.value.project).name) || '按集协作')
const directory = computed(() => {
  const ids = drafts.value.find(item => item.base.type === 'directory')?.body?.episodeIds
  return Array.isArray(ids) ? ids : []
})
const episodes = computed(() => drafts.value.filter(item => item.base.type === 'episode' && (!item.base.deleted || item.dirty))
  .sort((a, b) => directory.value.indexOf(a.base.id) - directory.value.indexOf(b.base.id)))
const characters = computed(() => drafts.value.filter(item => item.base.type === 'character' && (!item.base.deleted || item.dirty)))
const active = computed(() => drafts.value.find(item => keyOf(item.base) === selected.value))
const scope = computed(() => active.value && { type: active.value.base.type, id: active.value.base.id })
const body = computed(() => record(active.value?.body))
const plan = computed(() => record(body.value.plan))
const writing = computed(() => record(body.value.writing))
const scenes = computed(() => Array.isArray(body.value.scenes) ? body.value.scenes.map(record) : [])
const hasLease = computed(() => !!scope.value && session.canEdit(scope.value))
const editable = computed(() => hasLease.value && !busy.value && !active.value?.conflict && !active.value?.base.deleted)
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
  reviewed.value = undefined
  try {
    if (!id) throw new Error('缺少项目 ID')
    const status = await loadStatus()
    if (version !== loadSequence) return
    openedActor = status?.user?.id || ''
    await session.open(id, openedActor)
    if (version !== loadSequence) return
    selected.value = episodes.value[0] ? keyOf(episodes.value[0].base) : characters.value[0] ? keyOf(characters.value[0].base) : ''
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
watch(selected, () => { reviewed.value = undefined; message.value = '' })

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
function editScene(id: string, field: 'title' | 'description' | 'narration', value: string | number) {
  edit(patchCollaborationScene(body.value, id, field, String(value)))
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
  if (target) await run(async () => { await session.save([target]); message.value = '当前对象已保存到云端。' })
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
    <AppPageHeader :title="title" description="按集编辑与保存；公共角色使用独立编辑权。">
      <template #actions>
        <Button variant="outline" size="sm" @click="router.push('/projects')"><ArrowLeft class="mr-1 h-4 w-4" />项目列表</Button>
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
        <div v-if="pending" class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <span class="flex-1">上次保存结果尚未确认。请先重试原提交，再保存后续修改。</span>
          <Button size="sm" :disabled="busy || recovery !== undefined" @click="run(session.retrySave)">确认上次提交</Button>
        </div>
        <p class="text-xs text-muted-foreground">当前支持正文、分镜文本和公共角色编辑。自动生成与集数目录调整尚未接入此页。{{ dirtyCount ? ` ${dirtyCount} 个对象有未保存修改。` : '' }}</p>
        <div class="grid min-h-[32rem] gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="协作对象" class="space-y-4 rounded-lg border p-3">
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
            <div v-if="active.conflict" class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
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
            <fieldset :disabled="!editable" class="min-w-0 space-y-4 disabled:opacity-75">
              <template v-if="active.base.type === 'episode'">
                <label class="block space-y-2 text-sm"><span>集数标题</span><Input :model-value="text(plan.title)" @update:model-value="editEpisode('title', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>本集梗概</span><Textarea :model-value="text(writing.summary)" class="min-h-24" @update:model-value="editEpisode('summary', $event)" /></label>
                <label class="block space-y-2 text-sm"><span>本集正文</span><Textarea :model-value="text(writing.draft)" class="min-h-72 leading-7" @update:model-value="editEpisode('draft', $event)" /></label>
                <h2 class="border-t pt-4 text-sm font-medium">本集分镜 · {{ scenes.length }}</h2>
                <div v-for="(scene, index) in scenes" :key="text(scene.id)" class="space-y-3 rounded-md border p-3">
                  <label class="block space-y-2 text-sm"><span>分镜 {{ index + 1 }} 标题</span><Input :model-value="text(scene.title)" @update:model-value="editScene(text(scene.id), 'title', $event)" /></label>
                  <label class="block space-y-2 text-sm"><span>画面描述</span><Textarea :model-value="text(scene.description)" @update:model-value="editScene(text(scene.id), 'description', $event)" /></label>
                  <label class="block space-y-2 text-sm"><span>旁白</span><Textarea :model-value="text(scene.narration)" @update:model-value="editScene(text(scene.id), 'narration', $event)" /></label>
                </div>
              </template>
              <template v-else-if="active.base.type === 'character'">
                <label class="block space-y-2 text-sm"><span>角色名称</span><Input :model-value="text(body.name)" @update:model-value="edit({ ...body, name: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>角色定位</span><Input :model-value="text(body.role)" @update:model-value="edit({ ...body, role: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>外貌描述</span><Textarea :model-value="text(body.appearance)" class="min-h-40" @update:model-value="edit({ ...body, appearance: String($event) })" /></label>
                <label class="block space-y-2 text-sm"><span>性格描述</span><Textarea :model-value="text(body.personality)" class="min-h-32" @update:model-value="edit({ ...body, personality: String($event) })" /></label>
              </template>
            </fieldset>
          </section>
          <p v-else class="p-6 text-sm text-muted-foreground">选择一个集数或公共角色开始查看。</p>
        </div>
      </template>
    </AppPageContent>
  </AppPage>
</template>

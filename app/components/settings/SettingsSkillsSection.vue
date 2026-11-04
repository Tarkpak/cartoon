<script setup lang="ts">
import { Puzzle, Upload, FolderOpen, RefreshCw, MoreHorizontal, ChevronDown, Clapperboard, Eye, History, HelpCircle, X, Check, Search, ArrowRight, Loader2 } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { WorkflowSkill, SkillRun, SkillStage } from '#shared/types/skill'
import { SKILL_STAGE_LABELS } from '#shared/types/skill'
import { readSkillDirectory, readSkillZip } from '@/lib/skill-package'
import type { Project, ProjectListResponse } from '@/lib/projects-page'
import { getDisplayErrorMessage } from '@/lib/asset-workbench-values'
import SettingsSkillsOnline from '@/components/settings/SettingsSkillsOnline.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const skills = ref<WorkflowSkill[]>([])
const runs = ref<SkillRun[]>([])
const selectedIds = ref<string[]>([])
const savedIds = ref<string[]>([])
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const projectName = ref('')
const canEdit = ref(false)
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const projects = ref<Array<Pick<Project, 'id' | 'title'>>>([])
const projectSearch = ref('')
const zipInput = ref<HTMLInputElement>()
const directoryInput = ref<HTMLInputElement>()
const detail = ref<WorkflowSkill | null>(null)
const removing = ref<WorkflowSkill | null>(null)
const activeView = ref<'installed' | 'discover'>('installed')
const projectPickerOpen = ref(false)
const historyOpen = ref(false)
const helpOpen = ref(false)
const projectSearchBusy = ref(false)
const projectSearchError = ref('')
const onlineBusy = ref(false)
const changed = computed(() => [...selectedIds.value].sort().join(',') !== [...savedIds.value].sort().join(','))
const statusLabels: Record<SkillRun['status'], string> = {
  running: '执行中', succeeded: '已完成', failed: '失败', skipped: '已跳过', interrupted: '失败或中断'
}
let requestId = 0
let projectRequestId = 0
let loadedProjectId: string | null = null
const interactionBusy = computed(() => busy.value || loading.value || onlineBusy.value)
const actionLocked = computed(() => interactionBusy.value || changed.value)
const selectedCount = computed(() => selectedIds.value.filter(id => skills.value.some(skill => skill.id === id && skill.enabled)).length)

function shortStageLabel(stage: string) {
  return stage === 'scene_detail' ? '分镜细化' : stage === 'video_review' ? '视频审片' : stage
}

function openProjectPicker() {
  projectPickerOpen.value = true
  projectSearch.value = ''
  void searchProjects()
}

function onOnlineInstalled() {
  activeView.value = 'installed'
  notice.value = '技能已安装，选择项目后即可启用。'
  void load()
}

function stageLabel(stage: string) {
  return SKILL_STAGE_LABELS[stage as SkillStage] || stage
}

async function load() {
  const token = ++requestId
  loading.value = true
  error.value = ''
  if (loadedProjectId !== projectId.value) {
    canEdit.value = false
    skills.value = []
    selectedIds.value = []
    savedIds.value = []
    runs.value = []
    projectName.value = ''
  }
  try {
    if (projectId.value) {
      const id = encodeURIComponent(projectId.value)
      const [data, history] = await Promise.all([
        $fetch<{ skills: WorkflowSkill[], selectedIds: string[], projectName: string, canEdit: boolean }>(`/api/project/${id}/skills`),
        $fetch<{ runs: SkillRun[] }>(`/api/project/${id}/skill-runs`)
      ])
      if (token !== requestId) return
      skills.value = data.skills
      selectedIds.value = [...data.selectedIds]
      savedIds.value = [...data.selectedIds]
      projectName.value = data.projectName
      canEdit.value = data.canEdit
      runs.value = history.runs
    } else {
      const data = await $fetch<{ skills: WorkflowSkill[] }>('/api/skills')
      if (token !== requestId) return
      skills.value = data.skills
      runs.value = []
      canEdit.value = false
    }
    loadedProjectId = projectId.value
  } catch (cause) {
    if (token === requestId) {
      error.value = getDisplayErrorMessage(cause, '加载技能失败')
      canEdit.value = false
      skills.value = []
      selectedIds.value = []
      savedIds.value = []
    }
  } finally {
    if (token === requestId) loading.value = false
  }
}

async function searchProjects() {
  const token = ++projectRequestId
  projectSearchBusy.value = true
  projectSearchError.value = ''
  try {
    const data = await $fetch<ProjectListResponse>('/api/project/list', {
      query: { page: 1, pageSize: 30, keyword: projectSearch.value || undefined, workspace: 'video' }
    })
    if (token === projectRequestId) projects.value = data.projects
  } catch (cause) {
    if (token === projectRequestId) projectSearchError.value = getDisplayErrorMessage(cause, '加载项目失败')
  } finally {
    if (token === projectRequestId) projectSearchBusy.value = false
  }
}

async function action(work: () => Promise<unknown>, message: string) {
  if (busy.value || loading.value || onlineBusy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    notice.value = message
    await load()
  } catch (cause) { error.value = getDisplayErrorMessage(cause, '操作失败') }
  finally { busy.value = false }
}

async function install(event: Event, zip: boolean) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  await action(async () => {
    const body = zip ? await readSkillZip(files[0]!) : await readSkillDirectory(files)
    const data = await $fetch<{ skill: WorkflowSkill }>('/api/skills/install', { method: 'POST', body })
    detail.value = data.skill
  }, '已安装。兼容的技能可在项目中勾选使用。')
}

function toggleProject(id: string, checked: boolean) {
  selectedIds.value = checked ? [...selectedIds.value, id] : selectedIds.value.filter(value => value !== id)
}

function saveSelection() {
  const id = encodeURIComponent(projectId.value)
  const ids = [...selectedIds.value]
  return action(() => $fetch(`/api/project/${id}/skills`, { method: 'PUT', body: { selectedIds: ids } }), '项目技能已保存，下次执行时生效。')
}

function toggleGlobal(skill: WorkflowSkill) {
  return action(() => $fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'PUT', body: { enabled: !skill.enabled } }), skill.enabled ? '技能已在本机停用。' : '技能已在本机启用。')
}

async function uninstall() {
  if (!removing.value) return
  const id = removing.value.id
  await action(async () => {
    await $fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'PUT', body: { remove: true } })
    removing.value = null
    if (detail.value?.id === id) detail.value = null
  }, '技能已卸载，项目选择已清理。')
}

function selectProject(project: string) {
  projectPickerOpen.value = false
  void router.replace({ path: '/settings', query: { section: 'skills', ...(project ? { project } : {}) } })
}

watch(projectId, () => { notice.value = ''; historyOpen.value = false; void load() }, { immediate: true })
</script>

<template>
  <div class="h-full overflow-y-auto px-5 py-7 sm:px-8">
    <div class="mx-auto max-w-5xl">
      <header class="flex flex-wrap items-start justify-between gap-4 pb-7">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold tracking-tight">技能中心</h2>
          <p class="text-sm text-muted-foreground">为创作添加专业方法，让每个项目用上合适的技能。</p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="技能使用帮助" @click="helpOpen = true"><HelpCircle class="h-4 w-4" /></Button>
          <DropdownMenu :modal="false">
            <DropdownMenuTrigger as-child>
              <Button variant="outline" :disabled="actionLocked"><Upload class="mr-2 h-4 w-4" />本地导入<ChevronDown class="ml-2 h-3.5 w-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="directoryInput?.click()"><FolderOpen />从目录导入</DropdownMenuItem>
              <DropdownMenuItem @select="zipInput?.click()"><Upload />从 ZIP 导入</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <input ref="zipInput" class="hidden" type="file" accept=".zip" aria-label="选择技能 ZIP" @change="install($event, true)">
      <input ref="directoryInput" class="hidden" type="file" webkitdirectory multiple aria-label="选择技能目录" @change="install($event, false)">

      <nav aria-label="技能视图" class="mb-6 flex gap-7 border-b">
        <button type="button" class="-mb-px border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="activeView === 'installed' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" :aria-current="activeView === 'installed' ? 'page' : undefined" :disabled="onlineBusy" @click="activeView = 'installed'">已安装 <span class="ml-1.5 text-xs tabular-nums text-muted-foreground">{{ skills.length }}</span></button>
        <button type="button" class="-mb-px border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" :class="activeView === 'discover' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" :aria-current="activeView === 'discover' ? 'page' : undefined" :disabled="actionLocked" @click="activeView = 'discover'">发现技能</button>
      </nav>

      <p v-if="error" role="alert" class="mb-4 rounded-lg bg-destructive/5 px-4 py-3 text-sm text-destructive">{{ error }}</p>
      <p v-if="notice" role="status" class="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Check class="h-4 w-4 shrink-0 text-primary" />{{ notice }}</p>

      <SettingsSkillsOnline v-show="activeView === 'discover'" :disabled="busy || loading || changed" :installed-ids="skills.map(skill => skill.id)" @installed="onOnlineInstalled" @busy="onlineBusy = $event" />

      <section v-show="activeView === 'installed'" aria-label="已安装技能">
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="ghost" class="-ml-2 max-w-full gap-2 px-2 font-medium" :disabled="actionLocked" aria-label="配置项目技能" @click="openProjectPicker">
              <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="max-w-64 truncate">{{ projectId ? projectName || '加载项目…' : '本机技能' }}</span><ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Button>
            <span class="text-xs text-muted-foreground">{{ projectId ? (changed ? '选择已修改' : `已启用 ${selectedCount} 项`) : '选择项目，为项目启用技能' }}</span>
          </div>
          <div class="flex items-center gap-1">
            <Button v-if="projectId" variant="ghost" size="sm" :disabled="loading" @click="historyOpen = true"><History class="mr-1.5 h-3.5 w-3.5" />执行记录</Button>
            <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="actionLocked" aria-label="刷新技能和执行记录" @click="load"><RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" /></Button>
          </div>
        </div>
        <p v-if="projectId && !canEdit && !loading" class="mb-4 text-xs text-muted-foreground">当前项目只读，不能修改技能选择。</p>
        <div v-if="loading && !skills.length" role="status" aria-label="正在加载技能" class="space-y-6 py-3">
          <div v-for="index in 2" :key="index" class="flex gap-4 motion-safe:animate-pulse"><div class="h-11 w-11 rounded-xl bg-muted/50" /><div class="flex-1 space-y-3 py-1"><div class="h-4 w-32 rounded bg-muted/50" /><div class="h-3 w-2/3 rounded bg-muted/40" /></div></div>
        </div>
        <div v-else-if="!skills.length && !error" class="py-16 text-center">
          <Puzzle class="mx-auto mb-4 h-7 w-7 text-muted-foreground" />
          <h3 class="text-base font-medium">从一个技能开始</h3>
          <p class="mt-2 text-sm text-muted-foreground">发现适合分镜与审片的创作方法，或导入自己的技能。</p>
          <Button class="mt-5" @click="activeView = 'discover'">发现技能<ArrowRight class="ml-2 h-4 w-4" /></Button>
        </div>
        <div class="divide-y divide-border/60" :aria-busy="interactionBusy">
          <article v-for="skill in skills" :key="skill.id" class="group flex items-center gap-3 py-6 sm:gap-4">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
              <component :is="skill.stages.includes('scene_detail') ? Clapperboard : skill.stages.includes('video_review') ? Eye : Puzzle" class="h-5 w-5" :stroke-width="1.5" />
            </div>
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button class="text-left text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="detail = skill">{{ skill.name }}</button>
                <span v-if="skill.builtin" class="text-2xs text-muted-foreground">内置</span>
                <span v-if="skill.unsupported.length" class="text-xs text-destructive">暂不兼容</span>
                <span v-else-if="!skill.enabled" class="text-xs text-muted-foreground">本机已停用</span>
              </div>
              <p class="line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{{ skill.description }}</p>
              <p class="text-xs text-muted-foreground/75">{{ skill.stages.map(shortStageLabel).join(' · ') || '尚未指定流程' }}<span v-if="projectId && !skill.enabled && selectedIds.includes(skill.id)"> · 本机启用后才会执行</span></p>
            </div>
            <div class="flex shrink-0 items-center gap-2 sm:gap-4">
              <Switch v-if="projectId" :checked="selectedIds.includes(skill.id)" :aria-label="`项目使用${skill.name}`" :disabled="!canEdit || interactionBusy || (skill.unsupported.length > 0 && !selectedIds.includes(skill.id))" @update:checked="toggleProject(skill.id, $event)" />
              <Switch v-else :checked="skill.enabled" :aria-label="`本机使用${skill.name}`" :disabled="actionLocked || skill.unsupported.length > 0" @update:checked="toggleGlobal(skill)" />
              <DropdownMenu :modal="false">
                <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground" :aria-label="`管理${skill.name}`" :disabled="actionLocked"><MoreHorizontal class="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="detail = skill">查看详情</DropdownMenuItem>
                  <DropdownMenuItem v-if="projectId" :disabled="skill.unsupported.length > 0" @select="toggleGlobal(skill)">{{ skill.enabled ? '在本机停用' : '在本机启用' }}</DropdownMenuItem>
                  <template v-if="!skill.builtin"><DropdownMenuSeparator /><DropdownMenuItem destructive @select="removing = skill">卸载技能</DropdownMenuItem></template>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </article>
        </div>
        <p v-if="skills.length && !changed && (!projectId || canEdit)" class="mt-6 text-xs leading-relaxed text-muted-foreground/75">{{ projectId ? '为当前项目打开开关后保存，下次执行时生效。' : '技能仅保存在本机；项目启用情况可在左上角切换查看。' }}</p>
        <div v-if="changed" class="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/15 bg-background px-4 py-3 shadow-sm" role="status">
          <span class="text-sm">项目选择尚未保存</span>
          <div class="flex gap-2"><Button variant="ghost" :disabled="interactionBusy" @click="selectedIds = [...savedIds]">撤销选择</Button><Button :disabled="!canEdit || interactionBusy" @click="saveSelection"><Loader2 v-if="busy" class="mr-2 h-4 w-4 animate-spin" />保存项目选择</Button></div>
        </div>
      </section>
    </div>

    <Dialog v-model:open="projectPickerOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader><DialogTitle>选择项目</DialogTitle><DialogDescription>选择要配置技能的项目。</DialogDescription></DialogHeader>
        <form class="flex gap-2" @submit.prevent="searchProjects"><Input v-model="projectSearch" placeholder="搜索项目名称" aria-label="搜索项目" /><Button variant="outline" type="submit" :disabled="projectSearchBusy" aria-label="搜索项目列表"><Search class="h-4 w-4" /></Button></form>
        <button class="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="selectProject('')"><span>本机技能管理</span><Check v-if="!projectId" class="h-4 w-4 text-primary" /></button>
        <p v-if="projectSearchError" role="alert" class="text-sm text-destructive">{{ projectSearchError }}</p>
        <p v-if="projectSearchBusy" role="status" class="text-sm text-muted-foreground">正在查找项目…</p>
        <div v-else class="max-h-72 overflow-y-auto border-t pt-2">
          <button v-for="project in projects" :key="project.id" :aria-current="projectId === project.id ? 'true' : undefined" class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="selectProject(project.id)"><span class="truncate">{{ project.title?.trim() || '未命名项目' }}</span><Check v-if="projectId === project.id" class="h-4 w-4 shrink-0 text-primary" /></button>
          <p v-if="!projects.length && !projectSearchError" class="py-4 text-sm text-muted-foreground">没有找到项目，试试其他名称。</p>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!detail" @update:open="value => { if (!value) detail = null }">
      <SheetContent class="w-[min(92vw,580px)] max-w-none">
        <div class="flex items-start justify-between gap-4 border-b px-6 py-5">
          <DialogHeader class="min-w-0"><DialogTitle>{{ detail?.name }}</DialogTitle><DialogDescription>{{ detail?.description }}</DialogDescription></DialogHeader>
          <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" aria-label="关闭技能详情" @click="detail = null"><X class="h-4 w-4" /></Button>
        </div>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>版本 {{ detail?.version }}</span><span>{{ detail?.stages.map(shortStageLabel).join(' · ') }}</span><span>{{ Object.keys(detail?.files || {}).length }} 个附件</span></div>
          <p v-if="detail?.origin" class="break-all text-xs text-muted-foreground">来源 <a :href="detail.origin.url" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">{{ detail.origin.repository }} / {{ detail.origin.path || '根目录' }}</a> · {{ detail.origin.commit.slice(0, 12) }}</p>
          <p v-if="detail?.unsupported.length" role="alert" class="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{{ detail.unsupported.join('；') }}</p>
          <p v-if="detail?.warnings?.length" class="rounded-lg bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{{ detail.warnings.join('；') }}</p>
          <section><h3 class="mb-3 text-sm font-medium">技能指令</h3><pre class="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{{ detail?.instructions }}</pre></section>
          <details v-if="detail?.originalDocument" class="border-t pt-4 text-sm"><summary class="cursor-pointer text-muted-foreground">原始 SKILL.md</summary><pre class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{{ detail.originalDocument }}</pre></details>
          <details v-for="(content, path) in detail?.files" :key="path" class="border-t pt-4 text-sm"><summary class="cursor-pointer break-all text-muted-foreground">{{ path }}</summary><pre class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{{ content }}</pre></details>
        </div>
      </SheetContent>
    </Dialog>

    <Dialog v-model:open="historyOpen">
      <SheetContent class="w-[min(92vw,580px)] max-w-none">
        <div class="flex items-start justify-between gap-3 border-b px-6 py-5"><DialogHeader><DialogTitle>执行记录</DialogTitle><DialogDescription>{{ projectName }} · 最近的技能执行</DialogDescription></DialogHeader><Button variant="ghost" size="icon" class="h-8 w-8" aria-label="关闭执行记录" @click="historyOpen = false"><X class="h-4 w-4" /></Button></div>
        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          <p v-if="!runs.length" class="py-12 text-center text-sm text-muted-foreground">还没有执行记录，解析或审片后可在这里查看。</p>
          <article v-for="run in runs" :key="run.id" class="space-y-2 border-b py-5 text-sm last:border-0">
            <div class="flex flex-wrap items-center justify-between gap-2"><span class="font-medium">{{ stageLabel(run.stage) }}</span><span :class="['failed', 'interrupted'].includes(run.status) ? 'text-destructive' : 'text-muted-foreground'">{{ statusLabels[run.status] }}</span></div>
            <time class="text-xs text-muted-foreground">{{ new Date(run.createdAt).toLocaleString() }}</time>
            <p v-if="run.result?.message" class="text-sm leading-relaxed text-muted-foreground">{{ run.result.message }}</p>
            <p v-if="run.result?.sceneCount !== undefined" class="text-xs text-muted-foreground">已细化 {{ run.result.sceneCount }} 个分镜</p>
            <p v-if="run.result?.passed !== undefined" class="text-xs text-muted-foreground">审片{{ run.result.passed ? '通过' : '未通过' }} · {{ run.result.issueCount }} 项问题</p>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{{ run.durationMs !== undefined ? `${(run.durationMs / 1000).toFixed(1)} 秒 · ` : '' }}{{ run.syncStatus === 'synced' ? '已同步后台' : run.syncStatus === 'pending' ? '等待同步后台' : '本机记录' }}</span>
              <RouterLink :to="{ path: '/logs', query: { tab: 'model', skillRunId: run.id } }" class="text-primary underline-offset-4 hover:underline">查看模型调用</RouterLink>
            </div>
            <details class="text-xs text-muted-foreground"><summary class="cursor-pointer">使用的技能</summary><p class="mt-2">{{ run.skills.map(skill => `${skill.name} v${skill.version}`).join('、') || '未启用技能' }}</p></details>
          </article>
        </div>
      </SheetContent>
    </Dialog>

    <Dialog v-model:open="helpOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader><DialogTitle>使用技能</DialogTitle><DialogDescription>安装一次，再为不同项目选择。</DialogDescription></DialogHeader>
        <ol class="space-y-4 text-sm leading-relaxed"><li><span class="font-medium">1. 找到技能</span><p class="mt-1 text-muted-foreground">在“发现技能”中搜索，或通过“本地导入”安装目录与 ZIP。</p></li><li><span class="font-medium">2. 为项目启用</span><p class="mt-1 text-muted-foreground">在“已安装”中选择项目，打开所需技能并保存。分镜细化在解析后执行，审片由工作台入口执行。</p></li><li><span class="font-medium">3. 查看效果</span><p class="mt-1 text-muted-foreground">生成结果仍在工作台展示；详细状态可在“执行记录”中查看。</p></li></ol>
        <p class="text-xs leading-relaxed text-muted-foreground">仅本机生效，协作成员需各自安装。停用本机技能会影响本机所有项目。当前支持文本指令与参考资料，不执行脚本或 MCP 工具。</p>
        <details class="border-t pt-3 text-xs text-muted-foreground"><summary class="cursor-pointer">自定义技能格式与限制</summary><p class="mt-3 leading-relaxed">目录内包含唯一的 SKILL.md，可保留 UTF-8 文本附件；最多 128 个文件、合计 1 MB，单文件限 256 KB。模型使用正文和 Markdown、TXT、JSON 参考资料，合计限 96 KB；脚本、工具配置和打包文件仅保存。ZIP 上传限 1 MB。</p><pre class="mt-3 overflow-x-auto rounded-lg bg-muted/30 p-3">---
name: cinematic-staging
description: 细化站位与动作
version: "1.0.0"
stages: [scene_detail]
---
保留原剧情和时长，明确动作过程。</pre><p class="mt-3">流程可填写 scene_detail 或 video_review。在线安装时可直接选择，无需改写作者文件。</p></details>
      </DialogContent>
    </Dialog>
    <SettingsConfirmDialog :open="!!removing" title="卸载技能" :description="`卸载「${removing?.name || ''}」并移除本机所有项目对它的选择。已生成内容和执行记录会保留。`" confirm-text="卸载" :busy="busy" :error="error" @update:open="value => { if (!value && !busy) removing = null }" @confirm="uninstall" />
  </div>
</template>

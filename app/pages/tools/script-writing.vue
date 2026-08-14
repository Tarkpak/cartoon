<script setup lang="ts">
import { ArrowUpRight, FilePlus2, Loader2, PenLine, Search, Trash2 } from 'lucide-vue-next'
import type { ScriptWritingPublication } from '#shared/types/script-writing'
import { createProjectDraft, type Project, type ProjectDraft, type ProjectListResponse } from '~/lib/projects-page'
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import { resolveProjectWorkbenchPath } from '#shared/types/project'
import {
  buildPublishedWritingEpisodePlan,
  clearParsedWorkflowForPublishedWriting
} from '~/lib/script-writing-project'
import { formatProjectRelativeTime } from '~/lib/projects-page'

definePageMeta({
  layout: 'default'
})

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const {
  projectId,
  projectName,
  writingStudio,
  novelText,
  projectAssetWorkflow,
  scenes,
  episodePlan,
  loading,
  saveError,
  saveWarning,
  saveProject,
  loadProject,
  finalVideo
} = useAssetWorkbench()

const projects = ref<Project[]>([])
const projectsLoading = ref(true)
const projectsError = ref('')
const selectedProjectId = ref('')
const loadedProjectId = ref('')
const switchingProject = ref(false)
const projectSearch = ref('')
const writingStudioRef = ref<{ saveCurrent: () => Promise<boolean> } | null>(null)
const showCreateDialog = ref(false)
const newProject = ref<ProjectDraft>(createProjectDraft())
const createStep = ref<'basic' | 'style'>('basic')
const creatingProject = ref(false)
const showDeleteDialog = ref(false)
const projectToDelete = ref<Project | null>(null)
const deletingProject = ref(false)

const selectedProject = computed(() => {
  return projects.value.find(project => project.id === selectedProjectId.value) || null
})
const pageLoading = computed(() => projectsLoading.value || switchingProject.value || loading.value)
const filteredProjects = computed(() => {
  const keyword = projectSearch.value.trim().toLocaleLowerCase()
  if (!keyword) return projects.value
  return projects.value.filter(project => {
    return `${project.title} ${project.description || ''}`.toLocaleLowerCase().includes(keyword)
  })
})

const showProjectList = computed(() => !queryProjectId() || route.query.list === '1')

function queryProjectId() {
  const value = route.query.project
  return typeof value === 'string' ? value : ''
}

function openProjectList() {
  return router.replace({ path: '/tools/script-writing', query: { list: '1' } })
}

async function saveCurrentStudio() {
  if (!loadedProjectId.value || switchingProject.value) return true
  const saved = await (writingStudioRef.value?.saveCurrent() || saveSelectedProject())
  if (!saved) toast.error('当前剧本未能保存，操作已取消')
  return saved
}

async function fetchProjects() {
  projectsLoading.value = true
  projectsError.value = ''
  try {
    const response = await $fetch<ProjectListResponse>('/api/project/list', {
      query: { page: 1, pageSize: 100, sortBy: 'updated', status: 'all', workspace: 'writing' }
    })
    projects.value = response.projects
    const requestedId = queryProjectId()
    const nextId = projects.value.some(project => project.id === requestedId)
      ? requestedId
      : projects.value[0]?.id || ''
    selectedProjectId.value = nextId
    if (nextId && !showProjectList.value) await switchProject(nextId, false)
  } catch (error) {
    console.error('[script-writing] 加载项目列表失败:', error)
    projectsError.value = '项目列表加载失败，请稍后重试'
  } finally {
    projectsLoading.value = false
  }
}

async function switchProject(nextProjectId: string, saveCurrent = true) {
  // Returning to the list keeps the loaded id for persistence, but selecting
  // that same project must still leave list mode and restore the editor.
  if (!nextProjectId || (nextProjectId === loadedProjectId.value && !showProjectList.value)) return
  switchingProject.value = true
  const previousProjectId = loadedProjectId.value
  try {
    // Unmount the previous editor before replacing its project-backed state.
    await nextTick()
    if (saveCurrent && previousProjectId) {
      const saved = await saveProject(previousProjectId)
      if (!saved) {
        selectedProjectId.value = previousProjectId
        toast.error('当前项目未能保存，已取消切换')
        return
      }
    }
    await router.replace({ path: '/tools/script-writing', query: { project: nextProjectId } })
    await loadProject(nextProjectId)
    loadedProjectId.value = nextProjectId
  } finally {
    switchingProject.value = false
  }
}

async function handleProjectSelection(value: unknown) {
  const nextProjectId = typeof value === 'string' ? value : ''
  if (!nextProjectId) return
  selectedProjectId.value = nextProjectId
  await switchProject(nextProjectId)
}

function saveSelectedProject() {
  return saveProject(loadedProjectId.value || projectId.value)
}

async function openCreateProjectDialog() {
  if (!(await saveCurrentStudio())) return
  newProject.value = createProjectDraft()
  createStep.value = 'basic'
  showCreateDialog.value = true
}

function goToStyleStep() {
  void createProject()
}

async function createProject() {
  if (!newProject.value.title.trim() || creatingProject.value) return
  creatingProject.value = true
  try {
    const response = await $fetch<{ success: boolean, project?: { id: string }, message?: string }>('/api/project/create', {
      method: 'POST',
      body: {
        title: newProject.value.title.trim(),
        description: newProject.value.description.trim() || undefined,
        projectType: 'script_writing',
      }
    })
    if (!response.success || !response.project?.id) throw new Error(response.message || '创建项目失败')
    showCreateDialog.value = false
    await fetchProjects()
    selectedProjectId.value = response.project.id
    await router.replace({ path: '/tools/script-writing', query: { project: response.project.id } })
    await loadProject(response.project.id)
    loadedProjectId.value = response.project.id
    writingStudio.value.brief.idea = newProject.value.idea.trim()
    writingStudio.value.brief.genre = newProject.value.genre.trim()
    writingStudio.value.brief.customGenre = newProject.value.customGenre.trim()
    writingStudio.value.brief.audience = newProject.value.audience.trim()
    writingStudio.value.brief.customAudience = newProject.value.customAudience.trim()
    writingStudio.value.brief.episodeCount = Math.max(1, Math.min(100, Number(newProject.value.episodeCount) || 8))
    writingStudio.value.brief.episodeDuration = Math.max(15, Math.min(1800, Number(newProject.value.episodeDuration) || 90))
    writingStudio.value.brief.requirements = newProject.value.requirements.trim()
    const saved = await saveSelectedProject()
    if (!saved) throw new Error('项目已创建，但创作简报保存失败')
    await loadProject(response.project.id)
    loadedProjectId.value = response.project.id
    toast.success('AI 剧本项目已创建')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '创建项目失败')
  } finally {
    creatingProject.value = false
  }
}

function confirmDeleteProject(project: Project, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  projectToDelete.value = project
  showDeleteDialog.value = true
}

async function deleteProject() {
  if (!projectToDelete.value || deletingProject.value) return
  deletingProject.value = true
  try {
    await $fetch(`/api/project/${projectToDelete.value.id}`, { method: 'DELETE' })
    const deletedId = projectToDelete.value.id
    showDeleteDialog.value = false
    projectToDelete.value = null
    await fetchProjects()
    if (loadedProjectId.value === deletedId) {
      loadedProjectId.value = ''
      await openProjectList()
    }
    toast.success('项目已删除')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '删除项目失败')
  } finally {
    deletingProject.value = false
  }
}

async function publishWriting(publication: ScriptWritingPublication) {
  const normalizedText = publication.text.trim()
  if (!normalizedText) {
    toast.warning('没有可发布的单集剧本')
    return
  }

  if (episodePlan.value.length > 0 || scenes.value.length > 0) {
    const confirmed = await useConfirm().confirm({
      title: '发布新的生产剧本',
      description: '该项目现有分集目录、场景和成片状态将被清空，创作草稿、版本历史、人物和素材仍会保留。',
      confirmText: '确认发布',
      variant: 'destructive'
    })
    if (!confirmed) return
  }

  const previousProductionState = {
    novelText: novelText.value,
    episodePlan: episodePlan.value,
    scenes: scenes.value,
    finalVideo: finalVideo.value,
    projectAssetWorkflow: projectAssetWorkflow.value
  }

  novelText.value = normalizedText
  episodePlan.value = buildPublishedWritingEpisodePlan(publication)
  scenes.value = []
  finalVideo.value = null
  projectAssetWorkflow.value = clearParsedWorkflowForPublishedWriting(projectAssetWorkflow.value)

  const saved = await saveSelectedProject()
  if (!saved) {
    novelText.value = previousProductionState.novelText
    episodePlan.value = previousProductionState.episodePlan
    scenes.value = previousProductionState.scenes
    finalVideo.value = previousProductionState.finalVideo
    projectAssetWorkflow.value = previousProductionState.projectAssetWorkflow
    toast.error('剧本发布失败，请检查项目保存状态')
    return
  }

  toast.success('剧本已发布', {
    description: `已保留 ${episodePlan.value.length} 集分集边界，正在进入剧本解析。`
  })
  await router.push(resolveProjectWorkbenchPath(loadedProjectId.value, 'parse'))
}

async function openWorkbench() {
  if (!loadedProjectId.value) return
  const saved = await (writingStudioRef.value?.saveCurrent() || saveSelectedProject())
  if (!saved) {
    toast.error('当前剧本未能保存，已取消进入解析')
    return
  }
  await router.push(resolveProjectWorkbenchPath(loadedProjectId.value, 'parse'))
}

onMounted(async () => {
  await fetchProjects()
  if (route.query.new === '1') await openCreateProjectDialog()
})

watch(
  () => [queryProjectId(), route.query.list === '1'] as const,
  ([nextProjectId, listMode]) => {
    if (listMode || !nextProjectId || nextProjectId === loadedProjectId.value || switchingProject.value) return
    if (!projects.value.some(project => project.id === nextProjectId)) return
    selectedProjectId.value = nextProjectId
    void switchProject(nextProjectId)
  }
)

onBeforeRouteUpdate(async (to) => {
  const nextProjectId = typeof to.query.project === 'string' ? to.query.project : ''
  const nextListMode = to.query.list === '1' || !nextProjectId
  if (nextListMode && loadedProjectId.value && !switchingProject.value) {
    return await saveCurrentStudio()
  }
  return true
})

onBeforeRouteLeave(async () => {
  if (!loadedProjectId.value || switchingProject.value) return true
  return await saveCurrentStudio()
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      v-if="showProjectList || !selectedProject"
      title="AI 剧本创作"
      description="从创意设定到可生产剧本，项目、版本和分集都保存在同一工作台。"
    >
      <template #actions>
        <Button
          variant="outline"
          class="gap-2 transition-transform active:scale-[0.96]"
          @click="openCreateProjectDialog"
        >
          <FilePlus2 class="h-4 w-4" />
          新建项目
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent
      class="h-full overflow-hidden"
      :padded="showProjectList || !selectedProject"
      inner-class="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div
        v-if="saveError"
        class="shrink-0 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
      >
        {{ saveError }}
      </div>
      <div
        v-if="saveWarning"
        class="shrink-0 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300"
      >
        {{ saveWarning }}
      </div>

      <div
        v-if="pageLoading"
        class="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
      >
        <Loader2 class="h-5 w-5 animate-spin" />
        <p class="text-sm">加载创作项目</p>
      </div>

      <div
        v-else-if="projectsError"
        class="flex min-h-64 flex-1 flex-col items-center justify-center text-center"
      >
        <p class="text-sm text-destructive">{{ projectsError }}</p>
        <Button variant="outline" class="mt-4" @click="fetchProjects">重新加载</Button>
      </div>

      <section
        v-else-if="showProjectList"
        class="min-h-0 flex-1 overflow-y-auto"
      >
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <div class="relative min-w-[16rem] max-w-md flex-1">
                <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  v-model="projectSearch"
                  class="h-10 border-0 bg-muted/40 pl-9 shadow-none focus-visible:ring-1"
                  placeholder="搜索项目名称或描述"
                  aria-label="搜索剧本项目"
                />
              </div>
              <span class="rounded-full bg-muted/40 px-3 py-1 text-xs tabular-nums text-muted-foreground">
                {{ filteredProjects.length }} 个项目
              </span>
            </div>
            <Button class="gap-2 shadow-sm sm:hidden" @click="openCreateProjectDialog">
              <FilePlus2 class="h-4 w-4" />
              新建剧本项目
            </Button>
          </div>

          <div
            v-if="filteredProjects.length"
            class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            <article
              v-for="project in filteredProjects"
              :key="project.id"
              role="button"
              tabindex="0"
              class="group relative flex min-h-[11.5rem] flex-col overflow-hidden rounded-2xl bg-muted/25 p-5 text-left transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-muted/40 hover:shadow-[0_12px_28px_hsl(var(--foreground)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="handleProjectSelection(project.id)"
              @keydown.enter="handleProjectSelection(project.id)"
              @keydown.space.prevent="handleProjectSelection(project.id)"
            >
              <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              <div class="flex items-start justify-between gap-3">
                <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <PenLine class="h-4 w-4" :stroke-width="1.75" />
                </span>
                <div class="flex items-center gap-1">
                  <span class="text-xs tabular-nums text-muted-foreground">
                    {{ formatProjectRelativeTime(project.updatedAt) }}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8 text-muted-foreground opacity-70 transition-opacity hover:text-destructive group-hover:opacity-100"
                    title="删除项目"
                    aria-label="删除项目"
                    @click.stop="confirmDeleteProject(project, $event)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <h3 class="mt-4 truncate text-base font-semibold tracking-tight text-foreground">
                {{ project.title }}
              </h3>
              <p class="mt-1.5 line-clamp-2 min-h-10 flex-1 text-sm leading-5 text-muted-foreground">
                {{ project.description || '还没有项目描述，打开后可继续故事圣经与分集创作。' }}
              </p>

              <div class="mt-4 flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-muted/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  {{ project.totalScenes ? `${project.totalScenes} 个场景` : '尚未解析' }}
                </span>
                <span
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="project.status === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : project.status === 'in_progress'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'"
                >
                  {{ project.status === 'completed' ? '已完成' : project.status === 'in_progress' ? '进行中' : '草稿' }}
                </span>
                <span class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  打开
                  <ArrowUpRight class="h-3.5 w-3.5" />
                </span>
              </div>
            </article>
          </div>

          <div
            v-else
            class="flex min-h-72 flex-col items-center justify-center rounded-2xl bg-muted/20 px-6 text-center"
          >
            <span class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <PenLine class="h-5 w-5" :stroke-width="1.5" />
            </span>
            <p class="text-base font-semibold text-foreground">
              {{ projectSearch ? '没有匹配的剧本项目' : '还没有 AI 剧本项目' }}
            </p>
            <p class="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
              {{ projectSearch
                ? '换个关键词试试，或直接创建一个新项目。'
                : '创建一个项目，开始整理创意、故事圣经和分集正文。' }}
            </p>
            <Button class="mt-5 gap-2" @click="openCreateProjectDialog">
              <FilePlus2 class="h-4 w-4" />
              新建剧本项目
            </Button>
          </div>
        </div>
      </section>

      <div
        v-else-if="!selectedProject"
        class="flex min-h-64 flex-1 flex-col items-center justify-center rounded-2xl bg-muted/20 px-6 text-center"
      >
        <span class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <PenLine class="h-5 w-5" :stroke-width="1.5" />
        </span>
        <p class="text-base font-semibold text-foreground">先创建一个项目</p>
        <p class="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
          剧本草稿与版本会保存在项目中，便于后续直接进入解析和视频生产。
        </p>
        <Button class="mt-5 gap-2 transition-transform active:scale-[0.96]" @click="openCreateProjectDialog">
          <FilePlus2 class="h-4 w-4" />
          新建项目
        </Button>
      </div>

      <div v-else class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <AssetWorkbenchWritingStudio
          ref="writingStudioRef"
          :key="loadedProjectId"
          v-model="writingStudio"
          :project-id="loadedProjectId"
          :document-title="projectName"
          :save-project="saveSelectedProject"
          :loading="pageLoading"
          @publish="publishWriting"
          @open-production="openWorkbench"
          @open-list="openProjectList"
        />
      </div>
    </AppPageContent>
    <ProjectDeleteDialog
      v-model:open="showDeleteDialog"
      :project-to-delete="projectToDelete"
      :deleting="deletingProject"
      @delete="deleteProject"
    />
    <ProjectCreateDialog
      v-model:open="showCreateDialog"
      workspace="writing"
      v-model:new-project="newProject"
      :create-step="createStep"
      :style-config-loading="false"
      :available-style-presets="[]"
      :available-style-categories="[]"
      :creating="creatingProject"
      :aspect-ratio-options="[]"
      :script-parse-mode-options="[]"
      @update:create-step="createStep = $event"
      @next-step="goToStyleStep"
      @create="createProject"
    />
  </AppPage>
</template>

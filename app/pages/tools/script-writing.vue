<script setup lang="ts">
import { FilePlus2, Loader2, PenLine } from 'lucide-vue-next'
import type { ScriptWritingPublication } from '#shared/types/script-writing'
import type { Project, ProjectListResponse } from '~/lib/projects-page'
import { resolveProjectWorkbenchPath } from '#shared/types/project'
import {
  buildPublishedWritingEpisodePlan,
  clearParsedWorkflowForPublishedWriting
} from '~/lib/script-writing-project'

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
const writingStudioRef = ref<{ saveCurrent: () => Promise<boolean> } | null>(null)

const selectedProject = computed(() => {
  return projects.value.find(project => project.id === selectedProjectId.value) || null
})
const pageLoading = computed(() => projectsLoading.value || switchingProject.value || loading.value)

function queryProjectId() {
  const value = route.query.project
  return typeof value === 'string' ? value : ''
}

async function fetchProjects() {
  projectsLoading.value = true
  projectsError.value = ''
  try {
    const response = await $fetch<ProjectListResponse>('/api/project/list', {
      query: { page: 1, pageSize: 100, sortBy: 'updated', status: 'all' }
    })
    projects.value = response.projects
    const requestedId = queryProjectId()
    const nextId = projects.value.some(project => project.id === requestedId)
      ? requestedId
      : projects.value[0]?.id || ''
    selectedProjectId.value = nextId
    if (nextId) await switchProject(nextId, false)
  } catch (error) {
    console.error('[script-writing] 加载项目列表失败:', error)
    projectsError.value = '项目列表加载失败，请稍后重试'
  } finally {
    projectsLoading.value = false
  }
}

async function switchProject(nextProjectId: string, saveCurrent = true) {
  if (!nextProjectId || nextProjectId === loadedProjectId.value) return
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

function createProject() {
  router.push({
    path: '/projects',
    query: { new: '1', returnTo: 'script-writing' }
  })
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

onMounted(fetchProjects)

watch(
  () => queryProjectId(),
  (nextProjectId) => {
    if (!nextProjectId || nextProjectId === loadedProjectId.value || switchingProject.value) return
    if (!projects.value.some(project => project.id === nextProjectId)) return
    selectedProjectId.value = nextProjectId
    void switchProject(nextProjectId)
  }
)

onBeforeRouteLeave(async () => {
  if (!loadedProjectId.value || switchingProject.value) return true
  const saved = await (writingStudioRef.value?.saveCurrent() || saveSelectedProject())
  if (!saved) toast.error('当前剧本未能保存，已阻止离开页面')
  return saved
})
</script>

<template>
  <AppPage>
    <AppPageHeader title="AI 剧本创作" description="按项目管理故事圣经、分集正文、审校结果和版本。">
      <template #actions>
        <Select :model-value="selectedProjectId" @update:model-value="handleProjectSelection">
          <SelectTrigger class="w-52" aria-label="选择创作项目">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.title }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" class="gap-2 transition-transform active:scale-[0.96]" @click="createProject">
          <FilePlus2 class="h-4 w-4" />新建项目
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col overflow-hidden">
      <div v-if="saveError" class="shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
        {{ saveError }}
      </div>
      <div v-if="saveWarning" class="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
        {{ saveWarning }}
      </div>

      <div v-if="pageLoading" class="flex min-h-64 flex-1 items-center justify-center text-muted-foreground">
        <Loader2 class="mr-2 h-5 w-5 animate-spin" />加载创作项目
      </div>

      <div v-else-if="projectsError" class="flex min-h-64 flex-1 flex-col items-center justify-center text-center">
        <p class="text-sm text-destructive">{{ projectsError }}</p>
        <Button variant="outline" class="mt-4" @click="fetchProjects">重新加载</Button>
      </div>

      <div v-else-if="!selectedProject" class="flex min-h-64 flex-1 flex-col items-center justify-center text-center text-muted-foreground">
        <PenLine class="mb-3 h-8 w-8" :stroke-width="1.5" />
        <p class="text-sm font-medium text-foreground">先创建一个项目</p>
        <p class="mt-1 text-sm">剧本草稿与版本会保存在项目中，便于后续直接进入解析和视频生产。</p>
        <Button class="mt-4 gap-2 transition-transform active:scale-[0.96]" @click="createProject"><FilePlus2 class="h-4 w-4" />新建项目</Button>
      </div>

      <AssetWorkbenchWritingStudio
        v-else
        ref="writingStudioRef"
        :key="loadedProjectId"
        v-model="writingStudio"
        :project-id="loadedProjectId"
        :document-title="projectName"
        :save-project="saveSelectedProject"
        :loading="pageLoading"
        @publish="publishWriting"
        @open-production="openWorkbench"
      />
    </AppPageContent>
  </AppPage>
</template>

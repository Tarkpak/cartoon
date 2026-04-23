import { useDebounceFn } from '@vueuse/core'
import type { StylePreset } from '#shared/types/styles'
import { resolveProjectWorkbenchPath } from '#shared/types/project'
import type { ProjectWorkflowType } from '#shared/types/project'
import {
  createProjectDraft,
  hasProjectStyle,
  projectAspectRatioOptions,
  projectPageSizeOptions,
  projectScriptParseModeOptions,
  projectStatusMap,
  resolveProjectCreateStyleId,
  type Project,
  type ProjectListResponse,
  type ProjectSortBy,
  type ProjectStatusFilter
} from '~/lib/projects-page'

export function useProjectsIndexPage() {
  const router = useRouter()
  const {
    presets: availableStylePresets,
    categories: availableStyleCategories,
    defaultStyleId,
    loading: styleConfigLoading,
    resolveStyleById,
    loadStylePresets
  } = useStylePresets()

  const projects = ref<Project[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  const searchKeyword = ref('')
  const statusFilter = ref<ProjectStatusFilter>('all')
  const sortBy = ref<ProjectSortBy>('updated')
  const currentPage = ref(1)
  const pageSize = ref(20)
  const totalProjects = ref(0)
  const pageSizeOptions = projectPageSizeOptions

  const showCreateDialog = ref(false)
  const newProject = ref(createProjectDraft())
  const creating = ref(false)
  const deleting = ref<string | null>(null)
  const showDeleteDialog = ref(false)
  const projectToDelete = ref<Project | null>(null)
  const createStep = ref<'basic' | 'style'>('basic')
  const aspectRatioOptions = projectAspectRatioOptions
  const scriptParseModeOptions = projectScriptParseModeOptions
  const statusMap = projectStatusMap
  const effectiveDefaultStyleId = computed(() => resolveDefaultStyleId())

  function resolveDefaultStyleId(): string {
    return defaultStyleId.value || availableStylePresets.value[0]?.id || ''
  }

  function resolveCreateStyleId(preferDefault = false): string {
    return resolveProjectCreateStyleId({
      currentStyleId: newProject.value.styleId,
      defaultStyleId: resolveDefaultStyleId(),
      availableStyleIds: availableStylePresets.value.map(style => style.id),
      preferDefault
    })
  }

  function hasAvailableStyle(styleId: string): boolean {
    return hasProjectStyle(styleId, availableStylePresets.value.map(style => style.id))
  }

  function ensureCreateStyleId(preferDefault = false): string {
    if (!preferDefault && hasAvailableStyle(newProject.value.styleId)) {
      return newProject.value.styleId
    }

    const resolved = resolveCreateStyleId(preferDefault)
    newProject.value.styleId = resolved
    return resolved
  }

  async function fetchProjects(targetPage = currentPage.value) {
    loading.value = true
    error.value = null
    try {
      const normalizedPage = Math.max(1, targetPage)
      const keyword = searchKeyword.value.trim()
      const data = await $fetch<ProjectListResponse>('/api/project/list', {
        query: {
          page: normalizedPage,
          pageSize: pageSize.value,
          status: statusFilter.value,
          sortBy: sortBy.value,
          keyword: keyword || undefined
        }
      })
      projects.value = data.projects
      currentPage.value = data.pagination?.page ?? normalizedPage
      totalProjects.value = data.pagination?.total ?? data.projects.length
    } catch (fetchProjectError) {
      error.value = '获取项目列表失败'
      console.error(fetchProjectError)
    } finally {
      loading.value = false
    }
  }

  async function createProject() {
    if (!newProject.value.title.trim()) return

    const styleId = ensureCreateStyleId(false)
    if (!styleId) return

    creating.value = true
    try {
      const selectedWorkflowType = newProject.value.workflowType
      const response = await $fetch<{
        success: boolean
        project: {
          id: string
          workflowType?: ProjectWorkflowType
        }
      }>('/api/project/create', {
        method: 'POST',
        body: {
          title: newProject.value.title,
          description: newProject.value.description || undefined,
          workflowType: newProject.value.workflowType,
          scriptParseMode: newProject.value.scriptParseMode,
          styleId,
          aspectRatio: newProject.value.aspectRatio
        }
      })
      showCreateDialog.value = false
      createStep.value = 'basic'
      newProject.value = createProjectDraft(ensureCreateStyleId(true))

      const createdId = response?.project?.id
      if (createdId) {
        const workflowType = response.project.workflowType || selectedWorkflowType
        await router.push(resolveProjectWorkbenchPath(createdId, workflowType))
        return
      }

      await fetchProjects(1)
    } catch (createProjectError) {
      console.error('创建项目失败:', createProjectError)
    } finally {
      creating.value = false
    }
  }

  async function openCreateDialog() {
    await loadStylePresets(true)

    newProject.value = createProjectDraft(ensureCreateStyleId(true))
    createStep.value = 'basic'
    showCreateDialog.value = true
  }

  function goToStyleStep() {
    ensureCreateStyleId(false)
    createStep.value = 'style'
  }

  function handleStyleSelect(style: StylePreset) {
    newProject.value.styleId = style.id
  }

  function getStyleName(styleId: string): string {
    const style = resolveStyleById(styleId)
    return style?.name || styleId
  }

  function openProject(project: Project) {
    router.push(resolveProjectWorkbenchPath(project.id, project.workflowType))
  }

  async function deleteProject() {
    if (!projectToDelete.value) return

    deleting.value = projectToDelete.value.id
    try {
      await $fetch(`/api/project/${projectToDelete.value.id}`, {
        method: 'DELETE'
      })
      showDeleteDialog.value = false
      projectToDelete.value = null
      await fetchProjects(currentPage.value)
    } catch (deleteProjectError) {
      console.error('删除项目失败:', deleteProjectError)
      alert('删除失败，请重试')
    } finally {
      deleting.value = null
    }
  }

  function confirmDelete(project: Project, event: Event) {
    event.preventDefault()
    event.stopPropagation()
    projectToDelete.value = project
    showDeleteDialog.value = true
  }

  const totalPages = computed(() => Math.max(1, Math.ceil(totalProjects.value / pageSize.value)))
  const hasActiveFilters = computed(() => {
    return searchKeyword.value.trim().length > 0 || statusFilter.value !== 'all'
  })

  function goToPage(page: number) {
    const nextPage = Math.min(totalPages.value, Math.max(1, page))
    if (nextPage === currentPage.value && projects.value.length > 0) return
    void fetchProjects(nextPage)
  }

  function handlePageSizeChange(value: unknown) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    pageSize.value = parsed
  }

  const debouncedRefreshFirstPage = useDebounceFn(() => {
    currentPage.value = 1
    void fetchProjects(1)
  }, 300)

  onMounted(async () => {
    await Promise.all([
      fetchProjects(),
      loadStylePresets()
    ])

    if (!newProject.value.styleId) {
      ensureCreateStyleId(true)
    }
  })

  watch([defaultStyleId, availableStylePresets], () => {
    if (!showCreateDialog.value) return
    if (createStep.value !== 'style') return
    if (!hasAvailableStyle(newProject.value.styleId)) {
      ensureCreateStyleId(true)
    }
  })

  watch(searchKeyword, () => {
    debouncedRefreshFirstPage()
  })

  watch([statusFilter, sortBy, pageSize], () => {
    currentPage.value = 1
    void fetchProjects(1)
  })

  return {
    availableStylePresets,
    availableStyleCategories,
    styleConfigLoading,
    effectiveDefaultStyleId,
    projects,
    loading,
    error,
    searchKeyword,
    statusFilter,
    sortBy,
    currentPage,
    pageSize,
    totalProjects,
    pageSizeOptions,
    showCreateDialog,
    newProject,
    creating,
    deleting,
    showDeleteDialog,
    projectToDelete,
    aspectRatioOptions,
    scriptParseModeOptions,
    createStep,
    totalPages,
    hasActiveFilters,
    statusMap,
    fetchProjects,
    createProject,
    openCreateDialog,
    goToStyleStep,
    handleStyleSelect,
    getStyleName,
    openProject,
    deleteProject,
    confirmDelete,
    goToPage,
    handlePageSizeChange
  }
}

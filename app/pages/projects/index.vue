<script setup lang="ts">
import { ArrowRight, Clapperboard, Plus } from 'lucide-vue-next'
import type { Project } from '~/lib/projects-page'
import ProjectSyncConflictDialog from '@/components/projects/ProjectSyncConflictDialog.vue'
import { projectAspectRatioOptions } from '~/lib/projects-page'
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import ProjectMembersDialog from '@/components/projects/ProjectMembersDialog.vue'
import ProjectsFiltersBar from '@/components/projects/ProjectsFiltersBar.vue'
import ProjectsTable from '@/components/projects/ProjectsTable.vue'
import ProjectsGrid from '@/components/projects/ProjectsGrid.vue'
import ProjectsPagination from '@/components/projects/ProjectsPagination.vue'
import {
  PROJECT_VIEW_MODE_STORAGE_KEY,
  projectLastOpenedStorageKey,
  resolveProjectProgress,
  type ProjectViewMode
} from '~/lib/projects-page'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

// 我的项目页面
definePageMeta({
  layout: 'default'
})

const {
  availableStylePresets,
  availableStyleCategories,
  styleConfigLoading,
  effectiveDefaultStyleId,
  projects,
  fetchProjects,
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
  createStep,
  scriptParseModeOptions,
  totalPages,
  hasActiveFilters,
  isWritingWorkspace,
  openCreateDialog,
  createProject,
  goToStyleStep,
  handleStyleSelect,
  getStyleName,
  openProject,
  deleteProject,
  confirmDelete,
  goToPage,
  handlePageSizeChange
} = useProjectsIndexPage()

const aspectRatioOptions = projectAspectRatioOptions
const { currentUser } = useCloudAdmin()
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const isWritingProject = isWritingWorkspace
const conflictDialogOpen = ref(false)
const conflictProject = ref<Project | null>(null)
function openSyncConflict(project: Project) {
  conflictProject.value = project
  conflictDialogOpen.value = true
}

const projectMembersDialogOpen = ref(false)
const projectMembersProjectId = ref('')

function openProjectMembers(project: { id: string }) {
  projectMembersProjectId.value = project.id
  projectMembersDialogOpen.value = true
}

// Card view by default; remembered per device.
function readViewMode(): ProjectViewMode {
  try {
    return window.localStorage.getItem(PROJECT_VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}
const viewMode = ref<ProjectViewMode>(typeof window === 'undefined' ? 'grid' : readViewMode())
watch(viewMode, (mode) => {
  try {
    window.localStorage.setItem(PROJECT_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // Not critical: the choice just isn't remembered.
  }
})

// "Continue" shows the last opened project when it is on the first, unfiltered page.
const lastOpenedProjectId = ref<string | null>(null)
watch(() => currentUser.value?.id, () => {
  const key = projectLastOpenedStorageKey(currentUser.value?.id)
  try {
    lastOpenedProjectId.value = key ? window.localStorage.getItem(key) : null
  } catch {
    lastOpenedProjectId.value = null
  }
}, { immediate: true })
const continueProject = computed(() => {
  if (!lastOpenedProjectId.value || currentPage.value !== 1 || hasActiveFilters.value) return null
  return projects.value.find(project => project.id === lastOpenedProjectId.value) || null
})

const pageDescription = computed(() => {
  if (isWritingProject.value) return '创建并管理 AI 剧本创作项目'
  const scope = isAdmin.value ? '包含所有成员的项目' : '自己创建和他人共享给你的项目'
  return totalProjects.value > 0 ? `共 ${totalProjects.value} 个 · ${scope}` : scope
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      :title="isWritingProject ? 'AI 剧本项目' : '我的项目'"
      :description="pageDescription"
    >
      <template #actions>
        <Button
          class="gap-2"
          @click="openCreateDialog"
        >
          <Plus class="h-4 w-4" />
          {{ isWritingProject ? '新建 AI 剧本项目' : '新建视频项目' }}
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <!-- Continue where you left off -->
      <button
        v-if="continueProject"
        type="button"
        class="group flex shrink-0 items-center gap-4 rounded-xl bg-primary/[0.06] p-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="openProject(continueProject)"
      >
        <div class="flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          <LazyImage
            v-if="continueProject.coverImage"
            :image="continueProject.coverImage"
            :alt="`${continueProject.title} 封面`"
            class="h-full w-full object-cover"
            placeholder-class="bg-muted"
          />
          <Clapperboard
            v-else
            class="h-6 w-6 text-muted-foreground/50"
          />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-primary">
            继续上次的项目
          </p>
          <p class="mt-0.5 truncate text-base font-semibold">
            {{ continueProject.title }}
          </p>
          <p class="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {{ resolveProjectProgress(continueProject).label }}
          </p>
        </div>
        <span class="mr-2 inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary">
          继续
          <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>

      <ProjectsFiltersBar
        v-model:search-keyword="searchKeyword"
        v-model:status-filter="statusFilter"
        v-model:sort-by="sortBy"
        v-model:view-mode="viewMode"
        class="shrink-0"
      />

      <div class="min-h-0 flex-1 overflow-y-auto pb-2">
        <!-- Narrow windows always use cards; the table needs room. -->
        <ProjectsGrid
          :class="viewMode === 'list' ? 'lg:hidden' : ''"
          :projects="projects"
          :loading="loading"
          :error="error"
          :has-active-filters="hasActiveFilters"
          :get-style-name="getStyleName"
          @open-create="openCreateDialog"
          @open-project="openProject"
          @manage-members="openProjectMembers"
          @resolve-sync-conflict="openSyncConflict"
          @confirm-delete="confirmDelete"
        />
        <ProjectsTable
          v-if="viewMode === 'list'"
          class="hidden lg:block"
          :projects="projects"
          :loading="loading"
          :error="error"
          :has-active-filters="hasActiveFilters"
          :get-style-name="getStyleName"
          @open-create="openCreateDialog"
          @open-project="openProject"
          @manage-members="openProjectMembers"
          @resolve-sync-conflict="openSyncConflict"
          @confirm-delete="confirmDelete"
        />
        <ProjectsPagination
          :current-page="currentPage"
          :total-pages="totalPages"
          :total-projects="totalProjects"
          :page-size="pageSize"
          :page-size-options="pageSizeOptions"
          :loading="loading"
          @page-change="goToPage"
          @page-size-change="handlePageSizeChange"
        />
      </div>
    </AppPageContent>

    <ProjectSyncConflictDialog
      v-model:open="conflictDialogOpen"
      :project="conflictProject"
      @resolved="fetchProjects()"
    />

    <ProjectDeleteDialog
      v-model:open="showDeleteDialog"
      :project-to-delete="projectToDelete"
      :deleting="!!deleting"
      @delete="deleteProject"
    />

    <ProjectCreateDialog
      v-model:open="showCreateDialog"
      v-model:new-project="newProject"
      :create-step="createStep"
      :style-config-loading="styleConfigLoading"
      :available-style-presets="availableStylePresets"
      :available-style-categories="availableStyleCategories"
      :default-style-id="effectiveDefaultStyleId"
      :creating="creating"
      :aspect-ratio-options="aspectRatioOptions"
      :script-parse-mode-options="scriptParseModeOptions"
      @update:create-step="createStep = $event"
      @select-style="handleStyleSelect"
      @next-step="goToStyleStep"
      @create="createProject"
    />

    <ProjectMembersDialog
      v-if="projectMembersProjectId"
      v-model:open="projectMembersDialogOpen"
      :project-id="projectMembersProjectId"
    />
  </AppPage>
</template>

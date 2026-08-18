<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { projectAspectRatioOptions } from '~/lib/projects-page'
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import ProjectMembersDialog from '@/components/projects/ProjectMembersDialog.vue'
import ProjectsFiltersBar from '@/components/projects/ProjectsFiltersBar.vue'
import ProjectsTable from '@/components/projects/ProjectsTable.vue'
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
  statusMap,
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
const projectMembersDialogOpen = ref(false)
const projectMembersProjectId = ref('')

function openProjectMembers(project: { id: string }) {
  projectMembersProjectId.value = project.id
  projectMembersDialogOpen.value = true
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      :title="isWritingProject ? 'AI 剧本项目' : (isAdmin ? '全部项目' : '我的项目与协作')"
      :description="isWritingProject ? '创建并管理 AI 剧本创作项目' : (isAdmin ? '管理所有成员创建的项目' : '管理自己创建及其他成员共享的项目')"
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

    <AppPageContent inner-class="flex h-full min-h-0 flex-col overflow-hidden">
      <ProjectsFiltersBar
        class="shrink-0"
        v-model:search-keyword="searchKeyword"
        v-model:status-filter="statusFilter"
        v-model:sort-by="sortBy"
        :projects-count="projects.length"
        :total-projects="totalProjects"
      />

      <ProjectsTable
        class="min-h-0 flex-1"
        :projects="projects"
        :loading="loading"
        :error="error"
        :current-page="currentPage"
        :total-pages="totalPages"
        :total-projects="totalProjects"
        :page-size="pageSize"
        :page-size-options="pageSizeOptions"
        :has-active-filters="hasActiveFilters"
        :status-map="statusMap"
        :get-style-name="getStyleName"
        @open-create="openCreateDialog"
        @open-project="openProject"
        @manage-members="openProjectMembers"
        @confirm-delete="confirmDelete"
        @page-change="goToPage"
        @page-size-change="handlePageSizeChange"
      />
    </AppPageContent>

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
    >
    </ProjectCreateDialog>

    <ProjectMembersDialog
      v-if="projectMembersProjectId"
      v-model:open="projectMembersDialogOpen"
      :project-id="projectMembersProjectId"
    />
  </AppPage>
</template>

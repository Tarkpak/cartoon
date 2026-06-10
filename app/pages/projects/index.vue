<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { projectAspectRatioOptions } from '~/lib/projects-page'
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import ProjectsFiltersBar from '@/components/projects/ProjectsFiltersBar.vue'
import ProjectsTable from '@/components/projects/ProjectsTable.vue'

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
</script>

<template>
  <div class="p-4 md:p-6">
    <ProjectsFiltersBar
      v-model:search-keyword="searchKeyword"
      v-model:status-filter="statusFilter"
      v-model:sort-by="sortBy"
      :projects-count="projects.length"
      :total-projects="totalProjects"
    >
      <template #actions>
        <Button
          class="w-full gap-2 lg:w-auto"
          @click="openCreateDialog"
        >
          <Plus class="h-4 w-4" />
          新建项目
        </Button>
      </template>
    </ProjectsFiltersBar>

    <ProjectsTable
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
      @confirm-delete="confirmDelete"
      @page-change="goToPage"
      @page-size-change="handlePageSizeChange"
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
  </div>
</template>

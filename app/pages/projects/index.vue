<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { projectAspectRatioOptions } from '~/lib/projects-page'
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import ProjectsFiltersBar from '@/components/projects/ProjectsFiltersBar.vue'
import ProjectsTable from '@/components/projects/ProjectsTable.vue'

// 项目管理页面
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
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">
          项目管理
        </h1>
        <p class="text-muted-foreground">
          管理您的AI影视项目
        </p>
      </div>
      <Button
        size="lg"
        @click="openCreateDialog"
      >
        <Plus class="mr-2 h-5 w-5" />
        新建项目
      </Button>
    </div>

    <ProjectsFiltersBar
      v-model:search-keyword="searchKeyword"
      v-model:status-filter="statusFilter"
      v-model:sort-by="sortBy"
      :projects-count="projects.length"
      :total-projects="totalProjects"
    />

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

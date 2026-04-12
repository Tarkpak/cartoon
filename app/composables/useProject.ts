/**
 * 项目管理 Composable
 * 提供项目的 CRUD 操作
 */

export interface Project {
  id: string
  title: string
  description: string
  workflowType: 'classic' | 'asset_consistency'
  styleId: string // 风格预设 ID
  aspectRatio: '16:9' | '9:16' | '1:1' // 视频比例
  status: 'draft' | 'active' | 'completed'
  totalScenes: number
  completedScenes: number
  totalDuration: number
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  title: string
  description?: string
  workflowType?: 'classic' | 'asset_consistency'
  styleId: string // 必填
  aspectRatio: '16:9' | '9:16' | '1:1' // 必填
}

export interface UpdateProjectInput {
  title?: string
  description?: string
  workflowType?: 'classic' | 'asset_consistency'
  styleId?: string
  aspectRatio?: '16:9' | '9:16' | '1:1'
  status?: Project['status']
}

export function useProject() {
  const projects = ref<Project[]>([])
  const currentProject = ref<Project | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 获取项目列表
   */
  async function fetchProjects() {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ projects: Project[] }>('/api/project/list')
      projects.value = data.projects
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取项目列表失败'
      console.error('[useProject] fetchProjects error:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取单个项目
   */
  async function fetchProject(id: string) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ project: Project }>(`/api/project/${id}`)
      currentProject.value = data.project
      return data.project
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取项目失败'
      console.error('[useProject] fetchProject error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建项目
   */
  async function createProject(input: CreateProjectInput) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ project: Project }>('/api/project/create', {
        method: 'POST',
        body: input
      })
      projects.value.unshift(data.project)
      return data.project
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建项目失败'
      console.error('[useProject] createProject error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新项目
   */
  async function updateProject(id: string, input: UpdateProjectInput) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ project: Project }>(`/api/project/${id}`, {
        method: 'PATCH',
        body: input
      })
      // 更新列表中的项目
      const index = projects.value.findIndex(p => p.id === id)
      if (index !== -1) {
        projects.value[index] = data.project
      }
      // 更新当前项目
      if (currentProject.value?.id === id) {
        currentProject.value = data.project
      }
      return data.project
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新项目失败'
      console.error('[useProject] updateProject error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 删除项目
   */
  async function deleteProject(id: string) {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/project/${id}`, {
        method: 'DELETE'
      })
      // 从列表中移除
      projects.value = projects.value.filter(p => p.id !== id)
      // 清除当前项目
      if (currentProject.value?.id === id) {
        currentProject.value = null
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除项目失败'
      console.error('[useProject] deleteProject error:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  return {
    // 状态
    projects,
    currentProject,
    loading,
    error,
    // 方法
    fetchProjects,
    fetchProject,
    createProject,
    updateProject,
    deleteProject
  }
}

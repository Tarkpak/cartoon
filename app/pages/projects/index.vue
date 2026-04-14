<script setup lang="ts">
import { Plus, Video, Search, Loader2, Trash2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { StylePreset } from '#shared/types/styles'
import {
  PROJECT_WORKFLOW_LABELS,
  PROJECT_WORKFLOW_DESCRIPTIONS,
  type ProjectWorkflowType,
  resolveProjectWorkbenchPath
} from '#shared/types/project'
import StyleSelector from '@/components/StyleSelector.vue'

// 项目管理页面
definePageMeta({
  layout: 'default'
})

const router = useRouter()
const {
  presets: availableStylePresets,
  categories: availableStyleCategories,
  defaultStyleId,
  loading: styleConfigLoading,
  resolveStyleById,
  loadStylePresets
} = useStylePresets()

interface Project {
  id: string
  title: string
  description: string | null
  workflowType: ProjectWorkflowType
  styleId: string
  aspectRatio: string
  status: string | null
  totalScenes: number
  createdAt: string
  updatedAt: string
}

const projects = ref<Project[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const searchKeyword = ref('')
const statusFilter = ref<'all' | 'in_progress' | 'completed' | 'draft'>('all')
const sortBy = ref<'updated' | 'created' | 'name'>('updated')

// 新建项目对话框
const showCreateDialog = ref(false)
const newProject = ref({
  title: '',
  description: '',
  workflowType: 'asset_consistency' as ProjectWorkflowType,
  styleId: '',
  aspectRatio: '9:16' as '16:9' | '9:16' | '1:1'
})
const creating = ref(false)
const deleting = ref<string | null>(null)
const showDeleteDialog = ref(false)
const projectToDelete = ref<Project | null>(null)

// 视频比例选项
const aspectRatioOptions = [
  { value: '16:9', label: '16:9 横屏', description: '适合电脑/电视' },
  { value: '9:16', label: '9:16 竖屏', description: '适合手机/短视频' },
  { value: '1:1', label: '1:1 方形', description: '适合社交媒体' }
]

const workflowOptions = [
  {
    value: 'asset_consistency' as ProjectWorkflowType,
    label: PROJECT_WORKFLOW_LABELS.asset_consistency,
    description: PROJECT_WORKFLOW_DESCRIPTIONS.asset_consistency
  },
  {
    value: 'classic' as ProjectWorkflowType,
    label: PROJECT_WORKFLOW_LABELS.classic,
    description: PROJECT_WORKFLOW_DESCRIPTIONS.classic
  }
]

function resolveDefaultStyleId(): string {
  return defaultStyleId.value || availableStylePresets.value[0]?.id || ''
}

function resolveCreateStyleId(preferDefault = false): string {
  const availableIds = new Set(availableStylePresets.value.map(style => style.id))
  if (availableIds.size === 0) return ''

  const preferredDefaultId = resolveDefaultStyleId()
  if (preferDefault && preferredDefaultId && availableIds.has(preferredDefaultId)) {
    return preferredDefaultId
  }

  if (newProject.value.styleId && availableIds.has(newProject.value.styleId)) {
    return newProject.value.styleId
  }

  if (preferredDefaultId && availableIds.has(preferredDefaultId)) {
    return preferredDefaultId
  }

  return availableStylePresets.value[0]?.id || ''
}

function hasAvailableStyle(styleId: string): boolean {
  if (!styleId) return false
  return availableStylePresets.value.some(style => style.id === styleId)
}

function ensureCreateStyleId(preferDefault = false): string {
  if (!preferDefault && hasAvailableStyle(newProject.value.styleId)) {
    return newProject.value.styleId
  }

  const resolved = resolveCreateStyleId(preferDefault)
  newProject.value.styleId = resolved
  return resolved
}

// 获取项目列表
async function fetchProjects() {
  loading.value = true
  error.value = null
  try {
    const data = await $fetch<{ success: boolean, projects: Project[] }>('/api/project/list')
    projects.value = data.projects
  } catch (e) {
    error.value = '获取项目列表失败'
    console.error(e)
  } finally {
    loading.value = false
  }
}

// 创建项目步骤
const createStep = ref<'basic' | 'style'>('basic')

// 创建项目
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
        styleId,
        aspectRatio: newProject.value.aspectRatio
      }
    })
    showCreateDialog.value = false
    createStep.value = 'basic'
    newProject.value = {
      title: '',
      description: '',
      workflowType: 'asset_consistency',
      styleId: ensureCreateStyleId(true),
      aspectRatio: '9:16'
    }

    const createdId = response?.project?.id
    if (createdId) {
      const workflowType = response.project.workflowType || selectedWorkflowType
      await router.push(resolveProjectWorkbenchPath(createdId, workflowType))
      return
    }

    await fetchProjects()
  } catch (e) {
    console.error('创建项目失败:', e)
  } finally {
    creating.value = false
  }
}

// 打开新建对话框
async function openCreateDialog() {
  await loadStylePresets(true)

  newProject.value = {
    title: '',
    description: '',
    workflowType: 'asset_consistency',
    styleId: ensureCreateStyleId(true),
    aspectRatio: '9:16'
  }
  createStep.value = 'basic'
  showCreateDialog.value = true
}

function goToStyleStep() {
  ensureCreateStyleId(false)
  createStep.value = 'style'
}

// 处理风格选择
function handleStyleSelect(style: StylePreset) {
  newProject.value.styleId = style.id
}

// 获取风格名称
function getStyleName(styleId: string): string {
  const style = resolveStyleById(styleId)
  return style?.name || styleId
}

function getWorkflowName(workflowType: ProjectWorkflowType): string {
  return PROJECT_WORKFLOW_LABELS[workflowType] || PROJECT_WORKFLOW_LABELS.classic
}

function openProject(project: Project) {
  router.push(resolveProjectWorkbenchPath(project.id, project.workflowType))
}

// 格式化时间
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return date.toLocaleDateString()
}

// 删除项目
async function deleteProject() {
  if (!projectToDelete.value) return

  deleting.value = projectToDelete.value.id
  try {
    await $fetch(`/api/project/${projectToDelete.value.id}`, {
      method: 'DELETE'
    })
    showDeleteDialog.value = false
    projectToDelete.value = null
    await fetchProjects()
  } catch (e) {
    console.error('删除项目失败:', e)
    alert('删除失败，请重试')
  } finally {
    deleting.value = null
  }
}

// 打开删除确认对话框
function confirmDelete(project: Project, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  projectToDelete.value = project
  showDeleteDialog.value = true
}

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

const statusMap: Record<string, { label: string, variant: 'default' | 'secondary' | 'success' | 'warning' }> = {
  in_progress: { label: '进行中', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' }
}

const filteredProjects = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  const withFilter = projects.value.filter((project) => {
    const statusOk = statusFilter.value === 'all' || (project.status || 'draft') === statusFilter.value
    if (!statusOk) return false
    if (!keyword) return true

    const styleName = getStyleName(project.styleId).toLowerCase()
    return [
      project.title,
      project.description || '',
      getWorkflowName(project.workflowType),
      styleName
    ].some(text => text.toLowerCase().includes(keyword))
  })

  return withFilter.sort((a, b) => {
    if (sortBy.value === 'name') {
      return a.title.localeCompare(b.title, 'zh-CN')
    }
    if (sortBy.value === 'created') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
})
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
        <Plus class="w-5 h-5 mr-2" />
        新建项目
      </Button>
    </div>

    <!-- 搜索和筛选 -->
    <Card class="mb-6">
      <CardContent class="pt-6">
        <div class="flex flex-wrap gap-4">
          <div class="flex-1 min-w-[200px] relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              v-model="searchKeyword"
              class="pl-10"
              placeholder="搜索项目..."
            />
          </div>
          <Select
            v-model="statusFilter"
          >
            <SelectTrigger class="h-10 min-w-[130px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                全部状态
              </SelectItem>
              <SelectItem value="in_progress">
                进行中
              </SelectItem>
              <SelectItem value="completed">
                已完成
              </SelectItem>
              <SelectItem value="draft">
                草稿
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            v-model="sortBy"
          >
            <SelectTrigger class="h-10 min-w-[130px]">
              <SelectValue placeholder="最近更新" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">
                最近更新
              </SelectItem>
              <SelectItem value="created">
                创建时间
              </SelectItem>
              <SelectItem value="name">
                名称排序
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-12"
    >
      <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
    </div>

    <!-- 错误状态 -->
    <div
      v-else-if="error"
      class="text-center py-12 text-destructive"
    >
      {{ error }}
    </div>

    <!-- 项目列表 - 表格展示 -->
    <Card v-else>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-[250px]">
              项目名称
            </TableHead>
            <TableHead>描述</TableHead>
            <TableHead class="w-[150px]">
              工作流
            </TableHead>
            <TableHead class="w-[100px]">
              画风
            </TableHead>
            <TableHead class="w-[80px]">
              比例
            </TableHead>
            <TableHead class="w-[80px]">
              场景数
            </TableHead>
            <TableHead class="w-[80px]">
              状态
            </TableHead>
            <TableHead class="w-[120px]">
              更新时间
            </TableHead>
            <TableHead class="w-[80px] text-right">
              操作
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="project in filteredProjects"
            :key="project.id"
            class="cursor-pointer hover:bg-muted/50"
            @click="openProject(project)"
          >
            <TableCell class="font-medium">
              {{ project.title }}
            </TableCell>
            <TableCell class="text-muted-foreground max-w-[300px] truncate">
              {{ project.description || '暂无描述' }}
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                class="text-xs"
              >
                {{ getWorkflowName(project.workflowType) }}
              </Badge>
            </TableCell>
            <TableCell>
              <span class="text-sm">{{ getStyleName(project.styleId) }}</span>
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {{ project.aspectRatio }}
              </Badge>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <Video class="w-3.5 h-3.5 text-muted-foreground" />
                <span>{{ project.totalScenes }}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="statusMap[project.status || 'draft']?.variant || 'secondary'">
                {{ statusMap[project.status || 'draft']?.label || '草稿' }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground text-sm">
              {{ formatTime(project.updatedAt) }}
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-destructive"
                @click="confirmDelete(project, $event)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </TableCell>
          </TableRow>
          <!-- 空状态 -->
          <TableRow v-if="filteredProjects.length === 0">
            <TableCell
              :colspan="9"
              class="h-32 text-center"
            >
              <div class="flex flex-col items-center justify-center text-muted-foreground">
                <Video class="w-10 h-10 mb-2 opacity-50" />
                <p>{{ projects.length === 0 ? '暂无项目' : '没有匹配结果' }}</p>
                <Button
                  v-if="projects.length === 0"
                  variant="link"
                  class="mt-2"
                  @click="openCreateDialog"
                >
                  创建第一个项目
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- 删除确认对话框 -->
    <Dialog v-model:open="showDeleteDialog">
      <DialogContent class="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除项目「{{ projectToDelete?.title }}」吗？此操作不可撤销，所有相关数据将被永久删除。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            @click="showDeleteDialog = false"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            :disabled="!!deleting"
            @click="deleteProject"
          >
            <Loader2
              v-if="deleting"
              class="w-4 h-4 mr-2 animate-spin"
            />
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 新建项目对话框 -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            {{ createStep === 'basic' ? '填写项目信息并选择工作流' : '选择画风预设' }}
          </DialogDescription>
        </DialogHeader>

        <!-- 步骤 1: 基本信息 -->
        <div
          v-if="createStep === 'basic'"
          class="grid gap-4 py-4"
        >
          <div class="grid gap-2">
            <label class="text-sm font-medium">项目名称 <span class="text-destructive">*</span></label>
            <Input
              v-model="newProject.title"
              placeholder="输入项目名称..."
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">项目描述 (可选)</label>
            <Textarea
              v-model="newProject.description"
              placeholder="简单描述你的项目..."
              rows="2"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">视频比例 <span class="text-destructive">*</span></label>
            <div class="grid grid-cols-3 gap-2">
              <Button
                v-for="option in aspectRatioOptions"
                :key="option.value"
                type="button"
                variant="ghost"
                class="h-auto whitespace-normal p-3 rounded-md border text-center transition"
                :class="newProject.aspectRatio === option.value ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/50'"
                @click="newProject.aspectRatio = option.value as '16:9' | '9:16' | '1:1'"
              >
                <div class="font-medium text-sm">
                  {{ option.label }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ option.description }}
                </div>
              </Button>
            </div>
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">工作流模式 <span class="text-destructive">*</span></label>
            <div class="grid gap-2">
              <Button
                v-for="option in workflowOptions"
                :key="option.value"
                type="button"
                variant="ghost"
                class="h-auto whitespace-normal rounded-md border p-3 text-left transition"
                :class="newProject.workflowType === option.value ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/50'"
                @click="newProject.workflowType = option.value"
              >
                <div class="font-medium text-sm">
                  {{ option.label }}
                </div>
                <div class="text-xs text-muted-foreground mt-1">
                  {{ option.description }}
                </div>
              </Button>
            </div>
          </div>
        </div>

        <!-- 步骤 2: 选择画风 -->
        <div
          v-else
          class="flex-1 overflow-y-auto py-4 min-h-[400px]"
        >
          <div
            v-if="styleConfigLoading && availableStylePresets.length === 0"
            class="h-full flex items-center justify-center text-muted-foreground text-sm"
          >
            <Loader2 class="w-4 h-4 mr-2 animate-spin" />
            加载画风配置中...
          </div>
          <StyleSelector
            v-else
            v-model="newProject.styleId"
            :show-search="true"
            :styles="availableStylePresets"
            :categories="availableStyleCategories"
            @select="handleStyleSelect"
          />
        </div>

        <DialogFooter class="flex-shrink-0">
          <Button
            v-if="createStep === 'style'"
            variant="outline"
            @click="createStep = 'basic'"
          >
            上一步
          </Button>
          <Button
            v-else
            variant="outline"
            @click="showCreateDialog = false"
          >
            取消
          </Button>
          <Button
            v-if="createStep === 'basic'"
            :disabled="!newProject.title.trim()"
            @click="goToStyleStep"
          >
            下一步：选择画风
          </Button>
          <Button
            v-else
            :disabled="!newProject.styleId || creating"
            @click="createProject"
          >
            <Loader2
              v-if="creating"
              class="w-4 h-4 mr-2 animate-spin"
            />
            创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

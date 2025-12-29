<script setup lang="ts">
import { Plus, Video, Clock, Search, Loader2, Trash2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { STYLE_PRESETS, type StylePreset } from '#shared/types/styles'
import StyleSelector from '@/components/StyleSelector.vue'

// 项目管理页面
definePageMeta({
  layout: 'default'
})

interface Project {
  id: string
  title: string
  description: string | null
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

// 新建项目对话框
const showCreateDialog = ref(false)
const newProject = ref({
  title: '',
  description: '',
  styleId: '',
  aspectRatio: '16:9' as '16:9' | '9:16' | '1:1'
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
  if (!newProject.value.title.trim() || !newProject.value.styleId) return

  creating.value = true
  try {
    await $fetch('/api/project/create', {
      method: 'POST',
      body: {
        title: newProject.value.title,
        description: newProject.value.description || undefined,
        styleId: newProject.value.styleId,
        aspectRatio: newProject.value.aspectRatio
      }
    })
    showCreateDialog.value = false
    createStep.value = 'basic'
    newProject.value = { title: '', description: '', styleId: '', aspectRatio: '16:9' }
    await fetchProjects()
  } catch (e) {
    console.error('创建项目失败:', e)
  } finally {
    creating.value = false
  }
}

// 打开新建对话框
function openCreateDialog() {
  newProject.value = { title: '', description: '', styleId: '', aspectRatio: '16:9' }
  createStep.value = 'basic'
  showCreateDialog.value = true
}

// 处理风格选择
function handleStyleSelect(style: StylePreset) {
  newProject.value.styleId = style.id
}

// 获取风格名称
function getStyleName(styleId: string): string {
  const style = STYLE_PRESETS.find(s => s.id === styleId)
  return style?.name || styleId
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

// 获取背景色
function getBackground(index: number): string {
  return 'bg-muted'
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

onMounted(fetchProjects)

const statusMap: Record<string, { label: string, variant: 'default' | 'secondary' | 'success' | 'warning' }> = {
  in_progress: { label: '进行中', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' }
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">
          项目管理
        </h1>
        <p class="text-muted-foreground">
          管理您的AI漫剧项目
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
              class="pl-10"
              placeholder="搜索项目..."
            />
          </div>
          <select class="h-10 px-3 rounded-md border border-input bg-background text-sm">
            <option>全部状态</option>
            <option>进行中</option>
            <option>已完成</option>
            <option>草稿</option>
          </select>
          <select class="h-10 px-3 rounded-md border border-input bg-background text-sm">
            <option>最近更新</option>
            <option>创建时间</option>
            <option>名称排序</option>
          </select>
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

    <!-- 项目列表 -->
    <div
      v-else
      class="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
    >
      <NuxtLink
        v-for="(project, index) in projects"
        :key="project.id"
        :to="`/workbench?project=${project.id}`"
        class="block"
      >
        <Card class="overflow-hidden hover:shadow-md transition cursor-pointer">
          <div
            class="h-32 relative"
            :class="getBackground(index)"
          >
            <div class="absolute top-3 right-3 flex items-center space-x-2">
              <Badge :variant="statusMap[project.status || 'draft']?.variant || 'secondary'">
                {{ statusMap[project.status || 'draft']?.label || '草稿' }}
              </Badge>
              <button
                class="p-1.5 rounded-md bg-muted hover:bg-destructive hover:text-destructive-foreground transition"
                @click="confirmDelete(project, $event)"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          <CardContent class="pt-4">
            <h3 class="font-semibold text-lg mb-2">
              {{ project.title }}
            </h3>
            <p class="text-muted-foreground text-sm mb-4 line-clamp-2">
              {{ project.description || '暂无描述' }}
            </p>

            <div class="flex items-center justify-between text-sm text-muted-foreground">
              <div class="flex items-center space-x-2">
                <Video class="w-4 h-4" />
                <span>{{ project.totalScenes }}个场景</span>
              </div>
              <div class="flex items-center space-x-2">
                <Clock class="w-4 h-4" />
                <span>{{ formatTime(project.updatedAt) }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>

      <!-- 新建项目卡片 -->
      <div
        class="border-2 border-dashed rounded-lg flex items-center justify-center min-h-[280px] cursor-pointer hover:border-foreground/50 hover:bg-accent transition"
        @click="openCreateDialog"
      >
        <div class="text-center">
          <div class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus class="w-8 h-8 text-muted-foreground" />
          </div>
          <div class="text-muted-foreground font-medium">
            新建项目
          </div>
        </div>
      </div>
    </div>

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
            {{ createStep === 'basic' ? '填写项目基本信息' : '选择画风预设' }}
          </DialogDescription>
        </DialogHeader>
        
        <!-- 步骤 1: 基本信息 -->
        <div v-if="createStep === 'basic'" class="grid gap-4 py-4">
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
              <button
                v-for="option in aspectRatioOptions"
                :key="option.value"
                type="button"
                class="p-3 rounded-md border text-center transition"
                :class="newProject.aspectRatio === option.value ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/50'"
                @click="newProject.aspectRatio = option.value as '16:9' | '9:16' | '1:1'"
              >
                <div class="font-medium text-sm">{{ option.label }}</div>
                <div class="text-xs text-muted-foreground">{{ option.description }}</div>
              </button>
            </div>
          </div>
        </div>

        <!-- 步骤 2: 选择画风 -->
        <div v-else class="flex-1 overflow-y-auto py-4 min-h-[400px]">
          <StyleSelector
            v-model="newProject.styleId"
            :show-search="true"
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
            @click="createStep = 'style'"
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

<script setup lang="ts">
import { Plus, Video, Clock, Search, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// 项目管理页面
definePageMeta({
  layout: 'default'
})

interface Project {
  id: string
  title: string
  description: string | null
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
  description: ''
})
const creating = ref(false)

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

// 创建项目
async function createProject() {
  if (!newProject.value.title.trim()) return
  
  creating.value = true
  try {
    await $fetch('/api/project/create', {
      method: 'POST',
      body: {
        title: newProject.value.title,
        description: newProject.value.description || undefined
      }
    })
    showCreateDialog.value = false
    newProject.value = { title: '', description: '' }
    await fetchProjects()
  } catch (e) {
    console.error('创建项目失败:', e)
  } finally {
    creating.value = false
  }
}

// 打开新建对话框
function openCreateDialog() {
  newProject.value = { title: '', description: '' }
  showCreateDialog.value = true
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

// 获取渐变色
function getGradient(index: number): string {
  const gradients = [
    'from-purple-400 to-pink-400',
    'from-blue-400 to-cyan-400',
    'from-green-400 to-emerald-400',
    'from-orange-400 to-red-400',
    'from-indigo-400 to-purple-400'
  ]
  return gradients[index % gradients.length]
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
      <Button size="lg" @click="openCreateDialog">
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
        <Card class="overflow-hidden hover:shadow-lg transition cursor-pointer">
          <div
            class="h-32 bg-gradient-to-br relative"
            :class="getGradient(index)"
          >
            <div class="absolute top-3 right-3">
              <Badge :variant="statusMap[project.status || 'draft']?.variant || 'secondary'">
                {{ statusMap[project.status || 'draft']?.label || '草稿' }}
              </Badge>
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
        class="border-2 border-dashed rounded-xl flex items-center justify-center min-h-[280px] cursor-pointer hover:border-primary hover:bg-accent transition"
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

    <!-- 新建项目对话框 -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            创建一个新的AI漫剧项目，开始你的创作之旅
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-4 py-4">
          <div class="grid gap-2">
            <label class="text-sm font-medium">项目名称</label>
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
              rows="3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">
            取消
          </Button>
          <Button @click="createProject" :disabled="!newProject.title.trim() || creating">
            <Loader2 v-if="creating" class="w-4 h-4 mr-2 animate-spin" />
            创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

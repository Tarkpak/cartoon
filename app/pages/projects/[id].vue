<script setup lang="ts">
import {
  ArrowLeft,
  Play,
  Pencil,
  Video,
  Users,
  Clock,
  Calendar,
  Settings,
  Download,
  Trash2,
  ChevronRight,
  FileText,
  Music,
  Film,
  MoreVertical,
  CheckCircle2,
  Circle,
  Loader2
} from 'lucide-vue-next'

// 项目详情页
definePageMeta({
  layout: 'default'
})

const route = useRoute()
const projectId = computed(() => route.params.id as string)

// 模拟项目数据
const project = ref({
  id: projectId.value,
  title: '都市修仙传',
  description: '一个现代都市修仙故事，主角在繁华都市中踏上修仙之路，经历重重考验，最终成为一代强者。',
  status: 'active',
  createdAt: '2024-12-01',
  updatedAt: '2小时前',
  gradient: 'from-purple-400 to-pink-400',
  totalScenes: 12,
  completedScenes: 5,
  totalDuration: 96,
  characters: [
    { id: '1', name: '林浩', role: '主角', avatar: '' },
    { id: '2', name: '陈雪', role: '女主', avatar: '' },
    { id: '3', name: '王大力', role: '配角', avatar: '' }
  ]
})

// 模拟场景数据
const scenes = ref([
  {
    id: 'scene_001',
    title: '办公室 - 清晨',
    description: '阳光透过落地窗洒进办公室，林浩坐在工位上发呆',
    status: 'completed',
    duration: 8,
    thumbnail: ''
  },
  {
    id: 'scene_002',
    title: '会议室走廊',
    description: '林浩走向会议室，突然胸口闪过奇异光芒',
    status: 'completed',
    duration: 6,
    thumbnail: ''
  },
  {
    id: 'scene_003',
    title: '林浩内心世界',
    description: '脑海中浮现古老文字，林浩震惊',
    status: 'processing',
    duration: 8,
    thumbnail: ''
  },
  {
    id: 'scene_004',
    title: '公司天台',
    description: '林浩来到天台尝试修炼，感受到体内灵气流动',
    status: 'pending',
    duration: 8,
    thumbnail: ''
  },
  {
    id: 'scene_005',
    title: '下班路上',
    description: '林浩走在下班的路上，发现自己的感知能力大幅提升',
    status: 'pending',
    duration: 6,
    thumbnail: ''
  }
])

// 生成任务
const generationTasks = ref([
  { id: '1', type: '角色生成', status: 'completed', progress: 100 },
  { id: '2', type: '场景首尾帧', status: 'completed', progress: 100 },
  { id: '3', type: '视频生成', status: 'processing', progress: 45 },
  { id: '4', type: '音频合成', status: 'pending', progress: 0 }
])

const statusMap: Record<string, { label: string, variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  active: { label: '进行中', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' },
  processing: { label: '生成中', variant: 'default' },
  pending: { label: '待处理', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' }
}

const sceneStatusIcon = (status: string) => {
  switch (status) {
    case 'completed': return CheckCircle2
    case 'processing': return Loader2
    default: return Circle
  }
}

const progressPercent = computed(() => {
  return Math.round((project.value.completedScenes / project.value.totalScenes) * 100)
})
</script>

<template>
  <div class="p-8">
    <!-- 顶部导航 -->
    <div class="flex items-center space-x-2 text-sm text-muted-foreground mb-6">
      <NuxtLink
        to="/projects"
        class="hover:text-foreground transition flex items-center"
      >
        <ArrowLeft class="w-4 h-4 mr-1" />
        返回项目列表
      </NuxtLink>
      <ChevronRight class="w-4 h-4" />
      <span class="text-foreground">{{ project.title }}</span>
    </div>

    <!-- 项目头部 -->
    <div class="grid lg:grid-cols-3 gap-6 mb-8">
      <!-- 左侧：项目信息 -->
      <div class="lg:col-span-2">
        <Card class="overflow-hidden">
          <div
            class="h-40 bg-gradient-to-br relative"
            :class="project.gradient"
          >
            <div class="absolute top-4 right-4 flex space-x-2">
              <Badge :variant="statusMap[project.status || 'draft']?.variant ?? 'secondary'">
                {{ statusMap[project.status || 'draft']?.label ?? '草稿' }}
              </Badge>
            </div>
            <div class="absolute bottom-4 left-6">
              <h1 class="text-3xl font-bold text-white drop-shadow-lg">
                {{ project.title }}
              </h1>
            </div>
          </div>
          <CardContent class="pt-6">
            <p class="text-muted-foreground mb-6">
              {{ project.description }}
            </p>
            <div class="flex flex-wrap gap-6 text-sm">
              <div class="flex items-center text-muted-foreground">
                <Video class="w-4 h-4 mr-2" />
                <span>{{ project.totalScenes }} 个场景</span>
              </div>
              <div class="flex items-center text-muted-foreground">
                <Users class="w-4 h-4 mr-2" />
                <span>{{ project.characters.length }} 个角色</span>
              </div>
              <div class="flex items-center text-muted-foreground">
                <Clock class="w-4 h-4 mr-2" />
                <span>{{ project.totalDuration }} 秒时长</span>
              </div>
              <div class="flex items-center text-muted-foreground">
                <Calendar class="w-4 h-4 mr-2" />
                <span>更新于 {{ project.updatedAt }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：操作面板 -->
      <div class="space-y-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-lg">
              生成进度
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="mb-4">
              <div class="flex justify-between text-sm mb-2">
                <span class="text-muted-foreground">完成度</span>
                <span class="font-medium">{{ progressPercent }}%</span>
              </div>
              <div class="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary transition-all duration-300"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
            </div>
            <div class="text-sm text-muted-foreground">
              已完成 {{ project.completedScenes }}/{{ project.totalScenes }} 个场景
            </div>
          </CardContent>
        </Card>

        <div class="grid grid-cols-2 gap-3">
          <NuxtLink :to="`/workbench?project=${project.id}`">
            <Button
              variant="outline"
              class="w-full"
            >
              <Pencil class="w-4 h-4 mr-2" />
              编辑
            </Button>
          </NuxtLink>
          <Button class="w-full">
            <Play class="w-4 h-4 mr-2" />
            继续生成
          </Button>
        </div>

        <div class="flex space-x-2">
          <Button
            variant="outline"
            size="icon"
            class="flex-1"
          >
            <Download class="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="flex-1"
          >
            <Settings class="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="flex-1 text-destructive hover:text-destructive"
          >
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- 场景列表 -->
      <div class="lg:col-span-2">
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="flex items-center">
                <Film class="w-5 h-5 mr-2" />
                场景列表
              </CardTitle>
              <NuxtLink :to="`/workbench?project=${project.id}`">
                <Button
                  variant="ghost"
                  size="sm"
                >
                  查看全部
                  <ChevronRight class="w-4 h-4 ml-1" />
                </Button>
              </NuxtLink>
            </div>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div
                v-for="(scene, index) in scenes"
                :key="scene.id"
                class="flex items-center space-x-4 p-3 rounded-lg border hover:bg-accent transition cursor-pointer"
              >
                <!-- 序号/状态图标 -->
                <div
                  class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  :class="scene.status === 'completed' ? 'bg-green-100 text-green-600' : scene.status === 'processing' ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground'"
                >
                  <component
                    :is="sceneStatusIcon(scene.status)"
                    class="w-4 h-4"
                    :class="scene.status === 'processing' ? 'animate-spin' : ''"
                  />
                </div>

                <!-- 缩略图占位 -->
                <div class="flex-shrink-0 w-20 h-12 bg-muted rounded overflow-hidden">
                  <div class="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-400 text-xs">
                    {{ index + 1 }}
                  </div>
                </div>

                <!-- 场景信息 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center space-x-2">
                    <h4 class="font-medium truncate">
                      {{ scene.title }}
                    </h4>
                    <Badge
                      :variant="statusMap[scene.status]?.variant || 'secondary'"
                      class="text-xs"
                    >
                      {{ statusMap[scene.status]?.label || scene.status }}
                    </Badge>
                  </div>
                  <p class="text-sm text-muted-foreground truncate">
                    {{ scene.description }}
                  </p>
                </div>

                <!-- 时长 -->
                <div class="flex-shrink-0 text-sm text-muted-foreground">
                  {{ scene.duration }}秒
                </div>

                <!-- 操作按钮 -->
                <Button
                  variant="ghost"
                  size="icon"
                  class="flex-shrink-0"
                >
                  <MoreVertical class="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧边栏 -->
      <div class="space-y-6">
        <!-- 角色列表 -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="flex items-center text-lg">
                <Users class="w-5 h-5 mr-2" />
                角色
              </CardTitle>
              <NuxtLink to="/characters">
                <Button
                  variant="ghost"
                  size="sm"
                >
                  管理
                </Button>
              </NuxtLink>
            </div>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div
                v-for="character in project.characters"
                :key="character.id"
                class="flex items-center space-x-3"
              >
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center font-medium">
                  {{ character.name.charAt(0) }}
                </div>
                <div>
                  <div class="font-medium">
                    {{ character.name }}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ character.role }}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 生成任务 -->
        <Card>
          <CardHeader>
            <CardTitle class="flex items-center text-lg">
              <Settings class="w-5 h-5 mr-2 animate-spin-slow" />
              生成任务
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div
                v-for="task in generationTasks"
                :key="task.id"
                class="space-y-2"
              >
                <div class="flex items-center justify-between text-sm">
                  <div class="flex items-center space-x-2">
                    <component
                      :is="task.status === 'completed' ? CheckCircle2 : task.status === 'processing' ? Loader2 : Circle"
                      class="w-4 h-4"
                      :class="{
                        'text-green-500': task.status === 'completed',
                        'text-blue-500 animate-spin': task.status === 'processing',
                        'text-muted-foreground': task.status === 'pending'
                      }"
                    />
                    <span>{{ task.type }}</span>
                  </div>
                  <span class="text-muted-foreground">{{ task.progress }}%</span>
                </div>
                <div class="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    class="h-full transition-all duration-300"
                    :class="{
                      'bg-green-500': task.status === 'completed',
                      'bg-blue-500': task.status === 'processing',
                      'bg-muted-foreground': task.status === 'pending'
                    }"
                    :style="{ width: `${task.progress}%` }"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 快捷操作 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-lg">
              快捷操作
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-2">
            <Button
              variant="outline"
              class="w-full justify-start"
            >
              <FileText class="w-4 h-4 mr-2" />
              导入剧本
            </Button>
            <Button
              variant="outline"
              class="w-full justify-start"
            >
              <Music class="w-4 h-4 mr-2" />
              配置音频
            </Button>
            <Button
              variant="outline"
              class="w-full justify-start"
            >
              <Download class="w-4 h-4 mr-2" />
              导出视频
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-spin-slow {
  animation: spin 3s linear infinite;
}
</style>

<script setup lang="ts">
import { Plus, Video, Clock, Search } from 'lucide-vue-next'

// 项目管理页面
definePageMeta({
  layout: 'default',
})

const projects = ref([
  {
    id: '1',
    title: '都市修仙传',
    description: '一个现代都市修仙故事，主角在繁华都市中踏上修仙之路...',
    scenes: 12,
    status: 'active',
    updatedAt: '2小时前',
    gradient: 'from-purple-400 to-pink-400',
  },
  {
    id: '2',
    title: '玄幻大陆',
    description: '在这片神秘的大陆上，少年踏上了寻找真相的旅程...',
    scenes: 8,
    status: 'draft',
    updatedAt: '1天前',
    gradient: 'from-blue-400 to-cyan-400',
  },
  {
    id: '3',
    title: '甜蜜恋爱日记',
    description: '校园甜蜜恋爱故事，青春与爱情的美好邂逅...',
    scenes: 20,
    status: 'completed',
    updatedAt: '3天前',
    gradient: 'from-green-400 to-emerald-400',
  },
])

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' }> = {
  active: { label: '进行中', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' },
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">项目管理</h1>
        <p class="text-muted-foreground">管理您的AI漫剧项目</p>
      </div>
      <Button size="lg">
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

    <!-- 项目列表 -->
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      <NuxtLink
        v-for="project in projects"
        :key="project.id"
        :to="`/workbench?project=${project.id}`"
        class="block"
      >
        <Card class="overflow-hidden hover:shadow-lg transition cursor-pointer">
          <div
            class="h-32 bg-gradient-to-br relative"
            :class="project.gradient"
          >
            <div class="absolute top-3 right-3">
              <Badge :variant="statusMap[project.status].variant">
                {{ statusMap[project.status].label }}
              </Badge>
            </div>
          </div>
          <CardContent class="pt-4">
            <h3 class="font-semibold text-lg mb-2">{{ project.title }}</h3>
            <p class="text-muted-foreground text-sm mb-4 line-clamp-2">{{ project.description }}</p>
            
            <div class="flex items-center justify-between text-sm text-muted-foreground">
              <div class="flex items-center space-x-2">
                <Video class="w-4 h-4" />
                <span>{{ project.scenes }}个场景</span>
              </div>
              <div class="flex items-center space-x-2">
                <Clock class="w-4 h-4" />
                <span>{{ project.updatedAt }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>

      <!-- 新建项目卡片 -->
      <div
        class="border-2 border-dashed rounded-xl flex items-center justify-center min-h-[280px] cursor-pointer hover:border-primary hover:bg-accent transition"
      >
        <div class="text-center">
          <div class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus class="w-8 h-8 text-muted-foreground" />
          </div>
          <div class="text-muted-foreground font-medium">新建项目</div>
        </div>
      </div>
    </div>
  </div>
</template>

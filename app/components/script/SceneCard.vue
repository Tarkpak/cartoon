<script setup lang="ts">
import {
  Pencil,
  Trash2,
  Play,
  CheckCircle2,
  Circle,
  Loader2,
  Clock,
  Users,
  GripVertical
} from 'lucide-vue-next'

interface SceneCardProps {
  scene: {
    id: string
    title: string
    description: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    duration: number
    characters?: string[]
    thumbnail?: string
  }
  index: number
  active?: boolean
  draggable?: boolean
}

const props = withDefaults(defineProps<SceneCardProps>(), {
  active: false,
  draggable: false
})

const emit = defineEmits<{
  click: [scene: SceneCardProps['scene']]
  edit: [scene: SceneCardProps['scene']]
  delete: [scene: SceneCardProps['scene']]
  play: [scene: SceneCardProps['scene']]
}>()

const statusConfig = {
  pending: { icon: Circle, color: 'text-muted-foreground', bg: 'bg-muted', label: '待处理', spin: false },
  processing: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-100', label: '生成中', spin: true },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100', label: '已完成', spin: false },
  failed: { icon: Circle, color: 'text-red-500', bg: 'bg-red-100', label: '失败', spin: false }
}

const currentStatus = computed(() => statusConfig[props.scene.status] || statusConfig.pending)
</script>

<template>
  <div
    class="border rounded-xl p-4 cursor-pointer transition group"
    :class="[
      active ? 'border-primary bg-accent shadow-md' : 'hover:border-primary/50 hover:bg-accent/50',
      scene.status === 'failed' ? 'border-red-200' : ''
    ]"
    @click="emit('click', scene)"
  >
    <!-- 头部：序号、标题、操作 -->
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center space-x-3">
        <!-- 拖拽手柄 -->
        <div
          v-if="draggable"
          class="cursor-grab opacity-0 group-hover:opacity-100 transition"
        >
          <GripVertical class="w-4 h-4 text-muted-foreground" />
        </div>

        <!-- 状态图标 -->
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="currentStatus.bg"
        >
          <component
            :is="currentStatus.icon"
            class="w-4 h-4"
            :class="[currentStatus.color, currentStatus.spin ? 'animate-spin' : '']"
          />
        </div>

        <!-- 场景序号和标题 -->
        <div>
          <Badge :variant="active ? 'default' : 'secondary'">
            场景 {{ index + 1 }}
          </Badge>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition">
        <Button
          v-if="scene.status === 'completed'"
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          @click.stop="emit('play', scene)"
        >
          <Play class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          @click.stop="emit('edit', scene)"
        >
          <Pencil class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0 text-destructive hover:text-destructive"
          @click.stop="emit('delete', scene)"
        >
          <Trash2 class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <!-- 缩略图区域 -->
    <div
      v-if="scene.thumbnail"
      class="mb-3 rounded-lg overflow-hidden aspect-video bg-muted"
    >
      <img
        :src="scene.thumbnail"
        :alt="scene.title"
        class="w-full h-full object-cover"
      >
    </div>

    <!-- 内容 -->
    <h4 class="font-medium mb-1 line-clamp-1">
      {{ scene.title }}
    </h4>
    <p class="text-sm text-muted-foreground mb-3 line-clamp-2">
      {{ scene.description }}
    </p>

    <!-- 底部信息 -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- 角色标签 -->
      <Badge
        v-for="char in scene.characters?.slice(0, 3)"
        :key="char"
        variant="outline"
        class="text-xs"
      >
        <Users class="w-3 h-3 mr-1" />
        {{ char }}
      </Badge>
      <Badge
        v-if="(scene.characters?.length || 0) > 3"
        variant="outline"
        class="text-xs"
      >
        +{{ (scene.characters?.length || 0) - 3 }}
      </Badge>

      <!-- 时长 -->
      <Badge
        variant="outline"
        class="text-xs ml-auto"
      >
        <Clock class="w-3 h-3 mr-1" />
        {{ scene.duration }}秒
      </Badge>
    </div>

    <!-- 进度条（生成中时显示） -->
    <div
      v-if="scene.status === 'processing'"
      class="mt-3"
    >
      <div class="h-1 bg-muted rounded-full overflow-hidden">
        <div class="h-full bg-blue-500 animate-pulse w-1/2" />
      </div>
    </div>
  </div>
</template>

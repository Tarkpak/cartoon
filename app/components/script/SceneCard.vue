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
  GripVertical,
  Camera,
  Move,
  Layers
} from 'lucide-vue-next'
import type { SceneShotType, SceneCameraMovement } from '#shared/types/script'
import type { AssetWorkbenchTransitionType } from '~/lib/asset-workbench-models'

interface SceneCardProps {
  scene: {
    id: string
    title: string
    description: string
    status: 'pending' | 'generating' | 'completed' | 'failed'
    duration: number
    characters?: string[]
    thumbnail?: string
    shotType?: SceneShotType
    cameraMovement?: SceneCameraMovement
    transitionIn?: AssetWorkbenchTransitionType
    transitionOut?: AssetWorkbenchTransitionType
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
  generating: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-100', label: '生成中', spin: true },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100', label: '已完成', spin: false },
  failed: { icon: Circle, color: 'text-red-500', bg: 'bg-red-100', label: '失败', spin: false }
}

// 景别标签映射
const shotTypeLabels: Record<SceneShotType, string> = {
  extreme_wide: '大远景',
  wide: '全景',
  medium_wide: '中全景',
  medium: '中景',
  medium_close: '中近景',
  close: '近景',
  extreme_close: '特写',
  detail: '细节'
}

// 运镜标签映射
const cameraMovementLabels: Record<SceneCameraMovement, string> = {
  static: '固定镜头',
  push: '推',
  pull: '拉',
  pan_left: '左摇',
  pan_right: '右摇',
  tilt_up: '上摇',
  tilt_down: '下摇',
  track: '跟',
  dolly: '移',
  zoom_in: '变焦推',
  zoom_out: '变焦拉',
  crane: '升降',
  handheld: '手持',
  arc: '环绕'
}

// 转场标签映射
const transitionLabels: Record<AssetWorkbenchTransitionType, string> = {
  cut: '硬切',
  fade: '淡变',
  dissolve: '叠化',
  wipe: '划变',
  slide: '滑动',
  zoom: '缩放',
  blur: '模糊',
  flash: '闪白',
  none: '无'
}

const currentStatus = computed(() => statusConfig[props.scene.status] || statusConfig.pending)

// 获取景别标签
const shotTypeLabel = computed(() => {
  return props.scene.shotType ? shotTypeLabels[props.scene.shotType] : null
})

// 获取运镜标签
const cameraMovementLabel = computed(() => {
  return props.scene.cameraMovement ? cameraMovementLabels[props.scene.cameraMovement] : null
})

// 获取转场标签
const transitionLabel = computed(() => {
  const transIn = props.scene.transitionIn
  const transOut = props.scene.transitionOut
  if (!transIn && !transOut) return null
  if (transIn === transOut) return transitionLabels[transIn || 'cut']
  return `${transitionLabels[transIn || 'cut']}→${transitionLabels[transOut || 'cut']}`
})
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
      <!-- 镜头语言标签 -->
      <Badge
        v-if="shotTypeLabel"
        variant="outline"
        class="text-xs bg-blue-50 border-blue-200 text-blue-700"
      >
        <Camera class="w-3 h-3 mr-1" />
        {{ shotTypeLabel }}
      </Badge>
      <Badge
        v-if="cameraMovementLabel && cameraMovementLabel !== '定镜'"
        variant="outline"
        class="text-xs bg-green-50 border-green-200 text-green-700"
      >
        <Move class="w-3 h-3 mr-1" />
        {{ cameraMovementLabel }}
      </Badge>
      <Badge
        v-if="transitionLabel && transitionLabel !== '硬切'"
        variant="outline"
        class="text-xs bg-purple-50 border-purple-200 text-purple-700"
      >
        <Layers class="w-3 h-3 mr-1" />
        {{ transitionLabel }}
      </Badge>

      <!-- 角色标签 -->
      <Badge
        v-for="char in scene.characters?.slice(0, 2)"
        :key="char"
        variant="outline"
        class="text-xs"
      >
        <Users class="w-3 h-3 mr-1" />
        {{ char }}
      </Badge>
      <Badge
        v-if="(scene.characters?.length || 0) > 2"
        variant="outline"
        class="text-xs"
      >
        +{{ (scene.characters?.length || 0) - 2 }}
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
      v-if="scene.status === 'generating'"
      class="mt-3"
    >
      <div class="h-1 bg-muted rounded-full overflow-hidden">
        <div class="h-full bg-blue-500 animate-pulse w-1/2" />
      </div>
    </div>
  </div>
</template>

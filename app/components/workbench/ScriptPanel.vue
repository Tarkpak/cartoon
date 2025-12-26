<script setup lang="ts">
import { Loader2, Sparkles, Plus, Pencil, Trash2, Merge, Split, Film, Eye, BookOpen, Camera, Move, Layers } from 'lucide-vue-next'
import type { SceneData } from '~/composables/useWorkbench'

const props = defineProps<{
  scenes: SceneData[]
  parsing: boolean
  hasOutline?: boolean
  hasCharacters?: boolean
}>()

const emit = defineEmits<{
  'generateFromOutline': []
  'selectScene': [scene: SceneData]
  'addScene': []
  'editScene': [scene: SceneData]
  'deleteScene': [scene: SceneData]
  'splitScene': [index: number]
  'mergeScene': [index: number]
  'reorderScenes': [fromIndex: number, toIndex: number]
  'generateStoryboard': [scene: SceneData]
  'extractSceneVisual': [scene: SceneData]
  'viewStoryboard': [scene: SceneData]
  'viewSceneVisual': [scene: SceneData]
}>()

// 景别标签映射
const shotTypeLabels: Record<string, string> = {
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
const cameraMovementLabels: Record<string, string> = {
  static: '定镜',
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
const transitionLabels: Record<string, string> = {
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

// 拖拽排序
const draggedSceneIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function handleDragStart(event: DragEvent, index: number) {
  draggedSceneIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function handleDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverIndex.value = index
}

function handleDragLeave() {
  dragOverIndex.value = null
}

function handleDrop(event: DragEvent, targetIndex: number) {
  event.preventDefault()
  const sourceIndex = draggedSceneIndex.value

  if (sourceIndex !== null && sourceIndex !== targetIndex) {
    emit('reorderScenes', sourceIndex, targetIndex)
  }

  draggedSceneIndex.value = null
  dragOverIndex.value = null
}

function handleDragEnd() {
  draggedSceneIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="grid lg:grid-cols-2 gap-6">
    <!-- 左侧: 原文输入 -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">
          场景生成
        </h3>
        <div class="flex items-center space-x-2">
          <!-- 从大纲生成场景按钮 -->
          <Button
            v-if="hasOutline && hasCharacters"
            variant="default"
            size="sm"
            :disabled="parsing"
            @click="$emit('generateFromOutline')"
          >
            <Loader2
              v-if="parsing"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <BookOpen
              v-else
              class="w-4 h-4 mr-2"
            />
            {{ parsing ? '生成中...' : '从大纲生成场景' }}
          </Button>
        </div>
      </div>
      <!-- 提示信息 -->
      <div
        v-if="hasOutline && hasCharacters && scenes.length === 0"
        class="mb-4 p-3 bg-accent rounded-lg text-sm"
      >
        💡 推荐：点击"从大纲生成场景"按钮，AI 将根据故事大纲和角色设定自动生成详细场景
      </div>
      <div
        v-else-if="scenes.length > 0"
        class="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700"
      >
        ✅ 已有 {{ scenes.length }} 个场景，可以在右侧编辑场景内容，或生成分镜脚本
      </div>
      <div
        v-else
        class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700"
      >
        ⚠️ 请先在第一步生成大纲或解析剧本，然后在第二步提取角色
      </div>

      <!-- 场景操作提示 -->
      <Card class="bg-accent/50">
        <CardContent class="pt-4">
          <h4 class="font-medium text-sm mb-2">
            💡 场景编辑提示
          </h4>
          <ul class="text-xs text-muted-foreground space-y-1">
            <li>• 拖拽场景卡片可以调整顺序</li>
            <li>• 点击编辑按钮可以修改场景内容和对话</li>
            <li>• 生成分镜脚本可以获得专业的镜头语言设计</li>
            <li>• 提取场景视觉可以生成用于图片生成的提示词</li>
            <li>• 场景描述越详细，生成的图片和视频效果越好</li>
          </ul>
        </CardContent>
      </Card>
    </div>

    <!-- 右侧: 解析结果 -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">
          场景列表
        </h3>
        <Button
          variant="ghost"
          size="sm"
          @click="$emit('addScene')"
        >
          <Plus class="w-4 h-4" />
        </Button>
      </div>
      <div class="space-y-4 max-h-[400px] overflow-y-auto">
        <div
          v-for="(scene, sceneIndex) in scenes"
          :key="scene.id"
          class="border rounded-xl p-4 cursor-pointer transition group"
          :class="[
            scene.active ? 'border-primary bg-accent' : 'hover:border-primary/50',
            dragOverIndex === sceneIndex && draggedSceneIndex !== sceneIndex ? 'border-dashed border-2 border-primary' : '',
            draggedSceneIndex === sceneIndex ? 'opacity-50' : ''
          ]"
          draggable="true"
          @click="$emit('selectScene', scene)"
          @dragstart="handleDragStart($event, sceneIndex)"
          @dragover="handleDragOver($event, sceneIndex)"
          @dragleave="handleDragLeave"
          @drop="handleDrop($event, sceneIndex)"
          @dragend="handleDragEnd"
        >
          <div class="flex items-start justify-between mb-2">
            <div class="flex items-center space-x-2">
              <!-- 拖拽手柄 -->
              <div class="cursor-grab opacity-0 group-hover:opacity-100 transition text-muted-foreground">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle
                    cx="9"
                    cy="12"
                    r="1"
                  />
                  <circle
                    cx="9"
                    cy="5"
                    r="1"
                  />
                  <circle
                    cx="9"
                    cy="19"
                    r="1"
                  />
                  <circle
                    cx="15"
                    cy="12"
                    r="1"
                  />
                  <circle
                    cx="15"
                    cy="5"
                    r="1"
                  />
                  <circle
                    cx="15"
                    cy="19"
                    r="1"
                  />
                </svg>
              </div>
              <Badge :variant="scene.active ? 'default' : 'secondary'">
                场景 {{ sceneIndex + 1 }}
              </Badge>
            </div>
            <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0"
                title="拆分场景"
                @click.stop="$emit('splitScene', sceneIndex)"
              >
                <Split class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0"
                title="与下一场景合并"
                :disabled="sceneIndex >= scenes.length - 1"
                @click.stop="$emit('mergeScene', sceneIndex)"
              >
                <Merge class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0"
                title="编辑场景"
                @click.stop="$emit('editScene', scene)"
              >
                <Pencil class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0 text-destructive hover:text-destructive"
                title="删除场景"
                @click.stop="$emit('deleteScene', scene)"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <h4 class="font-medium mb-1">
            {{ scene.title }}
          </h4>
          <p class="text-sm text-muted-foreground mb-2 line-clamp-2">
            {{ scene.description }}
          </p>
          <div class="flex flex-wrap gap-2">
            <!-- 镜头语言标签 -->
            <Badge
              v-if="scene.shotType && scene.shotType !== 'medium'"
              variant="outline"
              class="bg-blue-50 border-blue-200 text-blue-700"
            >
              <Camera class="w-3 h-3 mr-1" />
              {{ shotTypeLabels[scene.shotType] || scene.shotType }}
            </Badge>
            <Badge
              v-if="scene.cameraMovement && scene.cameraMovement !== 'static'"
              variant="outline"
              class="bg-green-50 border-green-200 text-green-700"
            >
              <Move class="w-3 h-3 mr-1" />
              {{ cameraMovementLabels[scene.cameraMovement] || scene.cameraMovement }}
            </Badge>
            <Badge
              v-if="scene.transitionIn && scene.transitionIn !== 'cut'"
              variant="outline"
            >
              <Layers class="w-3 h-3 mr-1" />
              {{ transitionLabels[scene.transitionIn] || scene.transitionIn }}
            </Badge>
            <!-- 角色标签 -->
            <Badge
              v-for="char in scene.characters.slice(0, 2)"
              :key="char.name"
              variant="outline"
            >
              {{ char.name }}
            </Badge>
            <Badge
              v-if="scene.characters.length > 2"
              variant="outline"
            >
              +{{ scene.characters.length - 2 }}
            </Badge>
            <Badge variant="outline">
              {{ scene.duration }}秒
            </Badge>
          </div>
          <!-- 新增：分镜和场景视觉操作按钮 -->
          <div class="flex items-center space-x-2 mt-3 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              class="flex-1 h-7 text-xs"
              :disabled="scene.storyboardStatus === 'generating'"
              @click.stop="scene.storyboard ? $emit('viewStoryboard', scene) : $emit('generateStoryboard', scene)"
            >
              <Loader2
                v-if="scene.storyboardStatus === 'generating'"
                class="w-3 h-3 mr-1 animate-spin"
              />
              <Film
                v-else
                class="w-3 h-3 mr-1"
              />
              {{ scene.storyboard ? '查看分镜' : '生成分镜' }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="flex-1 h-7 text-xs"
              :disabled="scene.sceneVisualStatus === 'generating'"
              @click.stop="scene.sceneVisual ? $emit('viewSceneVisual', scene) : $emit('extractSceneVisual', scene)"
            >
              <Loader2
                v-if="scene.sceneVisualStatus === 'generating'"
                class="w-3 h-3 mr-1 animate-spin"
              />
              <Eye
                v-else
                class="w-3 h-3 mr-1"
              />
              {{ scene.sceneVisual ? '查看视觉' : '提取视觉' }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

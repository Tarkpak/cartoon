<script setup lang="ts">
import {
  RefreshCw,
  Download,
  ZoomIn,
  Check,
  Loader2,
  Plus
} from 'lucide-vue-next'

interface Expression {
  emotion: string
  imageData?: string
  mimeType?: string
  generating?: boolean
}

interface ExpressionGridProps {
  expressions: Expression[]
  selectedEmotion?: string
  characterName?: string
  editable?: boolean
}

const _props = withDefaults(defineProps<ExpressionGridProps>(), {
  editable: true
})
const { expressions, selectedEmotion, characterName, editable } = _props

const emit = defineEmits<{
  select: [emotion: string]
  regenerate: [emotion: string]
  download: [emotion: string]
  preview: [emotion: string, src: string]
  add: []
}>()

// 情绪标签映射
const emotionLabels: Record<string, { label: string, emoji: string }> = {
  neutral: { label: '平静', emoji: '😐' },
  happy: { label: '开心', emoji: '😊' },
  sad: { label: '悲伤', emoji: '😢' },
  angry: { label: '愤怒', emoji: '😠' },
  surprised: { label: '惊讶', emoji: '😲' },
  confused: { label: '困惑', emoji: '🤔' },
  excited: { label: '兴奋', emoji: '🤩' },
  scared: { label: '害怕', emoji: '😨' }
}

// 获取图片源
function getImageSrc(expr: Expression): string {
  if (!expr.imageData) return ''
  if (expr.imageData.startsWith('data:')) return expr.imageData
  return `data:${expr.mimeType || 'image/png'};base64,${expr.imageData}`
}

// 获取情绪信息
function getEmotionInfo(emotion: string) {
  return emotionLabels[emotion] || { label: emotion, emoji: '🎭' }
}
</script>

<template>
  <div class="space-y-4">
    <!-- 标题 -->
    <div class="flex items-center justify-between">
      <h3 class="font-semibold">
        {{ characterName ? `${characterName} 的表情` : '角色表情' }}
      </h3>
      <Button
        v-if="editable"
        variant="outline"
        size="sm"
        @click="emit('add')"
      >
        <Plus class="w-4 h-4 mr-1" />
        添加表情
      </Button>
    </div>

    <!-- 表情网格 -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <div
        v-for="expr in expressions"
        :key="expr.emotion"
        class="relative group cursor-pointer"
        @click="emit('select', expr.emotion)"
      >
        <!-- 卡片 -->
        <div
          class="aspect-square rounded-xl overflow-hidden border-2 transition-all"
          :class="[
            selectedEmotion === expr.emotion
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-transparent hover:border-primary/50'
          ]"
        >
          <!-- 生成中状态 -->
          <div
            v-if="expr.generating"
            class="w-full h-full bg-muted flex items-center justify-center"
          >
            <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
          </div>

          <!-- 无图片状态 -->
          <div
            v-else-if="!expr.imageData"
            class="w-full h-full bg-muted flex items-center justify-center"
          >
            <span class="text-4xl">{{ getEmotionInfo(expr.emotion).emoji }}</span>
          </div>

          <!-- 有图片 -->
          <img
            v-else
            :src="getImageSrc(expr)"
            :alt="expr.emotion"
            class="w-full h-full object-cover"
          >

          <!-- 选中标记 -->
          <div
            v-if="selectedEmotion === expr.emotion"
            class="absolute top-2 right-2"
          >
            <div class="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <Check class="w-4 h-4 text-primary-foreground" />
            </div>
          </div>

          <!-- 操作按钮 -->
          <div
            v-if="editable && expr.imageData && !expr.generating"
            class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2"
          >
            <Button
              variant="secondary"
              size="icon"
              class="h-8 w-8"
              @click.stop="emit('preview', expr.emotion, getImageSrc(expr))"
            >
              <ZoomIn class="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              class="h-8 w-8"
              @click.stop="emit('regenerate', expr.emotion)"
            >
              <RefreshCw class="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              class="h-8 w-8"
              @click.stop="emit('download', expr.emotion)"
            >
              <Download class="w-4 h-4" />
            </Button>
          </div>
        </div>

        <!-- 标签 -->
        <div class="mt-2 text-center">
          <span class="text-sm font-medium">
            {{ getEmotionInfo(expr.emotion).label }}
          </span>
          <span class="ml-1">{{ getEmotionInfo(expr.emotion).emoji }}</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="expressions.length === 0"
      class="text-center py-12 text-muted-foreground"
    >
      <span class="text-4xl mb-4 block">🎭</span>
      <p>暂无表情资产</p>
      <Button
        v-if="editable"
        variant="outline"
        class="mt-4"
        @click="emit('add')"
      >
        <Plus class="w-4 h-4 mr-2" />
        生成表情
      </Button>
    </div>
  </div>
</template>

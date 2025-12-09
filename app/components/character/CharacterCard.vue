<script setup lang="ts">
import {
  Pencil,
  Trash2,
  RefreshCw,
  Download,
  User,
  Sparkles
} from 'lucide-vue-next'

interface CharacterCardProps {
  character: {
    id: string
    name: string
    description: string
    role?: 'protagonist' | 'antagonist' | 'supporting'
    avatar?: string
    expressions?: Array<{
      emotion: string
      imageData?: string
    }>
    generating?: boolean
  }
  compact?: boolean
}

const props = withDefaults(defineProps<CharacterCardProps>(), {
  compact: false
})

const emit = defineEmits<{
  click: [character: CharacterCardProps['character']]
  edit: [character: CharacterCardProps['character']]
  delete: [character: CharacterCardProps['character']]
  regenerate: [character: CharacterCardProps['character']]
  download: [character: CharacterCardProps['character']]
}>()

const roleLabels: Record<string, { label: string, variant: 'default' | 'secondary' | 'outline' }> = {
  protagonist: { label: '主角', variant: 'default' },
  antagonist: { label: '反派', variant: 'secondary' },
  supporting: { label: '配角', variant: 'outline' }
}

const hasAvatar = computed(() => !!props.character.avatar)
const expressionCount = computed(() => props.character.expressions?.length || 0)
</script>

<template>
  <!-- 紧凑模式 -->
  <div
    v-if="compact"
    class="flex items-center space-x-3 p-2 rounded-lg hover:bg-accent cursor-pointer transition"
    @click="emit('click', character)"
  >
    <div
      class="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden"
      :class="hasAvatar ? '' : 'bg-gradient-to-br from-primary/20 to-primary/40'"
    >
      <img
        v-if="hasAvatar"
        :src="character.avatar"
        :alt="character.name"
        class="w-full h-full object-cover"
      >
      <span
        v-else
        class="font-medium text-primary"
      >
        {{ character.name.charAt(0) }}
      </span>
    </div>
    <div class="flex-1 min-w-0">
      <div class="font-medium truncate">
        {{ character.name }}
      </div>
      <div class="text-xs text-muted-foreground truncate">
        {{ character.role ? roleLabels[character.role]?.label : '角色' }}
      </div>
    </div>
    <Badge
      v-if="character.generating"
      variant="secondary"
      class="animate-pulse"
    >
      生成中
    </Badge>
  </div>

  <!-- 完整卡片模式 -->
  <Card
    v-else
    class="overflow-hidden hover:shadow-lg transition cursor-pointer group"
    @click="emit('click', character)"
  >
    <!-- 头像区域 -->
    <div class="aspect-square bg-muted relative overflow-hidden">
      <img
        v-if="hasAvatar"
        :src="character.avatar"
        :alt="character.name"
        class="w-full h-full object-cover"
      >
      <div
        v-else
        class="w-full h-full bg-gradient-to-br from-primary/10 to-primary/30 flex items-center justify-center"
      >
        <User class="w-16 h-16 text-primary/40" />
      </div>

      <!-- 生成中遮罩 -->
      <div
        v-if="character.generating"
        class="absolute inset-0 bg-background/80 flex items-center justify-center"
      >
        <div class="text-center">
          <RefreshCw class="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />
          <span class="text-sm">生成中...</span>
        </div>
      </div>

      <!-- 角色标签 -->
      <div class="absolute top-2 left-2">
        <Badge
          v-if="character.role"
          :variant="roleLabels[character.role]?.variant || 'outline'"
        >
          {{ roleLabels[character.role]?.label }}
        </Badge>
      </div>

      <!-- 操作按钮 -->
      <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
        <div class="flex space-x-1">
          <Button
            variant="secondary"
            size="icon"
            class="h-8 w-8"
            @click.stop="emit('regenerate', character)"
          >
            <Sparkles class="w-4 h-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-8 w-8"
            @click.stop="emit('download', character)"
          >
            <Download class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>

    <CardContent class="pt-4">
      <div class="flex items-start justify-between mb-2">
        <h3 class="font-semibold text-lg">
          {{ character.name }}
        </h3>
        <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition">
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0"
            @click.stop="emit('edit', character)"
          >
            <Pencil class="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0 text-destructive hover:text-destructive"
            @click.stop="emit('delete', character)"
          >
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <p class="text-sm text-muted-foreground line-clamp-2 mb-3">
        {{ character.description }}
      </p>

      <!-- 表情预览 -->
      <div
        v-if="expressionCount > 0"
        class="flex items-center space-x-2"
      >
        <div class="flex -space-x-2">
          <div
            v-for="(expr, i) in character.expressions?.slice(0, 5)"
            :key="i"
            class="w-6 h-6 rounded-full border-2 border-background overflow-hidden bg-muted"
          >
            <img
              v-if="expr.imageData"
              :src="`data:image/png;base64,${expr.imageData}`"
              :alt="expr.emotion"
              class="w-full h-full object-cover"
            >
          </div>
        </div>
        <span class="text-xs text-muted-foreground">
          {{ expressionCount }} 种表情
        </span>
      </div>
      <div
        v-else
        class="text-xs text-muted-foreground"
      >
        暂无表情资产
      </div>
    </CardContent>
  </Card>
</template>

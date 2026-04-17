<script setup lang="ts">
import { Loader2, Pencil, Star, Trash2 } from 'lucide-vue-next'
import type { StyleCategory, StylePreset } from '#shared/types/styles'
import { resolveStyleCategoryIcon } from '@/lib/style-category-icons'

const props = defineProps<{
  style: StylePreset
  enabled: boolean
  isDefault: boolean
  isEditing: boolean
  isDeleting: boolean
  getCategoryName: (category: StyleCategory) => string
}>()

defineEmits<{
  (event: 'toggle-enabled' | 'set-default' | 'delete', styleId: string): void
  (event: 'edit', style: StylePreset): void
}>()

const categoryIcon = computed(() => resolveStyleCategoryIcon(props.style.category))
</script>

<template>
  <div
    class="overflow-hidden rounded-xl border bg-background transition-colors"
    :class="[
      enabled ? 'border-primary/50' : 'border-border',
      isEditing ? 'ring-2 ring-primary/40' : ''
    ]"
  >
    <div class="relative aspect-[4/5] bg-muted/30">
      <img
        v-if="style.thumbnail"
        :src="style.thumbnail"
        :alt="style.name"
        class="h-full w-full object-contain"
        loading="lazy"
      >
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
      >
        无缩略图
      </div>

      <div class="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        <component
          :is="categoryIcon"
          class="h-3 w-3"
        />
        <span>{{ getCategoryName(style.category) }}</span>
      </div>
    </div>

    <div class="space-y-3 p-3">
      <div class="min-w-0">
        <div class="truncate text-sm font-medium">
          {{ style.name }}
        </div>
        <div class="truncate text-[12px] text-muted-foreground">
          {{ style.nameEn }}
        </div>
      </div>

      <div class="line-clamp-2 min-h-[36px] text-[12px] text-muted-foreground">
        {{ style.description }}
      </div>

      <div class="flex items-center justify-between gap-2 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          class="h-auto px-0 text-xs hover:bg-transparent"
          @click="$emit('toggle-enabled', style.id)"
        >
          <span
            class="relative inline-flex h-5 w-9 rounded-full transition-colors"
            :class="enabled ? 'bg-primary/80' : 'bg-muted-foreground/30'"
          >
            <span
              class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
              :class="enabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </span>
          <span class="text-muted-foreground">{{ enabled ? '已启用' : '未启用' }}</span>
        </Button>

        <Button
          size="sm"
          :variant="isDefault ? 'default' : 'outline'"
          class="h-7 px-2 text-xs"
          :disabled="!enabled"
          @click="$emit('set-default', style.id)"
        >
          <Star class="mr-1 h-3.5 w-3.5" />
          {{ isDefault ? '默认' : '设为默认' }}
        </Button>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 flex-1 text-xs"
          @click="$emit('edit', style)"
        >
          <Pencil class="mr-1.5 h-3.5 w-3.5" />
          {{ isEditing ? '编辑中' : '编辑' }}
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs text-destructive"
          :disabled="isDeleting"
          @click="$emit('delete', style.id)"
        >
          <Loader2
            v-if="isDeleting"
            class="h-3.5 w-3.5 animate-spin"
          />
          <Trash2
            v-else
            class="h-3.5 w-3.5"
          />
        </Button>
      </div>

      <details class="rounded-md border bg-muted/20 px-2 py-1.5">
        <summary class="cursor-pointer select-none text-xs text-muted-foreground">
          查看预设详情
        </summary>
        <div class="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
          <p class="break-all">
            ID：{{ style.id }}
          </p>
          <p class="break-words">
            预设词：{{ style.prompt }}
          </p>
          <p
            v-if="style.negativePrompt"
            class="break-words"
          >
            反向词：{{ style.negativePrompt }}
          </p>
        </div>
      </details>
    </div>
  </div>
</template>

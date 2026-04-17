<script setup lang="ts">
import { Loader2, Pencil, Star, Trash2 } from 'lucide-vue-next'
import type { StyleCategory, StylePreset } from '#shared/types/styles'
import { resolveStyleCategoryIcon } from '@/lib/style-category-icons'

const props = defineProps<{
  stylePreset: StylePreset
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

const categoryIcon = computed(() => resolveStyleCategoryIcon(props.stylePreset.category))
</script>

<template>
  <div
    class="group overflow-hidden rounded-lg border bg-card transition-all duration-200 hover:shadow-md"
    :class="[
      enabled ? 'border-primary/40' : 'border-border',
      isEditing ? 'ring-2 ring-primary/30' : ''
    ]"
  >
    <!-- Thumbnail -->
    <div class="relative aspect-[3/4] overflow-hidden bg-muted/20">
      <img
        v-if="stylePreset.thumbnail"
        :src="stylePreset.thumbnail"
        :alt="stylePreset.name"
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        loading="lazy"
      >
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground/50"
      >
        无缩略图
      </div>

      <!-- Category badge -->
      <div class="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
        <component
          :is="categoryIcon"
          class="h-2.5 w-2.5"
        />
        <span>{{ getCategoryName(stylePreset.category) }}</span>
      </div>

      <!-- Default badge -->
      <div
        v-if="isDefault"
        class="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-yellow-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
      >
        <Star class="h-2.5 w-2.5" />
        默认
      </div>

      <!-- Hover overlay with quick actions -->
      <div class="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
        <div class="flex w-full items-center gap-1 p-2">
          <Button
            variant="secondary"
            size="sm"
            class="h-7 flex-1 gap-1 bg-white/90 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm hover:bg-white"
            @click="$emit('edit', stylePreset)"
          >
            <Pencil class="h-3 w-3" />
            {{ isEditing ? '编辑中' : '编辑' }}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            class="h-7 w-7 bg-white/90 p-0 text-destructive shadow-sm backdrop-blur-sm hover:bg-red-50"
            :disabled="isDeleting"
            @click="$emit('delete', stylePreset.id)"
          >
            <Loader2
              v-if="isDeleting"
              class="h-3 w-3 animate-spin"
            />
            <Trash2
              v-else
              class="h-3 w-3"
            />
          </Button>
        </div>
      </div>
    </div>

    <!-- Info -->
    <div class="space-y-1.5 p-2.5">
      <div class="min-w-0">
        <div class="truncate text-xs font-semibold leading-tight">
          {{ stylePreset.name }}
        </div>
        <div
          v-if="stylePreset.nameEn"
          class="mt-0.5 truncate text-[11px] text-muted-foreground"
        >
          {{ stylePreset.nameEn }}
        </div>
      </div>

      <!-- Footer actions -->
      <div class="flex items-center justify-between border-t pt-2">
        <label
          class="inline-flex cursor-pointer items-center gap-1.5 text-[11px]"
          @click.stop
        >
          <Switch
            :checked="enabled"
            class="scale-75 origin-left"
            @update:checked="$emit('toggle-enabled', stylePreset.id)"
          />
          <span class="text-muted-foreground">{{ enabled ? '已启用' : '已停用' }}</span>
        </label>

        <Button
          v-if="!isDefault"
          size="sm"
          variant="ghost"
          class="h-6 gap-0.5 px-1.5 text-[11px] text-muted-foreground"
          :disabled="!enabled"
          @click="$emit('set-default', stylePreset.id)"
        >
          <Star class="h-3 w-3" />
          默认
        </Button>
      </div>
    </div>
  </div>
</template>

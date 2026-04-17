<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import type {
  StyleCategory,
  StylePreset
} from '#shared/types/styles'
import { STYLE_CATEGORIES } from '#shared/types/styles'
import SettingsStylePresetCard from '@/components/settings/SettingsStylePresetCard.vue'

const styleSearchKeyword = defineModel<string>('styleSearchKeyword', { required: true })
const styleCategoryFilter = defineModel<'all' | 'enabled' | StyleCategory>('styleCategoryFilter', { required: true })

defineProps<{
  filteredStylePresets: StylePreset[]
  enabledStyleIdSet: Set<string>
  styleDefaultId: string
  styleEditorMode: 'create' | 'edit' | null
  styleEditingId: string | null
  styleDeletingId: string | null
  getStyleCategoryName: (category: StyleCategory) => string
  toggleStyleEnabled: (styleId: string) => void
  setDefaultStyle: (styleId: string) => void
  openEditStyleEditor: (style: StylePreset) => void
  deleteStylePreset: (styleId: string) => void
}>()
</script>

<template>
  <div class="space-y-4">
    <!-- Filter bar -->
    <div class="flex flex-col gap-3 md:flex-row">
      <div class="relative md:flex-1">
        <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="styleSearchKeyword"
          class="h-10 pl-9"
          placeholder="搜索画风名称或 ID…"
        />
      </div>

      <Select v-model="styleCategoryFilter">
        <SelectTrigger class="h-10 text-sm md:w-48">
          <SelectValue placeholder="全部分类" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            全部分类
          </SelectItem>
          <SelectItem value="enabled">
            仅看已启用
          </SelectItem>
          <SelectItem
            v-for="category in STYLE_CATEGORIES"
            :key="category.id"
            :value="category.id"
          >
            {{ category.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Empty state -->
    <div
      v-if="filteredStylePresets.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground"
    >
      <Search class="mb-3 h-10 w-10 opacity-20" />
      <p class="text-sm">
        当前筛选条件下没有匹配的画风
      </p>
    </div>

    <!-- Grid -->
    <div
      v-else
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6"
    >
      <SettingsStylePresetCard
        v-for="preset in filteredStylePresets"
        :key="preset.id"
        :style-preset="preset"
        :enabled="enabledStyleIdSet.has(preset.id)"
        :get-category-name="getStyleCategoryName"
        :is-default="styleDefaultId === preset.id"
        :is-deleting="styleDeletingId === preset.id"
        :is-editing="styleEditorMode === 'edit' && styleEditingId === preset.id"
        @delete="deleteStylePreset"
        @edit="openEditStyleEditor"
        @set-default="setDefaultStyle"
        @toggle-enabled="toggleStyleEnabled"
      />
    </div>
  </div>
</template>

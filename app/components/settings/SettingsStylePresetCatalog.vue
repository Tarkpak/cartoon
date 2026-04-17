<script setup lang="ts">
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
  <div class="space-y-3 rounded-lg border bg-background p-3">
    <div class="flex flex-col gap-2 md:flex-row">
      <Input
        v-model="styleSearchKeyword"
        class="md:flex-1"
        placeholder="搜索画风名称 / ID"
      />

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

    <div
      v-if="filteredStylePresets.length === 0"
      class="py-10 text-center text-sm text-muted-foreground"
    >
      当前筛选条件下没有画风
    </div>

    <div
      v-else
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      <SettingsStylePresetCard
        v-for="style in filteredStylePresets"
        :key="style.id"
        :style="style"
        :enabled="enabledStyleIdSet.has(style.id)"
        :get-category-name="getStyleCategoryName"
        :is-default="styleDefaultId === style.id"
        :is-deleting="styleDeletingId === style.id"
        :is-editing="styleEditorMode === 'edit' && styleEditingId === style.id"
        @delete="deleteStylePreset"
        @edit="openEditStyleEditor"
        @set-default="setDefaultStyle"
        @toggle-enabled="toggleStyleEnabled"
      />
    </div>
  </div>
</template>

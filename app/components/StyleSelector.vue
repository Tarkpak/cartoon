<script setup lang="ts">
import { Search, Sparkles, Check } from 'lucide-vue-next'
import {
  STYLE_CATEGORIES,
  STYLE_PRESETS,
  getStylesByCategory,
  type StylePreset,
  type StyleCategory
} from '#shared/types/styles'

const props = defineProps<{
  modelValue?: string
  showSearch?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'select': [style: StylePreset]
}>()

const searchQuery = ref('')
const activeCategory = ref<StyleCategory | 'all' | 'new'>('all')

const filteredStyles = computed(() => {
  let styles = STYLE_PRESETS
  if (activeCategory.value === 'new') {
    styles = styles.filter(s => s.isNew)
  } else if (activeCategory.value !== 'all') {
    styles = getStylesByCategory(activeCategory.value)
  }
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    styles = styles.filter(s =>
      s.name.includes(query) ||
      s.nameEn.toLowerCase().includes(query) ||
      s.description.includes(query)
    )
  }
  return styles
})

const selectedStyle = computed(() =>
  STYLE_PRESETS.find(s => s.id === props.modelValue)
)

function selectStyle(style: StylePreset) {
  emit('update:modelValue', style.id)
  emit('select', style)
}
</script>

<template>
  <div class="space-y-4">
    <!-- 搜索框 -->
    <div v-if="showSearch !== false" class="relative">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索风格..."
        class="w-full pl-10 pr-4 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
    </div>

    <!-- 分类标签 -->
    <div class="flex flex-wrap gap-2">
      <button
        class="px-3 py-1.5 text-sm rounded-full transition-colors"
        :class="activeCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'"
        @click="activeCategory = 'all'"
      >
        全部
      </button>
      <button
        class="px-3 py-1.5 text-sm rounded-full transition-colors flex items-center gap-1"
        :class="activeCategory === 'new' ? 'bg-primary text-primary-foreground' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:opacity-90'"
        @click="activeCategory = 'new'"
      >
        <Sparkles class="w-3 h-3" />
        新增
      </button>
      <button
        v-for="cat in STYLE_CATEGORIES"
        :key="cat.id"
        class="px-3 py-1.5 text-sm rounded-full transition-colors"
        :class="activeCategory === cat.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'"
        @click="activeCategory = cat.id"
      >
        {{ cat.icon }} {{ cat.name }}
      </button>
    </div>

    <!-- 风格网格 -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      <div
        v-for="style in filteredStyles"
        :key="style.id"
        class="relative group cursor-pointer rounded-lg border-2 transition-all overflow-hidden"
        :class="modelValue === style.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'"
        @click="selectStyle(style)"
      >
        <div class="aspect-square bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center overflow-hidden">
          <img v-if="style.thumbnail" :src="style.thumbnail" :alt="style.name" class="w-full h-full object-cover" loading="lazy" />
          <span v-else class="text-3xl">🎨</span>
        </div>
        <div class="p-2 bg-background">
          <div class="flex items-center gap-1">
            <span class="text-sm font-medium truncate">{{ style.name }}</span>
            <span v-if="style.isNew" class="px-1 py-0.5 text-[10px] bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded">NEW</span>
          </div>
          <p class="text-xs text-muted-foreground truncate">{{ style.nameEn }}</p>
        </div>
        <div v-if="modelValue === style.id" class="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
          <Check class="w-3 h-3 text-primary-foreground" />
        </div>
        <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-3">
          <p class="text-white text-xs text-center">{{ style.description }}</p>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="filteredStyles.length === 0" class="text-center py-12 text-muted-foreground">
      <p>没有找到匹配的风格</p>
    </div>

    <!-- 已选风格预览 -->
    <div v-if="selectedStyle" class="p-4 bg-accent rounded-lg">
      <div class="flex items-center gap-3">
        <div class="w-16 h-16 bg-gradient-to-br from-purple-200 to-pink-200 rounded-lg flex items-center justify-center overflow-hidden">
          <img v-if="selectedStyle.thumbnail" :src="selectedStyle.thumbnail" :alt="selectedStyle.name" class="w-full h-full object-cover" />
          <span v-else class="text-2xl">🎨</span>
        </div>
        <div class="flex-1">
          <h4 class="font-medium">{{ selectedStyle.name }}</h4>
          <p class="text-sm text-muted-foreground">{{ selectedStyle.nameEn }}</p>
          <p class="text-xs text-muted-foreground mt-1">{{ selectedStyle.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

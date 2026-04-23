<script setup lang="ts">
import { Search, Sparkles, Check, Palette, Loader2, Star } from 'lucide-vue-next'
import {
  STYLE_CATEGORIES,
  STYLE_PRESETS,
  type StylePreset,
  type StyleCategory,
  type StyleCategoryInfo
} from '#shared/types/styles'
import { resolveStyleCategoryIconByName } from '@/lib/style-category-icons'

const props = defineProps<{
  modelValue?: string
  showSearch?: boolean
  styles?: StylePreset[]
  categories?: StyleCategoryInfo[]
  defaultStyleId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'select': [style: StylePreset]
}>()

const searchQuery = ref('')
const activeCategory = ref<StyleCategory | 'all' | 'new'>('all')

const {
  presets: remoteStyles,
  categories: remoteCategories,
  loading: remoteLoading,
  loadStylePresets
} = useStylePresets()

function stripLocalThumbnail(style: StylePreset): StylePreset {
  const thumbnail = style.thumbnail?.trim()
  if (!thumbnail) return style

  if (
    thumbnail.startsWith('/styles/')
    || thumbnail.startsWith('/generated-images/')
    || thumbnail.startsWith('/api/image/file/')
  ) {
    return {
      ...style,
      thumbnail: undefined
    }
  }

  return style
}

const localFallbackStyles = computed(() => STYLE_PRESETS.map(stripLocalThumbnail))

const availableStyles = computed(() => {
  if (props.styles && props.styles.length > 0) {
    return props.styles
  }
  if (remoteStyles.value.length > 0) {
    return remoteStyles.value
  }
  return localFallbackStyles.value
})

const availableCategories = computed(() => {
  const categorySet = new Set(availableStyles.value.map(style => style.category))

  const sourceCategories = props.categories && props.categories.length > 0
    ? props.categories
    : (remoteCategories.value.length > 0 ? remoteCategories.value : STYLE_CATEGORIES)

  return sourceCategories.filter(category => categorySet.has(category.id))
})

const filteredStyles = computed(() => {
  let styles = availableStyles.value
  if (activeCategory.value === 'new') {
    styles = styles.filter(s => s.isNew)
  } else if (activeCategory.value !== 'all') {
    styles = styles.filter(style => style.category === activeCategory.value)
  }
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    styles = styles.filter(s =>
      s.name.includes(query)
      || s.nameEn.toLowerCase().includes(query)
      || s.description.includes(query)
    )
  }
  return styles
})

const prioritizedStyles = computed(() => {
  const defaultId = props.defaultStyleId?.trim()
  if (!defaultId) return filteredStyles.value

  const defaultStyles = filteredStyles.value.filter(style => style.id === defaultId)
  if (defaultStyles.length === 0) return filteredStyles.value

  const others = filteredStyles.value.filter(style => style.id !== defaultId)
  return [...defaultStyles, ...others]
})

const selectedStyle = computed(() =>
  availableStyles.value.find(s => s.id === props.modelValue)
)

function selectStyle(style: StylePreset) {
  emit('update:modelValue', style.id)
  emit('select', style)
}

onMounted(async () => {
  if (!props.styles) {
    await loadStylePresets()
  }
})
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="!props.styles && remoteLoading && filteredStyles.length === 0"
      class="flex items-center justify-center py-8 text-muted-foreground text-sm"
    >
      <Loader2 class="w-4 h-4 mr-2 animate-spin" />
      加载画风配置中...
    </div>

    <!-- 搜索框 -->
    <div
      v-if="showSearch !== false"
      class="relative"
    >
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        v-model="searchQuery"
        placeholder="搜索风格..."
        class="h-10 pl-10 pr-4 rounded-lg"
      />
    </div>

    <!-- 分类标签 -->
    <div class="flex flex-wrap gap-2">
      <Button
        variant="ghost"
        size="sm"
        class="px-3 py-1.5 h-auto rounded-full transition-colors"
        :class="activeCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'"
        @click="activeCategory = 'all'"
      >
        全部
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="px-3 py-1.5 h-auto rounded-full transition-colors flex items-center gap-1"
        :class="activeCategory === 'new' ? 'bg-primary text-primary-foreground' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:opacity-90'"
        @click="activeCategory = 'new'"
      >
        <Sparkles class="w-3 h-3" />
        新增
      </Button>
      <Button
        v-for="cat in availableCategories"
        :key="cat.id"
        variant="ghost"
        size="sm"
        class="px-3 py-1.5 h-auto rounded-full transition-colors inline-flex items-center gap-1"
        :class="activeCategory === cat.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'"
        @click="activeCategory = cat.id"
      >
        <component
          :is="resolveStyleCategoryIconByName(cat.icon)"
          class="w-3.5 h-3.5"
        />
        <span>{{ cat.name }}</span>
      </Button>
    </div>

    <!-- 风格网格 -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      <div
        v-for="style in prioritizedStyles"
        :key="style.id"
        class="relative group cursor-pointer rounded-lg border-2 transition-all overflow-hidden"
        :class="modelValue === style.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'"
        @click="selectStyle(style)"
      >
        <div
          v-if="style.id === defaultStyleId"
          class="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-white"
        >
          <Star class="h-3 w-3 fill-current" />
          系统默认
        </div>
        <div class="aspect-[9/16] bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center overflow-hidden">
          <img
            v-if="style.thumbnail"
            :src="style.thumbnail"
            :alt="style.name"
            class="w-full h-full object-contain"
            loading="lazy"
          >
          <Palette
            v-else
            class="w-8 h-8 text-muted-foreground"
          />
        </div>
        <div class="p-2 bg-background">
          <div class="flex items-center gap-1">
            <span class="text-sm font-medium truncate">{{ style.name }}</span>
            <span
              v-if="style.isNew"
              class="px-1 py-0.5 text-[10px] bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded"
            >NEW</span>
          </div>
          <p class="text-xs text-muted-foreground truncate">
            {{ style.nameEn }}
          </p>
        </div>
        <div
          v-if="modelValue === style.id"
          class="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"
        >
          <Check class="w-3 h-3 text-primary-foreground" />
        </div>
        <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-3">
          <p class="text-white text-xs text-center leading-relaxed max-h-[85%] overflow-y-auto pr-1">
            {{ style.description }}
          </p>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="filteredStyles.length === 0"
      class="text-center py-12 text-muted-foreground"
    >
      <p>没有找到匹配的风格</p>
    </div>

    <!-- 已选风格预览 -->
    <div
      v-if="selectedStyle"
      class="p-4 bg-accent rounded-lg"
    >
      <div class="flex items-center gap-3">
        <div class="w-14 sm:w-16 aspect-[9/16] bg-gradient-to-br from-purple-200 to-pink-200 rounded-lg flex items-center justify-center overflow-hidden">
          <img
            v-if="selectedStyle.thumbnail"
            :src="selectedStyle.thumbnail"
            :alt="selectedStyle.name"
            class="w-full h-full object-contain"
          >
          <Palette
            v-else
            class="w-6 h-6 text-muted-foreground"
          />
        </div>
        <div class="flex-1">
          <h4 class="font-medium">
            {{ selectedStyle.name }}
          </h4>
          <p
            v-if="selectedStyle.id === defaultStyleId"
            class="mt-0.5 text-xs text-amber-600"
          >
            系统默认预设
          </p>
          <p class="text-sm text-muted-foreground">
            {{ selectedStyle.nameEn }}
          </p>
          <p class="text-xs text-muted-foreground mt-1 leading-relaxed max-h-20 overflow-y-auto pr-1">
            {{ selectedStyle.description }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

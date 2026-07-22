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
  gridScrollable?: boolean
  showSelectedPreview?: boolean
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
const localFallbackStyles = computed(() => STYLE_PRESETS)

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
  const categorySet = new Set(availableStyles.value.flatMap(style => style.categories || [style.category]))

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
    styles = styles.filter(style => (style.categories || [style.category]).includes(activeCategory.value as StyleCategory))
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
  <div
    class="min-h-0"
    :class="gridScrollable ? 'flex h-full flex-col gap-3' : 'space-y-4'"
  >
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
    <div
      class="min-h-0"
      :class="gridScrollable ? 'flex-1 overflow-y-auto overscroll-contain pr-1' : ''"
    >
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <button
          v-for="style in prioritizedStyles"
          :key="style.id"
          type="button"
          class="group relative cursor-pointer overflow-hidden rounded-md border-2 bg-background text-left transition-[border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
          :class="modelValue === style.id ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-primary/50'"
          :aria-pressed="modelValue === style.id"
          :aria-label="`选择${style.name}画风`"
          :title="style.description"
          @click="selectStyle(style)"
        >
          <div
            v-if="style.id === defaultStyleId"
            class="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[11px] font-medium text-white"
          >
            <Star class="h-3 w-3 fill-current" />
            默认
          </div>
          <div class="flex aspect-[9/16] items-center justify-center overflow-hidden bg-muted">
            <img
              v-if="style.thumbnail"
              :src="style.thumbnail"
              :alt="style.name"
              class="h-full w-full object-cover"
              loading="lazy"
            >
            <Palette
              v-else
              class="h-8 w-8 text-muted-foreground"
            />
          </div>
          <div class="bg-background p-2">
            <div class="flex min-w-0 items-center gap-1">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ style.name }}</span>
              <span
                v-if="style.isNew"
                class="shrink-0 rounded bg-fuchsia-500 px-1 py-0.5 text-[10px] font-semibold text-white"
              >NEW</span>
            </div>
            <p class="truncate text-xs text-muted-foreground">
              {{ style.nameEn }}
            </p>
          </div>
          <div
            v-if="modelValue === style.id"
            class="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-sm"
          >
            <Check class="h-3 w-3 text-primary-foreground" />
          </div>
          <div class="pointer-events-none absolute inset-0 flex items-end bg-black/65 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            <p class="line-clamp-6 text-left text-xs leading-relaxed text-white">
              {{ style.description }}
            </p>
          </div>
        </button>
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
      v-if="selectedStyle && showSelectedPreview !== false"
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
          <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {{ selectedStyle.description }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

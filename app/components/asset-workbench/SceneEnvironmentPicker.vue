<script setup lang="ts">
import { Check, ChevronDown, ImageIcon, ScanSearch, Search } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'radix-vue'
import LazyImage from '~/components/LazyImage.vue'

type EnvironmentOption = {
  id: string
  label: string
  hasReference: boolean
  previewImage?: string
}
const props = defineProps<{
  modelValue: string
  options: EnvironmentOption[]
  image?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  preview: [image: string, label: string]
}>()
const open = ref(false)
const query = ref('')
const readyOnly = ref(false)
const selectedOption = computed(() => props.options.find(option => option.id === props.modelValue))
const filteredOptions = computed(() => props.options.filter(option => {
  return (!readyOnly.value || option.hasReference)
    && option.label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
}))
watch(open, (value) => {
  if (value) {
    query.value = ''
    readyOnly.value = false
    nextTick(() => {
      document.querySelector('[data-environment-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }
})
function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
}
function preview(image: string, label: string) {
  open.value = false
  nextTick(() => emit('preview', image, label))
}
</script>

<template>
  <div class="flex min-w-0 max-w-full items-center gap-2.5" @dblclick.stop>
    <button
      v-if="image"
      type="button"
      class="group/preview relative h-[60px] w-24 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="放大当前环境引用图"
      @click.stop="preview(image, selectedOption?.label || '当前环境引用图')"
    >
      <LazyImage :image="image" alt="当前环境引用图" class="h-full w-full object-cover" />
      <span class="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover/preview:opacity-100 group-focus-visible/preview:opacity-100">
        <ScanSearch class="h-5 w-5" />
      </span>
    </button>
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          :disabled="disabled"
          class="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-medium leading-5">{{ selectedOption?.label || '自动匹配场景环境' }}</span>
            <span class="block text-[11px] leading-5 text-muted-foreground">{{ modelValue === '__auto__' ? '按当前场景自动选择 · 点击更换' : '手动选择 · 点击更换环境' }}</span>
          </span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          :side-offset="8"
          :collision-padding="16"
          class="z-50 flex max-h-[min(640px,var(--radix-popover-content-available-height))] w-[600px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
          @click.stop
          @dblclick.stop
        >
          <div class="shrink-0 space-y-3 border-b p-4">
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="text-sm font-semibold">选择环境引用</p>
                <p class="mt-1 text-xs text-muted-foreground">先看画面，再选择适合当前镜头的环境</p>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{{ filteredOptions.length }} 个环境</span>
            </div>
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input v-model="query" class="h-9 pl-9" placeholder="搜索场景、地点或光线…" aria-label="搜索环境" />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button size="sm" :variant="modelValue === '__auto__' ? 'secondary' : 'ghost'" class="h-7 gap-1.5 text-xs" :disabled="disabled" @click="select('__auto__')">
                <Check v-if="modelValue === '__auto__'" class="h-3.5 w-3.5" />
                自动匹配场景环境
              </Button>
              <label class="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input v-model="readyOnly" type="checkbox" class="accent-primary">
                只看已就绪
              </label>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            <div v-if="filteredOptions.length" class="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
              <div
                v-for="option in filteredOptions"
                :key="option.id"
                :data-environment-selected="modelValue === option.id"
                class="group/option relative overflow-hidden rounded-lg border transition-colors"
                :class="modelValue === option.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50'"
              >
                <button type="button" class="block h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50" :disabled="disabled" :aria-pressed="modelValue === option.id" @click="select(option.id)">
                  <div class="relative aspect-video overflow-hidden bg-muted/30">
                    <LazyImage v-if="option.previewImage" :image="option.previewImage" :alt="option.label" class="h-full w-full object-contain" />
                    <div v-else class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageIcon class="h-7 w-7" :stroke-width="1.5" />
                      <span class="text-xs">环境图尚未就绪</span>
                    </div>
                    <span v-if="modelValue === option.id" class="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
                      <Check class="h-3 w-3" />已选择
                    </span>
                  </div>
                  <div class="px-3 py-2.5">
                    <p class="break-words text-xs font-medium leading-5">{{ option.label }}</p>
                    <p class="mt-1 text-[11px] text-muted-foreground">{{ option.hasReference ? '环境图已就绪' : '选择后需生成环境图' }}</p>
                  </div>
                </button>
                <button
                  v-if="option.previewImage"
                  type="button"
                  class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="`放大查看 ${option.label}`"
                  title="放大查看"
                  @click.stop="preview(option.previewImage, option.label)"
                >
                  <ScanSearch class="h-4 w-4" />
                </button>
              </div>
            </div>
            <p v-else class="py-12 text-center text-sm text-muted-foreground">没有找到匹配的环境，试试其他关键词或取消筛选</p>
          </div>
          <p class="shrink-0 border-t px-4 py-2.5 text-[11px] text-muted-foreground">点击卡片选择 · 点击图片右上角放大查看</p>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>

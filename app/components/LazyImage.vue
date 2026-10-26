<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'
import { ImageOff } from 'lucide-vue-next'
import { toImageSrc } from '~/lib/media'

defineOptions({
  inheritAttrs: false
})

const props = withDefaults(defineProps<{
  image?: string | null
  alt?: string
  eager?: boolean
  rootMargin?: string
  fetchPriority?: 'high' | 'low' | 'auto'
  placeholderClass?: string
}>(), {
  alt: '',
  eager: false,
  rootMargin: '240px 0px',
  fetchPriority: 'low',
  placeholderClass: 'bg-muted/30'
})

const emit = defineEmits<{
  load: [event: Event]
  error: [event: Event]
}>()

const attrs = useAttrs()
const forwardedAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
const forwardedClass = computed(() => attrs.class)
const rootElement = ref<HTMLElement | null>(null)
const shouldLoad = ref(false)
const hasError = ref(false)
const loaded = ref(false)
let observer: IntersectionObserver | null = null

const resolvedSrc = computed(() => {
  if (!shouldLoad.value || hasError.value) return ''
  return toImageSrc(props.image)
})

function disconnectObserver() {
  observer?.disconnect()
  observer = null
}

function loadImage() {
  if (!props.image) return
  shouldLoad.value = true
  disconnectObserver()
}

async function observeImage() {
  disconnectObserver()
  if (!props.image || shouldLoad.value) return

  if (props.eager || typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    loadImage()
    return
  }

  await nextTick()
  const target = rootElement.value
  if (!target) return

  observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      loadImage()
    }
  }, {
    root: null,
    rootMargin: props.rootMargin,
    threshold: 0.01
  })
  observer.observe(target)
}

function handleLoad(event: Event) {
  loaded.value = true
  emit('load', event)
}

function handleError(event: Event) {
  hasError.value = true
  emit('error', event)
}

watch(
  () => props.image,
  () => {
    hasError.value = false
    loaded.value = false
    if (!props.image) {
      shouldLoad.value = false
      disconnectObserver()
      return
    }
    void observeImage()
  }
)

onMounted(() => {
  void observeImage()
})

onBeforeUnmount(() => {
  disconnectObserver()
})
</script>

<template>
  <img
    v-if="resolvedSrc"
    ref="rootElement"
    v-bind="forwardedAttrs"
    :src="resolvedSrc"
    :alt="alt"
    :class="[forwardedClass, loaded ? '' : [placeholderClass, 'motion-safe:animate-pulse']]"
    loading="lazy"
    decoding="async"
    :fetchpriority="fetchPriority"
    @load="handleLoad"
    @error="handleError"
  >
  <div
    v-else-if="hasError"
    ref="rootElement"
    v-bind="forwardedAttrs"
    role="img"
    :aria-label="alt ? `${alt}（图片无法加载）` : '图片无法加载'"
    title="图片无法加载"
    :class="[forwardedClass, placeholderClass]"
    class="flex items-center justify-center text-muted-foreground/70"
  >
    <ImageOff class="h-4 w-4 max-h-[60%] max-w-[60%] shrink-0" :stroke-width="1.5" />
  </div>
  <div
    v-else
    ref="rootElement"
    v-bind="forwardedAttrs"
    aria-hidden="true"
    :class="[forwardedClass, placeholderClass]"
  />
</template>

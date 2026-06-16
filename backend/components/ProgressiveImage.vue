<template>
  <img
    :src="currentSrc"
    :alt="alt"
    :class="computedClass"
    :style="style"
    loading="lazy"
    @load="onLoad"
    @error="onError"
  >
</template>

<script setup lang="ts">
interface Props {
  src: string
  alt?: string
  placeholder?: string
  class?: string | string[] | Record<string, boolean>
  style?: string | Record<string, string>
  errorImage?: string
}

const props = withDefaults(defineProps<Props>(), {
  alt: '',
  placeholder: '',
  errorImage: '',
  class: '',
  style: ''
})

const emit = defineEmits<{
  load: []
  error: []
}>()

const currentSrc = ref(props.placeholder || props.src)
const isLoaded = ref(false)
const hasError = ref(false)

const computedClass = computed(() => {
  const classes = typeof props.class === 'string' ? [props.class] : props.class
  return [
    classes,
    {
      'lazy-image--loading': !isLoaded.value && !hasError.value,
      'lazy-image--loaded': isLoaded.value,
      'lazy-image--error': hasError.value
    }
  ]
})

function onLoad() {
  isLoaded.value = true
  hasError.value = false
  emit('load')
}

function onError() {
  hasError.value = true
  if (props.errorImage) {
    currentSrc.value = props.errorImage
  }
  emit('error')
}

onMounted(() => {
  if (props.placeholder) {
    // 延迟加载真实图片
    nextTick(() => {
      currentSrc.value = props.src
    })
  }
})

watch(() => props.src, (newSrc) => {
  if (newSrc !== currentSrc.value) {
    isLoaded.value = false
    hasError.value = false
    currentSrc.value = props.placeholder || newSrc
    if (props.placeholder) {
      nextTick(() => {
        currentSrc.value = newSrc
      })
    }
  }
})
</script>

<style scoped>
.lazy-image--loading {
  opacity: 0.5;
  filter: blur(4px);
  transition: opacity 0.3s, filter 0.3s;
}

.lazy-image--loaded {
  opacity: 1;
  filter: blur(0);
  transition: opacity 0.3s, filter 0.3s;
}

.lazy-image--error {
  opacity: 0.3;
}
</style>

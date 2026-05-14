<script setup lang="ts">
const props = withDefaults(defineProps<{
  provider: string
  sizeClass?: string
  roundedClass?: string
}>(), {
  sizeClass: 'h-4 w-4',
  roundedClass: 'rounded'
})

const PROVIDER_LOGOS: Record<string, { src: string, alt: string }> = {
  gemini: { src: '/provider-logos/gemini.svg', alt: 'Google Gemini' },
  qwen: { src: '/provider-logos/qwen.svg', alt: 'QWen' },
  kling: { src: '/provider-logos/kling.svg', alt: 'Kling AI' },
  volcengine: { src: '/provider-logos/volcengine.svg', alt: 'Volcengine' },
  deepseek: { src: '/provider-logos/deepseek.svg', alt: 'DeepSeek' },
  custom_openai: { src: '/provider-logos/custom_openai.svg', alt: 'Custom OpenAI' },
  openai: { src: '/provider-logos/custom_openai.svg', alt: 'OpenAI' }
}

const logo = computed(() => {
  return PROVIDER_LOGOS[props.provider] || null
})

const fallbackLabel = computed(() => {
  const source = props.provider.trim()
  if (!source) return '?'

  return source
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'
})
</script>

<template>
  <div
    class="shrink-0 overflow-hidden"
    :class="[props.sizeClass, props.roundedClass]"
  >
    <img
      v-if="logo"
      :src="logo.src"
      :alt="logo.alt"
      class="h-full w-full object-contain"
      loading="lazy"
      decoding="async"
    >
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-muted text-[9px] font-semibold text-muted-foreground"
    >
      {{ fallbackLabel }}
    </div>
  </div>
</template>

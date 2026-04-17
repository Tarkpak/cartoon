<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{
  title?: string
  hint?: string
  icon?: Component
  cardClass?: string
  contentClass?: string
}>(), {
  title: '',
  hint: '',
  icon: undefined,
  cardClass: 'flex-1 min-h-0 flex flex-col overflow-hidden',
  contentClass: 'flex-1 min-h-0 overflow-hidden flex flex-col gap-4'
})
</script>

<template>
  <div :class="cardClass">
    <div :class="contentClass">
      <slot />
    </div>
  </div>
</template>

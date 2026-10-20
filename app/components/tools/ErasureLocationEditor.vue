<script setup lang="ts">
import type { ErasureLocation } from '~/lib/subtitle-erasure-settings'
const locations = defineModel<ErasureLocation[]>({ required: true })
const fields = [
  { key: 'top_left_x', label: '左边' }, { key: 'top_left_y', label: '上边' },
  { key: 'bottom_right_x', label: '右边' }, { key: 'bottom_right_y', label: '下边' }
] as const
</script>

<template>
  <div class="space-y-3">
    <div v-for="(box, index) in locations" :key="index" class="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <label v-for="field in fields" :key="field.key" class="min-w-20 flex-1 space-y-1 text-xs">
        <span>{{ field.label }}（0～1）</span>
        <input v-model.number="box[field.key]" type="number" min="0" max="1" step="0.01" required class="h-9 w-full rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      </label>
      <Button type="button" variant="ghost" size="sm" @click="locations.splice(index, 1)">移除区域 {{ index + 1 }}</Button>
    </div>
    <Button type="button" variant="outline" size="sm" :disabled="locations.length >= 20" @click="locations.push({ top_left_x: 0, top_left_y: 0.5, bottom_right_x: 1, bottom_right_y: 1 })">添加擦除区域</Button>
  </div>
</template>

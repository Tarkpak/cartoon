<script setup lang="ts">
import { computed } from 'vue'
import { useSubtitleErasureSettings } from '~/composables/useSubtitleErasureSettings'
import { defaultSubtitleErasureSettings } from '~/lib/subtitle-erasure-settings'
import ErasureLocationEditor from './ErasureLocationEditor.vue'

defineProps<{ disabled?: boolean }>()
const { settings, getOptions } = useSubtitleErasureSettings()
const validationError = computed(() => {
  try { getOptions(); return '' } catch (error) { return error instanceof Error ? error.message : '配置无效' }
})
const filterFields = [
  { key: 'min_text_height_ratio', label: '最小文字高度', placeholder: '默认 0.01' },
  { key: 'max_text_height_ratio', label: '最大文字高度', placeholder: '' },
  { key: 'center_offset_ratio', label: '水平中心最大偏移', placeholder: '默认 0.08' }
] as const
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <Card>
    <CardContent class="space-y-5 pt-6">
      <details>
        <summary class="cursor-pointer rounded-sm text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">字幕擦除配置</summary>
        <div class="mt-4 space-y-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <p class="text-xs leading-5 text-muted-foreground">修改后自动保存在当前设备，分镜视频的「去字幕」也使用此配置。</p>
            <Button variant="ghost" size="sm" :disabled="disabled" @click="settings = defaultSubtitleErasureSettings()">恢复默认</Button>
          </div>
          <fieldset :disabled="disabled" class="space-y-5 disabled:opacity-60">
            <div class="grid gap-4 sm:grid-cols-3">
              <label class="space-y-2 text-sm"><span>算法版本</span>
                <select aria-label="算法版本" v-model="settings.model_version" :class="selectClass">
                  <option value="v4">v4 · 默认算法</option><option value="v5">v5 · 更快，优化 AI 视频</option><option value="v5.6">v5.6 · 减少闪烁，支持多语种</option>
                </select>
              </label>
              <label class="space-y-2 text-sm"><span>擦除模式</span>
                <select aria-label="擦除模式" v-model="settings.mode" :class="selectClass"><option value="Subtitle">Subtitle · 仅字幕</option><option value="Text">Text · 字幕及其他文字</option></select>
              </label>
              <label class="space-y-2 text-sm"><span>输出编码</span>
                <select aria-label="输出编码" v-model="settings.output_encode_mode" :class="selectClass"><option value="Quality">Quality · 画质优先</option><option value="Size">Size · 大小优先</option></select>
              </label>
            </div>
            <p class="text-xs leading-5 text-muted-foreground">{{ settings.mode === 'Subtitle' ? '仅擦除画面下半部分的字幕；自定义区域也只在下半部分内生效。' : '检测全画面字幕、人名等文字，不包含牌匾等场景文字；可设置区域缩小范围。' }} v5.6 处理耗时较 v5 明显增加。输入最高 2K，输出最高 1080P。</p>
            <details class="rounded-lg border p-4">
              <summary class="cursor-pointer text-sm font-medium">擦除区域与时间段</summary>
              <div class="mt-4 space-y-5">
                <div class="space-y-2">
                  <p class="text-xs text-muted-foreground">全局区域，留空则自动检测。坐标以左上角为 (0, 0)、右下角为 (1, 1)，最多 20 个区域。</p>
                  <ErasureLocationEditor v-model="settings.erase_ratio_location" />
                </div>
                <label class="block space-y-2 text-sm"><span>处理时间范围</span>
                  <select aria-label="处理时间范围" v-model="settings.time_segment_filter.mode" :class="selectClass"><option value="all">整段视频</option><option value="selected">仅擦除指定时间段</option><option value="skip">跳过指定时间段</option></select>
                </label>
                <div v-if="settings.time_segment_filter.mode !== 'all'" class="space-y-3">
                  <div v-for="(segment, index) in settings.time_segment_filter.segments" :key="index" class="space-y-3 rounded-lg border p-3">
                    <div class="flex flex-wrap items-end gap-3">
                      <label class="flex-1 space-y-1 text-xs"><span>开始时间（秒）</span><input v-model.number="segment.start_time" type="number" min="0" step="0.1" required :class="selectClass"></label>
                      <label class="flex-1 space-y-1 text-xs"><span>结束时间（秒）</span><input v-model.number="segment.end_time" type="number" min="0" step="0.1" required :class="selectClass"></label>
                      <Button variant="ghost" size="sm" @click="settings.time_segment_filter.segments.splice(index, 1)">移除时间段</Button>
                    </div>
                    <div v-if="settings.time_segment_filter.mode === 'selected' && !settings.erase_ratio_location.length" class="space-y-2">
                      <p class="text-xs text-muted-foreground">此时间段的独立区域（留空使用默认范围）。独立区域不能与全局区域同时使用。</p>
                      <ErasureLocationEditor v-model="segment.erase_ratio_location" />
                    </div>
                  </div>
                  <Button variant="outline" size="sm" @click="settings.time_segment_filter.segments.push({ start_time: 0, end_time: 10, erase_ratio_location: [] })">添加时间段</Button>
                </div>
              </div>
            </details>
            <details v-if="settings.mode === 'Subtitle'" class="rounded-lg border p-4">
              <summary class="cursor-pointer text-sm font-medium">字幕识别条件</summary>
              <p class="mt-3 text-xs leading-5 text-muted-foreground">比例范围为 0～1；高度相对于画面高度，中心偏移相对于画面宽度。留空使用当前算法默认值。</p>
              <div class="mt-3 grid gap-4 sm:grid-cols-3">
                <label v-for="field in filterFields" :key="field.key" class="space-y-2 text-xs"><span>{{ field.label }}</span>
                  <input :value="settings.subtitle_filter[field.key] ?? ''" type="number" min="0" max="1" step="0.01" :placeholder="field.key === 'max_text_height_ratio' ? `默认 ${settings.model_version === 'v4' ? '0.2' : '0.1'}` : field.placeholder" :class="selectClass" @input="settings.subtitle_filter[field.key] = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)">
                </label>
              </div>
            </details>
          </fieldset>
        </div>
      </details>
      <p v-if="validationError" role="alert" class="text-sm text-destructive">{{ validationError }}</p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ChevronDown, SlidersHorizontal, Upload, X } from 'lucide-vue-next'
import type { ImageTestOptions } from '@/lib/model-test-image-options'
import { imageTestCapabilities } from '@/lib/model-test-image-options'
const options = defineModel<ImageTestOptions>({ required: true })
const aspectRatio = defineModel<string>('aspectRatio', { required: true })
const resolution = defineModel<string>('resolution', { required: true })
const quality = defineModel<string>('quality', { required: true })
const size = defineModel<string>('size', { required: true })
const props = defineProps<{
  provider?: string
  model?: string
  hasReferences: boolean
  aspectRatioOptions: string[]
  resolutionOptions: string[]
  qualityOptions: string[]
  sizeOptions: string[]
}>()
const sizeModes = computed(() => {
  const modes: { value: ImageTestOptions['sizeMode'], label: string }[] = [
    { value: 'preset', label: '预设比例' }
  ]
  if (capabilities.value.customSize) modes.push(
    { value: 'ratio', label: '自定义比例' },
    { value: 'size', label: '像素尺寸' }
  )
  modes.push({ value: 'auto', label: '自动' })
  return modes
})
const attachmentKinds = computed<('mask' | 'markup')[]>(() => capabilities.value.markup ? ['mask', 'markup'] : ['mask'])
const presetRatioOptions = computed(() => props.aspectRatioOptions.filter(value => value !== 'auto'))
watch(() => options.value.sizeMode, (mode) => {
  if (mode === 'preset' && aspectRatio.value === 'auto') aspectRatio.value = presetRatioOptions.value[0] || '1:1'
}, { immediate: true })
const showResolution = computed(() => ['preset', 'ratio'].includes(options.value.sizeMode) && props.resolutionOptions.length > 0)
const advancedSummary = computed(() => [
  options.value.output_format.toUpperCase(),
  options.value.background === 'transparent' ? '透明背景' : options.value.background === 'opaque' ? '不透明背景' : '',
  options.value.stream ? '流式响应' : ''
].filter(Boolean).join(' · '))
const attachmentNames = ref({ mask: '', markup: '' })
const capabilities = computed(() => imageTestCapabilities(props.provider, props.model))
const fidelity = computed({
  get: () => options.value.input_fidelity || 'default',
  set: (value: string) => { options.value.input_fidelity = value === 'default' ? '' : value }
})
const uploadError = ref('')
async function upload(event: Event, key: 'mask' | 'markup') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadError.value = ''
  if (file.type !== 'image/png' || file.size > 4 * 1024 * 1024) {
    uploadError.value = '请上传不超过 4 MB 的透明 PNG，尺寸需与第一张参考图一致'
    return
  }
  try {
    options.value[key] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(file)
    })
    attachmentNames.value[key] = file.name
  } catch { uploadError.value = '图片读取失败，请重试' }
}
</script>

<template>
  <div v-if="capabilities.gpt" class="space-y-4 rounded-xl bg-muted/20 p-4">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="text-xs font-medium text-muted-foreground">输出尺寸</span>
      <div class="inline-flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1" role="group" aria-label="尺寸模式">
        <button
          v-for="mode in sizeModes"
          :key="mode.value"
          type="button"
          class="rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="options.sizeMode === mode.value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="options.sizeMode === mode.value"
          @click="options.sizeMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
      <label v-if="options.sizeMode === 'preset' && presetRatioOptions.length" class="space-y-1.5">
        <span class="text-xs text-muted-foreground">比例</span>
        <Select v-model="aspectRatio">
          <SelectTrigger class="h-9 w-full" aria-label="比例"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="ratio in presetRatioOptions" :key="ratio" :value="ratio">{{ ratio }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label v-if="options.sizeMode === 'ratio'" class="space-y-1.5">
        <span class="text-xs text-muted-foreground">宽高比</span>
        <Input v-model="options.ratio" class="h-9" placeholder="例如 16:9 或 2.39:1" aria-label="自定义宽高比" />
      </label>
      <label v-if="options.sizeMode === 'size'" class="col-span-2 space-y-1.5 lg:col-span-2">
        <span class="text-xs text-muted-foreground">像素尺寸 · 宽 × 高</span>
        <Input v-model="options.size" class="h-9" placeholder="例如 1536x864" aria-label="像素尺寸" />
        <p class="text-[11px] leading-relaxed text-muted-foreground">边长为 16 的倍数，长短边比不超过 3:1。</p>
      </label>
      <label v-if="showResolution" class="space-y-1.5">
        <span class="text-xs text-muted-foreground">分辨率</span>
        <Select v-model="resolution">
          <SelectTrigger class="h-9 w-full" aria-label="分辨率"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="value in resolutionOptions" :key="value" :value="value">{{ value }}</SelectItem></SelectContent>
        </Select>
      </label>
      <label v-if="options.sizeMode === 'preset' && !resolutionOptions.length && sizeOptions.length" class="space-y-1.5">
        <span class="text-xs text-muted-foreground">尺寸</span>
        <Select v-model="size">
          <SelectTrigger class="h-9 w-full" aria-label="尺寸"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="value in sizeOptions" :key="value" :value="value">{{ value.replace(/[*x]/g, ' × ') }}</SelectItem></SelectContent>
        </Select>
      </label>
      <div v-if="options.sizeMode === 'auto'" class="col-span-2 flex min-h-[62px] items-center text-xs leading-relaxed text-muted-foreground">
        模型会根据提示词和参考图决定输出尺寸。
      </div>
      <label v-if="qualityOptions.length" class="space-y-1.5">
        <span class="text-xs text-muted-foreground">画质</span>
        <Select v-model="quality">
          <SelectTrigger class="h-9 w-full" aria-label="画质"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="value in qualityOptions" :key="value" :value="value">{{ value === 'auto' ? '自动' : value.toUpperCase() }}</SelectItem></SelectContent>
        </Select>
      </label>
      <label class="space-y-1.5">
        <span class="text-xs text-muted-foreground">生成数量</span>
        <Input v-model.number="options.n" class="h-9" type="number" :min="1" :max="10" aria-label="生成数量" />
      </label>
    </div>

    <details class="group border-t border-border/60 pt-3">
      <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal class="h-3.5 w-3.5 text-muted-foreground" />
        <span class="font-medium">高级设置</span>
        <span class="text-muted-foreground">{{ advancedSummary }}</span>
        <ChevronDown class="ml-auto h-3.5 w-3.5 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label class="space-y-1.5">
          <span class="text-xs text-muted-foreground">背景</span>
          <Select v-model="options.background">
            <SelectTrigger class="h-9 w-full" aria-label="背景"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">自动</SelectItem><SelectItem value="opaque">不透明</SelectItem><SelectItem value="transparent">透明</SelectItem></SelectContent>
          </Select>
        </label>
        <label class="space-y-1.5">
          <span class="text-xs text-muted-foreground">输出格式</span>
          <Select v-model="options.output_format">
            <SelectTrigger class="h-9 w-full" aria-label="输出格式"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="png">PNG</SelectItem><SelectItem value="jpeg">JPEG</SelectItem><SelectItem value="webp">WebP</SelectItem></SelectContent>
          </Select>
        </label>
        <label v-if="options.output_format !== 'png'" class="space-y-1.5">
          <span class="text-xs text-muted-foreground">压缩质量 · 0–100</span>
          <Input v-model.number="options.output_compression" class="h-9" type="number" :min="0" :max="100" aria-label="压缩质量" />
        </label>
        <label class="space-y-1.5">
          <span class="text-xs text-muted-foreground">内容审核</span>
          <Select v-model="options.moderation">
            <SelectTrigger class="h-9 w-full" aria-label="内容审核"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">自动</SelectItem><SelectItem value="low">较宽松</SelectItem></SelectContent>
          </Select>
        </label>
        <label v-if="capabilities.fidelity && hasReferences" class="space-y-1.5">
          <span class="text-xs text-muted-foreground">参考图保真度</span>
          <Select v-model="fidelity">
            <SelectTrigger class="h-9 w-full" aria-label="参考图保真度"><SelectValue placeholder="模型默认" /></SelectTrigger>
            <SelectContent><SelectItem value="default">模型默认</SelectItem><SelectItem value="low">低</SelectItem><SelectItem v-if="capabilities.highFidelity" value="high">高</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label class="flex cursor-pointer items-center gap-2 text-xs">
          <input v-model="options.stream" type="checkbox" class="h-3.5 w-3.5 accent-primary">测试流式响应
        </label>
        <label v-if="options.stream" class="flex items-center gap-2 text-xs text-muted-foreground">
          中间预览
          <Input v-model.number="options.partial_images" class="h-8 w-20" type="number" :min="0" :max="3" aria-label="中间预览数量" />
        </label>
        <span v-if="options.stream" class="text-[11px] text-muted-foreground">请求完成后统一展示预览与最终图片</span>
      </div>
      <div v-if="hasReferences" class="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
        <template v-for="key in attachmentKinds" :key="key">
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring" :class="(key === 'mask' ? options.markup : options.mask) ? 'pointer-events-none opacity-50' : ''">
            <Upload class="h-3.5 w-3.5 text-muted-foreground" />
            <span>{{ options[key] ? attachmentNames[key] || '已上传' : key === 'mask' ? '上传蒙版' : '上传标注图' }}</span>
            <input type="file" accept="image/png" class="sr-only" :aria-label="key === 'mask' ? '上传蒙版' : '上传标注图'" :disabled="!!(key === 'mask' ? options.markup : options.mask)" @change="upload($event, key)">
          </label>
          <Button v-if="options[key]" type="button" variant="ghost" size="icon" class="h-7 w-7" :aria-label="key === 'mask' ? '移除蒙版' : '移除标注图'" @click="options[key] = ''"><X class="h-3.5 w-3.5" /></Button>
        </template>
        <span class="text-[11px] text-muted-foreground">透明 PNG，尺寸与第一张参考图一致</span>
      </div>
      <p v-if="uploadError" role="alert" class="mt-2 text-xs text-destructive">{{ uploadError }}</p>
    </details>
  </div>
</template>

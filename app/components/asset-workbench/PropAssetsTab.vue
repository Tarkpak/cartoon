<script setup lang="ts">
import { History, Loader2, Package, Plus, Sparkles, Trash2, Upload } from 'lucide-vue-next'
import type { PropAsset, PropAssetCategory } from '~/composables/useAssetWorkflowMeta'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = withDefaults(defineProps<{
  propAssets: PropAsset[]
  autoRunning: boolean
  uploadingPropId: string | null
  generatingPropId: string | null
  getPropUsageCount: (propId: string) => number
  allowAdd?: boolean
  addCategory?: PropAssetCategory
  assetLabel?: string
  addNamePlaceholder?: string
  addDescriptionPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  allowAdd: true,
  addCategory: 'prop'
})

const emit = defineEmits<{
  'add-prop': [payload: { name: string, description: string, category: PropAssetCategory }]
  'remove-prop': [propId: string]
  'generate-prop': [propId: string]
  'upload-image': [payload: { propId: string, event: Event }]
  'open-history': [propId: string]
  'preview-image': [payload: { src: string | undefined, alt: string }]
}>()

const newPropName = ref('')
const newPropDescription = ref('')
const failedImageKeys = ref<Set<string>>(new Set())

watch(
  () => props.propAssets.map(prop => `${prop.id}:${prop.referenceImage || ''}`).join('|'),
  () => {
    failedImageKeys.value = new Set(
      Array.from(failedImageKeys.value).filter((key) => {
        return props.propAssets.some(prop => buildImageLoadKey(prop) === key)
      })
    )
  }
)

function handleAddProp() {
  if (props.autoRunning) return

  const name = newPropName.value.trim()
  const description = newPropDescription.value.trim()
  if (!name) return

  emit('add-prop', { name, description, category: props.addCategory })
  newPropName.value = ''
  newPropDescription.value = ''
}

function triggerUploadInput(propId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('prop', propId)) as HTMLInputElement | null
  input?.click()
}

function resolveHistoryCount(prop: PropAsset): number {
  return Array.isArray(prop.assetHistory) ? prop.assetHistory.length : 0
}

function resolveGenerateLabel(prop: PropAsset): string {
  if (props.generatingPropId === prop.id) return '生成中'
  return prop.referenceImage ? '重新生成' : '生成'
}

function hasImageLoadFailed(propId: string): boolean {
  const prop = props.propAssets.find(item => item.id === propId)
  return !!prop && failedImageKeys.value.has(buildImageLoadKey(prop))
}

function markImageLoadFailed(propId: string) {
  const prop = props.propAssets.find(item => item.id === propId)
  if (!prop) return
  const next = new Set(failedImageKeys.value)
  next.add(buildImageLoadKey(prop))
  failedImageKeys.value = next
}

function buildImageLoadKey(prop: PropAsset): string {
  return `${prop.id}:${prop.referenceImage || ''}`
}
</script>

<template>
  <div class="space-y-4">
    <!-- Add new prop form -->
    <form
      v-if="allowAdd !== false"
      class="flex items-center gap-2"
      @submit.prevent="handleAddProp"
    >
      <Input
        v-model="newPropName"
        class="h-8 flex-1 text-xs"
        :placeholder="addNamePlaceholder || '道具名称，如：手电筒'"
      />
      <Input
        v-model="newPropDescription"
        class="h-8 flex-[1.5] text-xs"
        :placeholder="addDescriptionPlaceholder || '可选描述，如：金属外壳，冷白光'"
      />
      <Button
        type="submit"
        size="sm"
        class="h-8 gap-1.5 px-3 text-xs"
        :disabled="autoRunning || !newPropName.trim()"
      >
        <Plus class="h-3 w-3" />
        添加
      </Button>
    </form>

    <!-- Empty state -->
    <div
      v-if="propAssets.length === 0"
      class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground"
    >
      <Package class="h-8 w-8 opacity-40" />
      <p class="text-sm">
        {{ emptyTitle || `暂无${assetLabel || '道具'}资产` }}
      </p>
      <p class="text-xs">
        {{ emptyDescription || `手动新增需要保持一致的${assetLabel || '道具'}` }}
      </p>
    </div>

    <!-- Prop cards -->
    <div
      v-else
      class="grid grid-cols-1 gap-3 md:grid-cols-2"
    >
      <div
        v-for="prop in propAssets"
        :key="prop.id"
        class="group rounded-lg border bg-card transition-colors hover:border-primary/30"
      >
        <div class="flex items-start gap-3 p-3">
          <!-- Thumbnail -->
          <div
            class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40"
            :class="prop.referenceImage ? 'cursor-zoom-in' : ''"
            @click="prop.referenceImage && emit('preview-image', { src: prop.referenceImage, alt: `${prop.name} 参考图` })"
          >
            <img
              v-if="prop.referenceImage && !hasImageLoadFailed(prop.id)"
              :src="toImageSrc(prop.referenceImage)"
              :alt="`${prop.name} 参考图`"
              class="h-full w-full object-cover"
              @error="markImageLoadFailed(prop.id)"
            >
            <div
              v-else-if="prop.referenceImage"
              class="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center"
            >
              <Package class="h-4 w-4 text-destructive/60" />
              <span class="text-[10px] leading-tight text-destructive/80">图片加载失败</span>
            </div>
            <Package
              v-else
              class="h-5 w-5 text-muted-foreground/40"
            />
          </div>

          <!-- Info -->
          <div class="min-w-0 flex-1 space-y-1.5">
            <Input
              v-model="prop.name"
              class="h-7 text-xs"
              :placeholder="`${assetLabel || '道具'}名称`"
            />
            <Input
              v-model="prop.description"
              class="h-7 text-xs"
              :placeholder="`${assetLabel || '道具'}描述（可选）`"
            />
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between border-t px-3 py-1.5">
          <span class="text-[11px] text-muted-foreground/60">
            {{ getPropUsageCount(prop.id) }} 个场景引用
          </span>
          <div class="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              :disabled="autoRunning || !!uploadingPropId || !!generatingPropId || !prop.name.trim()"
              @click="emit('generate-prop', prop.id)"
            >
              <Loader2
                v-if="generatingPropId === prop.id"
                class="mr-1 h-3 w-3 animate-spin"
              />
              <Sparkles
                v-else
                class="mr-1 h-3 w-3"
              />
              {{ resolveGenerateLabel(prop) }}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              :disabled="autoRunning || !!uploadingPropId"
              @click="triggerUploadInput(prop.id)"
            >
              <Loader2
                v-if="uploadingPropId === prop.id"
                class="mr-1 h-3 w-3 animate-spin"
              />
              <Upload
                v-else
                class="mr-1 h-3 w-3"
              />
              {{ prop.referenceImage ? '更换' : '上传' }}
            </Button>
            <Button
              v-if="resolveHistoryCount(prop) > 1"
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              @click="emit('open-history', prop.id)"
            >
              <History class="mr-1 h-3 w-3" />
              历史 {{ resolveHistoryCount(prop) }}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 w-7 p-0 text-muted-foreground/60 hover:text-destructive"
              @click="emit('remove-prop', prop.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
          <Input
            :id="buildAssetUploadInputId('prop', prop.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { propId: prop.id, event: $event })"
          />
        </div>
      </div>
    </div>
  </div>
</template>

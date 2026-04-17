<script setup lang="ts">
import { Loader2, Trash2, Upload } from 'lucide-vue-next'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

defineProps<{
  propAssets: PropAsset[]
  autoRunning: boolean
  uploadingPropId: string | null
  getPropUsageCount: (propId: string) => number
}>()

const emit = defineEmits<{
  'add-prop': [payload: { name: string, description: string }]
  'remove-prop': [propId: string]
  'upload-image': [payload: { propId: string, event: Event }]
  'preview-image': [payload: { src: string | undefined, alt: string }]
}>()

const newPropName = ref('')
const newPropDescription = ref('')

function handleAddProp() {
  const name = newPropName.value.trim()
  const description = newPropDescription.value.trim()
  if (!name) return

  emit('add-prop', { name, description })
  newPropName.value = ''
  newPropDescription.value = ''
}

function triggerUploadInput(propId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('prop', propId)) as HTMLInputElement | null
  input?.click()
}
</script>

<template>
  <div class="space-y-3 rounded-md border p-3">
    <div class="text-sm font-medium">
      道具资产总览
    </div>
    <p class="text-xs text-muted-foreground">
      支持人工补充道具并修改描述；可在此直接上传道具图，场景对话窗上传的资产也会同步展示。
    </p>

    <div class="grid grid-cols-1 gap-2 md:grid-cols-[1.3fr_1.7fr_auto]">
      <Input
        v-model="newPropName"
        class="h-8 text-xs"
        placeholder="道具名称，如：手电筒"
      />
      <Input
        v-model="newPropDescription"
        class="h-8 text-xs"
        placeholder="可选描述，如：金属外壳，冷白光"
      />
      <Button
        size="sm"
        class="h-8 px-3 text-xs"
        :disabled="!newPropName.trim()"
        @click="handleAddProp"
      >
        添加道具
      </Button>
    </div>

    <div
      v-if="propAssets.length === 0"
      class="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
    >
      当前暂无道具资产。你可以手动新增需要保持一致的道具。
    </div>

    <div
      v-else
      class="grid grid-cols-1 gap-2 md:grid-cols-2"
    >
      <div
        v-for="prop in propAssets"
        :key="prop.id"
        class="rounded-md border p-2"
      >
        <div class="flex items-start justify-between gap-2">
          <Badge
            variant="outline"
            class="text-[10px]"
          >
            引用场景 {{ getPropUsageCount(prop.id) }}
          </Badge>
          <div class="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              class="h-6 px-2 text-[11px]"
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
              {{ prop.referenceImage ? '更换图片' : '上传图片' }}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              @click="emit('remove-prop', prop.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div class="mt-2 space-y-2">
          <Button
            v-if="prop.referenceImage"
            type="button"
            variant="ghost"
            class="h-auto w-full justify-start gap-2 rounded border bg-muted/20 p-1.5"
            @click="emit('preview-image', { src: prop.referenceImage, alt: `${prop.name} 参考图` })"
          >
            <img
              :src="toImageSrc(prop.referenceImage)"
              :alt="`${prop.name} 参考图`"
              class="h-8 w-8 rounded border object-cover"
            >
            <span class="truncate text-[11px] text-muted-foreground">
              已上传图片资产
            </span>
          </Button>
          <Input
            v-model="prop.name"
            class="h-8 text-xs"
            placeholder="道具名称"
          />
          <Input
            v-model="prop.description"
            class="h-8 text-xs"
            placeholder="道具描述（可选）"
          />
          <input
            :id="buildAssetUploadInputId('prop', prop.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { propId: prop.id, event: $event })"
          >
        </div>
      </div>
    </div>
  </div>
</template>

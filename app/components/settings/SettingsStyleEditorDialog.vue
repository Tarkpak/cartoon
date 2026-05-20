<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { STYLE_CATEGORIES } from '#shared/types/styles'
import type { StyleFormState } from '@/lib/style-preset-settings'

const props = defineProps<{
  styleEditorMode: 'create' | 'edit' | null
  styleEditingId: string | null
  styleCrudSaving: boolean
  styleForm: StyleFormState
  handleStyleEditorOpenChange: (open: boolean) => void
  closeStyleEditor: () => void
  submitStyleEditor: () => void
}>()

const emit = defineEmits<{
  (e: 'update-field', payload: { key: keyof StyleFormState, value: StyleFormState[keyof StyleFormState] }): void
}>()

function useStyleFormField<K extends keyof StyleFormState>(key: K) {
  return computed<StyleFormState[K]>({
    get: () => props.styleForm[key],
    set: (value) => {
      emit('update-field', { key, value })
    }
  })
}

const editorTitle = computed(() => {
  return props.styleEditorMode === 'create'
    ? '新增画风预设'
    : `编辑画风预设 · ${props.styleEditingId}`
})

const styleId = useStyleFormField('id')
const styleCategory = useStyleFormField('category')
const styleName = useStyleFormField('name')
const styleNameEn = useStyleFormField('nameEn')
const styleDescription = useStyleFormField('description')
const stylePrompt = useStyleFormField('prompt')
const styleNegativePrompt = useStyleFormField('negativePrompt')
const styleThumbnail = useStyleFormField('thumbnail')
const styleEnabled = useStyleFormField('enabled')
const styleSetAsDefault = useStyleFormField('setAsDefault')
const styleIsNew = useStyleFormField('isNew')
const styleIsPro = useStyleFormField('isPro')
</script>

<template>
  <Dialog
    :open="Boolean(props.styleEditorMode)"
    @update:open="props.handleStyleEditorOpenChange"
  >
    <DialogContent class="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {{ editorTitle }}
        </DialogTitle>
        <DialogDescription>
          配置画风预设信息，并可同步启用状态与默认画风。
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">预设 ID</label>
            <Input
              v-model="styleId"
              :disabled="props.styleEditorMode === 'edit'"
              placeholder="如: custom_style_demo"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">分类</label>
            <Select v-model="styleCategory">
              <SelectTrigger class="h-10 w-full text-sm">
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="category in STYLE_CATEGORIES"
                  :key="category.id"
                  :value="category.id"
                >
                  {{ category.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">中文名称</label>
            <Input
              v-model="styleName"
              placeholder="输入中文名称"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">英文名称</label>
            <Input
              v-model="styleNameEn"
              placeholder="输入英文名称（可选）"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">描述</label>
          <Textarea
            v-model="styleDescription"
            rows="2"
            placeholder="输入画风描述"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">预设词（Prompt）</label>
          <Textarea
            v-model="stylePrompt"
            rows="3"
            placeholder="输入预设词"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">反向预设词（可选）</label>
            <Input
              v-model="styleNegativePrompt"
              placeholder="negative prompt"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">缩略图地址（可选）</label>
            <Input
              v-model="styleThumbnail"
              placeholder="https://playlet-ai.tos-cn-guangzhou.volces.com/playlet-assets/styles/example.webp"
            />
            <p class="text-[11px] text-muted-foreground">
              请填写云存储 URL，避免使用本地路径（如 /styles/...）
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <Checkbox v-model:checked="styleEnabled" />
            启用
          </label>

          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <Checkbox v-model:checked="styleSetAsDefault" />
            设为默认
          </label>

          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <Checkbox v-model:checked="styleIsNew" />
            NEW 标记
          </label>

          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <Checkbox v-model:checked="styleIsPro" />
            PRO 标记
          </label>
        </div>
      </div>

      <DialogFooter class="flex-shrink-0">
        <Button
          variant="outline"
          :disabled="props.styleCrudSaving"
          @click="props.closeStyleEditor"
        >
          取消
        </Button>

        <Button
          :disabled="props.styleCrudSaving || !props.styleForm.name.trim() || !props.styleForm.prompt.trim() || !props.styleForm.description.trim()"
          @click="props.submitStyleEditor"
        >
          <Loader2
            v-if="props.styleCrudSaving"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          {{ props.styleEditorMode === 'create' ? '创建预设' : '保存修改' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

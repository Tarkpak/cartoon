<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { StyleCategoryInfo, StylePreset } from '#shared/types/styles'
import type { ProjectAspectRatio, ProjectDraft } from '~/lib/projects-page'
import type { ScriptParseMode } from '#shared/types/script'
import StyleSelector from '@/components/StyleSelector.vue'

const props = defineProps<{
  open: boolean
  createStep: 'basic' | 'style'
  styleConfigLoading: boolean
  availableStylePresets: StylePreset[]
  availableStyleCategories: StyleCategoryInfo[]
  defaultStyleId?: string
  newProject: ProjectDraft
  creating: boolean
  aspectRatioOptions: ReadonlyArray<{
    value: string
    label: string
    description: string
  }>
  scriptParseModeOptions: ReadonlyArray<{
    value: ScriptParseMode
    label: string
    description: string
  }>
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'update:createStep', value: 'basic' | 'style'): void
  (event: 'update:newProject', value: ProjectDraft): void
  (event: 'select-style', style: StylePreset): void
  (event: 'next-step' | 'create'): void
}>()

function updateNewProject(patch: Partial<ProjectDraft>) {
  emit('update:newProject', {
    ...props.newProject,
    ...patch
  })
}

const titleModel = computed({
  get: () => props.newProject.title,
  set: (value: string) => updateNewProject({ title: value })
})

const descriptionModel = computed({
  get: () => props.newProject.description,
  set: (value: string) => updateNewProject({ description: value })
})

const styleIdModel = computed({
  get: () => props.newProject.styleId,
  set: (value: string) => updateNewProject({ styleId: value })
})

const defaultStyle = computed(() => {
  const targetId = props.defaultStyleId?.trim()
  if (!targetId) return null
  return props.availableStylePresets.find(style => style.id === targetId) || null
})

const defaultStyleLabel = computed(() => {
  if (defaultStyle.value) return defaultStyle.value.name
  return props.defaultStyleId?.trim() || ''
})

const defaultStyleDescription = computed(() => defaultStyle.value?.description || '')

const isUsingDefaultStyle = computed(() => {
  const targetId = props.defaultStyleId?.trim()
  return !!targetId && props.newProject.styleId === targetId
})

function setAspectRatio(value: string) {
  updateNewProject({ aspectRatio: value as ProjectAspectRatio })
}

function setScriptParseMode(value: ScriptParseMode) {
  updateNewProject({ scriptParseMode: value })
}

function applyDefaultStyle() {
  const targetId = props.defaultStyleId?.trim()
  if (!targetId) return
  updateNewProject({ styleId: targetId })
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="flex max-h-[90vh] max-w-[800px] flex-col sm:max-w-[800px]">
      <DialogHeader>
        <DialogTitle>新建项目</DialogTitle>
        <DialogDescription>
          {{ createStep === 'basic' ? '填写项目基本信息' : '选择画风预设' }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="createStep === 'basic'"
        class="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1"
      >
        <div class="grid gap-2">
          <label class="text-sm font-medium">项目名称 <span class="text-destructive">*</span></label>
          <Input
            v-model="titleModel"
            placeholder="输入项目名称..."
          />
        </div>
        <div class="grid gap-2">
          <label class="text-sm font-medium">项目描述（可选）</label>
          <Textarea
            v-model="descriptionModel"
            placeholder="项目简介（可选）"
            rows="2"
          />
        </div>
        <div class="grid gap-2">
          <label class="text-sm font-medium">解析模式 <span class="text-destructive">*</span></label>
          <div class="grid grid-cols-2 gap-2">
            <Button
              v-for="option in scriptParseModeOptions"
              :key="option.value"
              type="button"
              variant="ghost"
              class="h-auto rounded-md border p-3 text-left transition whitespace-normal"
              :class="newProject.scriptParseMode === option.value ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/50'"
              @click="setScriptParseMode(option.value)"
            >
              <div class="text-sm font-medium">
                {{ option.label }}
              </div>
              <div class="text-xs text-muted-foreground">
                {{ option.description }}
              </div>
            </Button>
          </div>
        </div>
        <div class="grid gap-2">
          <label class="text-sm font-medium">视频比例 <span class="text-destructive">*</span></label>
          <div class="grid grid-cols-3 gap-2">
            <Button
              v-for="option in aspectRatioOptions"
              :key="option.value"
              type="button"
              variant="ghost"
              class="h-auto rounded-md border p-3 text-center transition whitespace-normal"
              :class="newProject.aspectRatio === option.value ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/50'"
              @click="setAspectRatio(option.value)"
            >
              <div class="text-sm font-medium">
                {{ option.label }}
              </div>
              <div class="text-xs text-muted-foreground">
                {{ option.description }}
              </div>
            </Button>
          </div>
        </div>
      </div>

      <div
        v-else
        class="min-h-0 flex-1 overflow-y-auto py-4 pr-1"
      >
        <div
          v-if="defaultStyleLabel"
          class="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs text-amber-700">
                系统默认预设
              </p>
              <p class="text-sm font-semibold text-foreground truncate">
                {{ defaultStyleLabel }}
              </p>
              <p
                v-if="defaultStyleDescription"
                class="mt-0.5 text-xs text-muted-foreground line-clamp-2"
              >
                {{ defaultStyleDescription }}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              :disabled="isUsingDefaultStyle"
              @click="applyDefaultStyle"
            >
              {{ isUsingDefaultStyle ? '已在使用' : '一键使用默认' }}
            </Button>
          </div>
        </div>
        <div
          v-if="styleConfigLoading && availableStylePresets.length === 0"
          class="flex h-full items-center justify-center text-sm text-muted-foreground"
        >
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          加载画风配置中...
        </div>
        <StyleSelector
          v-else
          v-model="styleIdModel"
          :show-search="true"
          :styles="availableStylePresets"
          :categories="availableStyleCategories"
          :default-style-id="defaultStyleId"
          @select="$emit('select-style', $event)"
        />
      </div>

      <DialogFooter class="flex-shrink-0">
        <Button
          v-if="createStep === 'style'"
          variant="outline"
          @click="$emit('update:createStep', 'basic')"
        >
          上一步
        </Button>
        <Button
          v-else
          variant="outline"
          @click="$emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          v-if="createStep === 'basic'"
          :disabled="!newProject.title.trim()"
          @click="$emit('next-step')"
        >
          下一步：选择画风
        </Button>
        <Button
          v-else
          :disabled="!newProject.styleId || creating"
          @click="$emit('create')"
        >
          <Loader2
            v-if="creating"
            class="mr-2 h-4 w-4 animate-spin"
          />
          创建项目
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

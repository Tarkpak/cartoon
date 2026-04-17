<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { StyleCategoryInfo, StylePreset } from '#shared/types/styles'
import type { ProjectAspectRatio, ProjectDraft } from '~/lib/projects-page'
import StyleSelector from '@/components/StyleSelector.vue'

const props = defineProps<{
  open: boolean
  createStep: 'basic' | 'style'
  styleConfigLoading: boolean
  availableStylePresets: StylePreset[]
  availableStyleCategories: StyleCategoryInfo[]
  newProject: ProjectDraft
  creating: boolean
  aspectRatioOptions: ReadonlyArray<{
    value: string
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

function setAspectRatio(value: string) {
  updateNewProject({ aspectRatio: value as ProjectAspectRatio })
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
          {{ createStep === 'basic' ? '填写项目信息并选择工作流' : '选择画风预设' }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="createStep === 'basic'"
        class="grid gap-4 py-4"
      >
        <div class="grid gap-2">
          <label class="text-sm font-medium">项目名称 <span class="text-destructive">*</span></label>
          <Input
            v-model="titleModel"
            placeholder="输入项目名称..."
          />
        </div>
        <div class="grid gap-2">
          <label class="text-sm font-medium">项目描述 (可选)</label>
          <Textarea
            v-model="descriptionModel"
            placeholder="简单描述你的项目..."
            rows="2"
          />
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
        class="min-h-[400px] flex-1 overflow-y-auto py-4"
      >
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

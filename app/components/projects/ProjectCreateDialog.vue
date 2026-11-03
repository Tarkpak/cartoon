<script setup lang="ts">
import { Check, Loader2, Star } from 'lucide-vue-next'
import type { StyleCategoryInfo, StylePreset } from '#shared/types/styles'
import type { ProjectAspectRatio, ProjectDraft } from '~/lib/projects-page'
import type { ScriptParseMode } from '#shared/types/script'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import StyleSelector from '@/components/StyleSelector.vue'

const props = defineProps<{
  open: boolean
  workspace?: 'video' | 'writing'
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

const isWritingWorkspace = computed(() => props.workspace === 'writing')
const dialogTitle = computed(() => isWritingWorkspace.value ? '新建 AI 剧本项目' : '新建视频项目')
const basicDescription = computed(() => isWritingWorkspace.value ? '填写剧本项目的创作基础信息' : '填写视频项目基本信息')
const styleDescription = computed(() => '选择视频项目的画风预设')
const titlePlaceholder = computed(() => isWritingWorkspace.value ? '例如：长安旧梦' : '输入项目名称...')

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

function draftFieldModel<K extends keyof ProjectDraft>(key: K) {
  return computed({
    get: () => props.newProject[key],
    set: (value: ProjectDraft[K]) => updateNewProject({ [key]: value } as Partial<ProjectDraft>)
  })
}

const ideaModel = draftFieldModel('idea')
const genreModel = draftFieldModel('genre')
const customGenreModel = draftFieldModel('customGenre')
const audienceModel = draftFieldModel('audience')
const customAudienceModel = draftFieldModel('customAudience')
const episodeCountModel = draftFieldModel('episodeCount')
const episodeDurationModel = draftFieldModel('episodeDuration')
const requirementsModel = draftFieldModel('requirements')

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

const selectedWorkflowPreset = computed(() => resolveVideoWorkflowPreset(props.newProject.scriptParseMode))
const hidesStylePicker = computed(() => selectedWorkflowPreset.value.stylePickerMode === 'hidden')
const genreOptions = [
  '现代甜宠·都市情感', '先婚后爱·契约婚姻', '追妻火葬场·虐恋', '重生复仇·女性逆袭',
  '双向救赎·治愈', '豪门恩怨·真假千金', '闪婚萌宝·带球跑', '家庭伦理·婚姻成长',
  '年代爱情·军婚', '古装言情·宅斗宫斗', '都市逆袭·神豪', '战神赘婿·高手下山',
  '玄幻修仙·异能', '历史穿越·朝堂权谋', '商战职场·创业逆袭', '乡村年代·奋斗致富',
  '悬疑推理·刑侦犯罪', '惊悚灵异·规则怪谈', '灾荒求生·末日生存', '科幻脑洞·时空循环',
  '喜剧·家庭温情', '青春校园·成长', '文旅非遗·地域故事', '现实主义·社会议题', '其他'
]
const audienceOptions = [
  '短视频用户', '女性向用户', '男性向用户', '年轻用户（18-24岁）', '泛大众用户',
  '家庭用户', '儿童与亲子', '其他'
]

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
    <!-- Step 1 sizes to its form; only the style grid needs the tall fixed height. -->
    <DialogContent
      class="flex max-w-[800px] flex-col overflow-hidden sm:max-w-[800px]"
      :class="createStep === 'style' ? 'h-[min(90vh,920px)]' : ''"
    >
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>
          {{ createStep === 'basic' ? basicDescription : styleDescription }}
        </DialogDescription>
      </DialogHeader>

      <ol
        v-if="!isWritingWorkspace && !hidesStylePicker"
        class="flex items-center gap-2 text-xs"
        aria-label="创建步骤"
      >
        <li
          v-for="(step, index) in [{ key: 'basic', label: '基本信息' }, { key: 'style', label: '选择画风' }]"
          :key="step.key"
          class="flex items-center gap-2"
          :aria-current="createStep === step.key ? 'step' : undefined"
        >
          <span
            v-if="index > 0"
            class="h-px w-6 bg-border"
            aria-hidden="true"
          />
          <span
            class="flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
            :class="createStep === step.key
              ? 'bg-primary text-primary-foreground'
              : step.key === 'basic' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'"
          >
            <Check
              v-if="step.key === 'basic' && createStep === 'style'"
              class="h-3 w-3"
            />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span :class="createStep === step.key ? 'font-medium text-foreground' : 'text-muted-foreground'">{{ step.label }}</span>
        </li>
      </ol>

      <div
        v-if="createStep === 'basic'"
        class="min-h-0 flex-1 space-y-5 overflow-y-auto py-1 pr-1"
      >
        <div class="grid gap-2">
          <label
            for="project-create-title"
            class="text-sm font-medium"
          >项目名称 <span class="text-destructive">*</span></label>
          <Input
            id="project-create-title"
            v-model="titleModel"
            :placeholder="titlePlaceholder"
          />
        </div>
        <div class="grid gap-2">
          <label
            for="project-create-description"
            class="text-sm font-medium"
          >项目描述 <span class="font-normal text-muted-foreground">（可选）</span></label>
          <Textarea
            id="project-create-description"
            v-model="descriptionModel"
            class="resize-none"
            placeholder="一两句话说明这个项目"
            rows="2"
          />
        </div>
        <div v-if="!isWritingWorkspace" class="grid gap-2">
          <label class="text-sm font-medium">解析模式 <span class="text-destructive">*</span></label>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="option in scriptParseModeOptions"
              :key="option.value"
              type="button"
              class="relative flex flex-col items-start gap-1 rounded-xl p-3 pr-8 text-left transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="newProject.scriptParseMode === option.value
                ? 'bg-primary/[0.07] ring-2 ring-inset ring-primary'
                : 'bg-muted/30 ring-1 ring-inset ring-border/60 hover:bg-muted/50'"
              :aria-pressed="newProject.scriptParseMode === option.value"
              @click="setScriptParseMode(option.value)"
            >
              <span class="text-sm font-medium">{{ option.label }}</span>
              <span class="text-xs leading-5 text-muted-foreground">{{ option.description }}</span>
              <Check
                v-if="newProject.scriptParseMode === option.value"
                class="absolute right-3 top-3 h-4 w-4 text-primary"
              />
            </button>
          </div>
        </div>
        <div v-if="!isWritingWorkspace" class="grid gap-2">
          <label class="text-sm font-medium">成片比例 <span class="text-destructive">*</span></label>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              v-for="option in aspectRatioOptions"
              :key="option.value"
              type="button"
              class="relative flex flex-col items-start gap-1 rounded-xl p-3 pr-8 text-left transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="newProject.aspectRatio === option.value
                ? 'bg-primary/[0.07] ring-2 ring-inset ring-primary'
                : 'bg-muted/30 ring-1 ring-inset ring-border/60 hover:bg-muted/50'"
              :aria-pressed="newProject.aspectRatio === option.value"
              @click="setAspectRatio(option.value)"
            >
              <span class="text-sm font-medium">{{ option.label }}</span>
              <span class="text-xs leading-5 text-muted-foreground">{{ option.description }}</span>
              <Check
                v-if="newProject.aspectRatio === option.value"
                class="absolute right-3 top-3 h-4 w-4 text-primary"
              />
            </button>
          </div>
        </div>
        <template v-if="isWritingWorkspace">
          <div class="grid gap-2">
            <label class="text-sm font-medium">核心创意 <span class="text-destructive">*</span></label>
            <Textarea v-model="ideaModel" rows="3" placeholder="一句话故事、人物困境或想表达的主题" />
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">剧本类型 <span class="text-destructive">*</span></label>
            <Select v-model="genreModel">
              <SelectTrigger><SelectValue placeholder="选择剧本类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in genreOptions" :key="option" :value="option">{{ option }}</SelectItem>
              </SelectContent>
            </Select>
            <Input v-if="genreModel === '其他'" v-model="customGenreModel" placeholder="填写自定义类型" />
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="grid gap-2">
              <label class="text-sm font-medium">面向人群 <span class="text-destructive">*</span></label>
              <Select v-model="audienceModel">
                <SelectTrigger><SelectValue placeholder="选择目标观众" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in audienceOptions" :key="option" :value="option">{{ option }}</SelectItem>
                </SelectContent>
              </Select>
              <Input v-if="audienceModel === '其他'" v-model="customAudienceModel" placeholder="填写自定义受众" />
            </div>
            <div class="grid content-start gap-2">
              <label class="text-sm font-medium">集数 <span class="text-destructive">*</span></label>
              <Input v-model.number="episodeCountModel" type="number" min="1" max="100" />
            </div>
            <div class="grid content-start gap-2">
              <label class="text-sm font-medium">单集时长（秒） <span class="text-destructive">*</span></label>
              <Input v-model.number="episodeDurationModel" type="number" min="15" max="1800" />
            </div>
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">额外要求（可选）</label>
            <Textarea v-model="requirementsModel" rows="3" placeholder="禁用元素、结局方向、必须保留的设定" />
          </div>
        </template>
      </div>

      <div
        v-else
        class="flex min-h-0 flex-1 flex-col gap-3 py-3"
      >
        <div
          v-if="defaultStyleLabel"
          class="flex shrink-0 items-center gap-3 rounded-xl bg-warning/10 px-3 py-2"
        >
          <Star class="h-4 w-4 shrink-0 fill-warning text-warning" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="shrink-0 text-xs font-medium text-warning">系统默认</span>
              <span class="truncate text-sm font-semibold text-foreground">{{ defaultStyleLabel }}</span>
            </div>
            <p
              v-if="defaultStyleDescription"
              class="truncate text-xs text-muted-foreground"
            >
              {{ defaultStyleDescription }}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            class="shrink-0"
            :disabled="isUsingDefaultStyle"
            @click="applyDefaultStyle"
          >
            {{ isUsingDefaultStyle ? '使用中' : '设为当前' }}
          </Button>
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
          :grid-scrollable="true"
          :show-selected-preview="false"
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
          :disabled="!newProject.title.trim() || (isWritingWorkspace && !String(newProject.idea || '').trim()) || creating"
          @click="$emit('next-step')"
        >
          <Loader2
            v-if="creating && hidesStylePicker"
            class="mr-2 h-4 w-4 animate-spin"
          />
          {{ isWritingWorkspace || hidesStylePicker ? (isWritingWorkspace ? '创建剧本项目' : '创建视频项目') : '下一步：选择画风' }}
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
          {{ isWritingWorkspace ? '创建剧本项目' : '创建视频项目' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

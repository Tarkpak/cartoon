<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import StyleSelector from '@/components/StyleSelector.vue'

export interface VideoImportCreateProjectOptions {
  projectTitle?: string
  styleId?: string
  aspectRatio: '16:9' | '9:16' | '1:1'
}

const props = defineProps<{
  defaultTitle: string
  defaultAspectRatio?: string
  defaultStyleId?: string
  isOriginExplainer: boolean
  episodeCount?: number
  submitting?: boolean
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  confirm: [options: VideoImportCreateProjectOptions]
}>()

const title = ref('')
const aspectRatio = ref<'16:9' | '9:16' | '1:1'>('9:16')
const styleId = ref('')
const {
  presets,
  categories,
  defaultStyleId: presetDefaultStyleId,
  loading: stylesLoading,
  error: stylesError,
  loadStylePresets
} = useStylePresets()

watch(open, async (value) => {
  if (!value) return
  title.value = props.defaultTitle
  aspectRatio.value = (['16:9', '9:16', '1:1'].includes(props.defaultAspectRatio || '')
    ? props.defaultAspectRatio
    : '9:16') as '16:9' | '9:16' | '1:1'
  styleId.value = ''
  if (props.isOriginExplainer) return
  await loadStylePresets()
  pickDefaultStyle()
})

watch([presets, presetDefaultStyleId], pickDefaultStyle)

function pickDefaultStyle() {
  if (!open.value || props.isOriginExplainer || styleId.value) return
  const available = new Set(presets.value.map(style => style.id))
  if (props.defaultStyleId && available.has(props.defaultStyleId)) {
    styleId.value = props.defaultStyleId
  } else if (available.has(presetDefaultStyleId.value)) {
    styleId.value = presetDefaultStyleId.value
  } else {
    styleId.value = presets.value[0]?.id || ''
  }
}

const canSubmit = computed(() => !props.submitting && (props.isOriginExplainer || !!styleId.value))

function submit() {
  if (!canSubmit.value) return
  emit('confirm', {
    projectTitle: title.value.trim() || undefined,
    styleId: props.isOriginExplainer ? undefined : styleId.value,
    aspectRatio: aspectRatio.value
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="open = $event">
    <DialogContent class="flex max-h-[90vh] flex-col sm:max-w-[800px]">
      <DialogHeader>
        <DialogTitle>创建项目</DialogTitle>
        <DialogDescription>
          <template v-if="episodeCount && episodeCount > 1">将按 {{ episodeCount }} 集分别解析后合并为一个项目，</template>
          {{ isOriginExplainer ? '按科普拆解方式解析。' : '画风会用于后续角色、环境和分镜视频生成。' }}
          创建在后台进行，期间可以离开此页面。
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-1">
        <div class="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:gap-3">
          <div class="grid gap-1.5">
            <label for="video-import-project-title" class="text-xs font-medium text-muted-foreground">项目名称</label>
            <Input id="video-import-project-title" v-model="title" placeholder="项目名称" />
          </div>
          <div class="grid gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">画幅</label>
            <Select v-model="aspectRatio">
              <SelectTrigger class="bg-background">
                <SelectValue placeholder="画幅" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">竖屏 9:16</SelectItem>
                <SelectItem value="16:9">横屏 16:9</SelectItem>
                <SelectItem value="1:1">方形 1:1</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div v-if="!isOriginExplainer" class="grid gap-2">
          <div class="text-sm font-medium text-foreground">项目画风</div>
          <div
            v-if="stylesLoading && presets.length === 0"
            class="flex min-h-32 items-center justify-center text-sm text-muted-foreground"
          >
            <Loader2 class="mr-2 h-4 w-4 animate-spin" />
            加载画风配置中...
          </div>
          <div
            v-else-if="presets.length === 0"
            class="rounded-xl bg-destructive/10 px-3 py-3 text-sm text-destructive"
          >
            {{ stylesError || '没有可用画风，请先在设置中启用画风预设。' }}
          </div>
          <StyleSelector
            v-else
            v-model="styleId"
            :styles="presets"
            :categories="categories"
            :default-style-id="presetDefaultStyleId"
            :show-search="true"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
          开始创建
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

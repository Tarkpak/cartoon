<script setup lang="ts">
import { ArrowRight, Check, CircleAlert, Clapperboard, FileText, Film, Layers3, Loader2, RefreshCw } from 'lucide-vue-next'
import type { WorkflowCategoryKey, WorkflowData } from '@/composables/useSettingsWorkflowModels'
import { markOnboardingCompleted } from '@/lib/onboarding'

const router = useRouter()
const { currentUser } = useCloudAdmin()
const {
  isDesktopRuntime,
  status: ffmpegStatus,
  checking: ffmpegChecking,
  statusLabel: ffmpegStatusLabel,
  ensureDesktopFfmpegStatus,
  openInstallDialog
} = useDesktopFfmpeg()

// ---- Model readiness: one row per model type the workbench needs ----
const MODEL_TYPES: Array<{ key: WorkflowCategoryKey, label: string, usage: string }> = [
  { key: 'text', label: '文本模型', usage: '剧本解析与场景改写' },
  { key: 'image', label: '图片模型', usage: '角色、环境和道具图' },
  { key: 'video', label: '视频模型', usage: '分镜视频生成' }
]

const modelsLoading = ref(true)
const modelsError = ref('')
const workflowData = ref<WorkflowData | null>(null)

async function loadModels() {
  modelsLoading.value = true
  modelsError.value = ''
  try {
    const response = await $fetch<{ success: boolean, data: WorkflowData }>('/api/models/workflow')
    if (!response.success) throw new Error('模型状态读取失败')
    workflowData.value = response.data
  } catch {
    modelsError.value = '暂时无法读取模型状态，请稍后重试。'
  } finally {
    modelsLoading.value = false
  }
}

function isModelTypeReady(key: WorkflowCategoryKey): boolean {
  return (workflowData.value?.workflows || [])
    .filter(workflow => workflow.category === key)
    .some(workflow => workflow.compatibleModels.length > 0)
}

const allModelsReady = computed(() => MODEL_TYPES.every(type => isModelTypeReady(type.key)))

onMounted(() => {
  void loadModels()
  void ensureDesktopFfmpegStatus()
})

const STAGES = [
  { icon: FileText, title: '剧本解析', description: '粘贴剧本，拆成分集和场景' },
  { icon: Layers3, title: '资产准备', description: '生成角色、环境和道具参考图' },
  { icon: Film, title: '分镜视频', description: '按场景批量生成视频片段' },
  { icon: Clapperboard, title: '成片导出', description: '排好顺序，合成或导出剪映工程' }
]

function finish(path: string) {
  markOnboardingCompleted()
  void router.replace(path)
}
</script>

<template>
  <div class="min-h-full bg-background py-8 pr-5 sm:pr-8 lg:pr-10">
    <div class="mx-auto max-w-3xl space-y-8">
      <header class="space-y-2">
        <p class="text-sm font-medium text-primary">
          新手引导
        </p>
        <h1 class="text-3xl font-semibold tracking-tight text-foreground">
          欢迎使用 Playlet
        </h1>
        <p class="max-w-prose text-sm leading-6 text-muted-foreground">
          开始前先确认下面几项已经就绪。全部就绪后，就可以创建第一个项目，把剧本变成视频。
        </p>
      </header>

      <!-- Readiness checklist -->
      <section
        class="space-y-3"
        aria-labelledby="welcome-checklist-title"
      >
        <div class="flex items-center justify-between gap-3">
          <h2
            id="welcome-checklist-title"
            class="text-base font-semibold"
          >
            准备工作
          </h2>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 gap-1.5 text-xs text-muted-foreground"
            :disabled="modelsLoading || ffmpegChecking"
            @click="loadModels(); ensureDesktopFfmpegStatus()"
          >
            <RefreshCw class="h-3.5 w-3.5" />
            重新检测
          </Button>
        </div>

        <ul class="divide-y overflow-hidden rounded-xl bg-muted/25">
          <li class="flex items-center gap-3 px-4 py-3">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <Check class="h-3.5 w-3.5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">账号已登录</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ currentUser?.displayName || currentUser?.account || '当前账号' }}
              </span>
            </span>
          </li>

          <li
            v-for="type in MODEL_TYPES"
            :key="type.key"
            class="flex items-center gap-3 px-4 py-3"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              :class="modelsLoading
                ? 'bg-muted text-muted-foreground'
                : isModelTypeReady(type.key) ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'"
            >
              <Loader2
                v-if="modelsLoading"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Check
                v-else-if="isModelTypeReady(type.key)"
                class="h-3.5 w-3.5"
              />
              <CircleAlert
                v-else
                class="h-3.5 w-3.5"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ type.label }}</span>
              <span class="block text-xs text-muted-foreground">用于{{ type.usage }}</span>
            </span>
            <span
              class="shrink-0 text-xs"
              :class="modelsLoading || isModelTypeReady(type.key) ? 'text-muted-foreground' : 'text-warning'"
            >
              {{ modelsLoading ? '检测中…' : isModelTypeReady(type.key) ? '可用' : '未开通' }}
            </span>
          </li>

          <li
            v-if="isDesktopRuntime"
            class="flex items-center gap-3 px-4 py-3"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              :class="!ffmpegStatus
                ? 'bg-muted text-muted-foreground'
                : ffmpegStatus.available ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'"
            >
              <Loader2
                v-if="!ffmpegStatus"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Check
                v-else-if="ffmpegStatus.available"
                class="h-3.5 w-3.5"
              />
              <CircleAlert
                v-else
                class="h-3.5 w-3.5"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">FFmpeg</span>
              <span class="block text-xs text-muted-foreground">用于合成成片、去字幕和本地视频处理</span>
            </span>
            <Button
              v-if="ffmpegStatus && !ffmpegStatus.available"
              size="sm"
              variant="outline"
              class="h-7 shrink-0 text-xs"
              @click="openInstallDialog"
            >
              安装
            </Button>
            <span
              v-else
              class="shrink-0 text-xs text-muted-foreground"
            >
              {{ ffmpegStatusLabel }}
            </span>
          </li>
        </ul>

        <p
          v-if="modelsError"
          class="text-xs text-destructive"
        >
          {{ modelsError }}
        </p>
        <p
          v-else-if="!modelsLoading && !allModelsReady"
          class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          有模型还没有开通。模型由管理员统一配置，请联系管理员开通；在此之前，对应的生成步骤无法使用。
        </p>
      </section>

      <!-- Workflow overview -->
      <section
        class="space-y-3"
        aria-labelledby="welcome-flow-title"
      >
        <h2
          id="welcome-flow-title"
          class="text-base font-semibold"
        >
          创作流程
        </h2>
        <ol class="grid gap-2 sm:grid-cols-4">
          <li
            v-for="(stage, index) in STAGES"
            :key="stage.title"
            class="rounded-xl bg-muted/25 p-3"
          >
            <div class="mb-2 flex items-center gap-2 text-muted-foreground">
              <span class="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {{ index + 1 }}
              </span>
              <component
                :is="stage.icon"
                class="h-4 w-4"
              />
            </div>
            <p class="text-sm font-medium">
              {{ stage.title }}
            </p>
            <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
              {{ stage.description }}
            </p>
          </li>
        </ol>
      </section>

      <footer class="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button
          class="gap-2"
          @click="finish('/projects?new=1')"
        >
          创建第一个项目
          <ArrowRight class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          @click="finish('/projects')"
        >
          先看看项目列表
        </Button>
        <p class="w-full text-xs text-muted-foreground">
          以后打开软件会直接进入「我的项目」。需要时可以在「设置 → 通用」里重新查看本引导。
        </p>
      </footer>
    </div>
  </div>
</template>

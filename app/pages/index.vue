<script setup lang="ts">
import { FileText, FolderOpen, Sparkles, Layers3, Film, ScrollText, Settings, History } from 'lucide-vue-next'
import { createClickRipple } from '@/lib/ripple'
import { resolveProjectWorkbenchPath } from '#shared/types/project'

definePageMeta({
  layout: 'default'
})

const router = useRouter()

const lastProjectId = ref<string | null>(null)

onMounted(() => {
  if (typeof window === 'undefined') return
  lastProjectId.value = window.localStorage.getItem('playlet:last-project-id')
})

function navigateTo(path: string) {
  router.push(path)
}

// 开始创作：直接打开「新建项目」对话框
function startCreate() {
  router.push('/projects?new=1')
}

// 继续创作：回到最近一次打开的项目工作台
function continueLast() {
  if (!lastProjectId.value) return
  router.push(resolveProjectWorkbenchPath(lastProjectId.value))
}

function handleQuickActionPointerDown(event: PointerEvent) {
  createClickRipple(event)
}

// 功能展示卡片（说明产品能力，非独立入口）
const features = [
  {
    icon: FileText,
    title: '剧本解析',
    description: '导入小说或剧本后拆成场景、角色、对白和旁白，保留后续生成所需的上下文。'
  },
  {
    icon: Layers3,
    title: '资产准备',
    description: '集中生成角色、环境和道具素材，按镜头复用参考图，减少风格漂移。'
  },
  {
    icon: Film,
    title: '分镜视频',
    description: '按场景批量生成视频片段，检查失败队列后再合并交付版本。'
  }
]

// 快捷入口（各入口行为相互区分）
const quickActions = computed(() => [
  { icon: FolderOpen, label: '我的项目', handler: () => navigateTo('/projects') },
  { icon: Sparkles, label: '开始创作', handler: startCreate },
  ...(lastProjectId.value
    ? [{ icon: History, label: '继续创作', handler: continueLast }]
    : []),
  { icon: Settings, label: '设置', handler: () => navigateTo('/settings') },
  { icon: ScrollText, label: '日志', handler: () => navigateTo('/logs') }
])

const heroStats = computed(() => [
  {
    value: '3 阶段',
    label: '解析 / 素材 / 视频'
  },
  {
    value: lastProjectId.value ? '可继续' : '待创建',
    label: '最近项目'
  },
  {
    value: '队列追踪',
    label: '失败任务可重试'
  }
])
</script>

<template>
  <div class="min-h-screen bg-background py-5 pr-5 sm:pr-8 lg:pr-10">
    <section class="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="relative flex min-h-[23rem] flex-col justify-between overflow-hidden rounded-lg border border-border/60 bg-card/65 px-6 py-7 shadow-[0_20px_58px_hsl(var(--foreground)/0.055)] sm:px-9 sm:py-9">
        <div class="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_16%_18%,hsl(var(--primary)/0.11),transparent_32%),radial-gradient(circle_at_86%_8%,hsl(var(--warning)/0.08),transparent_24%)]" />
        <div class="relative max-w-3xl">
          <p class="mb-4 inline-flex rounded-sm bg-primary/10 px-2.5 py-1 text-xs font-semibold tracking-[0.14em] text-primary">
            项目生产台
          </p>
          <h1 class="mb-4 max-w-3xl text-3xl font-semibold leading-[1.06] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            剧本到视频的生产工作台
          </h1>
          <p class="mb-7 max-w-2xl text-base leading-7 text-muted-foreground">
            解析场景、锁定角色资产、生成分镜视频，并在一个工作台里追踪失败队列和素材版本。
          </p>
          <div class="flex flex-wrap gap-3">
            <Button
              size="lg"
              class="px-7"
              @click="startCreate"
            >
              开始创作
            </Button>
            <Button
              v-if="lastProjectId"
              variant="outline"
              size="lg"
              class="px-7"
              @click="continueLast"
            >
              继续创作
            </Button>
          </div>
        </div>

        <div class="relative mt-8 grid gap-3 sm:grid-cols-3">
          <div
            v-for="stat in heroStats"
            :key="stat.label"
            class="flex min-h-24 flex-col justify-center rounded-md border border-border/60 bg-background/65 p-3.5"
          >
            <p class="text-xl font-semibold text-foreground">
              {{ stat.value }}
            </p>
            <p class="mt-1 text-xs font-medium text-muted-foreground">
              {{ stat.label }}
            </p>
          </div>
        </div>
      </div>

      <Card class="flex h-full flex-col bg-card/72 shadow-[0_16px_44px_hsl(var(--foreground)/0.05)]">
        <CardHeader class="px-6 pb-3 pt-6">
          <CardTitle class="text-lg">
            快速入口
          </CardTitle>
        </CardHeader>
        <CardContent class="flex flex-1 px-5 pb-5">
          <div class="grid flex-1 content-between gap-1.5">
            <button
              v-for="action in quickActions"
              :key="action.label"
              type="button"
              class="group relative flex min-h-12 items-center gap-3 overflow-hidden rounded-md border border-transparent bg-transparent px-3 py-2 text-left transition-[background-color,border-color] duration-200 hover:border-border hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @pointerdown="handleQuickActionPointerDown"
              @click="action.handler()"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-colors group-hover:bg-background">
                <component
                  :is="action.icon"
                  class="h-5 w-5"
                />
              </span>
              <span class="text-sm font-semibold text-foreground">{{ action.label }}</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </section>

    <section class="mt-6">
      <div class="mb-4 flex items-end justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-primary">
            工作流
          </p>
          <h2 class="mt-1 text-2xl font-semibold tracking-tight">
            从解析到合片的关键节点
          </h2>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card
          v-for="(feature, index) in features"
          :key="feature.title"
          :class="[
            'group overflow-hidden',
            index === 0 ? 'lg:row-span-2' : ''
          ]"
        >
          <CardHeader :class="index === 0 ? 'p-7 sm:p-8' : 'p-6'">
            <div class="mb-5 flex items-center gap-3">
              <div class="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                <component
                  :is="feature.icon"
                  class="h-5 w-5"
                />
              </div>
              <span class="text-sm font-semibold text-muted-foreground">0{{ index + 1 }}</span>
            </div>
            <CardTitle :class="index === 0 ? 'text-3xl leading-tight' : 'text-xl leading-tight'">
              {{ feature.title }}
            </CardTitle>
          </CardHeader>
          <CardContent :class="index === 0 ? 'px-7 pb-8 sm:px-8' : 'px-6 pb-6'">
            <p class="max-w-prose text-sm leading-7 text-muted-foreground">
              {{ feature.description }}
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  </div>
</template>

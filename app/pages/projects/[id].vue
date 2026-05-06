<script setup lang="ts">
import {
  ArrowLeft,
  Clapperboard,
  FileText,
  FolderKanban,
  Loader2,
  Sparkles
} from 'lucide-vue-next'
import type {
  ProjectWorkbenchStage,
  ProjectWorkflowType
} from '#shared/types/project'
import { resolveProjectWorkbenchPath } from '#shared/types/project'
import {
  SCRIPT_PARSE_MODE_LABELS,
  normalizeScriptParseMode
} from '#shared/types/script'
import {
  formatProjectDateTime,
  projectStatusMap
} from '~/lib/projects-page'

interface ProjectDetailEpisodePlanItem {
  id: string
  title: string
  index: number
  startOffset?: number | null
  endOffset?: number | null
  charCount?: number | null
}

interface ProjectDetailSceneItem {
  id: string
  episodeId?: string | null
  episodeTitle?: string | null
  episodeIndex?: number | null
  videoUrl?: string | null
}

interface ProjectDetailPayload {
  project: {
    id: string
    name: string
    description: string | null
    workflowType?: ProjectWorkflowType | null
    scriptParseMode?: string | null
    styleId: string
    aspectRatio: string
    status: string | null
    createdAt: string
    updatedAt: string
  }
  script: {
    episodePlan?: ProjectDetailEpisodePlanItem[]
  } | null
  scenes: ProjectDetailSceneItem[]
  characters: Array<{ id: string }>
}

interface ProjectDetailResponse {
  success: boolean
  data?: ProjectDetailPayload
}

interface ProjectEpisodeDirectoryItem {
  id: string
  title: string
  index: number
  sceneCount: number
  doneCount: number
}

definePageMeta({
  layout: 'default',
  hideSidebar: true
})

const route = useRoute()
const router = useRouter()
const { resolveStyleById, loadStylePresets } = useStylePresets()

const projectId = computed(() => {
  const raw = route.params.id
  return typeof raw === 'string' ? raw.trim() : ''
})

const {
  data: detailResponse,
  pending,
  error,
  refresh
} = await useAsyncData(
  () => `project-detail:${projectId.value}`,
  async () => {
    const id = projectId.value
    if (!id) {
      return {
        success: false
      } satisfies ProjectDetailResponse
    }

    return $fetch<ProjectDetailResponse>(`/api/project/${encodeURIComponent(id)}`)
  },
  {
    watch: [projectId]
  }
)

void loadStylePresets()

const detail = computed(() => detailResponse.value?.data || null)
const project = computed(() => detail.value?.project || null)
const scenes = computed(() => detail.value?.scenes || [])
const characters = computed(() => detail.value?.characters || [])

const totalScenes = computed(() => scenes.value.length)
const totalCharacters = computed(() => characters.value.length)
const generatedVideos = computed(() => scenes.value.filter(scene => !!scene.videoUrl).length)
const videoProgress = computed(() => {
  if (totalScenes.value <= 0) return 0
  return Math.round((generatedVideos.value / totalScenes.value) * 100)
})

const projectStatusInfo = computed(() => {
  const status = project.value?.status || 'draft'
  return projectStatusMap[status] || {
    label: status,
    variant: 'secondary' as const
  }
})

const styleName = computed(() => {
  const styleId = project.value?.styleId || ''
  return resolveStyleById(styleId)?.name || styleId || '未设置'
})

const scriptParseModeLabel = computed(() => {
  const mode = normalizeScriptParseMode(project.value?.scriptParseMode)
  return SCRIPT_PARSE_MODE_LABELS[mode]
})

const sceneEpisodeSummaryMap = computed(() => {
  const summaryMap = new Map<string, { sceneCount: number, doneCount: number }>()

  for (const scene of scenes.value) {
    const fallbackIndex = Math.max(1, Math.round(scene.episodeIndex || 1))
    const episodeId = scene.episodeId?.trim() || `episode_${String(fallbackIndex).padStart(3, '0')}`
    const current = summaryMap.get(episodeId) || { sceneCount: 0, doneCount: 0 }
    current.sceneCount += 1
    if (scene.videoUrl) current.doneCount += 1
    summaryMap.set(episodeId, current)
  }

  return summaryMap
})

const episodeDirectoryItems = computed<ProjectEpisodeDirectoryItem[]>(() => {
  const plan = detail.value?.script?.episodePlan || []
  if (plan.length > 0) {
    return plan
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((episode) => {
        const summary = sceneEpisodeSummaryMap.value.get(episode.id)
        return {
          id: episode.id,
          title: episode.title,
          index: episode.index,
          sceneCount: summary?.sceneCount || 0,
          doneCount: summary?.doneCount || 0
        }
      })
  }

  const grouped = new Map<string, ProjectEpisodeDirectoryItem>()
  for (const scene of scenes.value) {
    const normalizedIndex = Math.max(1, Math.round(scene.episodeIndex || 1))
    const id = scene.episodeId?.trim() || `episode_${String(normalizedIndex).padStart(3, '0')}`
    const title = scene.episodeTitle?.trim() || `第${normalizedIndex}集`
    const existing = grouped.get(id)
    if (existing) {
      existing.sceneCount += 1
      if (scene.videoUrl) existing.doneCount += 1
      continue
    }
    grouped.set(id, {
      id,
      title,
      index: normalizedIndex,
      sceneCount: 1,
      doneCount: scene.videoUrl ? 1 : 0
    })
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    return a.title.localeCompare(b.title, 'zh-CN')
  })
})

function openWorkbench(stage?: ProjectWorkbenchStage) {
  if (!projectId.value) return
  void router.push(resolveProjectWorkbenchPath(projectId.value, project.value?.workflowType, stage))
}
</script>

<template>
  <div class="h-full min-h-0 overflow-auto p-4 lg:p-6">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          class="gap-2"
          @click="router.push('/projects')"
        >
          <ArrowLeft class="h-4 w-4" />
          返回项目列表
        </Button>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            class="gap-2"
            @click="openWorkbench('videos')"
          >
            <Clapperboard class="h-4 w-4" />
            进入分镜视频
          </Button>
          <Button
            class="gap-2"
            @click="openWorkbench()"
          >
            <FolderKanban class="h-4 w-4" />
            进入项目工作台
          </Button>
        </div>
      </div>

      <div
        v-if="pending"
        class="rounded-xl border border-border/70 bg-background px-4 py-16"
      >
        <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          正在加载项目详情...
        </div>
      </div>

      <Card
        v-else-if="error || !project"
        class="border-destructive/30"
      >
        <CardHeader>
          <CardTitle>项目详情加载失败</CardTitle>
          <CardDescription>
            {{ error?.message || '未找到项目数据，请返回列表后重试。' }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            @click="refresh()"
          >
            重试
          </Button>
          <Button
            size="sm"
            @click="router.push('/projects')"
          >
            返回列表
          </Button>
        </CardContent>
      </Card>

      <div
        v-else
        class="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"
      >
        <Card class="h-fit">
          <CardHeader>
            <div class="flex flex-wrap items-center gap-2">
              <CardTitle class="text-xl">
                {{ project.name }}
              </CardTitle>
              <Badge :variant="projectStatusInfo.variant">
                {{ projectStatusInfo.label }}
              </Badge>
            </div>
            <CardDescription>
              {{ project.description || '暂无项目描述' }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div class="text-[11px] text-muted-foreground">
                  画风
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ styleName }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div class="text-[11px] text-muted-foreground">
                  剧本模式
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ scriptParseModeLabel }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div class="text-[11px] text-muted-foreground">
                  视频比例
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ project.aspectRatio }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div class="text-[11px] text-muted-foreground">
                  更新时间
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ formatProjectDateTime(project.updatedAt) }}
                </div>
              </div>
            </div>

            <div class="grid gap-2 sm:grid-cols-3">
              <div class="rounded-lg border border-border/70 bg-background p-3">
                <div class="text-[11px] text-muted-foreground">
                  场景数
                </div>
                <div class="mt-1 text-xl font-semibold">
                  {{ totalScenes }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 bg-background p-3">
                <div class="text-[11px] text-muted-foreground">
                  角色数
                </div>
                <div class="mt-1 text-xl font-semibold">
                  {{ totalCharacters }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 bg-background p-3">
                <div class="text-[11px] text-muted-foreground">
                  视频进度
                </div>
                <div class="mt-1 flex items-end gap-2">
                  <span class="text-xl font-semibold">{{ generatedVideos }}</span>
                  <span class="pb-0.5 text-xs text-muted-foreground">/ {{ totalScenes }}（{{ videoProgress }}%）</span>
                </div>
              </div>
            </div>

            <div class="space-y-2 rounded-lg border border-border/70 bg-muted/15 p-3">
              <div class="text-xs font-medium text-foreground">
                进入制作阶段
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  class="justify-start gap-2"
                  @click="openWorkbench('parse')"
                >
                  <FileText class="h-4 w-4" />
                  剧本解析
                </Button>
                <Button
                  variant="outline"
                  class="justify-start gap-2"
                  @click="openWorkbench('assets')"
                >
                  <Sparkles class="h-4 w-4" />
                  资产准备
                </Button>
                <Button
                  variant="outline"
                  class="justify-start gap-2"
                  @click="openWorkbench('videos')"
                >
                  <Clapperboard class="h-4 w-4" />
                  分镜视频
                </Button>
                <Button
                  variant="outline"
                  class="justify-start gap-2"
                  @click="openWorkbench('final')"
                >
                  <FolderKanban class="h-4 w-4" />
                  最终成片
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="min-h-0 overflow-hidden xl:sticky xl:top-6 xl:flex xl:max-h-[calc(100dvh-3rem)] xl:flex-col">
          <CardHeader class="shrink-0">
            <CardTitle class="text-base">
              分集目录
            </CardTitle>
            <CardDescription>
              已识别 {{ episodeDirectoryItems.length }} 集，点击“进入分镜视频”后左侧将按分集导航。
            </CardDescription>
          </CardHeader>
          <CardContent class="min-h-0 space-y-2 overflow-y-auto">
            <div
              v-if="episodeDirectoryItems.length === 0"
              class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground"
            >
              暂无分集目录，请先在“剧本解析”步骤生成分集。
            </div>
            <div
              v-for="episode in episodeDirectoryItems"
              :key="episode.id"
              class="rounded-md border border-border/60 bg-background px-3 py-2"
            >
              <div class="text-sm font-medium">
                第{{ episode.index }}集：{{ episode.title.replace(/^第\d+集[：:]\s*/u, '') }}
              </div>
              <div class="mt-1 text-[11px] text-muted-foreground">
                场景 {{ episode.sceneCount }} · 视频完成 {{ episode.doneCount }}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

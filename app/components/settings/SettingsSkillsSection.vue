<script setup lang="ts">
import { Puzzle, Upload, FolderOpen, RefreshCw, MoreHorizontal, ChevronDown, Clapperboard, Eye, HelpCircle, X, Check, ArrowRight } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { WorkflowSkill, SkillStage } from '#shared/types/skill'
import { SKILL_STAGE_LABELS } from '#shared/types/skill'
import { readSkillDirectory, readSkillZip } from '@/lib/skill-package'
import { getDisplayErrorMessage } from '@/lib/asset-workbench-values'
import SettingsSkillsOnline from '@/components/settings/SettingsSkillsOnline.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'

const skills = ref<WorkflowSkill[]>([])
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const zipInput = ref<HTMLInputElement>()
const directoryInput = ref<HTMLInputElement>()
const detail = ref<WorkflowSkill | null>(null)
const editingStages = ref<WorkflowSkill | null>(null)
const stageSelection = ref<SkillStage[]>([])
const removing = ref<WorkflowSkill | null>(null)
const activeView = ref<'installed' | 'discover'>('installed')
const helpOpen = ref(false)
const onlineBusy = ref(false)
let requestId = 0
const interactionBusy = computed(() => busy.value || loading.value || onlineBusy.value)
const actionLocked = interactionBusy
const enabledCount = computed(() => skills.value.filter(skill => skill.enabled).length)

function shortStageLabel(stage: string) {
  return stage === 'script_polish' ? '剧本／对白润色' : stage === 'scene_detail' ? '分镜细化' : stage === 'video_review' ? '视频审片' : stage
}

function onOnlineInstalled() {
  activeView.value = 'installed'
  notice.value = '技能已安装，已对所有项目启用。'
  void load()
}

async function load() {
  const token = ++requestId
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{ skills: WorkflowSkill[] }>('/api/skills')
    if (token === requestId) skills.value = data.skills
  } catch (cause) {
    if (token === requestId) error.value = getDisplayErrorMessage(cause, '加载技能失败')
  } finally {
    if (token === requestId) loading.value = false
  }
}

async function action(work: () => Promise<unknown>, message: string) {
  if (busy.value || loading.value || onlineBusy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    notice.value = message
    await load()
  } catch (cause) { error.value = getDisplayErrorMessage(cause, '操作失败') }
  finally { busy.value = false }
}

async function install(event: Event, zip: boolean) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  await action(async () => {
    const body = zip ? await readSkillZip(files[0]!) : await readSkillDirectory(files)
    const data = await $fetch<{ skill: WorkflowSkill }>('/api/skills/install', { method: 'POST', body })
    detail.value = data.skill
  }, '已安装，兼容的技能已对所有项目启用。')
}

function toggleGlobal(skill: WorkflowSkill) {
  return action(() => $fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'PUT', body: { enabled: !skill.enabled } }), skill.enabled ? '技能已在本机停用。' : '技能已在本机启用。')
}

function editStages(skill: WorkflowSkill) {
  editingStages.value = skill
  stageSelection.value = skill.stages.filter((stage): stage is SkillStage => stage in SKILL_STAGE_LABELS)
}

function toggleStage(stage: SkillStage, checked: boolean) {
  stageSelection.value = checked ? [...stageSelection.value, stage] : stageSelection.value.filter(value => value !== stage)
}

async function saveStages() {
  if (!editingStages.value || !stageSelection.value.length) return
  const id = editingStages.value.id
  await action(() => $fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'PUT', body: { stages: stageSelection.value } }), '适用流程已保存，下次执行时生效。')
  if (!error.value) editingStages.value = null
}

async function uninstall() {
  if (!removing.value) return
  const id = removing.value.id
  await action(async () => {
    await $fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'PUT', body: { remove: true } })
    removing.value = null
    if (detail.value?.id === id) detail.value = null
  }, '技能已卸载。')
}

onMounted(() => { void load() })
</script>

<template>
  <div class="h-full overflow-y-auto px-5 py-7 sm:px-8">
    <div class="mx-auto max-w-5xl">
      <header class="flex flex-wrap items-start justify-between gap-4 pb-7">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold tracking-tight">技能中心</h2>
          <p class="text-sm text-muted-foreground">为创作添加专业方法，启用后对所有项目生效。</p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="技能使用帮助" @click="helpOpen = true"><HelpCircle class="h-4 w-4" /></Button>
          <DropdownMenu :modal="false">
            <DropdownMenuTrigger as-child>
              <Button variant="outline" :disabled="actionLocked"><Upload class="mr-2 h-4 w-4" />本地导入<ChevronDown class="ml-2 h-3.5 w-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="directoryInput?.click()"><FolderOpen />从目录导入</DropdownMenuItem>
              <DropdownMenuItem @select="zipInput?.click()"><Upload />从 ZIP 导入</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <input ref="zipInput" class="hidden" type="file" accept=".zip" aria-label="选择技能 ZIP" @change="install($event, true)">
      <input ref="directoryInput" class="hidden" type="file" webkitdirectory multiple aria-label="选择技能目录" @change="install($event, false)">

      <nav aria-label="技能视图" class="mb-6 flex gap-7 border-b">
        <button type="button" class="-mb-px border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="activeView === 'installed' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" :aria-current="activeView === 'installed' ? 'page' : undefined" :disabled="onlineBusy" @click="activeView = 'installed'">已安装 <span class="ml-1.5 text-xs tabular-nums text-muted-foreground">{{ skills.length }}</span></button>
        <button type="button" class="-mb-px border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" :class="activeView === 'discover' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" :aria-current="activeView === 'discover' ? 'page' : undefined" :disabled="actionLocked" @click="activeView = 'discover'">发现技能</button>
      </nav>

      <p v-if="error" role="alert" class="mb-4 rounded-lg bg-destructive/5 px-4 py-3 text-sm text-destructive">{{ error }}</p>
      <p v-if="notice" role="status" class="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Check class="h-4 w-4 shrink-0 text-primary" />{{ notice }}</p>

      <SettingsSkillsOnline v-show="activeView === 'discover'" :disabled="interactionBusy" :installed-ids="skills.map(skill => skill.id)" @installed="onOnlineInstalled" @busy="onlineBusy = $event" />

      <section v-show="activeView === 'installed'" aria-label="已安装技能">
        <div class="mb-5 flex items-center justify-between gap-3">
          <span class="text-xs text-muted-foreground">已启用 {{ enabledCount }} 项 · 对所有项目生效</span>
          <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="actionLocked" aria-label="刷新技能" @click="load"><RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" /></Button>
        </div>
        <div v-if="loading && !skills.length" role="status" aria-label="正在加载技能" class="space-y-6 py-3">
          <div v-for="index in 2" :key="index" class="flex gap-4 motion-safe:animate-pulse"><div class="h-11 w-11 rounded-xl bg-muted/50" /><div class="flex-1 space-y-3 py-1"><div class="h-4 w-32 rounded bg-muted/50" /><div class="h-3 w-2/3 rounded bg-muted/40" /></div></div>
        </div>
        <div v-else-if="!skills.length && !error" class="py-16 text-center">
          <Puzzle class="mx-auto mb-4 h-7 w-7 text-muted-foreground" />
          <h3 class="text-base font-medium">从一个技能开始</h3>
          <p class="mt-2 text-sm text-muted-foreground">发现适合分镜与审片的创作方法，或导入自己的技能。</p>
          <Button class="mt-5" @click="activeView = 'discover'">发现技能<ArrowRight class="ml-2 h-4 w-4" /></Button>
        </div>
        <div class="divide-y divide-border/60" :aria-busy="interactionBusy">
          <article v-for="skill in skills" :key="skill.id" class="group flex items-center gap-3 py-6 sm:gap-4">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
              <component :is="skill.stages.includes('scene_detail') ? Clapperboard : skill.stages.includes('video_review') ? Eye : Puzzle" class="h-5 w-5" :stroke-width="1.5" />
            </div>
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button class="text-left text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="detail = skill">{{ skill.name }}</button>
                <span v-if="skill.builtin" class="text-2xs text-muted-foreground">内置</span>
                <span v-if="skill.unsupported.length" class="text-xs text-destructive">暂不兼容</span>
                <span v-else-if="!skill.enabled" class="text-xs text-muted-foreground">本机已停用</span>
              </div>
              <p class="line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{{ skill.description }}</p>
              <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/75">
                <DropdownMenu v-if="!skill.builtin" :open="editingStages?.id === skill.id" @update:open="value => { if (!value) editingStages = null }">
                  <DropdownMenuTrigger as-child><button type="button" class="inline-flex items-center gap-1 rounded-md text-left text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-label="`编辑${skill.name}的适用流程`" :disabled="actionLocked" @click="editStages(skill)">{{ skill.stages.map(shortStageLabel).join(' · ') || '选择适用流程' }}<ChevronDown class="h-3 w-3 shrink-0" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="min-w-52 p-2">
                    <p class="px-2 pb-2 text-xs font-medium text-muted-foreground">适用流程</p>
                    <DropdownMenuItem v-for="(label, stage) in SKILL_STAGE_LABELS" :key="stage" :disabled="busy" @select="event => { event.preventDefault(); toggleStage(stage, !stageSelection.includes(stage)) }"><Check class="mr-2 h-4 w-4" :class="stageSelection.includes(stage) ? 'opacity-100' : 'opacity-0'" />{{ label }}</DropdownMenuItem>
                    <p v-if="!stageSelection.length" class="px-2 py-1 text-xs text-destructive">至少选择一个流程</p>
                    <div class="mt-2 border-t px-1 pt-2"><Button size="sm" class="w-full" :disabled="busy || !stageSelection.length" @click="saveStages">保存流程</Button></div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span v-else>{{ skill.stages.map(shortStageLabel).join(' · ') || '尚未指定流程' }}</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2 sm:gap-4">
              <Switch :checked="skill.enabled" :aria-label="`本机使用${skill.name}`" :disabled="actionLocked || skill.unsupported.length > 0" @update:checked="toggleGlobal(skill)" />
              <DropdownMenu :modal="false">
                <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground" :aria-label="`管理${skill.name}`" :disabled="actionLocked"><MoreHorizontal class="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="detail = skill">查看详情</DropdownMenuItem>
                  <template v-if="!skill.builtin"><DropdownMenuSeparator /><DropdownMenuItem destructive @select="removing = skill">卸载技能</DropdownMenuItem></template>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </article>
        </div>
        <p v-if="skills.length" class="mt-6 text-xs leading-relaxed text-muted-foreground/75">开关和适用流程保存后，下次执行时对所有项目生效。</p>
      </section>
    </div>

    <Dialog :open="!!detail" @update:open="value => { if (!value) detail = null }">
      <SheetContent class="w-[min(92vw,580px)] max-w-none">
        <div class="flex items-start justify-between gap-4 border-b px-6 py-5">
          <DialogHeader class="min-w-0"><DialogTitle>{{ detail?.name }}</DialogTitle><DialogDescription>{{ detail?.description }}</DialogDescription></DialogHeader>
          <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" aria-label="关闭技能详情" @click="detail = null"><X class="h-4 w-4" /></Button>
        </div>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>版本 {{ detail?.version }}</span><span>{{ detail?.stages.map(shortStageLabel).join(' · ') }}</span><span>{{ Object.keys(detail?.files || {}).length }} 个附件</span></div>
          <p v-if="detail?.origin" class="break-all text-xs text-muted-foreground">来源 <a :href="detail.origin.url" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">{{ detail.origin.repository }} / {{ detail.origin.path || '根目录' }}</a> · {{ detail.origin.commit.slice(0, 12) }}</p>
          <p v-if="detail?.unsupported.length" role="alert" class="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{{ detail.unsupported.join('；') }}</p>
          <p v-if="detail?.warnings?.length" class="rounded-lg bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{{ detail.warnings.join('；') }}</p>
          <section><h3 class="mb-3 text-sm font-medium">技能指令</h3><pre class="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{{ detail?.instructions }}</pre></section>
          <details v-if="detail?.originalDocument" class="border-t pt-4 text-sm"><summary class="cursor-pointer text-muted-foreground">原始 SKILL.md</summary><pre class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{{ detail.originalDocument }}</pre></details>
          <details v-for="(content, path) in detail?.files" :key="path" class="border-t pt-4 text-sm"><summary class="cursor-pointer break-all text-muted-foreground">{{ path }}</summary><pre class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{{ content }}</pre></details>
        </div>
      </SheetContent>
    </Dialog>

    <Dialog v-model:open="helpOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader><DialogTitle>使用技能</DialogTitle><DialogDescription>安装并启用后，所有项目都可以使用。</DialogDescription></DialogHeader>
        <ol class="space-y-4 text-sm leading-relaxed"><li><span class="font-medium">1. 找到技能</span><p class="mt-1 text-muted-foreground">在“发现技能”中搜索，或通过“本地导入”安装目录与 ZIP。</p></li><li><span class="font-medium">2. 启用技能</span><p class="mt-1 text-muted-foreground">在“已安装”中打开技能开关；适用流程可直接在技能行修改。分镜细化在解析后执行，审片由工作台入口执行。</p></li><li><span class="font-medium">3. 查看效果</span><p class="mt-1 text-muted-foreground">生成结果仍在工作台展示；调用详情可在日志中查看。</p></li></ol>
        <p class="text-xs leading-relaxed text-muted-foreground">仅本机生效，协作成员需各自安装。停用技能会影响所有项目。当前支持文本指令与参考资料，不执行脚本或 MCP 工具。</p>
        <details class="border-t pt-3 text-xs text-muted-foreground"><summary class="cursor-pointer">自定义技能格式与限制</summary><p class="mt-3 leading-relaxed">目录内包含唯一的 SKILL.md，可保留 UTF-8 文本附件；最多 128 个文件、合计 1 MB，单文件限 256 KB。模型使用正文和 Markdown、TXT、JSON 参考资料，合计限 96 KB；脚本、工具配置和打包文件仅保存。ZIP 上传限 1 MB。</p><pre class="mt-3 overflow-x-auto rounded-lg bg-muted/30 p-3">---
name: cinematic-staging
description: 细化站位与动作
version: "1.0.0"
stages: [scene_detail]
---
保留原剧情和时长，明确动作过程。</pre><p class="mt-3">流程可填写 script_polish（剧本／对白润色）、scene_detail 或 video_review。去 AI 味写作技能建议绑定剧本／对白润色，在线安装时可直接选择。</p></details>
      </DialogContent>
    </Dialog>
    <SettingsConfirmDialog :open="!!removing" title="卸载技能" :description="`卸载「${removing?.name || ''}」。已生成内容和执行记录会保留。`" confirm-text="卸载" :busy="busy" :error="error" @update:open="value => { if (!value && !busy) removing = null }" @confirm="uninstall" />
  </div>
</template>

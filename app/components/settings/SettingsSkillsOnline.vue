<script setup lang="ts">
import { Search, Download, ExternalLink, Loader2, ArrowUpRight, ArrowRight, X } from 'lucide-vue-next'
import { SheetContent } from '@/components/ui/sheet'
import type { OnlineSkillResult, OnlineSkillPreview, OnlineSkillDirectories, SkillStage, WorkflowSkill } from '#shared/types/skill'
import { SKILL_STAGE_LABELS } from '#shared/types/skill'
import { isSkillSource, onlineSkillBindingError } from '@/lib/online-skills'
import { getDisplayErrorMessage } from '@/lib/asset-workbench-values'

const props = defineProps<{ disabled: boolean, installedIds: string[] }>()
const emit = defineEmits<{
  (event: 'installed', skill: WorkflowSkill): void
  (event: 'busy', busy: boolean): void
}>()
const query = ref('')
const results = ref<OnlineSkillResult[]>([])
const searched = ref(false)
const working = ref(false)
const installing = ref(false)
const error = ref('')
const installError = ref('')
const notice = ref('')
const preview = ref<OnlineSkillPreview | null>(null)
const directories = ref<OnlineSkillDirectories | null>(null)
const currentSource = ref('')
const stages = ref<SkillStage[]>([])
const alreadyInstalled = computed(() => !!preview.value && props.installedIds.includes(preview.value.skill.id))
const bindingError = computed(() => preview.value ? onlineSkillBindingError(preview.value, stages.value) : '')
let requestId = 0
let abort: AbortController | undefined

async function discover() {
  if (props.disabled || working.value || installing.value || !query.value.trim()) return
  if (isSkillSource(query.value)) {
    results.value = []
    searched.value = false
    return loadPreview(query.value.trim())
  }
  const token = ++requestId
  abort?.abort()
  abort = new AbortController()
  working.value = true
  error.value = ''
  notice.value = ''
  directories.value = null
  results.value = []
  searched.value = false
  try {
    const response = await $fetch<{ skills: OnlineSkillResult[] }>('/api/skills/online/search', {
      query: { q: query.value.trim() }, signal: abort.signal
    })
    if (token !== requestId) return
    results.value = response.skills
    searched.value = true
  } catch (cause) {
    if (token === requestId) error.value = getDisplayErrorMessage(cause, '在线搜索失败，请稍后重试')
  } finally { if (token === requestId) working.value = false }
}

async function loadPreview(source: string, path?: string, commit?: string) {
  if (props.disabled || working.value || installing.value) return
  const token = ++requestId
  abort?.abort()
  abort = new AbortController()
  working.value = true
  error.value = ''
  notice.value = ''
  preview.value = null
  stages.value = []
  installError.value = ''
  currentSource.value = source
  directories.value = null
  try {
    const data = await $fetch<OnlineSkillPreview | OnlineSkillDirectories>('/api/skills/online/preview', {
      method: 'POST', body: { source, path, commit }, signal: abort.signal
    })
    if (token !== requestId) return
    if (data.kind === 'choose') directories.value = data
    else { directories.value = null; preview.value = data }
  } catch (cause) {
    if (token === requestId) error.value = getDisplayErrorMessage(cause, '下载技能预览失败，请重试')
  } finally { if (token === requestId) working.value = false }
}

function chooseStage(stage: SkillStage, checked: boolean) {
  stages.value = checked ? [...stages.value, stage] : stages.value.filter(value => value !== stage)
}

async function install() {
  if (!preview.value || alreadyInstalled.value || bindingError.value || props.disabled || installing.value) return
  installing.value = true
  installError.value = ''
  try {
    const data = await $fetch<{ skill: WorkflowSkill }>('/api/skills/online/install', {
      method: 'POST', body: { token: preview.value.token, stages: [...stages.value] }
    })
    preview.value = null
    notice.value = `已安装「${data.skill.name}」。在“已安装”中为项目启用后生效。`
    emit('installed', data.skill)
  } catch (cause) { installError.value = getDisplayErrorMessage(cause, '安装失败，请重试；预览过期时需重新预览') }
  finally { installing.value = false }
}

const searchDirections = [
  { label: '分镜设计', query: 'storyboard' },
  { label: '镜头与光线', query: 'cinematography' },
  { label: '视频审片', query: 'video review' }
]
function searchDirection(value: string) {
  query.value = value
  void discover()
}

watch(() => working.value || installing.value, value => emit('busy', value), { flush: 'sync' })
onBeforeUnmount(() => { requestId++; abort?.abort(); emit('busy', false) })
</script>

<template>
  <section aria-label="在线技能发现" class="pb-6">
    <div class="pb-6 pt-3">
      <h3 class="text-xl font-medium tracking-tight">寻找适合你的创作方法</h3>
      <p class="mt-2 text-sm text-muted-foreground">从 skills.sh 搜索技能，也可以直接粘贴技能链接。</p>
    </div>
    <form class="flex items-center gap-2 rounded-xl border bg-background p-2 pl-4 focus-within:ring-2 focus-within:ring-ring/30" @submit.prevent="discover">
      <Search class="h-4 w-4 shrink-0 text-muted-foreground" :stroke-width="1.5" />
      <input v-model="query" class="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/65 disabled:opacity-50" aria-label="技能关键词或链接" placeholder="搜索技能，或粘贴 skills.sh / GitHub 链接" :disabled="working || installing || disabled">
      <Button type="submit" :disabled="!query.trim() || working || installing || disabled"><Loader2 v-if="working" class="mr-2 h-4 w-4 animate-spin" />{{ isSkillSource(query) ? '预览链接' : '搜索技能' }}</Button>
    </form>
    <div v-if="!searched && !directories && !working && !error" class="flex flex-wrap items-center gap-x-5 gap-y-2 pt-4">
      <span class="text-xs text-muted-foreground">试试这些方向</span>
      <button v-for="direction in searchDirections" :key="direction.query" type="button" :disabled="disabled || installing" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" @click="searchDirection(direction.query)">{{ direction.label }}<ArrowUpRight class="h-3 w-3" /></button>
    </div>
    <p v-if="error" role="alert" class="mt-5 rounded-lg bg-destructive/5 p-4 text-sm text-destructive">{{ error }}</p>
    <p v-if="notice" role="status" class="mt-5 text-sm text-muted-foreground">{{ notice }}</p>
    <div v-if="working" role="status" aria-label="正在读取在线技能" class="space-y-6 py-8">
      <div v-for="index in 3" :key="index" class="space-y-3 motion-safe:animate-pulse"><div class="h-4 w-40 rounded bg-muted/50" /><div class="h-3 w-2/3 rounded bg-muted/40" /></div>
    </div>
    <div v-else-if="directories" class="mt-8">
      <p class="mb-3 text-sm text-muted-foreground">{{ directories.repository }} · 选择一个技能目录</p>
      <div class="divide-y border-t">
        <button v-for="path in directories.paths" :key="path" type="button" class="flex w-full items-center justify-between gap-3 py-4 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :disabled="disabled" @click="loadPreview(currentSource, path, directories.commit)"><span class="break-all">{{ path || '仓库根目录' }}</span><ArrowRight class="h-4 w-4 shrink-0" /></button>
      </div>
    </div>
    <div v-else-if="searched && !results.length" class="py-16 text-center">
      <Search class="mx-auto mb-3 h-6 w-6 text-muted-foreground" :stroke-width="1.5" />
      <p class="text-sm font-medium">没有找到匹配的技能</p>
      <p class="mt-2 text-sm text-muted-foreground">试试英文关键词，或直接粘贴公开 GitHub 技能链接。</p>
    </div>
    <div v-else-if="results.length" class="mt-8">
      <p class="mb-2 text-xs text-muted-foreground">{{ results.length }} 项搜索结果 · 来自 skills.sh</p>
      <div class="divide-y divide-border/60">
        <article v-for="result in results" :key="result.source" class="flex items-center justify-between gap-4 py-5">
          <div class="min-w-0 space-y-2">
            <p class="break-words text-sm font-semibold">{{ result.name }}</p>
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><a :href="result.url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 break-all hover:text-foreground">{{ result.repository }}<ExternalLink class="h-3 w-3 shrink-0" /></a><span class="tabular-nums">{{ result.installs.toLocaleString() }} 次安装</span></p>
          </div>
          <Button variant="ghost" size="sm" :disabled="installing || disabled" :aria-label="`预览${result.name}`" @click="loadPreview(result.source)">查看<ArrowRight class="ml-2 h-3.5 w-3.5" /></Button>
        </article>
      </div>
    </div>
    <p class="mt-10 text-xs text-muted-foreground/70">当前支持文本技能，兼容性会在安装前检查。</p>

    <Dialog :open="!!preview" @update:open="value => { if (!value && !installing) preview = null }">
      <SheetContent class="w-[min(92vw,600px)] max-w-none" @interact-outside="event => { if (installing) event.preventDefault() }" @escape-key-down="event => { if (installing) event.preventDefault() }">
        <template v-if="preview">
          <div class="flex items-start justify-between gap-4 border-b px-6 py-5">
            <DialogHeader class="min-w-0"><DialogTitle>安装 {{ preview.skill.name }}</DialogTitle><DialogDescription>{{ preview.skill.description }}</DialogDescription></DialogHeader>
            <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" :disabled="installing" aria-label="关闭安装预览" @click="preview = null"><X class="h-4 w-4" /></Button>
          </div>
          <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
            <a :href="preview.origin.url" target="_blank" rel="noopener noreferrer" class="inline-flex max-w-full items-center gap-1.5 break-all text-xs text-muted-foreground hover:text-foreground">{{ preview.origin.repository }}<ExternalLink class="h-3 w-3 shrink-0" /></a>
            <div v-if="preview.blockingIssues.length" role="alert" class="rounded-lg bg-destructive/5 p-4 text-sm text-destructive"><p class="font-medium">可以查看，暂不能安装</p><p v-for="issue in preview.blockingIssues" :key="issue" class="mt-1.5 leading-relaxed">{{ issue }}</p></div>
            <p v-for="warning in preview.warnings || []" :key="warning" class="rounded-lg bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">{{ warning }}</p>
            <fieldset :disabled="installing || preview.blockingIssues.length > 0">
              <legend class="mb-3 text-sm font-medium">用于哪些流程</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label v-for="(label, stage) in SKILL_STAGE_LABELS" :key="stage" class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50" :class="stages.includes(stage) ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30'">
                  <input type="checkbox" class="mt-0.5 h-4 w-4 shrink-0 accent-primary" :aria-label="label" :checked="stages.includes(stage)" @change="chooseStage(stage, ($event.target as HTMLInputElement).checked)">
                  <span><span class="block text-sm font-medium">{{ stage === 'scene_detail' ? '分镜细化' : '视频审片' }}</span><span class="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{{ stage === 'scene_detail' ? '完善解析后的镜头描述' : '审查视频抽帧与分镜的一致性' }}</span></span>
                </label>
              </div>
            </fieldset>
            <p v-if="alreadyInstalled" class="text-sm text-muted-foreground">此技能已安装。如需更换版本或流程绑定，请先在已安装列表卸载。</p>
            <p v-else-if="bindingError && stages.length && !preview.blockingIssues.length" class="text-sm text-destructive">{{ bindingError }}</p>
            <details open class="border-t pt-4 text-sm"><summary class="cursor-pointer font-medium">技能正文</summary><pre class="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{{ preview.skill.instructions }}</pre></details>
            <details class="border-t pt-4 text-sm"><summary class="cursor-pointer text-muted-foreground">版本与来源</summary><div class="mt-3 space-y-2 break-all text-xs leading-relaxed text-muted-foreground"><p v-if="preview.packageSizeBytes !== undefined">{{ preview.fileCount }} 个文件 · {{ (preview.packageSizeBytes / 1024).toFixed(1) }} KB</p><p>目录 {{ preview.origin.path || '仓库根目录' }}</p><p>提交 {{ preview.origin.commit }}</p><p>预览保留 15 分钟，安装使用此固定版本；作者原始文件会保留。</p><p>仅使用文本指令，不执行脚本、命令或外部工具。</p></div></details>
            <details v-for="(content, path) in preview.skill.files" :key="path" class="border-t pt-4 text-sm"><summary class="cursor-pointer break-all text-muted-foreground">{{ path }}</summary><pre class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{{ content }}</pre></details>
          </div>
          <div class="shrink-0 space-y-3 border-t bg-popover px-6 py-4">
            <p v-if="installError" role="alert" class="text-sm text-destructive">{{ installError }}</p>
            <div class="flex items-center justify-between gap-3"><span class="text-xs text-muted-foreground">{{ stages.length ? '安装后，在项目中启用' : '选择流程后即可安装' }}</span><div class="flex gap-2"><Button variant="ghost" :disabled="installing" @click="preview = null">取消</Button><Button :disabled="installing || disabled || alreadyInstalled || !!bindingError" @click="install"><Loader2 v-if="installing" class="mr-2 h-4 w-4 animate-spin" /><Download v-else class="mr-2 h-4 w-4" />{{ installing ? '正在安装…' : '安装到本机' }}</Button></div></div>
          </div>
        </template>
      </SheetContent>
    </Dialog>
  </section>
</template>

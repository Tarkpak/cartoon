<script setup lang="ts">
import type { SkillRun } from '@playlet-shared/types/skill'
import { SKILL_STAGE_LABELS } from '@playlet-shared/types/skill'

type Run = SkillRun & { user_id: string, account?: string, display_name?: string, projectName?: string, modelCallCount: number }
const props = defineProps<{ runId?: string, userId?: string }>()
const emit = defineEmits<{ (event: 'calls', value: { runId: string, userId: string }): void }>()
const skill = ref('')
const status = ref<string | null>(null)
const rows = ref<Run[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const selected = ref<Run | null>(null)
const labels: Record<string, string> = { running: '执行中', succeeded: '成功', failed: '失败', skipped: '已跳过', interrupted: '已中断' }
let request = 0
async function refresh() {
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: { runs: Run[], pagination: { total: number } } }>('/api/admin/skill-runs', { query: { page: page.value, pageSize: 20, skill: skill.value || undefined, status: status.value || undefined, runId: props.runId || undefined, userId: props.userId || undefined } })
    if (current !== request) return
    rows.value = response.data.runs
    total.value = response.data.pagination.total
  } catch (cause) {
    if (current === request) error.value = cause instanceof Error ? cause.message : '技能执行记录加载失败'
  } finally { if (current === request) loading.value = false }
}
function search() { page.value = 1; void refresh() }
function stageLabel(stage: string) { return SKILL_STAGE_LABELS[stage as keyof typeof SKILL_STAGE_LABELS] || stage }
watch(() => [props.runId, props.userId], search, { immediate: true })
onBeforeUnmount(() => { request++ })
defineExpose({ refresh })
</script>

<template>
  <div class="skill-runs">
    <div class="skill-filters">
      <n-input v-model:value="skill" placeholder="技能名称或 ID" aria-label="技能名称或 ID" clearable @keyup.enter="search" />
      <n-select v-model:value="status" placeholder="执行状态" clearable :options="Object.entries(labels).map(([value,label]) => ({value,label}))" />
      <n-button :loading="loading" type="primary" @click="search">查询</n-button>
    </div>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <div v-if="props.runId" class="skill-note">技能执行 · {{ props.runId }}</div>
    <n-spin :show="loading" class="skill-list">
      <n-empty v-if="!rows.length && !loading" description="暂无技能执行记录，客户端执行后会自动同步" />
      <article v-for="run in rows" :key="`${run.user_id}:${run.id}`" class="skill-row">
        <div class="skill-row-header"><strong>{{ stageLabel(run.stage) }} · {{ run.projectName || run.projectId }}</strong><n-tag size="small" :type="run.status === 'failed' ? 'error' : run.status === 'succeeded' ? 'success' : 'default'">{{ labels[run.status] || run.status }}</n-tag></div>
        <div>{{ run.skills.map(s => `${s.name} v${s.version}`).join('、') || '未启用技能' }}</div>
        <div v-if="run.result?.message">{{ run.result.message }}</div>
        <div class="skill-meta">{{ run.display_name || run.account || run.user_id }} · {{ new Date(run.createdAt).toLocaleString() }}<span v-if="run.durationMs !== undefined"> · {{ (run.durationMs / 1000).toFixed(1) }} 秒</span></div>
        <div class="skill-actions"><n-button size="small" @click="selected = run">执行详情</n-button><n-button size="small" :disabled="run.modelCallCount === 0" @click="emit('calls', { runId: run.id, userId: run.user_id })">查看模型调用（{{ run.modelCallCount }}）</n-button><span v-if="run.modelCallCount === 0" class="skill-meta">暂无可查看调用，可能尚未调用、等待同步或已归档</span></div>
      </article>
    </n-spin>
    <n-pagination v-model:page="page" :page-size="20" :item-count="total" @update:page="refresh" />
    <n-drawer :show="!!selected" :width="560" @update:show="(value: boolean) => { if (!value) selected = null }">
      <n-drawer-content title="技能执行详情" closable>
        <template v-if="selected">
          <p>{{ stageLabel(selected.stage) }} · {{ labels[selected.status] }}</p>
          <p class="skill-meta">执行编号 {{ selected.id }}</p>
          <p>{{ selected.result?.message }}</p>
          <section v-for="s in selected.skills" :key="s.id" class="skill-row">
            <strong>{{ s.name }} · {{ s.version }}</strong>
            <p v-if="s.origin" class="skill-meta">{{ s.origin.repository }} / {{ s.origin.path }}<br>{{ s.origin.commit }}</p>
          </section>
          <n-button @click="emit('calls', { runId: selected.id, userId: selected.user_id }); selected = null">查看关联模型调用</n-button>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.skill-runs { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 16px; }
.skill-filters { display: grid; grid-template-columns: minmax(180px, 320px) 160px auto; gap: 12px; align-self: start; }
.skill-list { flex: 1; min-height: 0; overflow: auto; }
.skill-row { padding: 18px 4px; border-bottom: 1px solid var(--n-border-color, #8883); display: grid; gap: 10px; }
.skill-row-header, .skill-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; }
.skill-actions { justify-content: flex-start; }
.skill-meta, .skill-note { color: var(--n-text-color-3, #888); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 700px) { .skill-filters { grid-template-columns: 1fr; width: 100%; } }
</style>

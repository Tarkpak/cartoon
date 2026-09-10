<script setup lang="ts">
import { Loader2, RefreshCw, Save } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
definePageMeta({ layout: 'default' })
const route = useRoute(); const { toast } = useToast(); const tasks = ref<any[]>([]); const selected = ref<any>(); const loading = ref(false)
async function load() { loading.value = true; try { const r = await $fetch<any>('/api/tools/subtitle-erasure/tasks'); tasks.value = r.data?.tasks || r.tasks || []; const id = route.query.taskId; if (id) selected.value = tasks.value.find((t:any) => t.taskId === id) || { taskId: id, status: 'processing' } } finally { loading.value = false } }
async function refresh(t = selected.value) { if (!t) return; const r = await $fetch<any>(`/api/tools/subtitle-erasure/status/${encodeURIComponent(t.taskId)}`); Object.assign(t, r); selected.value = t }
async function save(t = selected.value) { if (!t?.resultVideoUrl) return; await $fetch('/api/tools/subtitle-erasure/save', { method: 'POST', body: { taskId: t.taskId } }); toast.success('已保存到本地') }
onMounted(load)
</script>
<template><AppPageContent><AppPageHeader title="字幕擦除任务" description="查看处理进度并保存结果。" /><div class="space-y-4"><div v-if="loading" class="flex items-center gap-2"><Loader2 class="h-4 w-4 animate-spin" />加载中</div><div v-for="t in tasks" :key="t.taskId" class="flex items-center justify-between rounded-lg border p-4"><span class="truncate">{{ t.fileName || t.taskId }}</span><div class="flex items-center gap-2"><Badge>{{ t.status }}</Badge><Button size="icon" variant="ghost" @click="refresh(t)"><RefreshCw class="h-4 w-4" /></Button><Button v-if="t.resultVideoUrl" size="icon" variant="ghost" @click="save(t)"><Save class="h-4 w-4" /></Button></div></div><p v-if="!tasks.length" class="text-sm text-muted-foreground">暂无任务</p></div></AppPageContent></template>

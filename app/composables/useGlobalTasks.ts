import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  normalizeEnhanceTasks,
  normalizeVideoImportTasks,
  sortGlobalTasks,
  summarizeGlobalTasks,
  type GlobalTask
} from '~/lib/global-tasks'

const RUNNING_POLL_MS = 10_000
const IDLE_POLL_MS = 60_000
const RECENT_LIMIT = 30

// Module-level state: one poller shared by every consumer.
const tasks = ref<GlobalTask[]>([])
const loading = ref(false)
const lastError = ref<string | null>(null)
let subscribers = 0
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null

type TaskList<T> = { data?: { tasks?: T[] } }

async function fetchList<T>(url: string, limit: number): Promise<T[]> {
  const response = await $fetch<TaskList<T>>(url, { query: { limit } })
  return response.data?.tasks ?? []
}

async function refresh(): Promise<void> {
  if (inFlight) return inFlight
  loading.value = true
  inFlight = (async () => {
    // Each source fails independently: a tool that isn't configured must not hide the others.
    const results = await Promise.allSettled([
      fetchList<Parameters<typeof normalizeEnhanceTasks>[1][number]>('/api/tools/video-enhance/tasks', RECENT_LIMIT)
        .then(list => normalizeEnhanceTasks('video-enhance', list)),
      fetchList<Parameters<typeof normalizeEnhanceTasks>[1][number]>('/api/tools/image-enhance/tasks', RECENT_LIMIT)
        .then(list => normalizeEnhanceTasks('image-enhance', list)),
      fetchList<Parameters<typeof normalizeEnhanceTasks>[1][number]>('/api/tools/subtitle-erasure/tasks', RECENT_LIMIT)
        .then(list => normalizeEnhanceTasks('subtitle-erasure', list)),
      fetchList<Parameters<typeof normalizeVideoImportTasks>[0][number]>('/api/import/video/tasks', RECENT_LIMIT)
        .then(list => normalizeVideoImportTasks(list))
    ])
    const merged = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    const failures = results.filter(result => result.status === 'rejected').length
    lastError.value = failures === results.length ? '无法读取任务列表' : null
    tasks.value = sortGlobalTasks(merged)
  })().finally(() => {
    loading.value = false
    inFlight = null
  })
  return inFlight
}

function schedule() {
  if (timer) clearTimeout(timer)
  if (subscribers === 0) return
  const hasRunning = tasks.value.some(task => task.status === 'running')
  timer = setTimeout(() => {
    void refresh().finally(schedule)
  }, hasRunning ? RUNNING_POLL_MS : IDLE_POLL_MS)
}

function handleFocus() {
  void refresh().finally(schedule)
}

/** Shared, polled list of tool tasks (enhance, subtitle erasure, video import). */
export function useGlobalTasks() {
  onMounted(() => {
    subscribers += 1
    if (subscribers === 1) {
      window.addEventListener('focus', handleFocus)
      void refresh().finally(schedule)
    }
  })
  onBeforeUnmount(() => {
    subscribers = Math.max(subscribers - 1, 0)
    if (subscribers === 0) {
      window.removeEventListener('focus', handleFocus)
      if (timer) clearTimeout(timer)
      timer = null
    }
  })

  return {
    tasks,
    loading,
    lastError,
    summary: computed(() => summarizeGlobalTasks(tasks.value)),
    refresh: () => refresh().finally(schedule)
  }
}

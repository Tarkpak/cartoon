import { ref, watch, type ComputedRef, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'

/**
 * Source text editing: editing the novel text invalidates the episode plan and
 * parsed scenes, and the text is auto-saved shortly after typing stops and
 * flushed before leaving the page.
 */
export function useAssetWorkbenchNovelTextAutoSave(options: {
  loading: Ref<boolean>
  saving: Ref<boolean>
  projectId: Ref<string | undefined>
  projectStyleId: Ref<string>
  novelText: Ref<string>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  workflowMetaReady: Ref<boolean>
  hydratingWorkflowMeta: Ref<boolean>
  canEditProject: ComputedRef<boolean>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  clearParsedSceneStateForEpisodePlanChange: () => boolean
}) {
  const {
    loading,
    saving,
    projectId,
    projectStyleId,
    novelText,
    episodePlan,
    workflowMetaReady,
    hydratingWorkflowMeta,
    canEditProject,
    saveProject,
    saveWorkflowMeta,
    clearParsedSceneStateForEpisodePlanChange
  } = options

  const NOVEL_TEXT_AUTO_SAVE_DELAY_MS = 1200
  const lastSavedNovelText = ref('')
  const pendingWorkflowMetaSaveAfterNovelTextChange = ref(false)
  const canResetEpisodePlanFromNovelText = ref(false)
  let novelTextAutoSaveTimer: ReturnType<typeof setTimeout> | null = null

  function clearNovelTextAutoSaveTimer() {
    if (!novelTextAutoSaveTimer) return
    clearTimeout(novelTextAutoSaveTimer)
    novelTextAutoSaveTimer = null
  }

  async function persistNovelTextIfNeeded() {
    if (loading.value || saving.value) return
    if (!projectId.value && !projectStyleId.value) return
    if (
      novelText.value === lastSavedNovelText.value
      && !pendingWorkflowMetaSaveAfterNovelTextChange.value
    ) return

    const saved = await saveProject()
    if (saved) {
      lastSavedNovelText.value = novelText.value
      if (
        pendingWorkflowMetaSaveAfterNovelTextChange.value
        && workflowMetaReady.value
        && !hydratingWorkflowMeta.value
      ) {
        await saveWorkflowMeta()
      }
      pendingWorkflowMetaSaveAfterNovelTextChange.value = false
    }
  }

  function scheduleNovelTextAutoSave() {
    clearNovelTextAutoSaveTimer()
    novelTextAutoSaveTimer = setTimeout(() => {
      novelTextAutoSaveTimer = null
      void persistNovelTextIfNeeded()
    }, NOVEL_TEXT_AUTO_SAVE_DELAY_MS)
  }

  async function waitUntilProjectSaveIdle(maxWaitMs = 3000) {
    const deadline = Date.now() + maxWaitMs
    while (saving.value && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 80))
    }
  }

  watch(
    [loading, workflowMetaReady, hydratingWorkflowMeta],
    ([isLoading, isMetaReady, isHydrating]) => {
      if (isLoading || !isMetaReady || isHydrating) {
        canResetEpisodePlanFromNovelText.value = false
        return
      }
      lastSavedNovelText.value = novelText.value
      canResetEpisodePlanFromNovelText.value = true
    },
    { immediate: true }
  )

  watch(novelText, (nextValue, previousValue) => {
    if (nextValue === previousValue) return
    if (!canResetEpisodePlanFromNovelText.value) return
    if (loading.value) return
    if (episodePlan.value.length > 0) {
      episodePlan.value = []
    }
    const sceneStateCleared = clearParsedSceneStateForEpisodePlanChange()
    if (sceneStateCleared) {
      pendingWorkflowMetaSaveAfterNovelTextChange.value = true
    }
    if (nextValue === lastSavedNovelText.value && !sceneStateCleared) return
    scheduleNovelTextAutoSave()
  })

  onBeforeRouteLeave(async () => {
    clearNovelTextAutoSaveTimer()
    await waitUntilProjectSaveIdle()
    await persistNovelTextIfNeeded()
    await waitUntilProjectSaveIdle()
    if (!loading.value && canEditProject.value) await saveProject()
  })

  return {
    persistNovelTextIfNeeded
  }
}

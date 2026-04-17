import { useDebounceFn } from '@vueuse/core'
import type { Ref } from 'vue'
import type { FinalVideoAsset } from '~/lib/asset-workbench-types'

type ConsistencyLevel = 'lock' | 'soft'

export interface SceneConsistencyConfig {
  sceneId: string
  mustReferenceAssetIds: string[]
  consistencyLevel: ConsistencyLevel
  continuityNotes: string
}

export interface PropAsset {
  id: string
  name: string
  description: string
  referenceImage?: string
}

export interface AssetWorkflowMeta {
  version: number
  sceneConfigs: Record<string, SceneConsistencyConfig>
  props: PropAsset[]
  finalVideo?: FinalVideoAsset | null
}

interface UseAssetWorkflowMetaOptions {
  projectId: Ref<string | undefined>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  finalVideo: Ref<FinalVideoAsset | null>
  resolveProjectStatus: () => 'draft' | 'in_progress' | 'completed'
  onHydrated?: () => void
  debounceMs?: number
}

function createFallbackPropId() {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function useAssetWorkflowMeta(options: UseAssetWorkflowMetaOptions) {
  const workflowMetaReady = ref(false)
  const hydratingWorkflowMeta = ref(false)

  function normalizeFinalVideo(rawValue: unknown): FinalVideoAsset | null {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      return null
    }

    const item = rawValue as Partial<FinalVideoAsset> & { videoData?: unknown }
    const videoUrl = typeof item.videoUrl === 'string' && item.videoUrl.trim()
      ? item.videoUrl.trim()
      : typeof item.videoData === 'string' && item.videoData.trim()
        ? item.videoData.trim()
        : ''

    if (!videoUrl) return null

    return {
      videoUrl,
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      size: typeof item.size === 'number' ? item.size : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined
    }
  }

  async function loadWorkflowMeta(rawMetaInput?: unknown): Promise<boolean> {
    hydratingWorkflowMeta.value = true
    let hasMeta = false

    try {
      if (!rawMetaInput || typeof rawMetaInput !== 'object' || Array.isArray(rawMetaInput)) {
        return false
      }

      const meta = rawMetaInput as {
        sceneConfigs?: Record<string, unknown>
        props?: unknown
        finalVideo?: unknown
      }

      const loadedConfigs: Record<string, SceneConsistencyConfig> = {}
      for (const [sceneId, rawConfig] of Object.entries(meta.sceneConfigs || {})) {
        if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue

        const item = rawConfig as Partial<SceneConsistencyConfig>
        loadedConfigs[sceneId] = {
          sceneId,
          mustReferenceAssetIds: Array.isArray(item.mustReferenceAssetIds)
            ? item.mustReferenceAssetIds.filter((assetId): assetId is string => typeof assetId === 'string')
            : [],
          consistencyLevel: item.consistencyLevel === 'soft' ? 'soft' : 'lock',
          continuityNotes: typeof item.continuityNotes === 'string' ? item.continuityNotes : ''
        }
      }

      const loadedProps = Array.isArray(meta.props)
        ? meta.props
            .filter(item => item && typeof item === 'object')
            .map((item) => {
              const prop = item as Partial<PropAsset>
              return {
                id: typeof prop.id === 'string' ? prop.id : createFallbackPropId(),
                name: typeof prop.name === 'string' ? prop.name : '未命名道具',
                description: typeof prop.description === 'string' ? prop.description : '',
                referenceImage: typeof prop.referenceImage === 'string' ? prop.referenceImage : undefined
              }
            })
        : []

      const loadedFinalVideo = normalizeFinalVideo(meta.finalVideo)

      hasMeta = Object.keys(loadedConfigs).length > 0
        || loadedProps.length > 0
        || !!loadedFinalVideo
      options.sceneConfigs.value = loadedConfigs
      options.propAssets.value = loadedProps
      options.finalVideo.value = loadedFinalVideo
    } catch (error) {
      console.error('[useAssetWorkflowMeta] 读取工作流元数据失败:', error)
    } finally {
      options.onHydrated?.()
      workflowMetaReady.value = true
      hydratingWorkflowMeta.value = false
    }

    return hasMeta
  }

  async function saveWorkflowMeta() {
    const currentProjectId = options.projectId.value
    if (!workflowMetaReady.value || !currentProjectId) return

    const payload: AssetWorkflowMeta = {
      version: 1,
      sceneConfigs: options.sceneConfigs.value,
      props: options.propAssets.value,
      finalVideo: options.finalVideo.value
    }

    try {
      await $fetch(`/api/project/${currentProjectId}`, {
        method: 'PUT',
        body: {
          status: options.resolveProjectStatus(),
          assetWorkflow: payload
        }
      })
    } catch (error) {
      console.error('[useAssetWorkflowMeta] 保存工作流元数据失败:', error)
    }
  }

  const scheduleWorkflowMetaSave = useDebounceFn(() => {
    void saveWorkflowMeta()
  }, options.debounceMs ?? 700)

  return {
    workflowMetaReady,
    hydratingWorkflowMeta,
    loadWorkflowMeta,
    saveWorkflowMeta,
    scheduleWorkflowMetaSave
  }
}

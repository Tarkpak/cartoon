import { useDebounceFn } from '@vueuse/core'
import type { Ref } from 'vue'
import type {
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  EnvironmentPanoramaState,
  FinalVideoAsset
} from '~/lib/asset-workbench-types'
import type {
  CharacterData,
  SceneData
} from '~/lib/asset-workbench-models'
import {
  ensureAssetHistoryEntry,
  ensureVideoHistoryEntry,
  normalizeAssetHistoryEntries,
  normalizeVideoHistoryEntries
} from '~/lib/asset-history'
import {
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentAssetIdAliases,
  resolveSceneReferenceImage
} from '~/lib/asset-workbench-environment'

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
  assetHistory?: AssetImageHistoryEntry[]
}

export interface AssetWorkflowMeta {
  version: number
  sceneConfigs: Record<string, SceneConsistencyConfig>
  props: PropAsset[]
  characterHistories?: Record<string, AssetImageHistoryEntry[]>
  environmentHistories?: Record<string, AssetImageHistoryEntry[]>
  environmentPanoramaStates?: Record<string, EnvironmentPanoramaState>
  sceneVideoHistories?: Record<string, AssetVideoHistoryEntry[]>
  finalVideo?: FinalVideoAsset | null
}

interface UseAssetWorkflowMetaOptions {
  projectId: Ref<string | undefined>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  environmentAssetHistories: Ref<Record<string, AssetImageHistoryEntry[]>>
  environmentPanoramaStates: Ref<Record<string, EnvironmentPanoramaState>>
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

  function buildEnvironmentHistoryMap(
    rawHistories: Record<string, unknown> = {}
  ): Record<string, AssetImageHistoryEntry[]> {
    const currentImages = new Map<string, string>()
    const historyAliases = new Map<string, Set<string>>()

    for (const scene of options.scenes.value) {
      const assetId = resolveSceneEnvironmentAssetId(scene)
      const aliases = historyAliases.get(assetId) || new Set<string>()
      for (const alias of resolveSceneEnvironmentAssetIdAliases(scene)) {
        aliases.add(alias)
      }
      historyAliases.set(assetId, aliases)

      if (currentImages.has(assetId)) continue

      const image = resolveSceneReferenceImage(scene)
      if (!image) continue

      currentImages.set(assetId, image)
    }

    const next: Record<string, AssetImageHistoryEntry[]> = {}
    const assetIds = new Set([
      ...Array.from(historyAliases.keys()),
      ...Array.from(currentImages.keys())
    ])

    for (const assetId of assetIds) {
      const mergedRawHistory = Array.from(historyAliases.get(assetId) || [assetId])
        .flatMap((alias) => {
          const entries = rawHistories[alias]
          return Array.isArray(entries) ? entries : []
        })
      const history = normalizeAssetHistoryEntries(
        mergedRawHistory,
        currentImages.get(assetId)
      )
      if (history.length > 0) {
        next[assetId] = history
      }
    }

    return next
  }

  function buildCharacterHistoryMap(): Record<string, AssetImageHistoryEntry[]> {
    const next: Record<string, AssetImageHistoryEntry[]> = {}

    for (const character of options.characters.value) {
      const history = normalizeAssetHistoryEntries(character.assetHistory, character.baseImage)
      if (history.length > 0) {
        next[character.id] = history
      }
    }

    return next
  }

  function buildSceneVideoHistoryMap(): Record<string, AssetVideoHistoryEntry[]> {
    const next: Record<string, AssetVideoHistoryEntry[]> = {}

    for (const scene of options.scenes.value) {
      const history = normalizeVideoHistoryEntries(scene.videoHistory, scene.videoUrl)
      if (history.length > 0) {
        next[scene.id] = history
      }
    }

    return next
  }

  function buildWorkflowMetaPayload(): AssetWorkflowMeta {
    const environmentPanoramaStates = Object.fromEntries(
      Object.entries(options.environmentPanoramaStates.value)
        .filter(([, state]) => !!state?.panoramaImage?.trim() || !!state?.crop)
        .map(([assetId, state]) => [
          assetId,
          {
            panoramaImage: state.panoramaImage?.trim() || undefined,
            crop: state.crop
          }
        ])
    )

    return {
      version: 2,
      sceneConfigs: options.sceneConfigs.value,
      props: options.propAssets.value.map(prop => ({
        ...prop,
        assetHistory: normalizeAssetHistoryEntries(prop.assetHistory, prop.referenceImage)
      })),
      characterHistories: buildCharacterHistoryMap(),
      environmentHistories: buildEnvironmentHistoryMap(options.environmentAssetHistories.value),
      environmentPanoramaStates,
      sceneVideoHistories: buildSceneVideoHistoryMap(),
      finalVideo: options.finalVideo.value
    }
  }

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
      let meta: {
        sceneConfigs?: Record<string, unknown>
        props?: unknown
        characterHistories?: Record<string, unknown>
        environmentHistories?: Record<string, unknown>
        environmentPanoramaStates?: Record<string, unknown>
        sceneVideoHistories?: Record<string, unknown>
        finalVideo?: unknown
      } | null = null

      if (rawMetaInput && typeof rawMetaInput === 'object' && !Array.isArray(rawMetaInput)) {
        meta = rawMetaInput as {
          sceneConfigs?: Record<string, unknown>
          props?: unknown
          characterHistories?: Record<string, unknown>
          environmentHistories?: Record<string, unknown>
          environmentPanoramaStates?: Record<string, unknown>
          sceneVideoHistories?: Record<string, unknown>
          finalVideo?: unknown
        }
      }

      const loadedConfigs: Record<string, SceneConsistencyConfig> = {}
      for (const [sceneId, rawConfig] of Object.entries(meta?.sceneConfigs || {})) {
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

      const loadedProps = Array.isArray(meta?.props)
        ? meta.props
            .filter(item => item && typeof item === 'object')
            .map((item) => {
              const prop = item as Partial<PropAsset>
              return {
                id: typeof prop.id === 'string' ? prop.id : createFallbackPropId(),
                name: typeof prop.name === 'string' ? prop.name : '未命名道具',
                description: typeof prop.description === 'string' ? prop.description : '',
                referenceImage: typeof prop.referenceImage === 'string' ? prop.referenceImage : undefined,
                assetHistory: normalizeAssetHistoryEntries(
                  prop.assetHistory,
                  typeof prop.referenceImage === 'string' ? prop.referenceImage : undefined
                )
              }
            })
        : []

      const loadedCharacterHistories = meta?.characterHistories || {}
      for (const character of options.characters.value) {
        character.assetHistory = normalizeAssetHistoryEntries(
          loadedCharacterHistories[character.id],
          character.baseImage
        )
      }

      const loadedSceneVideoHistories = meta?.sceneVideoHistories || {}
      for (const scene of options.scenes.value) {
        scene.videoHistory = normalizeVideoHistoryEntries(
          loadedSceneVideoHistories[scene.id],
          scene.videoUrl
        )
      }

      const loadedEnvironmentHistories = buildEnvironmentHistoryMap(meta?.environmentHistories || {})
      const loadedEnvironmentPanoramaStates: Record<string, EnvironmentPanoramaState> = {}
      for (const [assetId, rawValue] of Object.entries(meta?.environmentPanoramaStates || {})) {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
          continue
        }

        const item = rawValue as Partial<EnvironmentPanoramaState>
        const panoramaImage = typeof item.panoramaImage === 'string' && item.panoramaImage.trim()
          ? item.panoramaImage.trim()
          : undefined
        const crop = item.crop
          && typeof item.crop === 'object'
          && !Array.isArray(item.crop)
          && [item.crop.x, item.crop.y, item.crop.width, item.crop.height].every(Number.isFinite)
          ? {
              x: Number(item.crop.x),
              y: Number(item.crop.y),
              width: Number(item.crop.width),
              height: Number(item.crop.height)
            }
          : undefined

        if (!panoramaImage && !crop) {
          continue
        }

        loadedEnvironmentPanoramaStates[assetId] = {
          panoramaImage,
          crop
        }
      }
      const loadedFinalVideo = normalizeFinalVideo(meta?.finalVideo)

      hasMeta = Object.keys(loadedConfigs).length > 0
        || loadedProps.length > 0
        || Object.keys(loadedCharacterHistories).length > 0
        || Object.keys(loadedEnvironmentHistories).length > 0
        || Object.keys(loadedEnvironmentPanoramaStates).length > 0
        || Object.keys(loadedSceneVideoHistories).length > 0
        || !!loadedFinalVideo
      options.sceneConfigs.value = loadedConfigs
      options.propAssets.value = loadedProps
      options.environmentAssetHistories.value = loadedEnvironmentHistories
      options.environmentPanoramaStates.value = loadedEnvironmentPanoramaStates
      options.finalVideo.value = loadedFinalVideo

      if (!meta) {
        for (const character of options.characters.value) {
          character.assetHistory = ensureAssetHistoryEntry(
            character.assetHistory,
            character.baseImage,
            { source: 'legacy' }
          )
        }
        for (const scene of options.scenes.value) {
          scene.videoHistory = ensureVideoHistoryEntry(
            scene.videoHistory,
            scene.videoUrl,
            { source: 'legacy' }
          )
        }
        options.environmentAssetHistories.value = buildEnvironmentHistoryMap()
        options.environmentPanoramaStates.value = {}
      }
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

    const payload = buildWorkflowMetaPayload()

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

import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { useCloudAdmin } from '~/composables/useCloudAdmin'
import { useToast } from '~/composables/useToast'
import type { LibraryAsset } from '#shared/types/library'
import { libraryPermissionCanUse } from '#shared/types/library'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type {
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import { ensureAssetHistoryEntry } from '~/lib/asset-history'
import {
  findPersonalLibraryAsset,
  isPersonalLibraryFavorite,
  personalLibraryFavoriteKeys,
  type PersonalLibrarySource
} from '~/lib/personal-library-assets'
import {
  createLibraryAsset,
  listAllLibraryAssets,
  markLibraryAssetUsed,
  readRemoteLibraryMetadata,
  updateLibraryAsset
} from '~/lib/library-api'

/**
 * Personal library integration: import library assets into the project, save
 * project assets to the library, and provide which assets are already saved
 * (favorite markers on asset cards).
 */
export function useAssetWorkbenchLibrary(options: {
  projectId: Ref<string | undefined>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  displayEnvironmentAssetCards: ComputedRef<EnvironmentAssetCard[]>
  canExportProject: ComputedRef<boolean>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  applyEnvironmentReferenceImage: (assetId: string, imageUrl: string, panoramaState?: EnvironmentPanoramaState) => Promise<void>
  recordCharacterHistory: (
    characterId: string,
    image: string | undefined,
    options: { source: 'generated' | 'uploaded' | 'legacy', prompt?: string, libraryAssetId?: string, libraryAssetVersion?: number }
  ) => void
  recordEnvironmentHistory: (
    assetId: string,
    image: string,
    options?: { source?: 'generated' | 'uploaded' | 'cropped' | 'legacy', prompt?: string, viewMode?: EnvironmentCropCaptureMode, libraryAssetId?: string, libraryAssetVersion?: number }
  ) => void
}) {
  const {
    projectId,
    characters,
    propAssets,
    displayEnvironmentAssetCards,
    canExportProject,
    saveProject,
    saveWorkflowMeta,
    resolveUiError,
    applyEnvironmentReferenceImage,
    recordCharacterHistory,
    recordEnvironmentHistory
  } = options
  const { toast } = useToast()

  async function handleImportLibraryAsset(payload: {
    asset: LibraryAsset
    targetId?: string
    createNew: boolean
    tab: 'characters' | 'environments' | 'props' | 'others'
  }) {
    const { asset } = payload
    try {
      if (!libraryPermissionCanUse(asset.permission)) {
        throw new Error('当前素材仅允许查看，不能加入项目')
      }
      if (payload.tab === 'characters') {
        if (asset.category === 'character_voice') {
          const target = characters.value.find(item => item.id === payload.targetId)
            || characters.value.find(item => !item.voiceAsset?.audioUrl)
            || characters.value[0]
          if (!target) throw new Error('当前项目没有可关联的角色')
          target.voiceAsset = {
            audioUrl: asset.url,
            libraryAssetId: asset.id,
            libraryAssetVersion: asset.version,
            locked: true,
            updatedAt: new Date().toISOString()
          }
          await saveProject()
        } else {
          const bundleName = asset.bundle?.characterName?.trim() || asset.name
          let target = payload.createNew
            ? undefined
            : characters.value.find(item => item.id === payload.targetId)
          target ||= characters.value.find(item => item.name.trim() === bundleName)
          const response = asset.bundle?.viewAssetIds
            || asset.bundle?.voiceAssetId
            || asset.bundle?.expressionAssetIds
            || asset.bundle?.poseAssetIds
            ? await listAllLibraryAssets()
            : null
          const libraryMap = new Map((response || []).map(item => [item.id, item]))
          const viewReferences = asset.bundle?.viewAssetIds
            ? Object.entries(asset.bundle.viewAssetIds)
                .map(([view, assetId]) => [view, libraryMap.get(assetId)] as const)
                .filter((entry): entry is readonly [string, LibraryAsset] => entry[1]?.mediaType === 'image')
            : []
          const views = viewReferences.length > 0
            ? Object.fromEntries(viewReferences.map(([view, item]) => [view, item.url]))
            : undefined
          const voice = asset.bundle?.voiceAssetId
            ? libraryMap.get(asset.bundle.voiceAssetId)
            : undefined
          const expressionReferences = (asset.bundle?.expressionAssetIds || [])
            .map(assetId => libraryMap.get(assetId))
            .filter((item): item is LibraryAsset => item?.mediaType === 'image')
          const poseReferences = (asset.bundle?.poseAssetIds || [])
            .map(assetId => libraryMap.get(assetId))
            .filter((item): item is LibraryAsset => item?.mediaType === 'image')
          const appearance = [asset.bundle?.appearance || asset.description || asset.name, asset.bundle?.clothing]
            .filter(Boolean)
            .join('；')
          const prompt = asset.bundle?.generationPrompt?.trim()
          const expressions = Object.fromEntries([
            ...expressionReferences.map((item, index) => [`expression_${index + 1}`, item.url]),
            ...poseReferences.map((item, index) => [`pose_${index + 1}`, item.url])
          ])
          const referencedImages = [
            ...viewReferences.map(([, item]) => item),
            ...expressionReferences,
            ...poseReferences
          ]
          if (!target) {
            target = {
              id: `char_${projectId.value || 'project'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: bundleName,
              appearance: prompt ? `${appearance}；生成提示：${prompt}` : appearance,
              role: asset.bundle?.role || '配角',
              gender: asset.bundle?.gender,
              age: asset.bundle?.age,
              baseImage: asset.url,
              views: views as CharacterData['views'],
              traits: asset.tags,
              expressions: Object.keys(expressions).length > 0 ? expressions : undefined,
              voiceAsset: voice?.mediaType === 'audio'
                ? { audioUrl: voice.url, libraryAssetId: voice.id, libraryAssetVersion: voice.version, locked: true, updatedAt: new Date().toISOString() }
                : undefined,
              assetHistory: ensureAssetHistoryEntry([], asset.url, {
                source: 'uploaded',
                createdAt: new Date().toISOString(),
                libraryAssetId: asset.id,
                libraryAssetVersion: asset.version
              }),
              generating: false,
              generatingViews: false
            }
            characters.value.push(target)
          } else {
            target.name = bundleName || target.name
            target.appearance = prompt ? `${appearance}；生成提示：${prompt}` : appearance || target.appearance
            target.baseImage = asset.url
            target.traits = asset.tags
            if (Object.keys(expressions).length > 0) target.expressions = expressions
            recordCharacterHistory(target.id, asset.url, {
              source: 'uploaded',
              libraryAssetId: asset.id,
              libraryAssetVersion: asset.version
            })
            if (views && Object.keys(views).length > 0) target.views = views as CharacterData['views']
            if (voice?.mediaType === 'audio') {
              target.voiceAsset = { audioUrl: voice.url, libraryAssetId: voice.id, libraryAssetVersion: voice.version, locked: true, updatedAt: new Date().toISOString() }
            }
          }
          for (const referencedImage of referencedImages) {
            target.assetHistory = ensureAssetHistoryEntry(target.assetHistory, referencedImage.url, {
              source: 'uploaded',
              createdAt: new Date().toISOString(),
              libraryAssetId: referencedImage.id,
              libraryAssetVersion: referencedImage.version
            })
          }
          await saveProject()
        }
        await saveWorkflowMeta()
      } else if (payload.tab === 'environments') {
        const targetId = payload.targetId || displayEnvironmentAssetCards.value[0]?.id
        if (!targetId) throw new Error('当前项目没有可替换的环境资产')
        recordEnvironmentHistory(targetId, asset.url, {
          source: 'uploaded',
          libraryAssetId: asset.id,
          libraryAssetVersion: asset.version
        })
        await applyEnvironmentReferenceImage(targetId, asset.url)
        await saveWorkflowMeta()
      } else {
        const target = payload.createNew
          ? undefined
          : propAssets.value.find(item => item.id === payload.targetId)
        const isVoice = asset.mediaType === 'audio'
        if (target) {
          target.name = asset.name
          target.description = asset.description
          if (isVoice) {
            target.mediaType = 'voice'
            target.voiceAsset = { audioUrl: asset.url, libraryAssetId: asset.id, libraryAssetVersion: asset.version, locked: true, updatedAt: new Date().toISOString() }
          } else {
            target.mediaType = target.category === 'other' ? 'image' : undefined
            target.referenceImage = asset.url
            target.libraryAssetId = asset.id
            target.libraryAssetVersion = asset.version
          }
        } else {
          propAssets.value.push({
            id: createPropAssetId(),
            name: asset.name,
            description: asset.description,
            category: payload.tab === 'props' ? 'prop' : 'other',
            mediaType: payload.tab === 'others' ? (isVoice ? 'voice' : 'image') : undefined,
            referenceImage: isVoice ? undefined : asset.url,
            libraryAssetId: asset.id,
            libraryAssetVersion: asset.version,
            voiceAsset: isVoice
              ? { audioUrl: asset.url, libraryAssetId: asset.id, libraryAssetVersion: asset.version, locked: true, updatedAt: new Date().toISOString() }
              : undefined
          })
        }
        await saveWorkflowMeta()
      }
      const linkedAssetIds = asset.bundle
        ? [
            ...Object.values(asset.bundle.viewAssetIds || {}),
            ...(asset.bundle.expressionAssetIds || []),
            ...(asset.bundle.poseAssetIds || []),
            asset.bundle.voiceAssetId
          ].filter((id): id is string => !!id)
        : []
      await Promise.allSettled([asset.id, ...new Set(linkedAssetIds)].map(id => markLibraryAssetUsed(id)))
      toast.success(`已使用资源：${asset.name}`)
    } catch (error) {
      toast.error(resolveUiError(error, '资源库导入失败'))
    }
  }

  const savingLibraryAssetKey = ref<string | null>(null)
  const libraryCloudAccount = useCloudAdmin()
  const personalLibraryAssets = shallowRef<LibraryAsset[]>([])
  let libraryRefreshSequence = 0

  async function refreshPersonalLibraryFavorites() {
    const sequence = ++libraryRefreshSequence
    try {
      const assets = await listAllLibraryAssets()
      if (sequence === libraryRefreshSequence) personalLibraryAssets.value = assets
    } catch {
      // A temporarily unavailable library must not interrupt project editing.
    }
  }

  watch(() => libraryCloudAccount.currentUser.value?.id, () => {
    personalLibraryAssets.value = []
    void refreshPersonalLibraryFavorites()
  }, { immediate: true })

  onMounted(() => window.addEventListener('focus', refreshPersonalLibraryFavorites))

  onBeforeUnmount(() => {
    libraryRefreshSequence++
    window.removeEventListener('focus', refreshPersonalLibraryFavorites)
  })

  provide(personalLibraryFavoriteKeys, computed(() => {
    const keys = new Set<string>()
    const markFavorite = (key: string, sources: PersonalLibrarySource[]) => {
      if (isPersonalLibraryFavorite(personalLibraryAssets.value, sources, libraryCloudAccount.currentUser.value?.id)) keys.add(key)
    }
    for (const character of characters.value) {
      const imageUrls = [...new Set([character.baseImage, ...Object.values(character.views || {}), ...Object.values(character.expressions || {})].filter((url): url is string => !!url))]
      markFavorite(`characters:${character.id}`, [
        ...imageUrls.map(sourceUrl => ({ category: 'character' as const, mediaType: 'image' as const, sourceUrl })),
        { category: 'character_voice', mediaType: 'audio', sourceUrl: character.voiceAsset?.audioUrl }
      ])
    }
    for (const environment of displayEnvironmentAssetCards.value) {
      markFavorite(`environments:${environment.id}`, [{ category: 'environment', mediaType: 'image', sourceUrl: environment.referenceImage || environment.singleViewImage || environment.fourViewImage }])
    }
    for (const item of propAssets.value) {
      const tab = item.category === 'prop' ? 'props' : 'others'
      markFavorite(`${tab}:${item.id}`, [
        { category: tab === 'props' ? 'prop' : 'other', mediaType: 'image', sourceUrl: item.referenceImage },
        { category: 'narration', mediaType: 'audio', sourceUrl: item.voiceAsset?.audioUrl }
      ])
    }
    return keys
  }))

  async function handleSaveAssetsToLibrary(tab: 'characters' | 'environments' | 'props' | 'others', targetId?: string) {
    if (!canExportProject.value) {
      toast.error('当前账号没有导出权限，不能收藏项目资产')
      return
    }
    if (savingLibraryAssetKey.value) return
    savingLibraryAssetKey.value = `${tab}:${targetId || 'all'}`
    try {
      const existing = await listAllLibraryAssets()
      libraryRefreshSequence++
      personalLibraryAssets.value = existing
      type LibraryCreateInput = Parameters<typeof createLibraryAsset>[0]
      let savedCount = 0
      let resourceCount = 0

      async function storeProjectAsset(job: LibraryCreateInput) {
        resourceCount += 1
        const stored = findPersonalLibraryAsset(existing, job, libraryCloudAccount.currentUser.value?.id)
        if (stored) {
          if (targetId && !stored.favorite) {
            const updated = await updateLibraryAsset(stored.id, { favorite: true })
            existing[existing.indexOf(stored)] = updated
            return updated
          }
          return stored
        }
        let created = await createLibraryAsset({ ...job, visibility: 'private', favorite: !!targetId })
        try {
          const metadata = await readRemoteLibraryMetadata(created.url, created.mediaType)
          created = await updateLibraryAsset(created.id, metadata)
        } catch {
          // The original file is already durable; metadata enrichment is best effort.
        }
        existing.push(created)
        savedCount += 1
        return created
      }

      if (tab === 'characters') {
        const viewLabels: Record<string, string> = {
          front: '正面',
          three_quarter: '四分之三侧面',
          side: '侧面',
          back: '背面',
          top_down: '俯视',
          bottom_up: '仰视'
        }
        for (const character of characters.value.filter(item => !targetId || item.id === targetId)) {
          const voice = character.voiceAsset?.audioUrl
            ? await storeProjectAsset({
                mediaType: 'audio',
                category: 'character_voice',
                name: `${character.name}音色`,
                description: character.voiceTone || character.speakingStyle,
                sourceUrl: character.voiceAsset.audioUrl,
                sourceType: 'project',
                sourceProjectId: projectId.value,
                tags: character.traits
              })
            : undefined
          const views = Object.entries(character.views || {}).filter((entry): entry is [string, string] => !!entry[1])
          const primaryUrl = character.baseImage || views.find(([view]) => view === 'front')?.[1] || views[0]?.[1]
          if (!primaryUrl) continue
          let primary = await storeProjectAsset({
            mediaType: 'image',
            category: 'character',
            name: character.name,
            description: character.appearance,
            sourceUrl: primaryUrl,
            sourceType: 'project',
            sourceProjectId: projectId.value,
            tags: character.traits
          })
          const viewAssetIds: Record<string, string> = {}
          for (const [view, url] of views) {
            const asset = url === primaryUrl
              ? primary
              : await storeProjectAsset({
                  mediaType: 'image',
                  category: 'character',
                  name: `${character.name}-${viewLabels[view] || view}`,
                  description: `${character.appearance}；${viewLabels[view] || view}参考`,
                  sourceUrl: url,
                  sourceType: 'project',
                  sourceProjectId: projectId.value,
                  tags: [...(character.traits || []), '角色包依赖']
                })
            viewAssetIds[view] = asset.id
          }
          const expressionAssetIds: string[] = []
          const poseAssetIds: string[] = []
          for (const [referenceName, url] of Object.entries(character.expressions || {})) {
            if (!url) continue
            const isPose = /pose|action|动作|姿态/iu.test(referenceName)
            const asset = url === primaryUrl
              ? primary
              : await storeProjectAsset({
                  mediaType: 'image',
                  category: 'character',
                  name: `${character.name}-${referenceName}`,
                  description: `${character.appearance}；${referenceName}参考`,
                  sourceUrl: url,
                  sourceType: 'project',
                  sourceProjectId: projectId.value,
                  tags: [...(character.traits || []), isPose ? '动作参考' : '表情参考', '角色包依赖']
                })
            ;(isPose ? poseAssetIds : expressionAssetIds).push(asset.id)
          }
          primary = await updateLibraryAsset(primary.id, {
            bundle: {
              characterName: character.name,
              appearance: character.appearance,
              role: character.role,
              gender: character.gender,
              age: character.age,
              baseImageAssetId: primary.id,
              viewAssetIds: Object.keys(viewAssetIds).length > 0 ? viewAssetIds : undefined,
              expressionAssetIds: expressionAssetIds.length > 0 ? [...new Set(expressionAssetIds)] : undefined,
              poseAssetIds: poseAssetIds.length > 0 ? [...new Set(poseAssetIds)] : undefined,
              voiceAssetId: voice?.id
            }
          })
          const primaryIndex = existing.findIndex(asset => asset.id === primary.id)
          if (primaryIndex >= 0) existing[primaryIndex] = primary
        }
        personalLibraryAssets.value = [...existing]
        if (!resourceCount) toast.info('当前资产还没有可收藏的图片或音频')
        else toast.success(targetId ? '已收藏到个人资源库' : savedCount > 0 ? `已存入 ${savedCount} 个资源并更新角色包` : '角色包已更新')
        return
      }

      const jobs: Array<Parameters<typeof createLibraryAsset>[0]> = []
      if (tab === 'environments') {
        for (const environment of displayEnvironmentAssetCards.value.filter(item => !targetId || item.id === targetId)) {
          const url = environment.referenceImage || environment.singleViewImage || environment.fourViewImage
          if (url) jobs.push({ mediaType: 'image', category: 'environment', name: environment.name, description: environment.description, sourceUrl: url, sourceType: 'project', sourceProjectId: projectId.value })
        }
      } else {
        const source = propAssets.value.filter(item => (!targetId || item.id === targetId) && (tab === 'props' ? item.category === 'prop' : item.category === 'other'))
        for (const item of source) {
          if (item.referenceImage) jobs.push({ mediaType: 'image', category: tab === 'props' ? 'prop' : 'other', name: item.name, description: item.description, sourceUrl: item.referenceImage, sourceType: 'project', sourceProjectId: projectId.value })
          if (item.voiceAsset?.audioUrl) jobs.push({ mediaType: 'audio', category: 'narration', name: item.name, description: item.description, sourceUrl: item.voiceAsset.audioUrl, sourceType: 'project', sourceProjectId: projectId.value })
        }
      }
      for (const job of jobs) {
        await storeProjectAsset(job)
      }
      personalLibraryAssets.value = [...existing]
      if (!resourceCount) toast.info('当前资产还没有可收藏的图片或音频')
      else toast.success(targetId ? '已收藏到个人资源库' : savedCount > 0 ? `已存入 ${savedCount} 个资源` : '这些资源已在个人资源库中')
    } catch (error) {
      toast.error(resolveUiError(error, '存入个人资源库失败'))
    } finally {
      savingLibraryAssetKey.value = null
    }
  }

  return {
    savingLibraryAssetKey,
    handleImportLibraryAsset,
    handleSaveAssetsToLibrary
  }
}

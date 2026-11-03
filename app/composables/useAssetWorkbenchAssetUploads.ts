import type { Ref } from 'vue'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type { DisplayAsset } from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import { resolveChatUploadAssetName } from '~/lib/asset-workbench-scene-chat'
import { uploadImageFile } from '~/lib/asset-workbench-upload'

/**
 * Upload/generate wrappers that record the new image in the asset history:
 * character and prop images, generated prop images, and images uploaded from
 * the scene edit dialog (added as "other" assets).
 */
export function useAssetWorkbenchAssetUploads(options: {
  projectId: Ref<string | undefined>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  maxAssetUploadSize: number
  handleCharacterImageUploadCore: (characterId: string, event: Event) => Promise<void>
  handlePropImageUploadCore: (propId: string, event: Event) => Promise<void>
  generatePropImageCore: (propId: string, options?: { skipCompletionNotice?: boolean }) => Promise<string | undefined>
  recordCharacterHistory: (characterId: string, image: string | undefined, options: { source: 'generated' | 'uploaded' | 'legacy', prompt?: string }) => void
  recordPropHistory: (propId: string, image: string | undefined, options: { source: 'generated' | 'uploaded' | 'legacy', prompt?: string }) => void
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
}) {
  const {
    projectId,
    characters,
    propAssets,
    maxAssetUploadSize,
    handleCharacterImageUploadCore,
    handlePropImageUploadCore,
    generatePropImageCore,
    recordCharacterHistory,
    recordPropHistory,
    saveWorkflowMeta,
    resolveUiError
  } = options

  async function handleCharacterImageUpload(characterId: string, event: Event) {
    const target = characters.value.find(item => item.id === characterId)
    const previousImage = target?.baseImage?.trim() || ''

    await handleCharacterImageUploadCore(characterId, event)

    const nextImage = characters.value.find(item => item.id === characterId)?.baseImage?.trim() || ''
    if (!nextImage || nextImage === previousImage) return

    recordCharacterHistory(characterId, nextImage, { source: 'uploaded' })
    await saveWorkflowMeta()
  }

  async function handlePropImageUpload(propId: string, event: Event) {
    const target = propAssets.value.find(item => item.id === propId)
    const previousImage = target?.referenceImage?.trim() || ''

    await handlePropImageUploadCore(propId, event)

    const nextImage = propAssets.value.find(item => item.id === propId)?.referenceImage?.trim() || ''
    if (!nextImage || nextImage === previousImage) return

    recordPropHistory(propId, nextImage, { source: 'uploaded' })
    await saveWorkflowMeta()
  }

  async function handleGeneratePropImage(
    propId: string,
    options: {
      skipCompletionNotice?: boolean
    } = {}
  ) {
    const previousImage = propAssets.value.find(item => item.id === propId)?.referenceImage?.trim() || ''
    const generatedImage = await generatePropImageCore(propId, {
      skipCompletionNotice: options.skipCompletionNotice
    })
    const target = propAssets.value.find(item => item.id === propId)
    const nextImage = generatedImage?.trim() || target?.referenceImage?.trim() || ''
    if (!target || !nextImage || nextImage === previousImage) return

    target.referenceImage = nextImage

    recordPropHistory(propId, nextImage, { source: 'generated' })
    await saveWorkflowMeta()
  }

  async function uploadSceneEditOtherAssets(options: {
    sceneId: string
    files: File[]
    names?: string[]
  }): Promise<DisplayAsset[]> {
    const sceneId = options.sceneId?.trim()
    if (!sceneId) {
      throw new Error('场景ID无效，无法上传资产')
    }

    const files = Array.isArray(options.files) ? options.files : []
    const names = Array.isArray(options.names) ? options.names : []
    if (files.length === 0) return []

    const createdAssets: DisplayAsset[] = []
    const existingNames = propAssets.value.map(item => item.name)

    try {
      for (const [index, file] of files.entries()) {
        const imageUrl = await uploadImageFile(file, {
          maxFileSize: maxAssetUploadSize,
          prefix: `scene_edit_${sceneId}`,
          projectId: projectId.value || ''
        })

        const preferredName = (names[index] || '').trim()
        const name = resolveChatUploadAssetName(preferredName || file.name, existingNames)
        existingNames.push(name)

        const propId = createPropAssetId()
        propAssets.value.push({
          id: propId,
          name,
          description: '场景编辑上传图片资产',
          category: 'other',
          mediaType: 'image',
          referenceImage: imageUrl
        })
        recordPropHistory(propId, imageUrl, { source: 'uploaded' })
        createdAssets.push({
          id: `prop:${propId}`,
          name,
          type: 'other',
          description: '场景编辑上传图片资产',
          referenceImage: imageUrl
        })
      }

      await saveWorkflowMeta()
      return createdAssets
    } catch (error) {
      throw new Error(resolveUiError(error, '场景编辑上传资产失败'))
    }
  }

  return {
    handleCharacterImageUpload,
    handlePropImageUpload,
    handleGeneratePropImage,
    uploadSceneEditOtherAssets
  }
}

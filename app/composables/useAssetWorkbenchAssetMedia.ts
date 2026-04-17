import { toImageSrc } from '~/lib/media'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import {
  applySceneBaselineReference,
  type GenerateSceneBaselineOptions
} from '~/lib/asset-workbench-scene-generation'
import {
  resetFileInput,
  uploadImageFile
} from '~/lib/asset-workbench-upload'
import type { EnvironmentAssetCard } from '~/lib/asset-workbench-types'

export function useAssetWorkbenchAssetMedia(options: {
  maxAssetUploadSize: number
  statusError: Ref<string | null>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  synchronizeQueueItems: () => void
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentRepresentativeScene: (assetId: string) => SceneData | undefined
  generateSceneBaseline: (
    sceneId: string,
    options?: GenerateSceneBaselineOptions
  ) => Promise<void>
}) {
  const imagePreviewOpen = ref(false)
  const imagePreviewSrc = ref('')
  const imagePreviewAlt = ref('')
  const environmentRegenerateDialogOpen = ref(false)
  const environmentRegenerateTargetId = ref<string | null>(null)
  const environmentRegeneratePrompt = ref('')
  const environmentRegenerateError = ref<string | null>(null)
  const uploadingCharacterId = ref<string | null>(null)
  const uploadingEnvironmentAssetId = ref<string | null>(null)
  const uploadingPropId = ref<string | null>(null)

  watch(environmentRegenerateDialogOpen, (open) => {
    if (open) return
    environmentRegenerateTargetId.value = null
    environmentRegenerateError.value = null
  })

  const environmentRegenerateTarget = computed(() => {
    if (!environmentRegenerateTargetId.value) return null
    return options.resolveEnvironmentCard(environmentRegenerateTargetId.value) || null
  })

  function openImagePreview(imageData: string | undefined, alt = '图片预览') {
    const src = toImageSrc(imageData)
    if (!src) return
    imagePreviewSrc.value = src
    imagePreviewAlt.value = alt
    imagePreviewOpen.value = true
  }

  async function handleCharacterImageUpload(characterId: string, event: Event) {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      resetFileInput(event)
      return
    }

    const target = options.characters.value.find(char => char.id === characterId)
    if (!target) {
      resetFileInput(event)
      return
    }

    uploadingCharacterId.value = characterId
    options.statusError.value = null

    try {
      const imageUrl = await uploadImageFile(file, {
        maxFileSize: options.maxAssetUploadSize,
        prefix: `char_${target.id}`
      })
      target.baseImage = imageUrl
      await options.saveProject()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '角色图片上传失败')
    } finally {
      uploadingCharacterId.value = null
      resetFileInput(event)
    }
  }

  async function handleEnvironmentImageUpload(assetId: string, event: Event) {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      resetFileInput(event)
      return
    }

    const asset = options.resolveEnvironmentCard(assetId)
    if (!asset) {
      resetFileInput(event)
      return
    }

    uploadingEnvironmentAssetId.value = assetId
    options.statusError.value = null

    try {
      const imageUrl = await uploadImageFile(file, {
        maxFileSize: options.maxAssetUploadSize,
        prefix: `env_${asset.sceneIds[0] || assetId}`
      })

      for (const sceneId of asset.sceneIds) {
        const scene = options.scenes.value.find(item => item.id === sceneId)
        if (!scene) continue

        applySceneBaselineReference(scene, imageUrl)
      }

      options.synchronizeQueueItems()
      await options.saveProject()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '环境图片上传失败')
    } finally {
      uploadingEnvironmentAssetId.value = null
      resetFileInput(event)
    }
  }

  async function handlePropImageUpload(propId: string, event: Event) {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      resetFileInput(event)
      return
    }

    const target = options.propAssets.value.find(item => item.id === propId)
    if (!target) {
      resetFileInput(event)
      return
    }

    uploadingPropId.value = propId
    options.statusError.value = null

    try {
      const imageUrl = await uploadImageFile(file, {
        maxFileSize: options.maxAssetUploadSize,
        prefix: `prop_${target.id}`
      })
      target.referenceImage = imageUrl
      await options.saveWorkflowMeta()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '道具图片上传失败')
    } finally {
      uploadingPropId.value = null
      resetFileInput(event)
    }
  }

  function openEnvironmentRegenerateDialog(assetId: string) {
    const asset = options.resolveEnvironmentCard(assetId)
    if (!asset) return

    if (!asset.referenceImage?.trim()) {
      alert('请先生成或上传环境图，再进行二次生成')
      return
    }

    environmentRegenerateTargetId.value = asset.id
    environmentRegeneratePrompt.value = ''
    environmentRegenerateError.value = null
    environmentRegenerateDialogOpen.value = true
  }

  function closeEnvironmentRegenerateDialog() {
    environmentRegenerateDialogOpen.value = false
    environmentRegenerateTargetId.value = null
    environmentRegenerateError.value = null
  }

  function setEnvironmentRegenerateDialogOpen(open: boolean) {
    if (open) {
      environmentRegenerateDialogOpen.value = true
      return
    }
    closeEnvironmentRegenerateDialog()
  }

  function setEnvironmentRegeneratePrompt(prompt: string) {
    environmentRegeneratePrompt.value = prompt
  }

  async function submitEnvironmentRegeneration() {
    const targetAssetId = environmentRegenerateTargetId.value
    if (!targetAssetId) return

    const targetAsset = options.resolveEnvironmentCard(targetAssetId)
    if (!targetAsset) {
      closeEnvironmentRegenerateDialog()
      return
    }

    const prompt = environmentRegeneratePrompt.value.trim()
    if (!prompt) {
      environmentRegenerateError.value = '请输入二次生成提示词'
      return
    }

    const targetScene = options.resolveEnvironmentRepresentativeScene(targetAsset.id)
    if (!targetScene) {
      environmentRegenerateError.value = '未找到代表场景，无法二次生成'
      return
    }

    if (!options.resolveSceneReferenceImage(targetScene)?.trim() && !targetAsset.referenceImage?.trim()) {
      environmentRegenerateError.value = '环境参考图不存在，请先生成环境图'
      return
    }

    environmentRegenerateError.value = null

    try {
      await options.generateSceneBaseline(targetScene.id, {
        customPrompt: prompt
      })

      const updatedImage = options.resolveSceneReferenceImage(targetScene)
      if (updatedImage) {
        for (const sceneId of targetAsset.sceneIds) {
          if (sceneId === targetScene.id) continue
          const scene = options.scenes.value.find(item => item.id === sceneId)
          if (!scene) continue

          applySceneBaselineReference(scene, updatedImage)
        }
        options.synchronizeQueueItems()
        await options.saveProject()
      }

      closeEnvironmentRegenerateDialog()
    } catch (error) {
      environmentRegenerateError.value = options.resolveUiError(error, '环境二次生成失败')
    }
  }

  return {
    imagePreviewOpen,
    imagePreviewSrc,
    imagePreviewAlt,
    environmentRegenerateDialogOpen,
    environmentRegeneratePrompt,
    environmentRegenerateError,
    environmentRegenerateTarget,
    uploadingCharacterId,
    uploadingEnvironmentAssetId,
    uploadingPropId,
    openImagePreview,
    handleCharacterImageUpload,
    handleEnvironmentImageUpload,
    handlePropImageUpload,
    openEnvironmentRegenerateDialog,
    setEnvironmentRegenerateDialogOpen,
    setEnvironmentRegeneratePrompt,
    submitEnvironmentRegeneration
  }
}

import { toImageSrc } from '~/lib/media'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import {
  applySceneBaselineReference,
  type GenerateSceneBaselineOptions
} from '~/lib/asset-workbench-scene-generation'
import {
  resetFileInput,
  uploadAudioFile,
  uploadImageFile
} from '~/lib/asset-workbench-upload'
import { isPanoramaSourceSize } from '~/lib/asset-workbench-environment-panorama'
import {
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode
} from '~/lib/asset-workbench-environment-views'
import type {
  EnvironmentAssetCard,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'

export function useAssetWorkbenchAssetMedia(options: {
  maxAssetUploadSize: number
  maxVoiceUploadSize: number
  statusError: Ref<string | null>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  workflowStylePrompt: Ref<string>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  synchronizeQueueItems: () => void
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentRepresentativeScene: (assetId: string) => SceneData | undefined
  panoramaSourceAspectRatio?: Ref<string>
  setEnvironmentPanoramaState?: (assetId: string, state: EnvironmentPanoramaState | undefined) => void
  generateSceneBaseline: (
    sceneId: string,
    options?: GenerateSceneBaselineOptions
  ) => Promise<void>
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}) {
  const imagePreviewOpen = ref(false)
  const imagePreviewSrc = ref('')
  const imagePreviewAlt = ref('')
  const environmentRegenerateDialogOpen = ref(false)
  const environmentRegenerateTargetId = ref<string | null>(null)
  const environmentRegeneratePrompt = ref('')
  const environmentRegenerateError = ref<string | null>(null)
  const uploadingCharacterId = ref<string | null>(null)
  const uploadingCharacterVoiceId = ref<string | null>(null)
  const uploadingEnvironmentAssetId = ref<string | null>(null)
  const uploadingPropId = ref<string | null>(null)
  const generatingPropId = ref<string | null>(null)

  async function isPanoramaFile(file: File): Promise<boolean> {
    return await new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file)
      const image = new Image()

      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width
          const height = image.naturalHeight || image.height
          resolve(isPanoramaSourceSize(width, height, options.panoramaSourceAspectRatio?.value))
        } finally {
          URL.revokeObjectURL(objectUrl)
        }
      }

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(false)
      }

      image.src = objectUrl
    })
  }

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

  async function handleCharacterVoiceUpload(characterId: string, event: Event) {
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

    uploadingCharacterVoiceId.value = characterId
    options.statusError.value = null

    try {
      const audioUrl = await uploadAudioFile(file, {
        maxFileSize: options.maxVoiceUploadSize,
        prefix: `voice_${target.id}`
      })

      target.voiceAsset = {
        audioUrl,
        locked: target.voiceAsset?.locked ?? false,
        updatedAt: new Date().toISOString()
      }

      await options.saveProject()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '角色音频上传失败')
    } finally {
      uploadingCharacterVoiceId.value = null
      resetFileInput(event)
    }
  }

  async function handleCharacterVoiceLockChange(characterId: string, locked: boolean) {
    const target = options.characters.value.find(char => char.id === characterId)
    if (!target?.voiceAsset?.audioUrl) return

    target.voiceAsset = {
      ...target.voiceAsset,
      locked,
      updatedAt: target.voiceAsset.updatedAt || new Date().toISOString()
    }
    options.statusError.value = null

    try {
      await options.saveProject()
    } catch (error) {
      target.voiceAsset = {
        ...target.voiceAsset,
        locked: !locked
      }
      options.statusError.value = options.resolveUiError(error, locked ? '锁定角色音频失败' : '取消锁定角色音频失败')
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

      const panoramaCompatible = await isPanoramaFile(file)
      options.setEnvironmentPanoramaState?.(
        assetId,
        panoramaCompatible
          ? { panoramaImage: imageUrl }
          : undefined
      )
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

  async function generatePropImage(
    propId: string,
    generationOptions: {
      skipCompletionNotice?: boolean
    } = {}
  ): Promise<string | undefined> {
    const target = options.propAssets.value.find(item => item.id === propId)
    if (!target || generatingPropId.value) return

    generatingPropId.value = propId
    options.statusError.value = null

    try {
      const response = await $fetch<{
        success: boolean
        imageUrl?: string
      }>('/api/asset-workflow/prop/generate', {
        method: 'POST',
        body: {
          prop: {
            id: target.id,
            name: target.name,
            description: target.description,
            category: target.category
          },
          style: options.workflowStylePrompt.value
        }
      })

      if (!response.success || !response.imageUrl) {
        throw new Error('道具图生成失败')
      }

      target.referenceImage = response.imageUrl
      await options.saveWorkflowMeta()
      if (!generationOptions.skipCompletionNotice) {
        await options.onModelTaskCompleted?.({
          title: '道具图生成完成',
          body: `道具：${target.name || target.id}`
        })
      }
      return response.imageUrl
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '道具图生成失败')
      return undefined
    } finally {
      generatingPropId.value = null
    }
  }

  function openEnvironmentRegenerateDialog(assetId: string) {
    const asset = options.resolveEnvironmentCard(assetId)
    if (!asset) return

    if (!asset.referenceImage?.trim() && !asset.panoramaImage?.trim()) {
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

    if (
      !options.resolveSceneReferenceImage(targetScene)?.trim()
      && !targetAsset.referenceImage?.trim()
      && !targetAsset.panoramaImage?.trim()
    ) {
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
        const latestAsset = options.resolveEnvironmentCard(targetAsset.id) || targetAsset
        for (const sceneId of targetAsset.sceneIds) {
          if (sceneId === targetScene.id) continue
          const scene = options.scenes.value.find(item => item.id === sceneId)
          if (!scene) continue

          const preferredMode = resolveEnvironmentCaptureModeForScene(scene, {
            fallbackCaptureMode: latestAsset.captureMode
          })
          const sceneReferenceImage = resolveEnvironmentReferenceImageByCaptureMode({
            panoramaImage: latestAsset.panoramaImage,
            singleViewImage: latestAsset.singleViewImage,
            fourViewImage: latestAsset.fourViewImage,
            captureMode: latestAsset.captureMode
          }, preferredMode) || updatedImage

          applySceneBaselineReference(scene, sceneReferenceImage)
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
    uploadingCharacterVoiceId,
    uploadingEnvironmentAssetId,
    uploadingPropId,
    generatingPropId,
    openImagePreview,
    handleCharacterImageUpload,
    handleCharacterVoiceUpload,
    handleCharacterVoiceLockChange,
    handleEnvironmentImageUpload,
    handlePropImageUpload,
    generatePropImage,
    openEnvironmentRegenerateDialog,
    setEnvironmentRegenerateDialogOpen,
    setEnvironmentRegeneratePrompt,
    submitEnvironmentRegeneration
  }
}

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
import {
  createArkVirtualAssetGroup,
  listArkVirtualAssetGroups,
  pollArkVirtualAsset,
  uploadArkVirtualAsset
} from '~/lib/ark-virtual-assets'
import { isPanoramaSourceSize } from '~/lib/asset-workbench-environment-panorama'
import {
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode
} from '~/lib/asset-workbench-environment-views'
import type {
  EnvironmentCropCaptureMode,
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
  projectName?: Ref<string>
  projectId?: Ref<string | undefined>
  workflowStylePrompt: Ref<string>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  synchronizeQueueItems: () => void
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentRepresentativeScene: (assetId: string) => SceneData | undefined
  panoramaSourceAspectRatio?: Ref<string>
  recordEnvironmentHistory?: (
    assetId: string,
    image: string,
    options?: {
      source?: 'generated' | 'uploaded' | 'cropped' | 'legacy'
      prompt?: string
      viewMode?: EnvironmentCropCaptureMode
    }
  ) => void
  setEnvironmentPanoramaState?: (assetId: string, state: EnvironmentPanoramaState | undefined) => void
  generateSceneBaseline: (
    sceneId: string,
    options?: GenerateSceneBaselineOptions
  ) => Promise<void>
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
  onModelTaskFailed?: (payload: {
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
  const uploadingArkCharacterId = ref<string | null>(null)
  const uploadingCharacterVoiceId = ref<string | null>(null)
  const uploadingEnvironmentAssetId = ref<string | null>(null)
  const uploadingPropId = ref<string | null>(null)
  const uploadingPropVoiceId = ref<string | null>(null)
  const generatingPropId = ref<string | null>(null)

  async function notifyModelTaskCompleted(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskCompleted) return
    try {
      await options.onModelTaskCompleted(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchAssetMedia] 模型任务完成通知失败:', error)
    }
  }

  async function notifyModelTaskFailed(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskFailed) return
    try {
      await options.onModelTaskFailed(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchAssetMedia] 模型任务失败通知失败:', error)
    }
  }

  function resolveArkGroupName() {
    return options.projectName?.value?.trim() || 'Playlet 项目素材'
  }

  async function resolveProjectArkVirtualAssetGroupId(projectName: string) {
    const groupName = resolveArkGroupName()
    const page = await listArkVirtualAssetGroups({
      name: groupName,
      projectName,
      pageNumber: 1,
      pageSize: 50
    })
    const existing = page.items.find(group => (group.Name || group.Title || '').trim() === groupName)
    if (existing?.Id) {
      return existing.Id
    }

    return await createArkVirtualAssetGroup({
      name: groupName,
      description: `Playlet Desktop 项目素材：${groupName}`,
      projectName
    })
  }

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

  async function ingestCharacterToArkVirtualAsset(
    characterId: string,
    ingestOptions: {
      silent?: boolean
    } = {}
  ) {
    const target = options.characters.value.find(char => char.id === characterId)
    if (!target) return

    const { toast } = useToast()
    const source = target.baseImage?.trim()
    if (!source) {
      if (!ingestOptions.silent) {
        toast.warning('请先生成或上传角色图')
      }
      return
    }

    uploadingArkCharacterId.value = characterId
    options.statusError.value = null

    const previous = target.arkAsset
    const parentArkAsset = target.parentCharacterId
      ? options.characters.value.find(char => char.id === target.parentCharacterId)?.arkAsset
      : undefined
    const arkTemplate = previous || parentArkAsset
    try {
      const projectName = arkTemplate?.projectName || 'default'
      const groupId = await resolveProjectArkVirtualAssetGroupId(projectName)

      target.arkAsset = {
        provider: 'volcengine',
        libraryType: 'virtual_human',
        projectName,
        groupId,
        assetType: 'Image',
        sourceUrl: source,
        name: target.name,
        status: 'Processing',
        updatedAt: new Date().toISOString()
      }
      await options.saveProject()

      const isPublicHttpSource = /^https?:\/\//i.test(source)
        && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(source)
      const uploaded = await uploadArkVirtualAsset({
        groupId,
        name: target.name || '虚拟人像素材',
        sourceUrl: isPublicHttpSource ? source : undefined,
        imageData: isPublicHttpSource ? undefined : source,
        projectName
      })
      target.arkAsset = uploaded
      await options.saveProject()

      const assetId = uploaded.assetId
      if (!assetId) {
        throw new Error('火山未返回素材 ID')
      }

      const polled = await pollArkVirtualAsset({
        assetId,
        projectName,
        timeoutMs: 10 * 60 * 1000,
        intervalMs: 5000,
        fallback: uploaded
      })
      target.arkAsset = polled.asset
      await options.saveProject()

      if (polled.asset.status === 'Active') {
        if (!ingestOptions.silent) {
          toast.success('虚拟人像已入库，可用于 Seedance 生成')
        }
      } else if (polled.asset.status === 'Failed') {
        if (!ingestOptions.silent) {
          toast.error('虚拟人像入库失败', { description: '请检查素材合规性或稍后重试。' })
        }
      } else if (polled.timeout) {
        if (!ingestOptions.silent) {
          toast.warning('虚拟人像仍在处理中', { description: '稍后可再次点击查询或重新入库。' })
        }
      }
    } catch (error) {
      const message = options.resolveUiError(error, '虚拟人像入库失败')
      target.arkAsset = previous
        ? {
            ...previous,
            status: previous.status === 'Active' ? 'Active' : 'Failed',
            errorMessage: message,
            updatedAt: new Date().toISOString()
          }
        : {
            provider: 'volcengine',
            libraryType: 'virtual_human',
            projectName: 'default',
            groupId: '',
            assetType: 'Image',
            sourceUrl: source,
            name: target.name,
            status: 'Failed',
            errorMessage: message,
            updatedAt: new Date().toISOString()
          }
      options.statusError.value = message
      await options.saveProject().catch(() => undefined)
    } finally {
      uploadingArkCharacterId.value = null
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

      // Only real scene IDs receive firstFrame; plan: markers are directory hints.
      let appliedSceneCount = 0
      for (const sceneId of asset.sceneIds) {
        if (!sceneId || sceneId.startsWith('plan:')) continue
        const scene = options.scenes.value.find(item => item.id === sceneId)
        if (!scene) continue

        applySceneBaselineReference(scene, imageUrl)
        appliedSceneCount += 1
      }

      options.recordEnvironmentHistory?.(
        assetId,
        imageUrl,
        { source: 'uploaded' }
      )

      const panoramaCompatible = await isPanoramaFile(file)
      // Persist an explicit view state so re-entry can restore from assetWorkflow
      // even when no scene firstFrame was updated (episode-plan-only env assets).
      options.setEnvironmentPanoramaState?.(
        assetId,
        panoramaCompatible
          ? { panoramaImage: imageUrl }
          : { singleViewImage: imageUrl }
      )
      options.synchronizeQueueItems()

      // Refresh assetWorkflow before project save. saveProject PUTs the full
      // script payload including assetWorkflow; writing scenes first with a
      // stale workflow would wipe the just-recorded environment history.
      await options.saveWorkflowMeta()

      const saved = await options.saveProject()
      if (saved === false) {
        throw new Error('环境图片已上传到云端，但项目保存失败，请查看页面顶部的保存错误提示后重试')
      }

      useToast().toast.success(
        appliedSceneCount > 0
          ? '环境图片上传成功'
          : '环境图片上传成功（已写入素材历史，重新进入项目后可恢复）'
      )
    } catch (error) {
      const message = options.resolveUiError(error, '环境图片上传失败')
      options.statusError.value = message
      useToast().toast.error('环境图片上传失败', {
        description: message
      })
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
      if (target.category === 'other' && target.mediaType !== 'voice') {
        target.mediaType = 'image'
      }
      await options.saveWorkflowMeta()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '道具图片上传失败')
    } finally {
      uploadingPropId.value = null
      resetFileInput(event)
    }
  }

  async function handlePropVoiceUpload(propId: string, event: Event) {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      resetFileInput(event)
      return
    }

    const target = options.propAssets.value.find(item => item.id === propId)
    if (!target || target.category !== 'other') {
      resetFileInput(event)
      return
    }

    uploadingPropVoiceId.value = propId
    options.statusError.value = null

    try {
      const audioUrl = await uploadAudioFile(file, {
        maxFileSize: options.maxVoiceUploadSize,
        prefix: `voice_${target.id}`
      })
      target.voiceAsset = {
        audioUrl,
        locked: target.voiceAsset?.locked ?? true,
        updatedAt: new Date().toISOString()
      }
      target.mediaType = 'voice'
      await options.saveWorkflowMeta()
    } catch (error) {
      options.statusError.value = options.resolveUiError(error, '旁白音频上传失败')
    } finally {
      uploadingPropVoiceId.value = null
      resetFileInput(event)
    }
  }

  async function handlePropVoiceLockChange(propId: string, locked: boolean) {
    const target = options.propAssets.value.find(item => item.id === propId)
    if (!target?.voiceAsset?.audioUrl) return

    target.voiceAsset = {
      ...target.voiceAsset,
      locked,
      updatedAt: target.voiceAsset.updatedAt || new Date().toISOString()
    }
    options.statusError.value = null

    try {
      await options.saveWorkflowMeta()
    } catch (error) {
      target.voiceAsset = {
        ...target.voiceAsset,
        locked: !locked
      }
      options.statusError.value = options.resolveUiError(error, locked ? '锁定旁白音频失败' : '取消锁定旁白音频失败')
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
          projectId: options.projectId?.value || undefined,
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
        await notifyModelTaskCompleted({
          title: '道具图生成完成',
          body: `道具：${target.name || target.id}`
        })
      }
      return response.imageUrl
    } catch (error) {
      const message = options.resolveUiError(error, '道具图生成失败')
      options.statusError.value = message
      if (!generationOptions.skipCompletionNotice) {
        await notifyModelTaskFailed({
          title: '道具图生成失败',
          body: `道具：${target.name || target.id}（${message}）`
        })
      }
      return undefined
    } finally {
      generatingPropId.value = null
    }
  }

  function openEnvironmentRegenerateDialog(assetId: string) {
    const asset = options.resolveEnvironmentCard(assetId)
    if (!asset) return

    if (!asset.referenceImage?.trim() && !asset.panoramaImage?.trim()) {
      useToast().toast.warning('请先生成或上传环境图，再进行二次生成')
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

  async function submitEnvironmentRegeneration(input: {
    consistencyReferenceImage?: string
    consistencyReferenceImages?: string[]
  } = {}) {
    const targetAssetId = environmentRegenerateTargetId.value
    if (!targetAssetId) return

    const targetAsset = options.resolveEnvironmentCard(targetAssetId)
    if (!targetAsset) {
      closeEnvironmentRegenerateDialog()
      return
    }

    const prompt = environmentRegeneratePrompt.value.trim()
    const consistencyReferenceImage = input.consistencyReferenceImage?.trim() || ''
    const consistencyReferenceImages = Array.isArray(input.consistencyReferenceImages)
      ? Array.from(new Set(
          input.consistencyReferenceImages
            .map(value => value?.trim() || '')
            .filter(Boolean)
        ))
      : []
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
        customPrompt: prompt,
        consistencyReferenceImage: consistencyReferenceImage || undefined,
        consistencyReferenceImages: consistencyReferenceImages.length > 0
          ? consistencyReferenceImages
          : undefined
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
    uploadingArkCharacterId,
    uploadingCharacterVoiceId,
    uploadingEnvironmentAssetId,
    uploadingPropId,
    uploadingPropVoiceId,
    generatingPropId,
    openImagePreview,
    handleCharacterImageUpload,
    ingestCharacterToArkVirtualAsset,
    handleCharacterVoiceUpload,
    handleCharacterVoiceLockChange,
    handleEnvironmentImageUpload,
    handlePropImageUpload,
    handlePropVoiceUpload,
    handlePropVoiceLockChange,
    generatePropImage,
    openEnvironmentRegenerateDialog,
    setEnvironmentRegenerateDialogOpen,
    setEnvironmentRegeneratePrompt,
    submitEnvironmentRegeneration
  }
}

import { computed, ref, watch, type Ref } from 'vue'
import { useToast } from '~/composables/useToast'
import type {
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentCropSelection,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'
import {
  resolveEnvironmentCropCaptureMode
} from '~/lib/asset-workbench-environment-panorama'
import { mergeEnvironmentReferenceViewImages } from '~/lib/asset-workbench-environment-views'

export interface EnvironmentCropImageResult {
  imageUrl: string
  crop: EnvironmentCropSelection
  captureMode: EnvironmentCropCaptureMode
  singleViewImage?: string
  fourViewImage?: string
}

/** Crop dialog: frame a single/four-view environment reference out of the panorama source. */
export function useAssetWorkbenchEnvironmentCrop(options: {
  referenceAspectRatio: string
  panoramaSourceAspectRatio: Ref<string>
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentPanoramaState: (assetId: string) => EnvironmentPanoramaState | undefined
  resolveEnvironmentHistoryImageByView: (asset: EnvironmentAssetCard | null | undefined, viewMode: EnvironmentCropCaptureMode) => string | undefined
  createEnvironmentCropImage: (options: {
    assetId: string
    sourceImage: string
    crop?: EnvironmentCropSelection
    captureMode?: EnvironmentCropCaptureMode
    aspectRatio?: string
  }) => Promise<EnvironmentCropImageResult>
  applyEnvironmentReferenceImage: (assetId: string, imageUrl: string, panoramaState?: EnvironmentPanoramaState) => Promise<void>
  recordEnvironmentHistory: (
    assetId: string,
    image: string,
    options?: { source?: 'generated' | 'uploaded' | 'cropped' | 'legacy', prompt?: string, viewMode?: EnvironmentCropCaptureMode }
  ) => void
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
}) {
  const {
    referenceAspectRatio,
    panoramaSourceAspectRatio,
    resolveEnvironmentCard,
    resolveEnvironmentPanoramaState,
    resolveEnvironmentHistoryImageByView,
    createEnvironmentCropImage,
    applyEnvironmentReferenceImage,
    recordEnvironmentHistory,
    saveWorkflowMeta,
    resolveUiError
  } = options
  const { toast } = useToast()

  const environmentCropDialogOpen = ref(false)
  const environmentCropTargetId = ref<string | null>(null)
  const environmentCropRequestedCaptureMode = ref<EnvironmentCropCaptureMode | null>(null)
  const environmentCropSaving = ref(false)
  const environmentCropError = ref<string | null>(null)

  watch(environmentCropDialogOpen, (open) => {
    if (open) return
    environmentCropTargetId.value = null
    environmentCropRequestedCaptureMode.value = null
    environmentCropError.value = null
  })

  const environmentCropTarget = computed(() => {
    if (!environmentCropTargetId.value) return null
    return resolveEnvironmentCard(environmentCropTargetId.value) || null
  })

  const environmentCropSourceImage = computed(() => {
    return environmentCropTarget.value?.panoramaImage?.trim()
      || environmentCropTarget.value?.referenceImage?.trim()
      || ''
  })

  const environmentCropInitialSelection = computed(() => {
    if (!environmentCropTarget.value) return undefined
    return resolveEnvironmentPanoramaState(environmentCropTarget.value.id)?.crop
      || environmentCropTarget.value.crop
  })

  const environmentCropInitialCaptureMode = computed<EnvironmentCropCaptureMode>(() => {
    if (environmentCropRequestedCaptureMode.value) {
      return resolveEnvironmentCropCaptureMode(environmentCropRequestedCaptureMode.value)
    }
    if (!environmentCropTarget.value) return '单视角'
    const captureMode = resolveEnvironmentPanoramaState(environmentCropTarget.value.id)?.captureMode
      || environmentCropTarget.value.captureMode
    return resolveEnvironmentCropCaptureMode(
      captureMode
    )
  })

  function openEnvironmentCropDialog(
    assetId: string,
    captureMode?: EnvironmentCropCaptureMode
  ) {
    const asset = resolveEnvironmentCard(assetId)
    if (!asset?.panoramaImage?.trim() && !asset?.referenceImage?.trim()) {
      toast.warning(`请先生成或上传 ${panoramaSourceAspectRatio.value} 的环境源图，再选择取景区域`)
      return
    }

    environmentCropTargetId.value = assetId
    environmentCropRequestedCaptureMode.value = captureMode || null
    environmentCropError.value = null
    environmentCropDialogOpen.value = true
  }

  function setEnvironmentCropDialogOpen(open: boolean) {
    environmentCropDialogOpen.value = open
    if (!open) {
      environmentCropTargetId.value = null
      environmentCropRequestedCaptureMode.value = null
      environmentCropError.value = null
    }
  }

  async function submitEnvironmentCropSelection(payload: {
    selection: EnvironmentCropSelection
    captureMode: EnvironmentCropCaptureMode
  }) {
    const target = environmentCropTarget.value
    const sourceImage = environmentCropSourceImage.value
    if (!target || !sourceImage) {
      environmentCropError.value = `环境源图不存在，请先重新生成或上传 ${panoramaSourceAspectRatio.value} 全景图`
      return
    }

    environmentCropSaving.value = true
    environmentCropError.value = null

    try {
      const result = await createEnvironmentCropImage({
        assetId: target.id,
        sourceImage,
        crop: payload.selection,
        captureMode: payload.captureMode,
        aspectRatio: referenceAspectRatio
      })

      const normalizedSingleViewImage = result.singleViewImage?.trim()
        || (result.captureMode === '单视角'
          ? (result.imageUrl?.trim() || undefined)
          : undefined)
      const normalizedFourViewImage = result.fourViewImage?.trim()
        || (result.captureMode === '四视角'
          ? (result.imageUrl?.trim() || undefined)
          : undefined)
      const latestPanoramaState = resolveEnvironmentPanoramaState(target.id)
      const previousSingleViewImage = latestPanoramaState?.singleViewImage?.trim()
        || target.singleViewImage?.trim()
        || resolveEnvironmentHistoryImageByView(target, '单视角')
        || undefined
      const previousFourViewImage = latestPanoramaState?.fourViewImage?.trim()
        || target.fourViewImage?.trim()
        || resolveEnvironmentHistoryImageByView(target, '四视角')
        || undefined
      const nextViewImages = mergeEnvironmentReferenceViewImages({
        previousSingleViewImage,
        previousFourViewImage,
        nextSingleViewImage: normalizedSingleViewImage,
        nextFourViewImage: normalizedFourViewImage,
        captureMode: result.captureMode
      })
      await applyEnvironmentReferenceImage(target.id, result.imageUrl, {
        panoramaImage: target.panoramaImage?.trim() || sourceImage,
        crop: result.crop,
        captureMode: result.captureMode,
        singleViewImage: nextViewImages.singleViewImage,
        fourViewImage: nextViewImages.fourViewImage
      })

      const selectedViewImage = result.captureMode === '四视角'
        ? (result.fourViewImage?.trim() || result.imageUrl?.trim() || '')
        : (result.singleViewImage?.trim() || result.imageUrl?.trim() || '')

      if (selectedViewImage) {
        recordEnvironmentHistory(target.id, selectedViewImage, {
          source: 'cropped',
          viewMode: result.captureMode
        })
      }
      await saveWorkflowMeta()
      setEnvironmentCropDialogOpen(false)
    } catch (error) {
      environmentCropError.value = resolveUiError(error, '环境取景区域保存失败')
    } finally {
      environmentCropSaving.value = false
    }
  }

  return {
    environmentCropDialogOpen,
    environmentCropSaving,
    environmentCropError,
    environmentCropTarget,
    environmentCropSourceImage,
    environmentCropInitialSelection,
    environmentCropInitialCaptureMode,
    openEnvironmentCropDialog,
    setEnvironmentCropDialogOpen,
    submitEnvironmentCropSelection
  }
}

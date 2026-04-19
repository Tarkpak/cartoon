import { toCanvasSafeImageSrc } from '~/lib/media'
import type {
  EnvironmentCropSelection
} from '~/lib/asset-workbench-types'

export type EnvironmentCropAspectRatio = '16:9' | '9:16' | '1:1'

const MIN_CROP_COVERAGE = 0.35
const DEFAULT_CROP_COVERAGE = 1
const LEGACY_DEFAULT_CROP_COVERAGE = 0.82
const LEGACY_DEFAULT_CROP_COVERAGE_EPSILON = 0.005

interface CropImageMetrics {
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function resolveCropAspectRatioValue(aspectRatio: EnvironmentCropAspectRatio): number {
  if (aspectRatio === '9:16') return 9 / 16
  if (aspectRatio === '1:1') return 1
  return 16 / 9
}

export function resolveMaxCropSelection(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: EnvironmentCropAspectRatio
): Pick<EnvironmentCropSelection, 'width' | 'height'> {
  const sourceAspectRatio = imageWidth / imageHeight
  const targetAspectRatio = resolveCropAspectRatioValue(aspectRatio)

  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) {
    return { width: 1, height: 1 }
  }

  if (sourceAspectRatio >= targetAspectRatio) {
    return {
      width: clamp(targetAspectRatio / sourceAspectRatio, 0, 1),
      height: 1
    }
  }

  return {
    width: 1,
    height: clamp(sourceAspectRatio / targetAspectRatio, 0, 1)
  }
}

export function buildCropSelectionFromCoverage(options: {
  imageWidth: number
  imageHeight: number
  aspectRatio: EnvironmentCropAspectRatio
  centerX?: number
  centerY?: number
  coverage?: number
}): EnvironmentCropSelection {
  const maxSelection = resolveMaxCropSelection(
    options.imageWidth,
    options.imageHeight,
    options.aspectRatio
  )
  const coverage = clamp(options.coverage ?? DEFAULT_CROP_COVERAGE, MIN_CROP_COVERAGE, 1)
  const width = maxSelection.width * coverage
  const height = maxSelection.height * coverage
  const x = clamp((options.centerX ?? 0.5) - (width / 2), 0, 1 - width)
  const y = clamp((options.centerY ?? 0.5) - (height / 2), 0, 1 - height)

  return { x, y, width, height }
}

export function buildDefaultCropSelection(options: {
  imageWidth: number
  imageHeight: number
  aspectRatio: EnvironmentCropAspectRatio
  coverage?: number
}): EnvironmentCropSelection {
  return buildCropSelectionFromCoverage({
    ...options,
    centerX: 0.5,
    centerY: 0.5,
    coverage: options.coverage ?? DEFAULT_CROP_COVERAGE
  })
}

export function resolveCropSelectionCoverage(
  selection: EnvironmentCropSelection | undefined,
  imageWidth: number,
  imageHeight: number,
  aspectRatio: EnvironmentCropAspectRatio
): number {
  if (!selection) return DEFAULT_CROP_COVERAGE

  const maxSelection = resolveMaxCropSelection(imageWidth, imageHeight, aspectRatio)
  if (maxSelection.width <= 0 || maxSelection.height <= 0) {
    return DEFAULT_CROP_COVERAGE
  }

  const widthCoverage = selection.width / maxSelection.width
  const heightCoverage = selection.height / maxSelection.height
  return clamp(Math.min(widthCoverage, heightCoverage), MIN_CROP_COVERAGE, 1)
}

export function normalizeCropSelection(
  rawValue: unknown,
  imageWidth: number,
  imageHeight: number,
  aspectRatio: EnvironmentCropAspectRatio
): EnvironmentCropSelection | undefined {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return undefined
  }

  const item = rawValue as Partial<EnvironmentCropSelection>
  if (![item.x, item.y, item.width, item.height].every(Number.isFinite)) {
    return undefined
  }

  const coverage = resolveCropSelectionCoverage(
    {
      x: item.x as number,
      y: item.y as number,
      width: item.width as number,
      height: item.height as number
    },
    imageWidth,
    imageHeight,
    aspectRatio
  )
  const normalizedCoverage = Math.abs(coverage - LEGACY_DEFAULT_CROP_COVERAGE) <= LEGACY_DEFAULT_CROP_COVERAGE_EPSILON
    ? DEFAULT_CROP_COVERAGE
    : coverage
  const centerX = clamp((item.x as number) + ((item.width as number) / 2), 0, 1)
  const centerY = clamp((item.y as number) + ((item.height as number) / 2), 0, 1)

  return buildCropSelectionFromCoverage({
    imageWidth,
    imageHeight,
    aspectRatio,
    centerX,
    centerY,
    coverage: normalizedCoverage
  })
}

export async function loadCropImageMetrics(sourceImage: string): Promise<CropImageMetrics> {
  const src = toCanvasSafeImageSrc(sourceImage)
  if (!src) {
    throw new Error('环境全景图不存在，无法选取区域')
  }

  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height

      if (!width || !height) {
        reject(new Error('环境全景图尺寸无效，无法选取区域'))
        return
      }

      resolve({ width, height })
    }
    image.onerror = () => {
      reject(new Error('环境全景图加载失败，请稍后重试'))
    }
    image.src = src
  })
}

function resolveOutputSize(aspectRatio: EnvironmentCropAspectRatio): CropImageMetrics {
  if (aspectRatio === '9:16') {
    return { width: 720, height: 1280 }
  }
  if (aspectRatio === '1:1') {
    return { width: 1024, height: 1024 }
  }
  return { width: 1280, height: 720 }
}

export async function renderCropSelectionToDataUrl(options: {
  sourceImage: string
  selection: EnvironmentCropSelection
  aspectRatio: EnvironmentCropAspectRatio
}): Promise<string> {
  const src = toCanvasSafeImageSrc(options.sourceImage)
  if (!src) {
    throw new Error('环境全景图不存在，无法生成截图')
  }

  const outputSize = resolveOutputSize(options.aspectRatio)

  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height

      if (!width || !height) {
        reject(new Error('环境全景图尺寸无效，无法生成截图'))
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width = outputSize.width
      canvas.height = outputSize.height

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('当前浏览器不支持环境截图导出'))
        return
      }

      const sourceX = Math.round(width * options.selection.x)
      const sourceY = Math.round(height * options.selection.y)
      const sourceWidth = Math.max(1, Math.round(width * options.selection.width))
      const sourceHeight = Math.max(1, Math.round(height * options.selection.height))

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputSize.width,
        outputSize.height
      )

      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => {
      reject(new Error('环境全景图加载失败，无法生成截图'))
    }
    image.src = src
  })
}

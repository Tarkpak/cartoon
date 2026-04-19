import { toCanvasSafeImageSrc } from '~/lib/media'
import type {
  EnvironmentCropSelection
} from '~/lib/asset-workbench-types'

const MIN_CROP_WIDTH = 0.08
const MIN_CROP_HEIGHT = 0.08
const DEFAULT_CROP_WIDTH = 0.22
const DEFAULT_CROP_HEIGHT = 0.4
const MIN_CROP_COVERAGE = 0.35
const DEFAULT_CROP_COVERAGE = 1
const MAX_CROP_WIDTH = 1
const MAX_CROP_HEIGHT = 1
const DEFAULT_OUTPUT_PIXELS = 1280 * 720

interface CropImageMetrics {
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function resolveSelectionBounds() {
  return {
    minWidth: MIN_CROP_WIDTH,
    minHeight: MIN_CROP_HEIGHT,
    maxWidth: MAX_CROP_WIDTH,
    maxHeight: MAX_CROP_HEIGHT
  }
}

export function resolveMaxCropSelection(
  imageWidth: number,
  imageHeight: number
): Pick<EnvironmentCropSelection, 'width' | 'height'> {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    return { width: 1, height: 1 }
  }

  const bounds = resolveSelectionBounds()
  return {
    width: bounds.maxWidth,
    height: bounds.maxHeight
  }
}

export function resolveCropSelectionAspectRatio(
  selection: Pick<EnvironmentCropSelection, 'width' | 'height'> | undefined,
  sourceWidth: number = 1,
  sourceHeight: number = 1
): number {
  if (!selection || selection.width <= 0 || selection.height <= 0) {
    return clamp((DEFAULT_CROP_WIDTH * sourceWidth) / (DEFAULT_CROP_HEIGHT * sourceHeight), 0.2, 5)
  }

  return clamp((selection.width * sourceWidth) / (selection.height * sourceHeight), 0.2, 8)
}

export function buildDefaultCropSelection(options: {
  imageWidth: number
  imageHeight: number
  coverage?: number
}): EnvironmentCropSelection {
  const bounds = resolveSelectionBounds()
  const coverage = clamp(options.coverage ?? DEFAULT_CROP_COVERAGE, MIN_CROP_COVERAGE, 1)
  const width = clamp(DEFAULT_CROP_WIDTH * coverage, bounds.minWidth, bounds.maxWidth)
  const height = clamp(DEFAULT_CROP_HEIGHT * coverage, bounds.minHeight, bounds.maxHeight)

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height
  }
}

export function resolveCropSelectionCoverage(
  selection: EnvironmentCropSelection | undefined,
  imageWidth: number,
  imageHeight: number
): number {
  if (!selection) return DEFAULT_CROP_COVERAGE

  const maxSelection = resolveMaxCropSelection(imageWidth, imageHeight)
  if (maxSelection.width <= 0 || maxSelection.height <= 0) {
    return DEFAULT_CROP_COVERAGE
  }

  return clamp(
    Math.min(selection.width / maxSelection.width, selection.height / maxSelection.height),
    MIN_CROP_COVERAGE,
    1
  )
}

export function normalizeCropSelection(
  rawValue: unknown,
  imageWidth: number,
  imageHeight: number
): EnvironmentCropSelection | undefined {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return undefined
  }

  const item = rawValue as Partial<EnvironmentCropSelection>
  if (![item.x, item.y, item.width, item.height].every(Number.isFinite)) {
    return undefined
  }

  const maxSelection = resolveMaxCropSelection(imageWidth, imageHeight)
  const width = clamp(item.width as number, MIN_CROP_WIDTH, maxSelection.width)
  const height = clamp(item.height as number, MIN_CROP_HEIGHT, maxSelection.height)
  const x = clamp(item.x as number, 0, 1 - width)
  const y = clamp(item.y as number, 0, 1 - height)

  return { x, y, width, height }
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

export function resolveCropSelectionOutputSize(options: {
  selection: Pick<EnvironmentCropSelection, 'width' | 'height'>
  sourceWidth?: number
  sourceHeight?: number
  targetPixels?: number
  maxDimension?: number
  minDimension?: number
}): CropImageMetrics {
  const aspectRatio = resolveCropSelectionAspectRatio(
    options.selection,
    options.sourceWidth ?? 1,
    options.sourceHeight ?? 1
  )
  const targetPixels = Math.max(1, options.targetPixels ?? DEFAULT_OUTPUT_PIXELS)
  const maxDimension = Math.max(1, options.maxDimension ?? 1600)
  const minDimension = Math.max(1, options.minDimension ?? 480)

  let width = Math.sqrt(targetPixels * aspectRatio)
  let height = Math.sqrt(targetPixels / aspectRatio)

  const maxScale = Math.min(maxDimension / width, maxDimension / height, 1)
  width *= maxScale
  height *= maxScale

  const shortSide = Math.min(width, height)
  if (shortSide < minDimension) {
    const minScale = Math.min(maxDimension / width, maxDimension / height, minDimension / shortSide)
    width *= minScale
    height *= minScale
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height))
  }
}

export async function renderCropSelectionToDataUrl(options: {
  sourceImage: string
  selection: EnvironmentCropSelection
  outputSize?: CropImageMetrics
}): Promise<string> {
  const src = toCanvasSafeImageSrc(options.sourceImage)
  if (!src) {
    throw new Error('环境全景图不存在，无法生成截图')
  }

  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height

      if (!width || !height) {
        reject(new Error('环境全景图尺寸无效，无法生成截图'))
        return
      }

      const normalizedSelection = normalizeCropSelection(options.selection, width, height)
      if (!normalizedSelection) {
        reject(new Error('截图区域无效，无法生成截图'))
        return
      }

      const outputSize = options.outputSize || resolveCropSelectionOutputSize({
        selection: normalizedSelection,
        sourceWidth: width,
        sourceHeight: height
      })

      const canvas = document.createElement('canvas')
      canvas.width = outputSize.width
      canvas.height = outputSize.height

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('当前浏览器不支持环境截图导出'))
        return
      }

      const sourceX = Math.floor(normalizedSelection.x * width)
      const sourceY = Math.floor(normalizedSelection.y * height)
      const sourceWidth = Math.max(1, Math.min(width - sourceX, Math.round(normalizedSelection.width * width)))
      const sourceHeight = Math.max(1, Math.min(height - sourceY, Math.round(normalizedSelection.height * height)))

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

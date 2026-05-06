import { toCanvasSafeImageSrc } from './media'
import * as THREE from 'three'
import type {
  EnvironmentCropSelection
} from '~/lib/asset-workbench-types'

const MIN_CROP_WIDTH = 0.08
const MIN_CROP_HEIGHT = 0.08
const DEFAULT_CROP_WIDTH = 0.22
const DEFAULT_OUTPUT_ASPECT_RATIO = 16 / 9
const MIN_CROP_COVERAGE = 0.35
const DEFAULT_CROP_COVERAGE = 1
const MAX_CROP_WIDTH = 1
const MAX_CROP_HEIGHT = 1
const DEFAULT_OUTPUT_PIXELS = 1280 * 720
const EQUIRECTANGULAR_ASPECT_RATIO = 2
const EQUIRECTANGULAR_ASPECT_RATIO_TOLERANCE = 0.03
const MIN_PERSPECTIVE_FOV = Math.PI / 8
const MAX_PERSPECTIVE_FOV = Math.PI * 0.95

interface CropImageMetrics {
  width: number
  height: number
}

export interface PanoramaImageLoadResult extends CropImageMetrics {
  image: HTMLImageElement
}

export interface PanoramaRenderResult {
  imageData: string
  crop: EnvironmentCropSelection
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

export function isEquirectangularPanoramaSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false
  }

  return Math.abs((width / height) - EQUIRECTANGULAR_ASPECT_RATIO) <= EQUIRECTANGULAR_ASPECT_RATIO_TOLERANCE
}

export function assertEquirectangularPanoramaSize(width: number, height: number) {
  if (!isEquirectangularPanoramaSize(width, height)) {
    throw new Error('环境全景图必须是 2:1 的 equirectangular projection（等距柱状投影图）')
  }
}

export function resolvePerspectiveVerticalFov(horizontalFov: number, outputAspectRatio: number): number {
  const safeHorizontalFov = clamp(horizontalFov, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  const safeOutputAspectRatio = Number.isFinite(outputAspectRatio) && outputAspectRatio > 0
    ? outputAspectRatio
    : DEFAULT_OUTPUT_ASPECT_RATIO

  return clamp(
    2 * Math.atan(Math.tan(safeHorizontalFov / 2) / safeOutputAspectRatio),
    MIN_PERSPECTIVE_FOV,
    MAX_PERSPECTIVE_FOV
  )
}

export function resolvePanoramaSelectionHeightForAspectRatio(width: number, outputAspectRatio = DEFAULT_OUTPUT_ASPECT_RATIO): number {
  const horizontalFov = clamp(width * Math.PI * 2, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  const verticalFov = resolvePerspectiveVerticalFov(horizontalFov, outputAspectRatio)
  return clamp(verticalFov / Math.PI, MIN_CROP_HEIGHT, MAX_CROP_HEIGHT)
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
    const defaultHeight = resolvePanoramaSelectionHeightForAspectRatio(DEFAULT_CROP_WIDTH)
    return clamp((DEFAULT_CROP_WIDTH * sourceWidth) / (defaultHeight * sourceHeight), 0.2, 5)
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
  const height = clamp(
    resolvePanoramaSelectionHeightForAspectRatio(width),
    bounds.minHeight,
    bounds.maxHeight
  )

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

export function normalizePanoramaSelection(
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
  const x = wrapUnit(item.x as number)
  const y = clamp(item.y as number, 0, 1 - height)

  return { x, y, width, height }
}

export async function loadPanoramaImage(sourceImage: string): Promise<PanoramaImageLoadResult> {
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

      try {
        assertEquirectangularPanoramaSize(width, height)
      } catch (error) {
        reject(error)
        return
      }

      resolve({ image, width, height })
    }
    image.onerror = () => {
      reject(new Error('环境全景图加载失败，请稍后重试'))
    }
    image.crossOrigin = 'anonymous'
    image.src = src
  })
}

export async function loadCropImageMetrics(sourceImage: string): Promise<CropImageMetrics> {
  const { width, height } = await loadPanoramaImage(sourceImage)
  return { width, height }
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

      const normalizedSelection = normalizePanoramaSelection(options.selection, width, height)
      if (!normalizedSelection) {
        reject(new Error('取景区域无效，无法生成环境图'))
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
        reject(new Error('当前浏览器不支持环境图导出'))
        return
      }

      const sourceX = Math.floor(normalizedSelection.x * width) % width
      const sourceY = Math.floor(normalizedSelection.y * height)
      const sourceWidth = Math.max(1, Math.min(width, Math.round(normalizedSelection.width * width)))
      const sourceHeight = Math.max(1, Math.min(height - sourceY, Math.round(normalizedSelection.height * height)))
      const firstSourceWidth = Math.min(width - sourceX, sourceWidth)
      const secondSourceWidth = sourceWidth - firstSourceWidth
      const firstOutputWidth = secondSourceWidth > 0
        ? Math.max(1, Math.round(outputSize.width * (firstSourceWidth / sourceWidth)))
        : outputSize.width

      context.drawImage(
        image,
        sourceX,
        sourceY,
        firstSourceWidth,
        sourceHeight,
        0,
        0,
        firstOutputWidth,
        outputSize.height
      )
      if (secondSourceWidth > 0) {
        context.drawImage(
          image,
          0,
          sourceY,
          secondSourceWidth,
          sourceHeight,
          firstOutputWidth,
          0,
          outputSize.width - firstOutputWidth,
          outputSize.height
        )
      }

      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => {
      reject(new Error('环境全景图加载失败，无法生成截图'))
    }
    image.src = src
  })
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return ((value % 1) + 1) % 1
}

interface PanoramaThreeState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  direction: THREE.Vector3
  texture: THREE.Texture | null
  image?: HTMLImageElement
}

const panoramaThreeStates = new WeakMap<HTMLCanvasElement, PanoramaThreeState>()

function createPanoramaThreeState(canvas: HTMLCanvasElement): PanoramaThreeState {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true
    })
  } catch {
    throw new Error('当前浏览器不支持 360 全景预览')
  }

  const context = renderer.getContext()
  if (!context) {
    throw new Error('当前浏览器不支持 360 全景预览')
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, DEFAULT_OUTPUT_ASPECT_RATIO, 0.01, 10)

  return {
    renderer,
    scene,
    camera,
    direction: new THREE.Vector3(0, 0, -1),
    texture: null
  }
}

function getPanoramaThreeState(canvas: HTMLCanvasElement): PanoramaThreeState {
  const existing = panoramaThreeStates.get(canvas)
  if (existing) return existing

  const state = createPanoramaThreeState(canvas)
  panoramaThreeStates.set(canvas, state)
  return state
}

function updatePanoramaTexture(state: PanoramaThreeState, image: HTMLImageElement) {
  if (state.image === image && state.texture) return

  if (state.texture) {
    state.texture.dispose()
    state.texture = null
  }

  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  state.scene.background = texture
  state.texture = texture
  state.image = image
}

export function renderPanoramaSelectionToCanvas(options: {
  image: HTMLImageElement
  canvas: HTMLCanvasElement
  selection: EnvironmentCropSelection
  width?: number
  height?: number
}): void {
  const sourceWidth = options.image.naturalWidth || options.image.width
  const sourceHeight = options.image.naturalHeight || options.image.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error('环境全景图尺寸无效，无法生成截图')
  }
  assertEquirectangularPanoramaSize(sourceWidth, sourceHeight)

  const outputWidth = Math.max(1, Math.round(options.width || options.canvas.width || 1280))
  const outputHeight = Math.max(1, Math.round(options.height || options.canvas.height || 720))
  const state = getPanoramaThreeState(options.canvas)

  if (options.canvas.width !== outputWidth) options.canvas.width = outputWidth
  if (options.canvas.height !== outputHeight) options.canvas.height = outputHeight

  state.renderer.setSize(outputWidth, outputHeight, false)
  updatePanoramaTexture(state, options.image)

  state.camera.aspect = outputWidth / outputHeight
  const centerYaw = (options.selection.x + options.selection.width / 2) * Math.PI * 2 - Math.PI
  const centerPitch = (0.5 - (options.selection.y + options.selection.height / 2)) * Math.PI
  const horizontalFov = clamp(options.selection.width * Math.PI * 2, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  const verticalFov = resolvePerspectiveVerticalFov(horizontalFov, outputWidth / outputHeight)
  state.camera.fov = THREE.MathUtils.radToDeg(verticalFov)
  state.camera.position.set(0, 0, 0)
  state.direction.set(
    Math.sin(centerYaw) * Math.cos(centerPitch),
    Math.sin(centerPitch),
    Math.cos(centerYaw) * Math.cos(centerPitch)
  )
  state.camera.up.set(0, 1, 0)
  state.camera.lookAt(state.direction)
  state.camera.updateProjectionMatrix()

  state.renderer.render(state.scene, state.camera)
}

export async function renderPanoramaSelectionToDataUrl(options: {
  sourceImage: string
  selection: EnvironmentCropSelection
  outputSize?: CropImageMetrics
}): Promise<PanoramaRenderResult> {
  const { image, width, height } = await loadPanoramaImage(options.sourceImage)
  const normalizedSelection = normalizePanoramaSelection(options.selection, width, height)
  if (!normalizedSelection) {
    throw new Error('取景区域无效，无法生成环境图')
  }

  const outputSize = options.outputSize || {
    width: 1920,
    height: 1080
  }
  const canvas = document.createElement('canvas')
  renderPanoramaSelectionToCanvas({
    image,
    canvas,
    selection: normalizedSelection,
    width: outputSize.width,
    height: outputSize.height
  })
  return {
    imageData: canvas.toDataURL('image/png'),
    crop: normalizedSelection
  }
}

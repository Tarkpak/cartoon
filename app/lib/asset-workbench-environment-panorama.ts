import * as THREE from 'three'
import { toCanvasSafeImageSrc } from './media'
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
const DEFAULT_PANORAMA_OUTPUT_PIXELS = 1920 * 1080
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

export type PanoramaOutputAspectRatioInput = number | string | undefined | null

interface PanoramaViewState {
  yaw: number
  pitch: number
  horizontalFov: number
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
const panoramaImageLoadCache = new Map<string, Promise<PanoramaImageLoadResult>>()

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return ((value % 1) + 1) % 1
}

function resolveSelectionBounds() {
  return {
    minWidth: MIN_CROP_WIDTH,
    minHeight: MIN_CROP_HEIGHT,
    maxWidth: MAX_CROP_WIDTH,
    maxHeight: MAX_CROP_HEIGHT
  }
}

function resolveSelectionCenter(selection: Pick<EnvironmentCropSelection, 'x' | 'y' | 'width' | 'height'>) {
  return {
    x: wrapUnit(selection.x + selection.width / 2),
    y: clamp(selection.y + selection.height / 2, 0, 1)
  }
}

function selectionToViewState(
  selection: Pick<EnvironmentCropSelection, 'x' | 'y' | 'width' | 'height'>
): PanoramaViewState {
  const center = resolveSelectionCenter(selection)
  return {
    yaw: center.x * Math.PI * 2 - Math.PI,
    pitch: (0.5 - center.y) * Math.PI,
    horizontalFov: clamp(selection.width * Math.PI * 2, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  }
}

function canUseAnonymousCrossOrigin(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('//')
}

function applyViewStateToCamera(
  state: PanoramaThreeState,
  view: PanoramaViewState,
  outputAspectRatio: number
) {
  const verticalFov = resolvePerspectiveVerticalFov(view.horizontalFov, outputAspectRatio)
  const maxPitch = Math.max(0, Math.PI / 2 - verticalFov / 2)
  const pitch = clamp(view.pitch, -maxPitch, maxPitch)

  state.camera.fov = THREE.MathUtils.radToDeg(verticalFov)
  state.camera.position.set(0, 0, 0)
  state.camera.up.set(0, 1, 0)
  state.direction.set(
    Math.sin(view.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(view.yaw) * Math.cos(pitch)
  )
  state.camera.lookAt(state.direction)
  state.camera.updateProjectionMatrix()
}

function createPanoramaThreeState(canvas: HTMLCanvasElement): PanoramaThreeState {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
  } catch {
    throw new Error('当前浏览器不支持 360 全景预览')
  }

  const context = renderer.getContext()
  if (!context) {
    renderer.dispose()
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

function disposePanoramaThreeState(state: PanoramaThreeState) {
  if (state.texture) {
    state.texture.dispose()
    state.texture = null
  }
  state.scene.background = null
  state.renderer.dispose()

  const context = state.renderer.getContext()
  if (context) {
    const loseContextExtension = context.getExtension('WEBGL_lose_context')
    loseContextExtension?.loseContext?.()
  }
}

function getPanoramaThreeState(canvas: HTMLCanvasElement): PanoramaThreeState {
  const existing = panoramaThreeStates.get(canvas)
  if (existing) {
    const context = existing.renderer.getContext()
    if (!context?.isContextLost?.()) {
      return existing
    }
    disposePanoramaThreeState(existing)
    panoramaThreeStates.delete(canvas)
  }

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

export function disposePanoramaCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return

  const state = panoramaThreeStates.get(canvas)
  if (!state) return

  disposePanoramaThreeState(state)
  panoramaThreeStates.delete(canvas)
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

export function resolvePanoramaOutputAspectRatioValue(
  rawValue: PanoramaOutputAspectRatioInput,
  fallback = DEFAULT_OUTPUT_ASPECT_RATIO
): number {
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : fallback
  }

  const normalized = rawValue?.trim()
  if (!normalized) return fallback

  const ratioMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (ratioMatch?.[1] && ratioMatch[2]) {
    const width = Number(ratioMatch[1])
    const height = Number(ratioMatch[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height
    }
  }

  const numericValue = Number(normalized)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback
}

export function resolvePanoramaSelectionHeightForAspectRatio(width: number, outputAspectRatio = DEFAULT_OUTPUT_ASPECT_RATIO): number {
  const horizontalFov = clamp(width * Math.PI * 2, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  const verticalFov = resolvePerspectiveVerticalFov(horizontalFov, outputAspectRatio)
  return clamp(verticalFov / Math.PI, MIN_CROP_HEIGHT, MAX_CROP_HEIGHT)
}

export function resolvePanoramaOutputSize(options: {
  aspectRatio?: PanoramaOutputAspectRatioInput
  targetPixels?: number
} = {}): CropImageMetrics {
  const aspectRatio = resolvePanoramaOutputAspectRatioValue(options.aspectRatio)
  const targetPixels = Math.max(1, options.targetPixels ?? DEFAULT_PANORAMA_OUTPUT_PIXELS)

  return {
    width: Math.max(1, Math.round(Math.sqrt(targetPixels * aspectRatio))),
    height: Math.max(1, Math.round(Math.sqrt(targetPixels / aspectRatio)))
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
    const defaultHeight = resolvePanoramaSelectionHeightForAspectRatio(DEFAULT_CROP_WIDTH)
    return clamp((DEFAULT_CROP_WIDTH * sourceWidth) / (defaultHeight * sourceHeight), 0.2, 5)
  }

  return clamp((selection.width * sourceWidth) / (selection.height * sourceHeight), 0.2, 8)
}

export function buildDefaultCropSelection(options: {
  imageWidth: number
  imageHeight: number
  coverage?: number
  outputAspectRatio?: PanoramaOutputAspectRatioInput
}): EnvironmentCropSelection {
  const bounds = resolveSelectionBounds()
  const outputAspectRatio = resolvePanoramaOutputAspectRatioValue(options.outputAspectRatio)
  const coverage = clamp(options.coverage ?? DEFAULT_CROP_COVERAGE, MIN_CROP_COVERAGE, 1)
  const width = clamp(DEFAULT_CROP_WIDTH * coverage, bounds.minWidth, bounds.maxWidth)
  const height = clamp(
    resolvePanoramaSelectionHeightForAspectRatio(width, outputAspectRatio),
    bounds.minHeight,
    bounds.maxHeight
  )

  return {
    x: wrapUnit((1 - width) / 2),
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

export function normalizePanoramaSelectionForAspectRatio(
  rawValue: unknown,
  imageWidth: number,
  imageHeight: number,
  outputAspectRatio: PanoramaOutputAspectRatioInput = DEFAULT_OUTPUT_ASPECT_RATIO
): EnvironmentCropSelection | undefined {
  const normalized = normalizePanoramaSelection(rawValue, imageWidth, imageHeight)
  if (!normalized) return undefined

  const aspectRatio = resolvePanoramaOutputAspectRatioValue(outputAspectRatio)
  const height = resolvePanoramaSelectionHeightForAspectRatio(normalized.width, aspectRatio)
  const center = resolveSelectionCenter(normalized)

  return normalizePanoramaSelection(
    {
      x: center.x - normalized.width / 2,
      y: center.y - height / 2,
      width: normalized.width,
      height
    },
    imageWidth,
    imageHeight
  )
}

export async function loadPanoramaImage(sourceImage: string): Promise<PanoramaImageLoadResult> {
  const src = toCanvasSafeImageSrc(sourceImage)
  if (!src) {
    throw new Error('环境全景图不存在，无法选取区域')
  }

  const cached = panoramaImageLoadCache.get(src)
  if (cached) {
    return await cached
  }

  const pending = new Promise<PanoramaImageLoadResult>((resolve, reject) => {
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

    if (canUseAnonymousCrossOrigin(src)) {
      image.crossOrigin = 'anonymous'
    }
    image.src = src
  })

  panoramaImageLoadCache.set(src, pending)

  try {
    return await pending
  } catch (error) {
    panoramaImageLoadCache.delete(src)
    throw error
  }
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

  const normalizedSelection = normalizePanoramaSelection(options.selection, sourceWidth, sourceHeight)
  if (!normalizedSelection) {
    throw new Error('取景区域无效，无法生成环境图')
  }

  const outputWidth = Math.max(1, Math.round(options.width || options.canvas.width || 1280))
  const outputHeight = Math.max(1, Math.round(options.height || options.canvas.height || 720))
  const state = getPanoramaThreeState(options.canvas)

  if (options.canvas.width !== outputWidth) options.canvas.width = outputWidth
  if (options.canvas.height !== outputHeight) options.canvas.height = outputHeight

  state.renderer.setSize(outputWidth, outputHeight, false)
  updatePanoramaTexture(state, options.image)

  state.camera.aspect = outputWidth / outputHeight
  applyViewStateToCamera(state, selectionToViewState(normalizedSelection), state.camera.aspect)

  state.renderer.render(state.scene, state.camera)
}

export async function renderPanoramaSelectionToDataUrl(options: {
  sourceImage: string
  selection: EnvironmentCropSelection
  outputSize?: CropImageMetrics
  aspectRatio?: PanoramaOutputAspectRatioInput
}): Promise<PanoramaRenderResult> {
  const { image, width, height } = await loadPanoramaImage(options.sourceImage)
  const normalizedSelection = normalizePanoramaSelectionForAspectRatio(
    options.selection,
    width,
    height,
    options.aspectRatio
  )
  if (!normalizedSelection) {
    throw new Error('取景区域无效，无法生成环境图')
  }

  const outputSize = options.outputSize || resolvePanoramaOutputSize({
    aspectRatio: options.aspectRatio
  })

  const canvas = document.createElement('canvas')
  try {
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
  } finally {
    disposePanoramaCanvas(canvas)
  }
}

export async function renderCropSelectionToDataUrl(options: {
  sourceImage: string
  selection: EnvironmentCropSelection
  outputSize?: CropImageMetrics
  aspectRatio?: PanoramaOutputAspectRatioInput
}): Promise<string> {
  const result = await renderPanoramaSelectionToDataUrl(options)
  return result.imageData
}

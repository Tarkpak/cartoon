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

interface PanoramaWebglState {
  gl: WebGLRenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  positionBuffer: WebGLBuffer
  image?: HTMLImageElement
  uniforms: {
    centerYaw: WebGLUniformLocation | null
    centerPitch: WebGLUniformLocation | null
    horizontalFov: WebGLUniformLocation | null
    verticalFov: WebGLUniformLocation | null
    image: WebGLUniformLocation | null
  }
}

const panoramaWebglStates = new WeakMap<HTMLCanvasElement, PanoramaWebglState>()

function compilePanoramaShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('当前浏览器不支持 360 预览')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || '360 预览着色器编译失败'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createPanoramaWebglState(canvas: HTMLCanvasElement): PanoramaWebglState {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true
  }) as WebGLRenderingContext | null
  if (!gl) {
    throw new Error('当前浏览器不支持 360 全景预览')
  }

  const vertexShader = compilePanoramaShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
  )
  const fragmentShader = compilePanoramaShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_image;
      uniform float u_centerYaw;
      uniform float u_centerPitch;
      uniform float u_horizontalFov;
      uniform float u_verticalFov;

      const float PI = 3.141592653589793;

      void main() {
        vec2 screen = vec2(v_uv.x * 2.0 - 1.0, (1.0 - v_uv.y) * 2.0 - 1.0);
        vec3 direction = normalize(vec3(
          screen.x * tan(u_horizontalFov * 0.5),
          screen.y * tan(u_verticalFov * 0.5),
          1.0
        ));

        float sinPitch = sin(u_centerPitch);
        float cosPitch = cos(u_centerPitch);
        vec3 pitched = vec3(
          direction.x,
          direction.y * cosPitch - direction.z * sinPitch,
          direction.y * sinPitch + direction.z * cosPitch
        );

        float sinYaw = sin(u_centerYaw);
        float cosYaw = cos(u_centerYaw);
        vec3 world = vec3(
          pitched.x * cosYaw + pitched.z * sinYaw,
          pitched.y,
          -pitched.x * sinYaw + pitched.z * cosYaw
        );

        float longitude = atan(world.x, world.z);
        float latitude = asin(clamp(world.y, -1.0, 1.0));
        vec2 sourceUv = vec2(fract(longitude / (2.0 * PI) + 0.5), clamp(0.5 - latitude / PI, 0.0, 1.0));
        gl_FragColor = texture2D(u_image, sourceUv);
      }
    `
  )

  const program = gl.createProgram()
  if (!program) throw new Error('当前浏览器不支持 360 预览')
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '360 预览着色器链接失败'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  const positionBuffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!positionBuffer || !texture) {
    throw new Error('当前浏览器不支持 360 预览')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1
    ]),
    gl.STATIC_DRAW
  )

  return {
    gl,
    program,
    texture,
    positionBuffer,
    uniforms: {
      centerYaw: gl.getUniformLocation(program, 'u_centerYaw'),
      centerPitch: gl.getUniformLocation(program, 'u_centerPitch'),
      horizontalFov: gl.getUniformLocation(program, 'u_horizontalFov'),
      verticalFov: gl.getUniformLocation(program, 'u_verticalFov'),
      image: gl.getUniformLocation(program, 'u_image')
    }
  }
}

function getPanoramaWebglState(canvas: HTMLCanvasElement): PanoramaWebglState {
  const existing = panoramaWebglStates.get(canvas)
  if (existing) return existing

  const state = createPanoramaWebglState(canvas)
  panoramaWebglStates.set(canvas, state)
  return state
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
  if (options.canvas.width !== outputWidth) options.canvas.width = outputWidth
  if (options.canvas.height !== outputHeight) options.canvas.height = outputHeight

  const state = getPanoramaWebglState(options.canvas)
  const gl = state.gl
  const centerYaw = (options.selection.x + options.selection.width / 2) * Math.PI * 2 - Math.PI
  const centerPitch = (0.5 - (options.selection.y + options.selection.height / 2)) * Math.PI
  const horizontalFov = clamp(options.selection.width * Math.PI * 2, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
  const verticalFov = resolvePerspectiveVerticalFov(horizontalFov, outputWidth / outputHeight)

  gl.viewport(0, 0, outputWidth, outputHeight)
  gl.useProgram(state.program)

  gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer)
  const positionLocation = gl.getAttribLocation(state.program, 'a_position')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, state.texture)
  if (state.image !== options.image) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.image)
    state.image = options.image
  }

  gl.uniform1i(state.uniforms.image, 0)
  gl.uniform1f(state.uniforms.centerYaw, centerYaw)
  gl.uniform1f(state.uniforms.centerPitch, centerPitch)
  gl.uniform1f(state.uniforms.horizontalFov, horizontalFov)
  gl.uniform1f(state.uniforms.verticalFov, verticalFov)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
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

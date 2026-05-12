import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'

type JianyingTransitionType = 'fade' | 'dissolve' | 'wipe'

const FILE_NAME_INVALID_CHAR_REGEX = /[\\/:*?"<>|]/g
const FILE_NAME_SPACE_REGEX = /\s+/g
const API_VIDEO_FILE_PREFIX = '/api/video/file/'

const DEFAULT_CLIP_SETTINGS = {
  alpha: 1,
  flip: { horizontal: false, vertical: false },
  rotation: 0,
  scale: { x: 1, y: 1 },
  transform: { x: 0, y: 0 }
}

const DEFAULT_CROP_SETTINGS = {
  upper_left_x: 0,
  upper_left_y: 0,
  upper_right_x: 1,
  upper_right_y: 0,
  lower_left_x: 0,
  lower_left_y: 1,
  lower_right_x: 1,
  lower_right_y: 1
}

const TRANSITION_PRESET_MAP: Record<JianyingTransitionType, {
  name: string
  effectId: string
  resourceId: string
  isOverlap: boolean
}> = {
  fade: {
    name: '闪黑',
    effectId: '6724239388189921806',
    resourceId: '3bca53e9f3dfa2c184fbee96438ea097',
    isOverlap: false
  },
  dissolve: {
    name: '叠化',
    effectId: '6724845717472416269',
    resourceId: '2d641adc4bb63e37e3a0067d8c8cc3c3',
    isOverlap: true
  },
  wipe: {
    name: '向左擦除',
    effectId: '6724849999336706573',
    resourceId: '316c2a1c1783f51505c793b13381b445',
    isOverlap: true
  }
}

const SceneDialogueSchema = z.object({
  character: z.string().optional(),
  text: z.string().optional()
})

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  videoUrl: z.string(),
  duration: z.number().optional(),
  narration: z.string().nullish(),
  dialogues: z.array(SceneDialogueSchema).optional()
})

const ExportJianyingSchema = z.object({
  projectName: z.string().optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
  sceneOrder: z.array(z.string()).optional(),
  scenes: z.array(SceneSchema).min(1),
  options: z.object({
    addSubtitles: z.boolean().optional(),
    transition: z.object({
      type: z.enum(['fade', 'dissolve', 'wipe', 'none']).optional(),
      duration: z.number().optional()
    }).optional(),
    bgm: z.object({
      url: z.string(),
      volume: z.number().min(0).max(1).optional()
    }).optional()
  }).optional()
})

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toMicroseconds(seconds: number, fallbackSeconds = 3): number {
  const normalizedSeconds = Number.isFinite(seconds) && seconds > 0
    ? seconds
    : fallbackSeconds
  return Math.max(100_000, Math.round(normalizedSeconds * 1_000_000))
}

function createDraftGuid(): string {
  return randomUUID().toUpperCase()
}

function createDraftEntityId(): string {
  return randomUUID().replace(/-/g, '')
}

function isRemoteMediaPath(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

function sanitizeFileNameStem(rawName: string): string {
  const normalized = rawName
    .replace(FILE_NAME_INVALID_CHAR_REGEX, '_')
    .replace(FILE_NAME_SPACE_REGEX, '_')
    .trim()
    .slice(0, 48)

  return normalized || '项目'
}

function buildJianyingArchiveFileName(projectName: string, now = new Date()): string {
  const dateTag = now.toISOString().slice(0, 10)
  return `${sanitizeFileNameStem(projectName)}-剪映工程-${dateTag}.zip`
}

function resolveCanvas(aspectRatio: '16:9' | '9:16' | '1:1' = '16:9') {
  if (aspectRatio === '9:16') {
    return { width: 1080, height: 1920, ratio: '9:16' as const }
  }
  if (aspectRatio === '1:1') {
    return { width: 1080, height: 1080, ratio: '1:1' as const }
  }
  return { width: 1920, height: 1080, ratio: '16:9' as const }
}

function getPublicDir(): string {
  return join(process.cwd(), 'public')
}

function resolveApiVideoFilePath(rawPath: string): string | null {
  if (!rawPath.startsWith(API_VIDEO_FILE_PREFIX)) return null

  const filename = decodeURIComponent(rawPath.slice(API_VIDEO_FILE_PREFIX.length))
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null
  }

  return join(getPublicDir(), 'videos', filename)
}

function resolveMediaPath(rawPath: string): string {
  const normalized = normalizeText(rawPath)
  if (!normalized) return ''

  if (isRemoteMediaPath(normalized)) return normalized
  if (normalized.startsWith('data:')) return normalized
  if (!normalized.startsWith('/')) return normalized

  const apiVideoPath = resolveApiVideoFilePath(normalized)
  if (apiVideoPath) return apiVideoPath

  return join(getPublicDir(), normalized.replace(/^\/+/, ''))
}

function createEmptyMaterials(): Record<string, Array<Record<string, unknown>>> {
  return {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_track_indexes: [],
    audios: [],
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_deformations: [],
    masks: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: [],
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: [],
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_trackings: [],
    videos: [],
    vocal_beautifys: [],
    vocal_separations: []
  }
}

function createDraftContentTemplate(options: {
  id: string
  name: string
  width: number
  height: number
  duration: number
  createTimeMicros: number
  updateTimeMicros: number
}) {
  const platformInfo = {
    app_id: 3704,
    app_source: 'lv',
    app_version: '5.9.0',
    os: 'windows'
  }

  return {
    canvas_config: {
      height: options.height,
      ratio: 'original',
      width: options.width
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null
    },
    cover: null,
    create_time: options.createTimeMicros,
    duration: options.duration,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: options.id,
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: []
    },
    last_modified_platform: platformInfo,
    materials: createEmptyMaterials(),
    mutable_config: null,
    name: options.name,
    new_version: '110.0.0',
    platform: platformInfo,
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks: [],
    update_time: options.updateTimeMicros,
    version: 360000
  }
}

function createSpeedMaterial(id: string, speed = 1) {
  return {
    curve_speed: null,
    id,
    mode: 0,
    speed,
    type: 'speed'
  }
}

function createSegmentBase(options: {
  id: string
  materialId: string
  speedMaterialId: string
  start: number
  duration: number
  sourceDuration: number
  volume: number
}) {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: Math.max(0, options.volume),
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: options.id,
    material_id: options.materialId,
    target_timerange: {
      start: options.start,
      duration: options.duration
    },
    source_timerange: {
      start: 0,
      duration: options.sourceDuration
    },
    speed: 1,
    volume: Math.max(0, options.volume),
    extra_material_refs: [options.speedMaterialId],
    is_tone_modify: false,
    common_keyframes: [],
    keyframe_refs: []
  }
}

function createTextMaterialContent(text: string): string {
  return JSON.stringify({
    styles: [
      {
        fill: {
          alpha: 1.0,
          content: {
            render_type: 'solid',
            solid: {
              alpha: 1.0,
              color: [1.0, 1.0, 1.0]
            }
          }
        },
        range: [0, text.length],
        size: 8,
        bold: false,
        italic: false,
        underline: false,
        strokes: []
      }
    ],
    text
  })
}

function createDraftMetaInfo(options: {
  draftId: string
  draftName: string
  duration: number
  createTimeMicros: number
  updateTimeMicros: number
  materialCount: number
}) {
  return {
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: '',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: []
    },
    draft_fold_path: '',
    draft_id: options.draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] }
    ],
    draft_materials_copied_info: [],
    draft_name: options.draftName,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: options.materialCount,
    draft_type: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_create: options.createTimeMicros,
    tm_draft_modified: options.updateTimeMicros,
    tm_draft_removed: 0,
    tm_duration: options.duration
  }
}

function orderScenesByIds<T extends { id: string }>(scenes: T[], ids: string[] = []): T[] {
  const sceneMap = new Map(scenes.map(scene => [scene.id, scene] as const))
  const ordered: T[] = []
  const consumed = new Set<string>()

  for (const sceneId of ids) {
    const scene = sceneMap.get(sceneId)
    if (!scene || consumed.has(sceneId)) continue
    ordered.push(scene)
    consumed.add(sceneId)
  }

  for (const scene of scenes) {
    if (consumed.has(scene.id)) continue
    ordered.push(scene)
  }

  return ordered
}

function resolveSceneSubtitleLines(scene: z.infer<typeof SceneSchema>): string[] {
  const lines: string[] = []

  for (const dialogue of scene.dialogues || []) {
    const character = normalizeText(dialogue.character)
    const text = normalizeText(dialogue.text)
    if (!text) continue
    lines.push(character ? `${character}：${text}` : text)
  }

  if (lines.length === 0) {
    const narration = normalizeText(scene.narration)
    if (narration) {
      lines.push(narration)
    }
  }

  return lines.slice(0, 8)
}

async function checkMediaPathAccessibility(path: string): Promise<'ok' | 'remote' | 'inline' | 'missing'> {
  if (!path) return 'missing'
  if (path.startsWith('data:')) return 'inline'
  if (isRemoteMediaPath(path)) return 'remote'
  try {
    await fs.access(path)
    return 'ok'
  } catch {
    return 'missing'
  }
}

interface ZipFileEntry {
  path: string
  data: Buffer
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? (0xedb88320 ^ (value >>> 1))
        : (value >>> 1)
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function resolveDosTimeAndDate(now = new Date()) {
  const year = Math.max(1980, Math.min(2107, now.getFullYear()))
  const month = Math.max(1, Math.min(12, now.getMonth() + 1))
  const day = Math.max(1, Math.min(31, now.getDate()))
  const hours = Math.max(0, Math.min(23, now.getHours()))
  const minutes = Math.max(0, Math.min(59, now.getMinutes()))
  const seconds = Math.max(0, Math.min(59, now.getSeconds()))

  const dosTime = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2)
  const dosDate = ((year - 1980) << 9) | (month << 5) | day

  return { dosTime, dosDate }
}

function createZipArchive(files: ZipFileEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  const { dosTime, dosDate } = resolveDosTimeAndDate()

  let offset = 0

  for (const file of files) {
    const fileName = file.path.replace(/\\/g, '/')
    const nameBuffer = Buffer.from(fileName, 'utf8')
    const dataBuffer = file.data
    const checksum = crc32(dataBuffer)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(dataBuffer.length, 18)
    localHeader.writeUInt32LE(dataBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuffer, dataBuffer)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(dataBuffer.length, 20)
    centralHeader.writeUInt32LE(dataBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + dataBuffer.length
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const centralDirectoryOffset = offset
  const entryCount = files.length

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(entryCount, 8)
  endRecord.writeUInt16LE(entryCount, 10)
  endRecord.writeUInt32LE(centralDirectorySize, 12)
  endRecord.writeUInt32LE(centralDirectoryOffset, 16)
  endRecord.writeUInt16LE(0, 20)

  return Buffer.concat([
    ...localParts,
    ...centralParts,
    endRecord
  ])
}

function buildReadme(projectName: string, warnings: string[]): string {
  const lines = [
    '剪映专业版工程导出说明',
    '',
    `项目名：${projectName}`,
    '',
    '1. 解压本 ZIP。',
    '2. 将解压后的目录整体复制到剪映草稿目录（com.lveditor.draft）。',
    '3. 打开剪映专业版后刷新草稿列表。',
    '',
    '常见草稿目录：',
    'macOS: ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft',
    'Windows: %USERPROFILE%\\Videos\\JianyingPro\\User Data\\Projects\\com.lveditor.draft',
    ''
  ]

  if (warnings.length > 0) {
    lines.push('需要注意的素材路径问题：')
    for (const warning of warnings) {
      lines.push(`- ${warning}`)
    }
  } else {
    lines.push('素材路径检查通过。')
  }

  return lines.join('\n')
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = ExportJianyingSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const payload = parseResult.data
  const orderedScenes = orderScenesByIds(payload.scenes, payload.sceneOrder)

  if (orderedScenes.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '没有可导出的场景'
    })
  }

  const invalidScene = orderedScenes.find(scene => !normalizeText(scene.videoUrl))
  if (invalidScene) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `场景 ${invalidScene.id} 缺少视频地址`
    })
  }

  const now = new Date()
  const nowMicros = Date.now() * 1000
  const projectName = normalizeText(payload.projectName) || '资产工作台项目'
  const draftId = createDraftGuid()
  const canvas = resolveCanvas(payload.aspectRatio)
  const includeSubtitles = payload.options?.addSubtitles === true
  const transitionType = payload.options?.transition?.type
  const transitionDurationUs = toMicroseconds(payload.options?.transition?.duration || 0.5, 0.5)
  const bgmUrl = normalizeText(payload.options?.bgm?.url)
  const bgmVolume = Math.max(0, Math.min(1, Number(payload.options?.bgm?.volume ?? 0.3)))

  const draftContent = createDraftContentTemplate({
    id: createDraftGuid(),
    name: projectName,
    width: canvas.width,
    height: canvas.height,
    duration: 0,
    createTimeMicros: nowMicros,
    updateTimeMicros: nowMicros
  })

  const videoTrackId = createDraftEntityId()
  const audioTrackId = createDraftEntityId()
  const textTrackId = createDraftEntityId()

  const videoSegments: Array<Record<string, unknown>> = []
  const audioSegments: Array<Record<string, unknown>> = []
  const textSegments: Array<Record<string, unknown>> = []

  const videoMaterials: Array<Record<string, unknown>> = []
  const audioMaterials: Array<Record<string, unknown>> = []
  const textMaterials: Array<Record<string, unknown>> = []
  const speedMaterials: Array<Record<string, unknown>> = []
  const transitionMaterials: Array<Record<string, unknown>> = []

  const manifestScenes: Array<Record<string, unknown>> = []
  const warnings: string[] = []

  let timelineOffset = 0

  for (const [index, scene] of orderedScenes.entries()) {
    const sceneDuration = toMicroseconds(scene.duration || 3)
    const sceneMaterialPath = resolveMediaPath(scene.videoUrl)
    const scenePathStatus = await checkMediaPathAccessibility(sceneMaterialPath)
    if (scenePathStatus !== 'ok') {
      const reasonMap: Record<typeof scenePathStatus, string> = {
        missing: '本地文件不存在',
        remote: '远程 URL，剪映可能无法直接加载',
        inline: '内联 data URL 不受支持'
      }
      warnings.push(`场景 ${index + 1} (${scene.title || scene.id})：${reasonMap[scenePathStatus]} -> ${scene.videoUrl}`)
    }

    const videoMaterialId = createDraftEntityId()
    const videoSpeedId = createDraftEntityId()
    const videoSegmentId = createDraftEntityId()
    const videoFileName = basename(sceneMaterialPath || scene.videoUrl || `scene_${index + 1}.mp4`)

    videoMaterials.push({
      audio_fade: null,
      category_id: '',
      category_name: 'local',
      check_flag: 63487,
      crop: { ...DEFAULT_CROP_SETTINGS },
      crop_ratio: 'free',
      crop_scale: 1,
      duration: sceneDuration,
      height: canvas.height,
      id: videoMaterialId,
      local_material_id: '',
      material_id: videoMaterialId,
      material_name: videoFileName,
      media_path: '',
      path: sceneMaterialPath,
      type: 'video',
      width: canvas.width
    })

    speedMaterials.push(createSpeedMaterial(videoSpeedId))

    const videoSegment = createSegmentBase({
      id: videoSegmentId,
      materialId: videoMaterialId,
      speedMaterialId: videoSpeedId,
      start: timelineOffset,
      duration: sceneDuration,
      sourceDuration: sceneDuration,
      volume: 1
    })

    videoSegments.push({
      ...videoSegment,
      clip: { ...DEFAULT_CLIP_SETTINGS },
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      render_index: 0
    })

    if (includeSubtitles) {
      const subtitleLines = resolveSceneSubtitleLines(scene)
      if (subtitleLines.length > 0) {
        const baseLineDuration = Math.max(300_000, Math.floor(sceneDuration / subtitleLines.length))
        let subtitleStartOffset = 0

        for (const [lineIndex, lineText] of subtitleLines.entries()) {
          const normalizedText = normalizeText(lineText)
          if (!normalizedText) continue

          const remainingDuration = sceneDuration - subtitleStartOffset
          if (remainingDuration <= 0) break

          const lineDuration = lineIndex === subtitleLines.length - 1
            ? remainingDuration
            : Math.min(baseLineDuration, remainingDuration)
          if (lineDuration <= 0) continue

          const textMaterialId = createDraftEntityId()
          const textSpeedId = createDraftEntityId()
          const textSegmentId = createDraftEntityId()

          textMaterials.push({
            id: textMaterialId,
            content: createTextMaterialContent(normalizedText),
            typesetting: 0,
            alignment: 1,
            letter_spacing: 0,
            line_spacing: 0.02,
            line_feed: 1,
            line_max_width: 0.82,
            force_apply_line_max_width: false,
            check_flag: 7,
            type: 'subtitle',
            global_alpha: 1
          })

          speedMaterials.push(createSpeedMaterial(textSpeedId))

          const textSegment = createSegmentBase({
            id: textSegmentId,
            materialId: textMaterialId,
            speedMaterialId: textSpeedId,
            start: timelineOffset + subtitleStartOffset,
            duration: lineDuration,
            sourceDuration: lineDuration,
            volume: 1
          })

          textSegments.push({
            ...textSegment,
            clip: { ...DEFAULT_CLIP_SETTINGS, transform: { x: 0, y: -0.8 } },
            uniform_scale: { on: true, value: 1.0 },
            render_index: 15000
          })

          subtitleStartOffset += lineDuration
        }
      }
    }

    manifestScenes.push({
      sceneId: scene.id,
      title: scene.title || '',
      orderIndex: index + 1,
      startMicroseconds: timelineOffset,
      durationMicroseconds: sceneDuration,
      sourceVideoUrl: scene.videoUrl,
      resolvedMediaPath: sceneMaterialPath
    })

    timelineOffset += sceneDuration
  }

  if (transitionType && transitionType !== 'none' && videoSegments.length > 1) {
    const transitionPreset = TRANSITION_PRESET_MAP[transitionType as JianyingTransitionType]
    if (transitionPreset) {
      for (let index = 0; index < videoSegments.length - 1; index += 1) {
        const transitionId = createDraftEntityId()
        transitionMaterials.push({
          category_id: '',
          category_name: '',
          duration: transitionDurationUs,
          effect_id: transitionPreset.effectId,
          id: transitionId,
          is_overlap: transitionPreset.isOverlap,
          name: transitionPreset.name,
          platform: 'all',
          resource_id: transitionPreset.resourceId,
          type: 'transition'
        })

        const segment = videoSegments[index]
        if (!segment) continue
        const extraRefs = Array.isArray(segment.extra_material_refs)
          ? segment.extra_material_refs as string[]
          : []
        segment.extra_material_refs = [...extraRefs, transitionId]
      }
    }
  }

  if (bgmUrl) {
    const bgmMaterialPath = resolveMediaPath(bgmUrl)
    const bgmStatus = await checkMediaPathAccessibility(bgmMaterialPath)
    if (bgmStatus !== 'ok') {
      const reasonMap: Record<typeof bgmStatus, string> = {
        missing: '本地文件不存在',
        remote: '远程 URL，剪映可能无法直接加载',
        inline: '内联 data URL 不受支持'
      }
      warnings.push(`BGM：${reasonMap[bgmStatus]} -> ${bgmUrl}`)
    }

    const bgmMaterialId = createDraftEntityId()
    const bgmSpeedId = createDraftEntityId()
    const bgmSegmentId = createDraftEntityId()
    const bgmName = basename(bgmMaterialPath || bgmUrl || 'bgm.mp3')

    audioMaterials.push({
      app_id: 0,
      category_id: '',
      category_name: 'local',
      check_flag: 3,
      copyright_limit_type: 'none',
      duration: timelineOffset,
      effect_id: '',
      formula_id: '',
      id: bgmMaterialId,
      local_material_id: bgmMaterialId,
      music_id: bgmMaterialId,
      name: bgmName,
      path: bgmMaterialPath,
      source_platform: 0,
      type: 'extract_music',
      wave_points: []
    })

    speedMaterials.push(createSpeedMaterial(bgmSpeedId))

    const audioSegment = createSegmentBase({
      id: bgmSegmentId,
      materialId: bgmMaterialId,
      speedMaterialId: bgmSpeedId,
      start: 0,
      duration: timelineOffset,
      sourceDuration: timelineOffset,
      volume: bgmVolume
    })

    audioSegments.push({
      ...audioSegment,
      clip: null,
      hdr_settings: null,
      render_index: 0
    })
  }

  draftContent.duration = timelineOffset
  draftContent.materials.videos = videoMaterials
  draftContent.materials.audios = audioMaterials
  draftContent.materials.texts = textMaterials
  draftContent.materials.speeds = speedMaterials
  draftContent.materials.transitions = transitionMaterials

  const tracks: Array<Record<string, unknown>> = [
    {
      attribute: 0,
      flag: 0,
      id: videoTrackId,
      is_default_name: false,
      name: '主视频轨',
      segments: videoSegments,
      type: 'video'
    }
  ]

  if (audioSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: audioTrackId,
      is_default_name: false,
      name: '背景音乐',
      segments: audioSegments,
      type: 'audio'
    })
  }

  if (textSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: textTrackId,
      is_default_name: false,
      name: '字幕',
      segments: textSegments,
      type: 'text'
    })
  }

  draftContent.tracks = tracks

  const draftMeta = createDraftMetaInfo({
    draftId,
    draftName: projectName,
    duration: timelineOffset,
    createTimeMicros: nowMicros,
    updateTimeMicros: nowMicros,
    materialCount: videoMaterials.length + audioMaterials.length + textMaterials.length
  })

  const manifest = {
    format: 'asset-workbench-jianying-project',
    generatedAt: now.toISOString(),
    projectName,
    aspectRatio: payload.aspectRatio || '16:9',
    sceneCount: orderedScenes.length,
    totalDurationMicroseconds: timelineOffset,
    options: {
      addSubtitles: includeSubtitles,
      transition: payload.options?.transition || null,
      bgm: bgmUrl
        ? {
            url: bgmUrl,
            volume: bgmVolume
          }
        : null
    },
    warnings,
    scenes: manifestScenes
  }

  const archiveRoot = sanitizeFileNameStem(projectName)
  const zipBuffer = createZipArchive([
    {
      path: `${archiveRoot}/draft_content.json`,
      data: Buffer.from(JSON.stringify(draftContent, null, 2), 'utf8')
    },
    {
      path: `${archiveRoot}/draft_info.json`,
      data: Buffer.from(JSON.stringify(draftContent, null, 2), 'utf8')
    },
    {
      path: `${archiveRoot}/draft_meta_info.json`,
      data: Buffer.from(JSON.stringify(draftMeta, null, 2), 'utf8')
    },
    {
      path: `${archiveRoot}/asset-workbench-manifest.json`,
      data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    },
    {
      path: `${archiveRoot}/README.txt`,
      data: Buffer.from(buildReadme(projectName, warnings), 'utf8')
    }
  ])

  const fileName = buildJianyingArchiveFileName(projectName)
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

  return zipBuffer
})

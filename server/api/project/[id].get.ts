import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters, videoTasks } from '../../db'
import { persistImageToPublic } from '../../utils/image-storage'
import { persistVideoSourceToCloud } from '../../utils/video-storage'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import { normalizeScriptParseMode } from '../../../shared/types/script'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import { parseStoredProjectScript } from '../../utils/project-script'
import type { CharacterVoiceAsset } from '../../../shared/types/character'

function looksLikeBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function looksLikeBase64Video(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('AAAAIGZ0eX')
    || compact.startsWith('AAAAHGZ0eX')
    || compact.startsWith('GkXfow')
    || compact.startsWith('T2dnUw')
}

function looksLikeBase64Payload(value: string): boolean {
  if (value.length < 120) return false
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value)
}

function normalizeCharacterImageUrl(rawValue?: string | null): string | null {
  const raw = rawValue?.trim()
  if (!raw) return null

  if (raw.startsWith('url:')) {
    return normalizeCharacterImageUrl(raw.slice(4))
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  if (raw.startsWith('/generated-images/')) {
    const filename = raw.slice('/generated-images/'.length)
    return filename ? `/api/image/file/${encodeURIComponent(filename)}` : null
  }

  if (raw.startsWith('/api/image/file/')) return raw

  if (raw.startsWith('data:image/')) return null
  if (looksLikeBase64Image(raw)) return null

  if (raw.startsWith('/')) return raw
  return raw
}

function shouldMigrateCharacterImage(rawValue: string): boolean {
  const raw = rawValue.trim()
  if (!raw) return false

  return raw.startsWith('/generated-images/')
    || raw.startsWith('/api/image/file/')
    || raw.startsWith('data:image/')
    || looksLikeBase64Image(raw)
    || looksLikeBase64Payload(raw)
}

function normalizeSceneFrameUrl(rawValue?: string | null): string | null {
  const raw = rawValue?.trim()
  if (!raw) return null

  if (raw.startsWith('url:')) {
    return normalizeSceneFrameUrl(raw.slice(4))
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  if (raw.startsWith('/generated-images/')) {
    const filename = raw.slice('/generated-images/'.length)
    return filename ? `/api/image/file/${encodeURIComponent(filename)}` : null
  }

  if (raw.startsWith('/api/image/file/')) return raw
  if (raw.startsWith('data:image/')) return null
  if (looksLikeBase64Image(raw)) return null
  if (looksLikeBase64Payload(raw)) return null
  if (raw.startsWith('/')) return raw
  return raw
}

function shouldMigrateSceneFrame(rawValue: string): boolean {
  const raw = rawValue.trim()
  if (!raw) return false

  return raw.startsWith('/generated-images/')
    || raw.startsWith('/api/image/file/')
    || raw.startsWith('data:image/')
    || looksLikeBase64Image(raw)
    || looksLikeBase64Payload(raw)
}

function normalizeSceneVideoUrl(rawValue?: string | null): string | null {
  const normalized = normalizeProjectVideoUrl(rawValue)
  if (!normalized) return null
  if (normalized.startsWith('data:video/')) return null
  return normalized
}

async function hydrateSceneVideoUrlsFromTasks(projectScenes: typeof scenes.$inferSelect[]): Promise<void> {
  if (projectScenes.length === 0) return

  const missingVideoSceneIds = projectScenes
    .filter((scene) => {
      return scene.status === 'video_ready' && !normalizeProjectVideoUrl(scene.videoUrl)
    })
    .map(scene => scene.id)

  if (missingVideoSceneIds.length === 0) return

  const completedTasks = await db.select({
    sceneId: videoTasks.sceneId,
    videoData: videoTasks.videoData,
    updatedAt: videoTasks.updatedAt
  })
    .from(videoTasks)
    .where(and(
      inArray(videoTasks.sceneId, missingVideoSceneIds),
      eq(videoTasks.status, 'completed')
    ))
    .orderBy(desc(videoTasks.updatedAt))
    .all()

  const latestVideoByScene = new Map<string, string>()
  for (const task of completedTasks) {
    const sceneId = task.sceneId
    if (!sceneId || latestVideoByScene.has(sceneId)) continue

    const normalized = normalizeProjectVideoUrl(task.videoData)
    if (normalized) {
      latestVideoByScene.set(sceneId, normalized)
    }
  }

  const sceneUpdates: Array<{ id: string, videoUrl: string }> = []

  for (const scene of projectScenes) {
    const normalizedCurrent = normalizeProjectVideoUrl(scene.videoUrl)
    const recovered = normalizedCurrent || latestVideoByScene.get(scene.id)
    if (!recovered) continue

    if (scene.videoUrl !== recovered) {
      scene.videoUrl = recovered
      sceneUpdates.push({ id: scene.id, videoUrl: recovered })
    }

    if (scene.status !== 'video_ready') {
      scene.status = 'video_ready'
    }
  }

  if (sceneUpdates.length === 0) return

  const now = new Date().toISOString()
  await Promise.all(sceneUpdates.map(scene =>
    db.update(scenes)
      .set({
        videoUrl: scene.videoUrl,
        status: 'video_ready',
        updatedAt: now
      })
      .where(eq(scenes.id, scene.id))
  ))
}

async function migrateCharacterBaseImagesToCloud(
  projectCharacters: typeof characters.$inferSelect[]
): Promise<Map<string, string>> {
  const migrated = new Map<string, string>()
  if (projectCharacters.length === 0) return migrated

  const now = new Date().toISOString()

  await Promise.all(projectCharacters.map(async (character) => {
    const raw = character.baseImage?.trim()
    if (!raw) return

    if (!shouldMigrateCharacterImage(raw)) {
      const normalized = normalizeCharacterImageUrl(raw)
      if (normalized && normalized !== raw) {
        migrated.set(character.id, normalized)
      }
      return
    }

    try {
      const cloudUrl = await persistImageToPublic({
        source: raw,
        prefix: `char_${character.id}`
      })
      if (!cloudUrl) return

      migrated.set(character.id, cloudUrl)
      await db.update(characters)
        .set({
          baseImage: cloudUrl,
          updatedAt: now
        })
        .where(eq(characters.id, character.id))
      console.log(`[ProjectGet] 已迁移角色图片到云端: ${character.id}`)
    } catch (error) {
      console.warn(`[ProjectGet] 角色图片迁移失败，已跳过返回 base64: ${character.id}`, error)
    }
  }))

  return migrated
}

async function migrateSceneFramesToCloud(
  projectScenes: typeof scenes.$inferSelect[]
): Promise<void> {
  if (projectScenes.length === 0) return

  const now = new Date().toISOString()

  await Promise.all(projectScenes.map(async (scene) => {
    const nextFirstFrame = scene.firstFrame?.trim() || ''
    const nextLastFrame = scene.lastFrame?.trim() || ''
    const updates: Partial<typeof scenes.$inferInsert> = {}

    if (nextFirstFrame) {
      if (shouldMigrateSceneFrame(nextFirstFrame)) {
        try {
          const cloudUrl = await persistImageToPublic({
            source: nextFirstFrame,
            prefix: `scene_${scene.id}_first`
          })
          updates.firstFrame = cloudUrl
          scene.firstFrame = cloudUrl
        } catch (error) {
          scene.firstFrame = normalizeSceneFrameUrl(nextFirstFrame)
          console.warn(`[ProjectGet] 场景首帧迁移失败，已跳过返回 base64: ${scene.id}`, error)
        }
      } else {
        const normalized = normalizeSceneFrameUrl(nextFirstFrame)
        if (normalized !== nextFirstFrame) {
          updates.firstFrame = normalized
        }
        scene.firstFrame = normalized
      }
    } else {
      scene.firstFrame = null
    }

    if (nextLastFrame) {
      if (shouldMigrateSceneFrame(nextLastFrame)) {
        try {
          const cloudUrl = await persistImageToPublic({
            source: nextLastFrame,
            prefix: `scene_${scene.id}_last`
          })
          updates.lastFrame = cloudUrl
          scene.lastFrame = cloudUrl
        } catch (error) {
          scene.lastFrame = normalizeSceneFrameUrl(nextLastFrame)
          console.warn(`[ProjectGet] 场景尾帧迁移失败，已跳过返回 base64: ${scene.id}`, error)
        }
      } else {
        const normalized = normalizeSceneFrameUrl(nextLastFrame)
        if (normalized !== nextLastFrame) {
          updates.lastFrame = normalized
        }
        scene.lastFrame = normalized
      }
    } else {
      scene.lastFrame = null
    }

    if (Object.keys(updates).length === 0) return

    await db.update(scenes)
      .set({
        ...updates,
        updatedAt: now
      })
      .where(eq(scenes.id, scene.id))
  }))
}

function shouldMigrateSceneVideo(rawValue?: string | null): boolean {
  const raw = rawValue?.trim()
  if (!raw) return false

  if (raw.startsWith('url:')) {
    return shouldMigrateSceneVideo(raw.slice(4))
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) return false
  if (raw.startsWith('/videos/') || raw.startsWith('/api/video/file/')) return true
  if (raw.startsWith('data:video/')) return true
  if (looksLikeBase64Video(raw)) return true
  if (looksLikeBase64Payload(raw)) return true
  return false
}

async function migrateSceneVideosToCloud(
  projectScenes: typeof scenes.$inferSelect[]
): Promise<void> {
  if (projectScenes.length === 0) return

  const now = new Date().toISOString()

  await Promise.all(projectScenes.map(async (scene) => {
    const rawVideo = scene.videoUrl?.trim()
    if (!rawVideo) {
      scene.videoUrl = null
      return
    }

    if (!shouldMigrateSceneVideo(rawVideo)) {
      const normalized = normalizeSceneVideoUrl(rawVideo)
      scene.videoUrl = normalized
      if (normalized && normalized !== rawVideo) {
        await db.update(scenes)
          .set({
            videoUrl: normalized,
            updatedAt: now
          })
          .where(eq(scenes.id, scene.id))
      }
      return
    }

    try {
      const cloudUrl = await persistVideoSourceToCloud({
        source: rawVideo,
        prefix: `scene_${scene.id}_video`,
        category: 'videos'
      })

      scene.videoUrl = cloudUrl
      await db.update(scenes)
        .set({
          videoUrl: cloudUrl,
          updatedAt: now
        })
        .where(eq(scenes.id, scene.id))
      console.log(`[ProjectGet] 已迁移分镜视频到云端: ${scene.id}`)
    } catch (error) {
      scene.videoUrl = normalizeSceneVideoUrl(rawVideo)
      console.warn(`[ProjectGet] 分镜视频迁移失败，已跳过返回 base64: ${scene.id}`, error)
    }
  }))
}

function parseCharacterVoiceAsset(rawValue?: string | null): CharacterVoiceAsset | null {
  if (!rawValue?.trim()) return null

  try {
    return JSON.parse(rawValue) as CharacterVoiceAsset
  } catch (error) {
    console.warn('[ProjectGet] 解析角色声音资产失败:', error)
    return null
  }
}

function normalizeCharacterImageMap(rawValue?: string | null): Record<string, string> | undefined {
  if (!rawValue?.trim()) return undefined

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>
    const normalizedEntries: Array<[string, string]> = []

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue
      const normalized = normalizeCharacterImageUrl(value)
      if (normalized) {
        normalizedEntries.push([key, normalized])
      }
    }

    if (normalizedEntries.length === 0) return undefined
    return Object.fromEntries(normalizedEntries)
  } catch (error) {
    console.warn('[ProjectGet] 解析角色图片映射失败:', error)
    return undefined
  }
}

/**
 * 获取项目详情
 * GET /api/project/:id
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少项目ID'
    })
  }

  try {
    // 获取项目基本信息
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()

    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '项目不存在'
      })
    }

    // 获取项目的剧本
    const script = await db.select().from(scripts).where(eq(scripts.projectId, id)).get()

    // 获取项目的场景（通过剧本）
    let projectScenes: typeof scenes.$inferSelect[] = []
    if (script) {
      projectScenes = await db.select().from(scenes)
        .where(eq(scenes.scriptId, script.id))
        .orderBy(scenes.orderIndex)
        .all()

      // 兜底修复：若 scene.video_url 丢失，尝试从已完成的 video_tasks 回填
      await hydrateSceneVideoUrlsFromTasks(projectScenes)
      await migrateSceneFramesToCloud(projectScenes)
      await migrateSceneVideosToCloud(projectScenes)
    }

    // 获取项目的角色
    const projectCharacters = await db.select().from(characters)
      .where(eq(characters.projectId, id))
      .all()
    const migratedCharacterImages = await migrateCharacterBaseImagesToCloud(projectCharacters)

    // 解析剧本内容（支持新旧格式）
    const scriptData = parseStoredProjectScript(script?.rawText)
    const projectScriptParseMode = normalizeScriptParseMode(project.scriptParseMode)
    const resolvedScriptParseMode = scriptData?.scriptParseMode === 'short_drama'
      ? 'short_drama'
      : projectScriptParseMode

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          workflowType: normalizeProjectWorkflowType(project.workflowType),
          scriptParseMode: resolvedScriptParseMode,
          styleId: project.styleId,
          aspectRatio: project.aspectRatio,
          status: project.status,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        },
        script: script
          ? {
              id: script.id,
              title: script.title,
              // 返回分离的字段
              storyIdea: scriptData?.storyIdea || scriptData?.rawText || '',
              novelText: scriptData?.novelText || '',
              // 兼容旧字段
              rawText: scriptData?.storyIdea || scriptData?.rawText || '',
              // 风格选择
              selectedStyleId: scriptData?.selectedStyleId || '',
              inputMode: scriptData?.inputMode || 'idea',
              scriptParseMode: resolvedScriptParseMode,
              episodePlan: scriptData?.episodePlan || [],
              assetWorkflow: scriptData?.assetWorkflow || null,
              parsedData: script.parsedData ? JSON.parse(script.parsedData) : null,
              totalDuration: script.totalDuration
            }
          : null,
        scenes: projectScenes.map((s) => {
          const normalizedVideoUrl = normalizeSceneVideoUrl(s.videoUrl)
          const normalizedFirstFrame = normalizeSceneFrameUrl(s.firstFrame)
          const normalizedLastFrame = normalizeSceneFrameUrl(s.lastFrame)

          return {
            id: s.id,
            orderIndex: s.orderIndex,
            episodeId: s.episodeId,
            episodeTitle: s.episodeTitle,
            episodeIndex: s.episodeIndex,
            title: s.title,
            description: s.description,
            setting: s.setting ? JSON.parse(s.setting) : null,
            characters: s.characters ? JSON.parse(s.characters) : [],
            dialogues: s.dialogues ? JSON.parse(s.dialogues) : [],
            duration: s.duration,
            narration: s.narration,
            // 镜头语言
            shotType: s.shotType,
            cameraMovement: s.cameraMovement,
            cameraNote: s.cameraNote,
            // 转场
            transitionIn: s.transitionIn,
            transitionOut: s.transitionOut,
            transitionDuration: s.transitionDuration,
            // 帧和视频
            firstFrame: normalizedFirstFrame,
            lastFrame: normalizedLastFrame,
            videoUrl: normalizedVideoUrl,
            status: normalizedVideoUrl ? 'video_ready' : s.status
          }
        }),
        characters: projectCharacters.map((c) => {
          const normalizedBaseImage = migratedCharacterImages.get(c.id) || normalizeCharacterImageUrl(c.baseImage)
          return {
            id: c.id,
            name: c.name,
            role: c.role,
            appearance: c.appearance,
            personality: c.personality,
            traits: c.traits ? JSON.parse(c.traits) : null,
            background: c.background,
            motivation: c.motivation,
            speakingStyle: c.speakingStyle,
            catchphrase: c.catchphrase,
            voiceTone: c.voiceTone,
            voiceAsset: parseCharacterVoiceAsset(c.voiceAsset),
            age: c.age,
            gender: c.gender,
            imageUrl: normalizedBaseImage,
            baseImage: normalizedBaseImage || c.baseImage,
            expressions: normalizeCharacterImageMap(c.expressions),
            views: normalizeCharacterImageMap(c.views)
          }
        })
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }
    console.error('[ProjectGet] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '获取项目失败'
    })
  }
})

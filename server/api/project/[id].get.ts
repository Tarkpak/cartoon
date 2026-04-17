import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters, videoTasks } from '../../db'
import { persistImageToPublic } from '../../utils/image-storage'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import { parseStoredProjectScript } from '../../utils/project-script'

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

/**
 * 获取项目详情
 * GET /api/project/:id
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少项目ID'
    })
  }

  try {
    // 获取项目基本信息
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()

    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: '项目不存在'
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
    }

    // 获取项目的角色
    const projectCharacters = await db.select().from(characters)
      .where(eq(characters.projectId, id))
      .all()
    const migratedCharacterImages = await migrateCharacterBaseImagesToCloud(projectCharacters)

    // 解析剧本内容（支持新旧格式）
    const scriptData = parseStoredProjectScript(script?.rawText)

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          workflowType: normalizeProjectWorkflowType(project.workflowType),
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
              assetWorkflow: scriptData?.assetWorkflow || null,
              parsedData: script.parsedData ? JSON.parse(script.parsedData) : null,
              totalDuration: script.totalDuration
            }
          : null,
        scenes: projectScenes.map((s) => {
          const normalizedVideoUrl = normalizeProjectVideoUrl(s.videoUrl)

          return {
            id: s.id,
            orderIndex: s.orderIndex,
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
            firstFrame: s.firstFrame,
            lastFrame: s.lastFrame,
            videoUrl: normalizedVideoUrl,
            status: normalizedVideoUrl ? 'video_ready' : s.status
          }
        }),
        characters: projectCharacters.map(c => ({
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
          age: c.age,
          gender: c.gender,
          imageUrl: migratedCharacterImages.get(c.id) || normalizeCharacterImageUrl(c.baseImage),
          expressions: c.expressions ? JSON.parse(c.expressions) : undefined,
          views: c.views ? JSON.parse(c.views) : undefined
        }))
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }
    console.error('[ProjectGet] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取项目失败'
    })
  }
})

import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters, videoTasks } from '../../db'

function normalizeSceneVideoUrl(rawValue?: string | null): string | null {
  const raw = rawValue?.trim()
  if (!raw) return null

  if (raw.startsWith('url:')) {
    return normalizeSceneVideoUrl(raw.slice(4))
  }

  if (raw.startsWith('/videos/')) {
    const filename = raw.slice('/videos/'.length)
    return filename ? `/api/video/file/${filename}` : null
  }

  if (raw.startsWith('/api/video/file/')) return raw
  if (raw.startsWith('http')) return raw
  if (raw.startsWith('data:video')) return raw
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('ref:')) return null

  return `data:video/mp4;base64,${raw}`
}

async function hydrateSceneVideoUrlsFromTasks(projectScenes: typeof scenes.$inferSelect[]): Promise<void> {
  if (projectScenes.length === 0) return

  const missingVideoSceneIds = projectScenes
    .filter(scene => !normalizeSceneVideoUrl(scene.videoUrl))
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

    const normalized = normalizeSceneVideoUrl(task.videoData)
    if (normalized) {
      latestVideoByScene.set(sceneId, normalized)
    }
  }

  const sceneUpdates: Array<{ id: string, videoUrl: string }> = []

  for (const scene of projectScenes) {
    const normalizedCurrent = normalizeSceneVideoUrl(scene.videoUrl)
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

    // 解析剧本内容（支持新旧格式）
    let scriptData: {
      storyIdea?: string
      novelText?: string
      rawText?: string
      selectedStyleId?: string
      selectedModels?: unknown
      outline?: unknown
      inputMode?: 'idea' | 'script'
    } | null = null
    if (script?.rawText) {
      try {
        scriptData = JSON.parse(script.rawText)
      } catch {
        // 旧格式，rawText 是纯文本
        scriptData = { rawText: script.rawText, storyIdea: script.rawText, novelText: '' }
      }
    }

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
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
              // 风格和模型选择
              selectedStyleId: scriptData?.selectedStyleId || '',
              selectedModels: scriptData?.selectedModels || null,
              outline: scriptData?.outline || null,
              inputMode: scriptData?.inputMode || 'idea',
              parsedData: script.parsedData ? JSON.parse(script.parsedData) : null,
              totalDuration: script.totalDuration
            }
          : null,
        scenes: projectScenes.map((s) => {
          const normalizedVideoUrl = normalizeSceneVideoUrl(s.videoUrl)

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
            storyboard: s.storyboard ? JSON.parse(s.storyboard) : null,
            sceneVisual: s.sceneVisual ? JSON.parse(s.sceneVisual) : null,
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
          baseImage: c.baseImage,
          expressions: c.expressions ? JSON.parse(c.expressions) : null,
          views: c.views ? JSON.parse(c.views) : null
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

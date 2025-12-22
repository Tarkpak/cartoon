import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters } from '../../db'

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string(),
  setting: z.object({
    location: z.string(),
    timeOfDay: z.string(),
    mood: z.string().optional(),
    weather: z.string().optional()
  }).optional(),
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string().optional(),
    action: z.string().optional(),
    emotion: z.string().optional()
  })).optional(),
  dialogues: z.array(z.object({
    character: z.string(),
    text: z.string(),
    emotion: z.string().optional(),
    isInnerThought: z.boolean().optional()
  })).optional(),
  duration: z.number().default(8),
  narration: z.string().nullish(),
  firstFrame: z.string().nullish(),
  lastFrame: z.string().nullish(),
  videoUrl: z.string().nullish(),
  status: z.string().nullish(),
  // 新增：分镜和场景视觉
  storyboard: z.any().nullish(),
  sceneVisual: z.any().nullish()
})

const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  appearance: z.string(),
  personality: z.string().optional(),
  age: z.number().optional(),
  gender: z.string().optional(),
  baseImage: z.string().optional(),
  expressions: z.record(z.string()).optional(),
  // 新增：多视角
  views: z.record(z.string()).optional()
})

const UpdateProjectSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'in_progress', 'completed']).optional(),
  rawText: z.string().optional(),
  scenes: z.array(SceneSchema).optional(),
  characters: z.array(CharacterSchema).optional()
})

/**
 * 更新/保存项目
 * PUT /api/project/:id
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少项目ID'
    })
  }

  const body = await readBody(event)
  const parseResult = UpdateProjectSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
    })
  }

  const data = parseResult.data
  const now = new Date().toISOString()

  try {
    // 检查项目是否存在
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: '项目不存在'
      })
    }

    // 更新项目基本信息
    if (data.name || data.description || data.status) {
      await db.update(projects)
        .set({
          name: data.name ?? project.name,
          description: data.description ?? project.description,
          status: data.status ?? project.status,
          updatedAt: now
        })
        .where(eq(projects.id, id))
    }

    // 处理剧本和场景
    if (data.rawText !== undefined || data.scenes !== undefined) {
      // 获取或创建剧本
      let script = await db.select().from(scripts).where(eq(scripts.projectId, id)).get()

      if (!script) {
        const scriptId = `script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await db.insert(scripts).values({
          id: scriptId,
          projectId: id,
          rawText: data.rawText || '',
          createdAt: now,
          updatedAt: now
        })
        script = { id: scriptId, projectId: id, rawText: data.rawText || '', title: null, parsedData: null, totalDuration: 0, createdAt: now, updatedAt: now }
      } else if (data.rawText !== undefined) {
        await db.update(scripts)
          .set({ rawText: data.rawText, updatedAt: now })
          .where(eq(scripts.id, script.id))
      }

      // 处理场景
      if (data.scenes !== undefined) {
        // 删除所有相关场景（包括旧的 scriptId 和当前的场景 ID）
        await db.delete(scenes).where(eq(scenes.scriptId, script.id))

        // 同时删除可能存在的同 ID 场景
        for (const scene of data.scenes) {
          await db.delete(scenes).where(eq(scenes.id, scene.id))
        }

        // 插入新场景
        const totalDuration = data.scenes.reduce((sum, s) => sum + (s.duration || 8), 0)

        for (let i = 0; i < data.scenes.length; i++) {
          const scene = data.scenes[i]
          if (!scene) continue
          await db.insert(scenes).values({
            id: scene.id,
            scriptId: script.id,
            orderIndex: i,
            title: scene.title || null,
            description: scene.description,
            setting: scene.setting ? JSON.stringify(scene.setting) : null,
            characters: scene.characters ? JSON.stringify(scene.characters) : null,
            dialogues: scene.dialogues ? JSON.stringify(scene.dialogues) : null,
            duration: scene.duration || 8,
            narration: scene.narration || null,
            firstFrame: scene.firstFrame || null,
            lastFrame: scene.lastFrame || null,
            videoUrl: scene.videoUrl || null,
            storyboard: scene.storyboard ? JSON.stringify(scene.storyboard) : null,
            sceneVisual: scene.sceneVisual ? JSON.stringify(scene.sceneVisual) : null,
            status: (scene.status as 'pending' | 'frames_ready' | 'video_ready') || 'pending',
            createdAt: now,
            updatedAt: now
          })
        }

        // 更新剧本总时长
        await db.update(scripts)
          .set({ totalDuration, updatedAt: now })
          .where(eq(scripts.id, script.id))
      }
    }

    // 处理角色
    if (data.characters !== undefined) {
      // 删除旧角色
      await db.delete(characters).where(eq(characters.projectId, id))

      // 同时删除可能存在的同 ID 角色
      for (const char of data.characters) {
        await db.delete(characters).where(eq(characters.id, char.id))
      }

      // 插入新角色
      for (const char of data.characters) {
        if (!char) continue
        await db.insert(characters).values({
          id: char.id,
          projectId: id,
          name: char.name,
          role: (char.role as 'protagonist' | 'antagonist' | 'supporting' | 'extra') || 'supporting',
          appearance: char.appearance,
          personality: char.personality || null,
          age: char.age || null,
          gender: (char.gender as 'male' | 'female' | 'other') || null,
          baseImage: char.baseImage || null,
          expressions: char.expressions ? JSON.stringify(char.expressions) : null,
          views: char.views ? JSON.stringify(char.views) : null,
          createdAt: now,
          updatedAt: now
        })
      }
    }

    return {
      success: true,
      message: '保存成功',
      updatedAt: now
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }
    console.error('[ProjectUpdate] 保存失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '保存项目失败'
    })
  }
})

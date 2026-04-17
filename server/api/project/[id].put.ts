import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, projects, scripts, scenes, characters } from '../../db'
import { isStyleIdEnabled } from '../../utils/style-config'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import {
  mergeStoredProjectScriptData,
  parseStoredProjectScript,
  serializeStoredProjectScript
} from '../../utils/project-script'

const nullToUndefined = (value: unknown) => (value === null ? undefined : value)

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
  // 镜头语言
  shotType: z.enum(['extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close', 'close', 'extreme_close', 'detail']).nullish(),
  cameraMovement: z.enum(['static', 'push', 'pull', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'track', 'dolly', 'zoom_in', 'zoom_out', 'crane', 'handheld', 'arc']).nullish(),
  cameraNote: z.string().nullish(),
  // 转场
  transitionIn: z.enum(['cut', 'fade', 'dissolve', 'wipe', 'slide', 'zoom', 'blur', 'flash', 'none']).nullish(),
  transitionOut: z.enum(['cut', 'fade', 'dissolve', 'wipe', 'slide', 'zoom', 'blur', 'flash', 'none']).nullish(),
  transitionDuration: z.number().nullish()
})

const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  appearance: z.string(),
  personality: z.string().optional(),
  traits: z.array(z.string()).optional(),
  background: z.string().optional(),
  motivation: z.string().optional(),
  speakingStyle: z.string().optional(),
  catchphrase: z.string().optional(),
  voiceTone: z.string().optional(),
  age: z.number().optional(),
  gender: z.string().optional(),
  baseImage: z.preprocess(nullToUndefined, z.string().optional()),
  expressions: z.record(z.string()).nullish(),
  // 新增：多视角
  views: z.record(z.string()).nullish()
})

const UpdateProjectSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'in_progress', 'completed']).optional(),
  workflowType: z.literal('asset_consistency').optional(),
  // 项目预设配置 (可更新)
  styleId: z.string().optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
  // 兼容旧字段
  rawText: z.string().optional(),
  // 新字段：分离故事创意和小说原文
  storyIdea: z.string().optional(),
  novelText: z.string().optional(),
  // 输入模式
  inputMode: z.enum(['idea', 'script']).optional(),
  // 风格选择
  selectedStyleId: z.string().optional(),
  // 资产一致性工作流扩展字段
  assetWorkflow: z.any().optional(),
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
  const normalizeScopedId = (entity: 'scene' | 'char', sourceId: string) => {
    const scopedPrefix = `${entity}_${id}_`
    if (sourceId.startsWith(scopedPrefix)) return sourceId
    return `${scopedPrefix}${sourceId}`
  }

  try {
    // 检查项目是否存在
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) {
      throw createError({
        statusCode: 404,
        statusMessage: '项目不存在'
      })
    }

    if (data.styleId !== undefined) {
      const styleEnabled = await isStyleIdEnabled(data.styleId)
      if (!styleEnabled) {
        throw createError({
          statusCode: 400,
          statusMessage: '画风预设不可用',
          message: `当前后台配置未启用该画风: ${data.styleId}`
        })
      }
    }

    // 更新项目基本信息
    const shouldUpdateProject = data.name !== undefined
      || data.description !== undefined
      || data.status !== undefined
      || data.workflowType !== undefined
      || data.styleId !== undefined
      || data.aspectRatio !== undefined

    if (shouldUpdateProject) {
      await db.update(projects)
        .set({
          name: data.name ?? project.name,
          description: data.description ?? project.description,
          status: data.status ?? project.status,
          workflowType: normalizeProjectWorkflowType(data.workflowType ?? project.workflowType),
          styleId: data.styleId ?? project.styleId,
          aspectRatio: data.aspectRatio ?? project.aspectRatio,
          updatedAt: now
        })
        .where(eq(projects.id, id))
    }

    // 处理剧本和场景
    if (
      data.rawText !== undefined
      || data.storyIdea !== undefined
      || data.novelText !== undefined
      || data.inputMode !== undefined
      || data.selectedStyleId !== undefined
      || data.assetWorkflow !== undefined
      || data.scenes !== undefined
    ) {
      // 获取或创建剧本
      let script = await db.select().from(scripts).where(eq(scripts.projectId, id)).get()

      // 读取现有数据
      const existingData = parseStoredProjectScript(script?.rawText)
      const scriptContent = serializeStoredProjectScript(
        mergeStoredProjectScriptData({
          storyIdea: data.storyIdea,
          novelText: data.novelText,
          rawText: data.rawText,
          selectedStyleId: data.selectedStyleId,
          inputMode: data.inputMode,
          assetWorkflow: data.assetWorkflow
        }, existingData)
      )

      if (!script) {
        const scriptId = `script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await db.insert(scripts).values({
          id: scriptId,
          projectId: id,
          rawText: scriptContent,
          createdAt: now,
          updatedAt: now
        })
        script = { id: scriptId, projectId: id, rawText: scriptContent, title: null, parsedData: null, totalDuration: 0, createdAt: now, updatedAt: now }
      } else {
        await db.update(scripts)
          .set({ rawText: scriptContent, updatedAt: now })
          .where(eq(scripts.id, script.id))
      }

      // 处理场景
      if (data.scenes !== undefined) {
        // 删除当前项目旧场景（仅按 scriptId 作用域）
        await db.delete(scenes).where(eq(scenes.scriptId, script.id))

        // 插入新场景
        const totalDuration = data.scenes.reduce((sum, s) => sum + (s.duration || 8), 0)

        for (let i = 0; i < data.scenes.length; i++) {
          const scene = data.scenes[i]
          if (!scene) continue
          await db.insert(scenes).values({
            id: normalizeScopedId('scene', scene.id),
            scriptId: script.id,
            orderIndex: i,
            title: scene.title || null,
            description: scene.description,
            setting: scene.setting ? JSON.stringify(scene.setting) : null,
            characters: scene.characters ? JSON.stringify(scene.characters) : null,
            dialogues: scene.dialogues ? JSON.stringify(scene.dialogues) : null,
            duration: scene.duration || 8,
            narration: scene.narration || null,
            // 镜头语言
            shotType: scene.shotType || null,
            cameraMovement: scene.cameraMovement || null,
            cameraNote: scene.cameraNote || null,
            // 转场
            transitionIn: scene.transitionIn || null,
            transitionOut: scene.transitionOut || null,
            transitionDuration: scene.transitionDuration || null,
            // 帧和视频
            firstFrame: scene.firstFrame || null,
            lastFrame: scene.lastFrame || null,
            videoUrl: scene.videoUrl || null,
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

      // 插入新角色
      for (const char of data.characters) {
        if (!char) continue
        await db.insert(characters).values({
          id: normalizeScopedId('char', char.id),
          projectId: id,
          name: char.name,
          role: (char.role as 'protagonist' | 'antagonist' | 'supporting' | 'extra') || 'supporting',
          appearance: char.appearance,
          personality: char.personality || null,
          traits: char.traits ? JSON.stringify(char.traits) : null,
          background: char.background || null,
          motivation: char.motivation || null,
          speakingStyle: char.speakingStyle || null,
          catchphrase: char.catchphrase || null,
          voiceTone: char.voiceTone || null,
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

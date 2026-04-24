/**
 * 获取业务流程模型配置
 * 从数据库读取配置，返回各业务流程的模型需求和当前选择
 */

import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../../db'
import {
  TEXT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  initializeSelectedModels,
  getSelectedModels,
  normalizeModelId
} from '../../utils/model-provider'
import {
  WORKFLOW_STEP_CONFIGS,
  type WorkflowStep,
  type ModelCapability,
  WorkflowModelOptionsSchema,
  type WorkflowModelOptions,
  type WorkflowImageGenerationModelOptions,
  type WorkflowVideoGenerationModelOptions,
  type WorkflowCompletionNotificationOptions
} from '#shared/types/workflow-models'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig
} from '#shared/types/provider'

// 配置键名
const WORKFLOW_MODELS_KEY = 'workflow_models'
const WORKFLOW_MODEL_OPTIONS_KEY = 'workflow_model_options'

// 当前主流程默认配置
const DEFAULT_WORKFLOW_MODELS: Record<WorkflowStep, string> = {
  script_parsing: 'qwen3.6-plus',
  scene_description_refinement: 'qwen3.6-plus',
  text_translation: 'qwen3.6-plus',

  character_portrait: 'qwen-image-2.0-pro',
  frame_generation: 'wan2.7-image-pro',

  video_generation: 'wan2.7-t2v'
}

const WORKFLOW_STEPS = WORKFLOW_STEP_CONFIGS.map(config => config.id)

function getGlobalModelByCategory(
  category: 'text' | 'image' | 'video',
  selected: ReturnType<typeof getSelectedModels>
): string | undefined {
  switch (category) {
    case 'text':
      return selected.text
    case 'image':
      return selected.image
    case 'video':
      return selected.video
  }
}

function isModelCompatibleForStep(
  step: WorkflowStep,
  modelId: string
): boolean {
  const normalizedModelId = normalizeModelId(modelId)
  const stepConfig = WORKFLOW_STEP_CONFIGS.find(config => config.id === step)
  if (!stepConfig) {
    return false
  }
  const compatibleModels = getCompatibleModels(stepConfig.category, stepConfig.requiredCapabilities)
  return compatibleModels.some(model => model.model === normalizedModelId)
}

function getDefaultModelForStep(
  step: WorkflowStep,
  selected: ReturnType<typeof getSelectedModels>
): string {
  const stepConfig = WORKFLOW_STEP_CONFIGS.find(config => config.id === step)
  const defaultModel = DEFAULT_WORKFLOW_MODELS[step]

  if (!stepConfig) {
    return defaultModel
  }

  const globalModel = getGlobalModelByCategory(stepConfig.category, selected)
  if (globalModel && isModelCompatibleForStep(step, globalModel)) {
    return globalModel
  }

  if (defaultModel && isModelCompatibleForStep(step, defaultModel)) {
    return defaultModel
  }

  const fallback = getCompatibleModels(stepConfig.category, stepConfig.requiredCapabilities)[0]
  if (fallback) {
    return fallback.model
  }

  return globalModel || defaultModel
}

function normalizeLegacyOverrides(
  raw: Partial<Record<WorkflowStep, string>>
): Partial<Record<WorkflowStep, string>> {
  let configuredCount = 0
  for (const step of WORKFLOW_STEPS) {
    if (raw[step]) {
      configuredCount += 1
    }
  }
  // 旧版本 setWorkflowModel 会把完整配置整包写入（所有步骤都有值）
  const maybeLegacyFullSnapshot = configuredCount >= WORKFLOW_STEPS.length

  const normalized: Partial<Record<WorkflowStep, string>> = {}
  for (const step of WORKFLOW_STEPS) {
    const rawModelId = raw[step]
    if (!rawModelId || typeof rawModelId !== 'string') {
      continue
    }
    const modelId = normalizeModelId(rawModelId)
    // 仅对“旧版整包快照”去掉历史默认值，避免误伤新配置
    if (maybeLegacyFullSnapshot && modelId === DEFAULT_WORKFLOW_MODELS[step]) {
      continue
    }
    normalized[step] = modelId
  }
  return normalized
}

async function readWorkflowModelOverridesFromDB(): Promise<Partial<Record<WorkflowStep, string>>> {
  const result = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, WORKFLOW_MODELS_KEY))
    .limit(1)

  const row = result[0]
  if (!row?.value) {
    return {}
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<Record<WorkflowStep, string>>
    return normalizeLegacyOverrides(parsed)
  } catch {
    return {}
  }
}

async function saveWorkflowModelOverrides(
  overrides: Partial<Record<WorkflowStep, string>>
): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: WORKFLOW_MODELS_KEY,
      value: JSON.stringify(overrides),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(overrides),
        updatedAt: now
      }
    })
}

function resolveDefaultWorkflowModelOptions(): WorkflowModelOptions {
  return {
    image_options: {
      geminiImageSize: '1K'
    },
    video_generation: {
      klingV3Omni: {
        sound: 'off',
        mode: 'pro'
      },
      seedance: {
        quality: '720p'
      },
      audioDefaults: {
        qwen: true,
        kling: true,
        seedance: true
      }
    },
    completion_notification: {
      sound: true,
      systemNotification: false
    }
  }
}

function normalizeWorkflowModelOptions(raw: unknown): WorkflowModelOptions {
  // 兼容旧版存量数据：将 image_generation 键迁移为 image_options
  if (raw && typeof raw === 'object' && 'image_generation' in raw && !('image_options' in raw)) {
    const legacy = raw as Record<string, unknown>
    const migrated: Record<string, unknown> = { ...legacy, image_options: legacy.image_generation }
    delete migrated.image_generation
    const parsed = WorkflowModelOptionsSchema.safeParse(migrated)
    if (parsed.success) return parsed.data
  }
  const parsed = WorkflowModelOptionsSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return resolveDefaultWorkflowModelOptions()
}

async function readWorkflowModelOptionsFromDB(): Promise<WorkflowModelOptions> {
  const result = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, WORKFLOW_MODEL_OPTIONS_KEY))
    .limit(1)

  const row = result[0]
  if (!row?.value) {
    return resolveDefaultWorkflowModelOptions()
  }

  try {
    const parsed = JSON.parse(row.value)
    return normalizeWorkflowModelOptions(parsed)
  } catch {
    return resolveDefaultWorkflowModelOptions()
  }
}

async function saveWorkflowModelOptions(
  options: WorkflowModelOptions
): Promise<void> {
  const normalized = normalizeWorkflowModelOptions(options)
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: WORKFLOW_MODEL_OPTIONS_KEY,
      value: JSON.stringify(normalized),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(normalized),
        updatedAt: now
      }
    })
}

/**
 * 获取业务流程模型覆盖配置（仅保存局部覆盖）
 */
export async function getWorkflowModelOverrides(): Promise<Partial<Record<WorkflowStep, string>>> {
  try {
    return await readWorkflowModelOverridesFromDB()
  } catch (error) {
    console.error('[WorkflowModels] 读取覆盖配置失败:', error)
    return {}
  }
}

/**
 * 获取业务流程模型扩展配置
 */
export async function getWorkflowModelOptions(): Promise<WorkflowModelOptions> {
  try {
    return await readWorkflowModelOptionsFromDB()
  } catch (error) {
    console.error('[WorkflowModels] 读取模型扩展配置失败:', error)
    return resolveDefaultWorkflowModelOptions()
  }
}

/**
 * 设置视频生成流程的模型扩展配置
 */
export async function setWorkflowVideoGenerationModelOptions(
  options: WorkflowVideoGenerationModelOptions
): Promise<void> {
  const current = await getWorkflowModelOptions()
  const merged: WorkflowModelOptions = normalizeWorkflowModelOptions({
    ...current,
    video_generation: {
      ...current.video_generation,
      ...options,
      klingV3Omni: {
        ...current.video_generation.klingV3Omni,
        ...options.klingV3Omni
      },
      seedance: {
        ...current.video_generation.seedance,
        ...options.seedance
      },
      audioDefaults: {
        ...current.video_generation.audioDefaults,
        ...options.audioDefaults
      }
    }
  })
  await saveWorkflowModelOptions(merged)
  console.log('[WorkflowModels] 已保存视频流程模型扩展配置:', merged.video_generation)
}

/**
 * 设置图片生成流程的模型扩展配置
 */
export async function setWorkflowImageGenerationModelOptions(
  options: WorkflowImageGenerationModelOptions
): Promise<void> {
  const current = await getWorkflowModelOptions()
  const merged: WorkflowModelOptions = normalizeWorkflowModelOptions({
    ...current,
    image_options: {
      ...current.image_options,
      ...options
    }
  })
  await saveWorkflowModelOptions(merged)
  console.log('[WorkflowModels] 已保存图片流程模型扩展配置:', merged.image_options)
}

/**
 * 设置生成完成提醒配置
 */
export async function setWorkflowCompletionNotificationOptions(
  options: WorkflowCompletionNotificationOptions
): Promise<void> {
  const current = await getWorkflowModelOptions()
  const merged: WorkflowModelOptions = normalizeWorkflowModelOptions({
    ...current,
    completion_notification: {
      ...current.completion_notification,
      ...options
    }
  })
  await saveWorkflowModelOptions(merged)
  console.log('[WorkflowModels] 已保存生成完成提醒配置:', merged.completion_notification)
}

/**
 * 获取业务流程模型有效配置（未覆盖时继承全局）
 */
export async function getWorkflowModels(): Promise<Record<WorkflowStep, string>> {
  try {
    await initializeSelectedModels()

    const selected = getSelectedModels()
    const overrides = await readWorkflowModelOverridesFromDB()
    const resolved = {} as Record<WorkflowStep, string>

    for (const step of WORKFLOW_STEPS) {
      const override = overrides[step]
      resolved[step] = override || getDefaultModelForStep(step, selected)
    }

    return resolved
  } catch (error) {
    console.error('[WorkflowModels] 读取配置失败:', error)
  }

  const selected = getSelectedModels()
  const fallback = {} as Record<WorkflowStep, string>
  for (const step of WORKFLOW_STEPS) {
    fallback[step] = getDefaultModelForStep(step, selected)
  }
  return fallback
}

/**
 * 保存业务流程模型配置到数据库
 */
export async function setWorkflowModel(step: WorkflowStep, modelId: string): Promise<void> {
  await initializeSelectedModels()

  const normalizedModelId = normalizeModelId(modelId)
  const selected = getSelectedModels()
  const defaultModel = getDefaultModelForStep(step, selected)
  const overrides = await getWorkflowModelOverrides()

  if (normalizedModelId === defaultModel) {
    overrides[step] = undefined
  } else {
    overrides[step] = normalizedModelId
  }

  await saveWorkflowModelOverrides(overrides)
  console.log(`[WorkflowModels] 已保存配置: ${step} = ${normalizedModelId}`)
}

/**
 * 批量保存业务流程模型配置
 */
export async function setWorkflowModels(models: Partial<Record<WorkflowStep, string>>): Promise<void> {
  await initializeSelectedModels()

  const selected = getSelectedModels()
  const overrides = await getWorkflowModelOverrides()

  for (const step of WORKFLOW_STEPS) {
    const rawModelId = models[step]
    if (!rawModelId) {
      continue
    }
    const modelId = normalizeModelId(rawModelId)
    const defaultModel = getDefaultModelForStep(step, selected)
    if (modelId === defaultModel) {
      overrides[step] = undefined
    } else {
      overrides[step] = modelId
    }
  }

  await saveWorkflowModelOverrides(overrides)
  console.log(`[WorkflowModels] 已批量保存配置:`, models)
}

/** 检查模型是否满足能力要求 */
function checkModelCapabilities(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig,
  requiredCapabilities: ModelCapability[]
): boolean {
  for (const cap of requiredCapabilities) {
    switch (cap) {
      case 'text_generation':
        break
      case 'reference_image':
        if ('supportReferenceImage' in model && !model.supportReferenceImage) {
          return false
        }
        break
      case 'require_reference_image':
        if ('requireReferenceImage' in model && !model.requireReferenceImage) {
          return false
        }
        break
      case 'first_last_frame':
        if ('supportFirstLastFrame' in model && !model.supportFirstLastFrame) {
          return false
        }
        break
      case 'image_to_video':
        if ('supportImageToVideo' in model && !model.supportImageToVideo) {
          return false
        }
        break
      case 'text_to_video':
        if ('supportTextToVideo' in model && !model.supportTextToVideo) {
          return false
        }
        break
    }
  }
  return true
}

/** 获取满足能力要求的模型列表 */
function getCompatibleModels(
  category: 'text' | 'image' | 'video',
  requiredCapabilities: ModelCapability[]
) {
  let models: Array<TextModelConfig | ImageModelConfig | VideoModelConfig>

  switch (category) {
    case 'text':
      models = TEXT_MODELS
      break
    case 'image':
      models = IMAGE_MODELS
      break
    case 'video':
      models = VIDEO_MODELS
      break
  }

  return models.filter(m => checkModelCapabilities(m, requiredCapabilities))
}

/** 获取模型的能力标签 */
function getModelCapabilityTags(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig
): string[] {
  const tags: string[] = []

  if ('supportThinking' in model && model.supportThinking) {
    tags.push('深度思考')
  }
  if ('supportReferenceImage' in model && model.supportReferenceImage) {
    tags.push('参考图')
  }
  if ('requireReferenceImage' in model && model.requireReferenceImage) {
    tags.push('需参考图')
  }
  if ('supportFirstLastFrame' in model && model.supportFirstLastFrame) {
    tags.push('首尾帧')
  }
  if ('supportImageToVideo' in model && model.supportImageToVideo) {
    tags.push('图生视频')
  }
  if ('supportTextToVideo' in model && model.supportTextToVideo) {
    tags.push('文生视频')
  }
  if ('supportAudioReference' in model && model.supportAudioReference) {
    tags.push('音频参考')
  }
  if ('maxDuration' in model && model.maxDuration) {
    tags.push(`${model.maxDuration}s`)
  }

  return tags
}

export default defineEventHandler(async () => {
  // 从数据库读取当前配置
  const [workflowModels, workflowOverrides, workflowModelOptions] = await Promise.all([
    getWorkflowModels(),
    getWorkflowModelOverrides(),
    getWorkflowModelOptions()
  ])

  // 构建每个业务流程的可用模型列表
  const workflowConfigs = WORKFLOW_STEP_CONFIGS.map((config) => {
    const compatibleModels = getCompatibleModels(config.category, config.requiredCapabilities)

    return {
      ...config,
      compatibleModels: compatibleModels.map(m => ({
        model: m.model,
        displayName: m.displayName,
        provider: m.provider,
        description: m.description,
        supportAudioReference: 'supportAudioReference' in m ? !!m.supportAudioReference : false,
        capabilities: getModelCapabilityTags(m)
      })),
      selectedModel: workflowModels[config.id] || null,
      isOverridden: !!workflowOverrides[config.id],
      modelOptions: config.id === 'video_generation' ? workflowModelOptions.video_generation : undefined
    }
  })

  return {
    success: true,
    data: {
      workflows: workflowConfigs,
      currentSelections: workflowModels,
      modelOptions: workflowModelOptions
    }
  }
})

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
  VOICE_MODELS,
  initializeSelectedModels,
  getSelectedModels
} from '../../utils/model-provider'
import {
  WORKFLOW_STEP_CONFIGS,
  type WorkflowStep,
  type ModelCapability
} from '#shared/types/workflow-models'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'

// 配置键名
const WORKFLOW_MODELS_KEY = 'workflow_models'

// 历史默认配置（用于兼容旧数据）
const LEGACY_DEFAULT_WORKFLOW_MODELS: Record<WorkflowStep, string> = {
  // 文本生成类 - 默认使用千问
  outline_generation: 'qwen-flash',
  script_parsing: 'qwen-flash',
  character_extraction: 'qwen-flash',
  storyboard_generation: 'qwen-flash',
  scene_visual_extraction: 'qwen-flash',
  text_translation: 'qwen-flash',

  // 图片生成类 - 默认使用千问
  character_portrait: 'wan2.6-t2i',
  character_views: 'wan2.6-image',
  frame_generation: 'wan2.6-image',

  // 视频生成类 - 默认使用千问
  video_generation: 'wan2.2-kf2v-flash',

  // 语音生成类 - 默认使用千问
  voice_synthesis: 'qwen3-tts-instruct-flash'
}

const WORKFLOW_STEPS = WORKFLOW_STEP_CONFIGS.map(config => config.id)

function getGlobalModelByCategory(
  category: 'text' | 'image' | 'video' | 'voice',
  selected: ReturnType<typeof getSelectedModels>
): string | undefined {
  switch (category) {
    case 'text':
      return selected.text
    case 'image':
      return selected.image
    case 'video':
      return selected.video
    case 'voice':
      return selected.tts
  }
}

function isModelCompatibleForStep(
  step: WorkflowStep,
  modelId: string
): boolean {
  const stepConfig = WORKFLOW_STEP_CONFIGS.find(config => config.id === step)
  if (!stepConfig) {
    return false
  }
  const compatibleModels = getCompatibleModels(stepConfig.category, stepConfig.requiredCapabilities)
  return compatibleModels.some(model => model.model === modelId)
}

function getDefaultModelForStep(
  step: WorkflowStep,
  selected: ReturnType<typeof getSelectedModels>
): string {
  const stepConfig = WORKFLOW_STEP_CONFIGS.find(config => config.id === step)
  const legacyDefault = LEGACY_DEFAULT_WORKFLOW_MODELS[step]

  if (!stepConfig) {
    return legacyDefault
  }

  const globalModel = getGlobalModelByCategory(stepConfig.category, selected)
  if (globalModel && isModelCompatibleForStep(step, globalModel)) {
    return globalModel
  }

  if (legacyDefault && isModelCompatibleForStep(step, legacyDefault)) {
    return legacyDefault
  }

  const fallback = getCompatibleModels(stepConfig.category, stepConfig.requiredCapabilities)[0]
  if (fallback) {
    return fallback.model
  }

  return globalModel || legacyDefault
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
    const modelId = raw[step]
    if (!modelId) {
      continue
    }
    // 仅对“旧版整包快照”去掉历史默认值，避免误伤新配置
    if (maybeLegacyFullSnapshot && modelId === LEGACY_DEFAULT_WORKFLOW_MODELS[step]) {
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

  const selected = getSelectedModels()
  const defaultModel = getDefaultModelForStep(step, selected)
  const overrides = await getWorkflowModelOverrides()

  if (modelId === defaultModel) {
    overrides[step] = undefined
  } else {
    overrides[step] = modelId
  }

  await saveWorkflowModelOverrides(overrides)
  console.log(`[WorkflowModels] 已保存配置: ${step} = ${modelId}`)
}

/**
 * 批量保存业务流程模型配置
 */
export async function setWorkflowModels(models: Partial<Record<WorkflowStep, string>>): Promise<void> {
  await initializeSelectedModels()

  const selected = getSelectedModels()
  const overrides = await getWorkflowModelOverrides()

  for (const step of WORKFLOW_STEPS) {
    const modelId = models[step]
    if (!modelId) {
      continue
    }
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
  model: TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig,
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
      case 'tts':
        if ('type' in model && model.type !== 'tts') {
          return false
        }
        break
      case 'asr':
        if ('type' in model && model.type !== 'asr') {
          return false
        }
        break
    }
  }
  return true
}

/** 获取满足能力要求的模型列表 */
function getCompatibleModels(
  category: 'text' | 'image' | 'video' | 'voice',
  requiredCapabilities: ModelCapability[]
) {
  let models: Array<TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig>

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
    case 'voice':
      models = VOICE_MODELS.filter(m => m.type === 'tts')
      break
  }

  return models.filter(m => checkModelCapabilities(m, requiredCapabilities))
}

/** 获取模型的能力标签 */
function getModelCapabilityTags(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig
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
  if ('maxDuration' in model && model.maxDuration) {
    tags.push(`${model.maxDuration}s`)
  }

  return tags
}

export default defineEventHandler(async () => {
  // 从数据库读取当前配置
  const [workflowModels, workflowOverrides] = await Promise.all([
    getWorkflowModels(),
    getWorkflowModelOverrides()
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
        capabilities: getModelCapabilityTags(m)
      })),
      selectedModel: workflowModels[config.id] || null,
      isOverridden: !!workflowOverrides[config.id]
    }
  })

  return {
    success: true,
    data: {
      workflows: workflowConfigs,
      currentSelections: workflowModels
    }
  }
})

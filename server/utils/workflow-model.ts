/**
 * 业务模型配置工具
 * 每次调用都从数据库读取最新配置
 */

import type { WorkflowStep } from '#shared/types/workflow-models'
import {
  findTextModel,
  getCustomOpenAIProviderConfig
} from './model-provider'
import * as gemini from './gemini'
import * as qwen from './qwen'
import * as volcengine from './volcengine'
import {
  generateOpenAICompatibleJSON,
  generateOpenAICompatibleText
} from './openai-compatible'
import { getWorkflowModels } from '../api/models/workflow.get'

/**
 * 从数据库获取指定步骤的业务模型配置
 */
export async function getWorkflowModel(step: WorkflowStep): Promise<string> {
  const models = await getWorkflowModels()
  const modelId = models[step]
  if (!modelId) {
    throw new Error(`[WorkflowModel] 未找到流程模型配置: ${step}`)
  }
  return modelId
}

/**
 * 根据业务模型配置生成纯文本 (文本生成类)
 */
export async function generateTextForWorkflow(
  step: WorkflowStep,
  options: {
    prompt: string
    systemInstruction?: string
    temperature?: number
    maxRetries?: number
  }
): Promise<string> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findTextModel(modelId)
  const provider = modelConfig?.provider || 'qwen'

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'custom_openai') {
    return generateOpenAICompatibleText({
      providerConfig: getCustomOpenAIProviderConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  // Gemini
  return gemini._geminiGenerateText({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

/**
 * 根据业务模型配置生成 JSON (文本生成类)
 */
export async function generateJSONForWorkflow<T>(
  step: WorkflowStep,
  options: {
    prompt: string
    systemInstruction?: string
    temperature?: number
    maxRetries?: number
  }
): Promise<T> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findTextModel(modelId)
  const provider = modelConfig?.provider || 'qwen'

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'custom_openai') {
    return generateOpenAICompatibleJSON<T>({
      providerConfig: getCustomOpenAIProviderConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  // Gemini
  return gemini._geminiGenerateJSON<T>({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

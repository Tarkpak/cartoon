import type { Component } from 'vue'
import {
  Cpu,
  Image,
  Mic,
  Video
} from 'lucide-vue-next'
import type {
  AvailableModelsResponse,
  ImageModelConfig,
  SelectedModels,
  ThreeDModelConfig,
  TextModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'
import settingsModelTestPlaceholders from '../assets/prompts/settings-model-test-placeholders.json'

export type SettingsModelConfig
  = | TextModelConfig
    | ImageModelConfig
    | ThreeDModelConfig
    | VideoModelConfig
    | VoiceModelConfig

export type ModelTestTab = 'text' | 'image' | 'video' | 'tts'

export interface ModelTestTabConfig {
  key: ModelTestTab
  label: string
  icon: Component
}

export interface TestSelectedModels {
  text: string
  image: string
  video: string
  tts: string
}

export interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  latencyMs?: number
  result?: unknown
}

export interface ProviderGroup {
  provider: string
  displayName: string
  models: SettingsModelConfig[]
  expanded: boolean
}

export const SETTINGS_PROVIDER_CONFIG: Record<string, { displayName: string, color: string, order: number }> = {
  gemini: { displayName: 'Google Gemini', color: 'blue', order: 1 },
  qwen: { displayName: '通义千问', color: 'orange', order: 2 },
  kling: { displayName: '可灵 AI', color: 'cyan', order: 3 },
  volcengine: { displayName: '火山引擎', color: 'red', order: 4 },
  custom_openai: { displayName: '自定义 OpenAI', color: 'green', order: 5 },
  openai: { displayName: 'OpenAI', color: 'green', order: 6 },
  deepseek: { displayName: 'DeepSeek', color: 'purple', order: 7 }
}

export const SETTINGS_MODEL_TEST_PLACEHOLDERS = settingsModelTestPlaceholders as Record<ModelTestTab, string>

export const SETTINGS_MODEL_TEST_TABS: ModelTestTabConfig[] = [
  { key: 'text', label: '文本生成', icon: Cpu },
  { key: 'image', label: '图片生成', icon: Image },
  { key: 'video', label: '视频生成', icon: Video },
  { key: 'tts', label: '语音合成', icon: Mic }
]

export function toSelectString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function getSettingsProviderLabel(provider: string): string {
  return {
    gemini: 'Gemini',
    qwen: '千问',
    kling: '可灵',
    volcengine: '火山',
    custom_openai: '自定义',
    openai: 'OpenAI',
    deepseek: 'DeepSeek'
  }[provider] || provider
}

export function getSettingsProviderColor(provider: string): string {
  return SETTINGS_PROVIDER_CONFIG[provider]?.color || 'gray'
}

export function buildTestSelectedModels(
  selectedModels: SelectedModels,
  _models: AvailableModelsResponse
): TestSelectedModels {
  return {
    text: selectedModels.text || '',
    image: selectedModels.image || '',
    video: selectedModels.video || '',
    tts: selectedModels.tts || ''
  }
}

export function getModelDocUrl(model: SettingsModelConfig): string | undefined {
  return model.docUrl
}

export function modelSupportsThinking(model: SettingsModelConfig): boolean {
  return 'supportThinking' in model && model.supportThinking === true
}

export function modelSupportsReferenceImage(model: SettingsModelConfig): boolean {
  return 'supportReferenceImage' in model
    && (
      model.supportReferenceImage === true
      || model.supportReferenceImages === true
      || model.supportImageToImage === true
      || model.requireReferenceImage === true
    )
}

export function getModelMaxDuration(model: SettingsModelConfig): number | undefined {
  return 'maxDuration' in model ? model.maxDuration : undefined
}

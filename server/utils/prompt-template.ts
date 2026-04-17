/**
 * 提示词模板工具函数
 * 支持按工作流读取/保存提示词模板，并维护版本历史
 */

import { db, systemConfig } from '../db'
import { eq } from 'drizzle-orm'
import type {
  PromptTemplate,
  PromptVersion,
  PromptTemplateId,
  BilingualContent
} from '../../shared/types/prompt-template'
import {
  applyPromptTemplateWorkflowDisplay,
  isPromptTemplateVisibleForWorkflow
} from '../../shared/types/prompt-template'
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from '../../shared/types/project'
import { getDefaultPromptTemplates } from './prompt-defaults'

// 新版按工作流分离 key
const PROMPT_TEMPLATES_KEY_PREFIX = 'prompt_templates'
const PROMPT_VERSIONS_KEY_PREFIX = 'prompt_versions'
const PROMPT_LANG_CONFIG_KEY_PREFIX = 'prompt_lang_config'

type PromptWorkflowInput = ProjectWorkflowType | string | null | undefined

interface PromptStorageKeys {
  workflow: ProjectWorkflowType
  templatesKey: string
  versionsKey: string
  langConfigKey: string
  legacyTemplatesKey?: string
  legacyVersionsKey?: string
  legacyLangConfigKey?: string
}

/**
 * 提示词语言配置类型
 */
export type PromptLangConfig = Record<PromptTemplateId, 'zh' | 'en'>

function resolvePromptStorageKeys(workflow?: PromptWorkflowInput): PromptStorageKeys {
  const normalized = normalizeProjectWorkflowType(workflow)

  return {
    workflow: normalized,
    templatesKey: `${PROMPT_TEMPLATES_KEY_PREFIX}_${normalized}`,
    versionsKey: `${PROMPT_VERSIONS_KEY_PREFIX}_${normalized}`,
    langConfigKey: `${PROMPT_LANG_CONFIG_KEY_PREFIX}_${normalized}`,
    legacyTemplatesKey: undefined,
    legacyVersionsKey: undefined,
    legacyLangConfigKey: undefined
  }
}

/**
 * 获取默认语言配置
 * 素材一致性流程统一采用中文优先，避免跨模块理解偏差。
 */
function getDefaultLangConfig(_workflow: PromptWorkflowInput = 'asset_consistency'): PromptLangConfig {
  return {
    script_parsing: 'zh',
    character_sheet: 'zh',
    character_regeneration: 'zh',
    environment_reference_generation: 'zh',
    scene_description_refinement: 'zh',
    scene_video_generation: 'zh'
  }
}

function mergeWithDefaultTemplates(
  templates: PromptTemplate[],
  workflow: ProjectWorkflowType
): PromptTemplate[] {
  const defaults = getDefaultPromptTemplates(workflow)
  const defaultMap = new Map(defaults.map(template => [template.id, template]))
  const templateMap = new Map(templates.map(t => [t.id, t]))

  for (const def of defaults) {
    const existing = templateMap.get(def.id)
    if (!existing) {
      templateMap.set(def.id, def)
      continue
    }

    // 同步模板元数据，避免历史存量模板缺少新变量定义导致编辑器误报
    templateMap.set(def.id, {
      ...existing,
      name: def.name,
      category: def.category,
      description: def.description,
      variables: def.variables
    })
  }

  return Array.from(templateMap.values())
    .map((template) => {
      const def = defaultMap.get(template.id)
      if (!def) return template

      const isCustomized = template.isCustomized === true
      return {
        ...template,
        name: def.name,
        category: def.category,
        description: def.description,
        variables: def.variables,
        // 非自定义模板自动跟随最新默认内容，避免历史默认值造成行为偏差
        content: isCustomized ? template.content : def.content,
        isCustomized
      }
    })
    .filter(template => isPromptTemplateVisibleForWorkflow(template.id as PromptTemplateId, workflow))
    .map(template => applyPromptTemplateWorkflowDisplay(template, workflow))
}

/**
 * 获取提示词语言配置
 */
export async function getPromptLangConfig(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptLangConfig> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const defaultConfig = getDefaultLangConfig(workflow)
    const value = await readSystemConfigValue(keys.langConfigKey, keys.legacyLangConfigKey)

    if (value) {
      const saved = JSON.parse(value) as Partial<PromptLangConfig>
      return {
        ...defaultConfig,
        ...saved
      } as PromptLangConfig
    }

    return defaultConfig
  } catch (error) {
    console.error('[PromptTemplate] 获取语言配置失败:', error)
    return getDefaultLangConfig(workflow)
  }
}

/**
 * 更新提示词语言配置
 */
export async function updatePromptLangConfig(
  config: Partial<PromptLangConfig>,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptLangConfig> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const current = await getPromptLangConfig(workflow)
    const updated = { ...current, ...config }

    await upsertSystemConfigValue(keys.langConfigKey, JSON.stringify(updated))

    return updated
  } catch (error) {
    console.error('[PromptTemplate] 更新语言配置失败:', error)
    throw error
  }
}

/**
 * 获取单个模板的语言配置
 */
export async function getPromptLang(
  id: PromptTemplateId,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<'zh' | 'en'> {
  const config = await getPromptLangConfig(workflow)
  return config[id] || 'zh'
}

/**
 * 获取所有提示词模板
 */
export async function getAllPromptTemplates(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate[]> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const normalizedWorkflow = keys.workflow
    const value = await readSystemConfigValue(keys.templatesKey, keys.legacyTemplatesKey)

    if (value) {
      const parsed = JSON.parse(value) as PromptTemplate[]
      return mergeWithDefaultTemplates(parsed, normalizedWorkflow)
    }

    return getDefaultPromptTemplates(normalizedWorkflow)
  } catch (error) {
    console.error('[PromptTemplate] 获取模板失败:', error)
    const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
    return getDefaultPromptTemplates(normalizedWorkflow)
  }
}

/**
 * 获取单个提示词模板
 */
export async function getPromptTemplate(
  id: PromptTemplateId,
  _lang?: 'zh' | 'en',
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate | null> {
  const templates = await getAllPromptTemplates(workflow)
  return templates.find(t => t.id === id) || null
}

/**
 * 获取提示词内容（指定语言）
 */
export async function getPromptContent(
  id: PromptTemplateId,
  lang: 'zh' | 'en' = 'zh',
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<string | null> {
  const template = await getPromptTemplate(id, undefined, workflow)
  if (!template) {
    return null
  }

  return template.content[lang]
}

/**
 * 更新提示词模板
 */
export async function updatePromptTemplate(
  id: PromptTemplateId,
  content: BilingualContent,
  note?: string,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate | null> {
  try {
    const templates = await getAllPromptTemplates(workflow)
    const index = templates.findIndex(t => t.id === id)

    if (index === -1) {
      return null
    }

    const oldTemplate = templates[index]!
    const now = new Date().toISOString()

    await saveVersion(id, oldTemplate.content, note, workflow)

    const updatedTemplate: PromptTemplate = {
      ...oldTemplate,
      content,
      isCustomized: true,
      updatedAt: now
    }

    templates[index] = updatedTemplate

    await saveTemplates(templates, workflow)

    return updatedTemplate
  } catch (error) {
    console.error('[PromptTemplate] 更新模板失败:', error)
    return null
  }
}

/**
 * 重置单个提示词模板为默认值
 */
export async function resetPromptTemplate(
  id: PromptTemplateId,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate | null> {
  try {
    const templates = await getAllPromptTemplates(workflow)
    const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
    const defaults = getDefaultPromptTemplates(normalizedWorkflow)

    const defaultTemplate = defaults.find(t => t.id === id)
    if (!defaultTemplate) {
      return null
    }

    const index = templates.findIndex(t => t.id === id)
    if (index === -1) {
      return null
    }

    const oldTemplate = templates[index]!
    await saveVersion(id, oldTemplate.content, '重置前的版本', workflow)

    templates[index] = {
      ...defaultTemplate,
      isCustomized: false,
      updatedAt: new Date().toISOString()
    }

    await saveTemplates(templates, workflow)

    return templates[index]!
  } catch (error) {
    console.error('[PromptTemplate] 重置模板失败:', error)
    return null
  }
}

/**
 * 重置所有提示词模板为默认值
 */
export async function resetAllPromptTemplates(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<boolean> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const defaults = getDefaultPromptTemplates(keys.workflow)

    await saveTemplates(defaults, workflow)
    await deleteSystemConfigValue(keys.versionsKey)

    if (keys.legacyVersionsKey) {
      await deleteSystemConfigValue(keys.legacyVersionsKey)
    }

    return true
  } catch (error) {
    console.error('[PromptTemplate] 重置所有模板失败:', error)
    return false
  }
}

/**
 * 获取版本历史
 */
export async function getPromptVersions(
  id: PromptTemplateId,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptVersion[]> {
  try {
    const allVersions = await getAllVersions(workflow)
    return allVersions
      .filter(v => v.templateId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (error) {
    console.error('[PromptTemplate] 获取版本历史失败:', error)
    return []
  }
}

/**
 * 恢复到指定版本
 */
export async function restorePromptVersion(
  id: PromptTemplateId,
  versionId: string,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate | null> {
  try {
    const versions = await getPromptVersions(id, workflow)
    const version = versions.find(v => v.id === versionId)

    if (!version) {
      return null
    }

    return await updatePromptTemplate(id, version.content, `恢复到版本 ${versionId}`, workflow)
  } catch (error) {
    console.error('[PromptTemplate] 恢复版本失败:', error)
    return null
  }
}

/**
 * 插值模板变量
 * 将模板中的 {{variableName}} 替换为实际值
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number | boolean | undefined>
): string {
  let result = template

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = '{{' + key + '}}'
    result = result.split(placeholder).join(String(value ?? ''))
  }

  return result
}

/**
 * 获取插值后的提示词（便捷函数）
 */
export async function getInterpolatedPrompt(
  id: PromptTemplateId,
  variables: Record<string, string | number | boolean | undefined>,
  lang?: 'zh' | 'en',
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<string | null> {
  const actualLang = lang || await getPromptLang(id, workflow)
  const content = await getPromptContent(id, actualLang, workflow)
  if (!content) {
    return null
  }

  return interpolateTemplate(content, variables)
}

// ========== 内部函数 ==========

/**
 * 保存模板到数据库
 */
async function saveTemplates(
  templates: PromptTemplate[],
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.templatesKey, JSON.stringify(templates))
}

/**
 * 保存版本到历史
 */
async function saveVersion(
  templateId: PromptTemplateId,
  content: BilingualContent,
  note?: string,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  try {
    const versions = await getAllVersions(workflow)

    const newVersion: PromptVersion = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      templateId,
      content,
      createdAt: new Date().toISOString(),
      note
    }

    versions.push(newVersion)

    const templateVersions = versions.filter(v => v.templateId === templateId)
    if (templateVersions.length > 20) {
      const toRemove = templateVersions
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, templateVersions.length - 20)

      const removeIds = new Set(toRemove.map(v => v.id))
      const filteredVersions = versions.filter(v => !removeIds.has(v.id))
      await saveVersions(filteredVersions, workflow)
    } else {
      await saveVersions(versions, workflow)
    }
  } catch (error) {
    console.error('[PromptTemplate] 保存版本失败:', error)
  }
}

/**
 * 获取所有版本
 */
async function getAllVersions(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptVersion[]> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const value = await readSystemConfigValue(keys.versionsKey, keys.legacyVersionsKey)

    if (value) {
      return JSON.parse(value) as PromptVersion[]
    }

    return []
  } catch {
    return []
  }
}

/**
 * 保存版本到数据库
 */
async function saveVersions(
  versions: PromptVersion[],
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.versionsKey, JSON.stringify(versions))
}

async function readSystemConfigValue(key: string, fallbackKey?: string): Promise<string | null> {
  const primary = await readSystemConfigValueByKey(key)
  if (primary !== null) {
    return primary
  }

  if (fallbackKey && fallbackKey !== key) {
    return readSystemConfigValueByKey(fallbackKey)
  }

  return null
}

async function readSystemConfigValueByKey(key: string): Promise<string | null> {
  const result = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1)

  return result.length > 0 && result[0]?.value ? result[0].value : null
}

async function upsertSystemConfigValue(key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1)

  if (existing.length > 0) {
    await db.update(systemConfig)
      .set({ value, updatedAt: now })
      .where(eq(systemConfig.key, key))
  } else {
    await db.insert(systemConfig).values({
      key,
      value,
      updatedAt: now
    })
  }
}

async function deleteSystemConfigValue(key: string): Promise<void> {
  await db.delete(systemConfig).where(eq(systemConfig.key, key))
}

/**
 * 提示词模板工具函数
 * 支持从数据库读取/保存提示词模板，支持版本历史
 */

import { db, systemConfig } from '../db'
import { eq } from 'drizzle-orm'
import type {
  PromptTemplate,
  PromptVersion,
  PromptTemplateId,
  BilingualContent
} from '../../shared/types/prompt-template'
import { getDefaultPromptTemplates } from './prompt-defaults'

// 数据库 key
const PROMPT_TEMPLATES_KEY = 'prompt_templates'
const PROMPT_VERSIONS_KEY = 'prompt_versions'

/**
 * 获取所有提示词模板
 */
export async function getAllPromptTemplates(): Promise<PromptTemplate[]> {
  try {
    const result = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, PROMPT_TEMPLATES_KEY))
      .limit(1)

    if (result.length > 0 && result[0]?.value) {
      const templates = JSON.parse(result[0].value) as PromptTemplate[]
      // 合并默认模板（确保新增的模板也能显示）
      const defaults = getDefaultPromptTemplates()
      const templateMap = new Map(templates.map(t => [t.id, t]))

      for (const def of defaults) {
        if (!templateMap.has(def.id)) {
          templateMap.set(def.id, def)
        }
      }

      return Array.from(templateMap.values())
    }

    // 返回默认模板
    return getDefaultPromptTemplates()
  } catch (error) {
    console.error('[PromptTemplate] 获取模板失败:', error)
    return getDefaultPromptTemplates()
  }
}

/**
 * 获取单个提示词模板
 */
export async function getPromptTemplate(
  id: PromptTemplateId,
  lang?: 'zh' | 'en'
): Promise<PromptTemplate | null> {
  const templates = await getAllPromptTemplates()
  const template = templates.find(t => t.id === id)

  if (!template) {
    return null
  }

  return template
}

/**
 * 获取提示词内容（指定语言）
 */
export async function getPromptContent(
  id: PromptTemplateId,
  lang: 'zh' | 'en' = 'zh'
): Promise<{ systemPrompt?: string; userPrompt: string } | null> {
  const template = await getPromptTemplate(id)
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
  note?: string
): Promise<PromptTemplate | null> {
  try {
    const templates = await getAllPromptTemplates()
    const index = templates.findIndex(t => t.id === id)

    if (index === -1) {
      return null
    }

    const oldTemplate = templates[index]!
    const now = new Date().toISOString()

    // 保存版本历史
    await saveVersion(id, oldTemplate.content, note)

    // 更新模板
    const updatedTemplate: PromptTemplate = {
      ...oldTemplate,
      content,
      isCustomized: true,
      updatedAt: now
    }

    templates[index] = updatedTemplate

    // 保存到数据库
    await saveTemplates(templates)

    return updatedTemplate
  } catch (error) {
    console.error('[PromptTemplate] 更新模板失败:', error)
    return null
  }
}

/**
 * 重置单个提示词模板为默认值
 */
export async function resetPromptTemplate(id: PromptTemplateId): Promise<PromptTemplate | null> {
  try {
    const templates = await getAllPromptTemplates()
    const defaults = getDefaultPromptTemplates()

    const defaultTemplate = defaults.find(t => t.id === id)
    if (!defaultTemplate) {
      return null
    }

    const index = templates.findIndex(t => t.id === id)
    if (index === -1) {
      return null
    }

    const oldTemplate = templates[index]!

    // 保存当前版本到历史
    await saveVersion(id, oldTemplate.content, '重置前的版本')

    // 重置为默认
    templates[index] = {
      ...defaultTemplate,
      isCustomized: false,
      updatedAt: new Date().toISOString()
    }

    await saveTemplates(templates)

    return templates[index]!
  } catch (error) {
    console.error('[PromptTemplate] 重置模板失败:', error)
    return null
  }
}

/**
 * 重置所有提示词模板为默认值
 */
export async function resetAllPromptTemplates(): Promise<boolean> {
  try {
    const defaults = getDefaultPromptTemplates()
    await saveTemplates(defaults)

    // 清空版本历史
    await db.delete(systemConfig)
      .where(eq(systemConfig.key, PROMPT_VERSIONS_KEY))

    return true
  } catch (error) {
    console.error('[PromptTemplate] 重置所有模板失败:', error)
    return false
  }
}

/**
 * 获取版本历史
 */
export async function getPromptVersions(id: PromptTemplateId): Promise<PromptVersion[]> {
  try {
    const result = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, PROMPT_VERSIONS_KEY))
      .limit(1)

    if (result.length > 0 && result[0]?.value) {
      const allVersions = JSON.parse(result[0].value) as PromptVersion[]
      return allVersions
        .filter(v => v.templateId === id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }

    return []
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
  versionId: string
): Promise<PromptTemplate | null> {
  try {
    const versions = await getPromptVersions(id)
    const version = versions.find(v => v.id === versionId)

    if (!version) {
      return null
    }

    // 使用版本内容更新模板
    return await updatePromptTemplate(id, version.content, `恢复到版本 ${versionId}`)
  } catch (error) {
    console.error('[PromptTemplate] 恢复版本失败:', error)
    return null
  }
}

/**
 * 插值模板变量
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number | boolean | undefined>
): string {
  let result = template

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), String(value ?? ''))
  }

  return result
}

// ========== 内部函数 ==========

/**
 * 保存模板到数据库
 */
async function saveTemplates(templates: PromptTemplate[]): Promise<void> {
  const now = new Date().toISOString()
  const value = JSON.stringify(templates)

  // 使用 upsert
  const existing = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, PROMPT_TEMPLATES_KEY))
    .limit(1)

  if (existing.length > 0) {
    await db.update(systemConfig)
      .set({ value, updatedAt: now })
      .where(eq(systemConfig.key, PROMPT_TEMPLATES_KEY))
  } else {
    await db.insert(systemConfig).values({
      key: PROMPT_TEMPLATES_KEY,
      value,
      updatedAt: now
    })
  }
}

/**
 * 保存版本到历史
 */
async function saveVersion(
  templateId: PromptTemplateId,
  content: BilingualContent,
  note?: string
): Promise<void> {
  try {
    const versions = await getAllVersions()

    const newVersion: PromptVersion = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      templateId,
      content,
      createdAt: new Date().toISOString(),
      note
    }

    versions.push(newVersion)

    // 每个模板最多保留 20 个版本
    const templateVersions = versions.filter(v => v.templateId === templateId)
    if (templateVersions.length > 20) {
      const toRemove = templateVersions
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, templateVersions.length - 20)

      const removeIds = new Set(toRemove.map(v => v.id))
      const filteredVersions = versions.filter(v => !removeIds.has(v.id))
      await saveVersions(filteredVersions)
    } else {
      await saveVersions(versions)
    }
  } catch (error) {
    console.error('[PromptTemplate] 保存版本失败:', error)
  }
}

/**
 * 获取所有版本
 */
async function getAllVersions(): Promise<PromptVersion[]> {
  try {
    const result = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, PROMPT_VERSIONS_KEY))
      .limit(1)

    if (result.length > 0 && result[0]?.value) {
      return JSON.parse(result[0].value) as PromptVersion[]
    }

    return []
  } catch (error) {
    return []
  }
}

/**
 * 保存版本到数据库
 */
async function saveVersions(versions: PromptVersion[]): Promise<void> {
  const now = new Date().toISOString()
  const value = JSON.stringify(versions)

  const existing = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, PROMPT_VERSIONS_KEY))
    .limit(1)

  if (existing.length > 0) {
    await db.update(systemConfig)
      .set({ value, updatedAt: now })
      .where(eq(systemConfig.key, PROMPT_VERSIONS_KEY))
  } else {
    await db.insert(systemConfig).values({
      key: PROMPT_VERSIONS_KEY,
      value,
      updatedAt: now
    })
  }
}

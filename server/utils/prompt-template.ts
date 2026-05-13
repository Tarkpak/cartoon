/**
 * 提示词模板工具函数
 * 支持模板读取/保存，并维护版本历史
 */

import { db, systemConfig } from '../db'
import { eq } from 'drizzle-orm'
import type {
  PromptTemplate,
  PromptVersion,
  PromptTemplateId,
  PromptTemplateProfile
} from '../../shared/types/prompt-template'
import {
  applyPromptTemplateWorkflowDisplay,
  isPromptReadonlyProfile,
  PROMPT_DEFAULT_PROFILE_ID,
  isPromptTemplateVisibleForWorkflow
} from '../../shared/types/prompt-template'
import {
  getDefaultPromptTemplates
} from './prompt-defaults'

// 配置持久化 key
const PROMPT_TEMPLATES_KEY_PREFIX = 'prompt_templates'
const PROMPT_VERSIONS_KEY_PREFIX = 'prompt_versions'
const PROMPT_PROFILE_STATE_KEY_PREFIX = 'prompt_profile_state'

const PROMPT_SCOPE_DEFAULT = 'default'
type PromptWorkflowInput = unknown
const LEGACY_SEEDANCE_PROFILE_ID = 'default_seedance'

interface PromptStorageKeys {
  scope: string
  templatesKey: string
  versionsKey: string
  profileStateKey: string
}

interface PromptProfileSnapshot {
  templates: PromptTemplate[]
  versions: PromptVersion[]
}

interface PromptProfileState {
  activeProfileId: string
  profiles: PromptTemplateProfile[]
  snapshots: Record<string, PromptProfileSnapshot>
}

export interface PromptProfileListResult {
  activeProfileId: string
  profiles: PromptTemplateProfile[]
}

function resolvePromptStorageKeys(workflow?: PromptWorkflowInput): PromptStorageKeys {
  const normalized = normalizePromptScope(workflow)
  const templatesKey = `${PROMPT_TEMPLATES_KEY_PREFIX}_${normalized}`
  const versionsKey = `${PROMPT_VERSIONS_KEY_PREFIX}_${normalized}`
  const profileStateKey = `${PROMPT_PROFILE_STATE_KEY_PREFIX}_${normalized}`

  return {
    scope: normalized,
    templatesKey,
    versionsKey,
    profileStateKey
  }
}

function resolvePromptProfileStateKey(workflow?: PromptWorkflowInput): string {
  return resolvePromptStorageKeys(workflow).profileStateKey
}

function normalizePromptScope(_workflow?: PromptWorkflowInput): string {
  return PROMPT_SCOPE_DEFAULT
}

function mergeWithDefaultTemplates(
  templates: PromptTemplate[],
  workflow: string
): PromptTemplate[] {
  const defaults = getDefaultPromptTemplates()
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
      const normalizedContent = typeof template.content === 'string'
        ? template.content
        : def.content
      return {
        ...template,
        name: def.name,
        category: def.category,
        description: def.description,
        variables: def.variables,
        // 非自定义模板自动跟随最新默认内容，避免历史默认值造成行为偏差
        content: isCustomized ? normalizedContent : def.content,
        isCustomized
      }
    })
    .filter(template => isPromptTemplateVisibleForWorkflow(template.id as PromptTemplateId, workflow))
    .map(template => applyPromptTemplateWorkflowDisplay(template, workflow))
}

function buildPromptProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizePromptProfileName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 64)
}

function clonePromptTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    content: template.content,
    variables: template.variables.map(variable => ({ ...variable }))
  }
}

function clonePromptVersion(version: PromptVersion): PromptVersion {
  return {
    ...version,
    content: version.content
  }
}

function clonePromptProfileSnapshot(snapshot: PromptProfileSnapshot): PromptProfileSnapshot {
  return {
    templates: snapshot.templates.map(clonePromptTemplate),
    versions: snapshot.versions.map(clonePromptVersion)
  }
}

function normalizePromptProfileSnapshot(
  input: unknown,
  workflow: string,
  fallback: PromptProfileSnapshot
): PromptProfileSnapshot {
  const next = clonePromptProfileSnapshot(fallback)
  if (!input || typeof input !== 'object') return next

  const source = input as {
    templates?: unknown
    versions?: unknown
  }

  if (Array.isArray(source.templates)) {
    try {
      next.templates = mergeWithDefaultTemplates(source.templates as PromptTemplate[], workflow)
    } catch {
      next.templates = fallback.templates.map(clonePromptTemplate)
    }
  }

  if (Array.isArray(source.versions)) {
    next.versions = source.versions
      .filter((item): item is PromptVersion => {
        if (!item || typeof item !== 'object') return false
        const value = item as PromptVersion
        return typeof value.id === 'string'
          && typeof value.templateId === 'string'
          && typeof value.createdAt === 'string'
          && typeof value.content === 'string'
      })
      .map(clonePromptVersion)
  }

  return next
}

function normalizePromptProfileMetadata(
  input: unknown,
  fallbackName: string,
  fallbackId: string,
  fallbackTime: string
): PromptTemplateProfile {
  const source = input as Partial<PromptTemplateProfile> | null | undefined
  const id = normalizeOptionalText(source?.id) || fallbackId
  const name = normalizePromptProfileName(source?.name) || fallbackName
  const createdAt = normalizeOptionalText(source?.createdAt) || fallbackTime
  const updatedAt = normalizeOptionalText(source?.updatedAt) || createdAt
  const description = normalizeOptionalText(source?.description)

  return {
    id,
    name,
    description,
    createdAt,
    updatedAt
  }
}

function normalizePromptProfilesList(input: unknown, nowIso: string): PromptTemplateProfile[] {
  if (!Array.isArray(input)) return []

  const profiles: PromptTemplateProfile[] = []
  const seen = new Set<string>()

  for (const item of input) {
    const normalized = normalizePromptProfileMetadata(item, '未命名配置', buildPromptProfileId(), nowIso)
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    profiles.push(normalized)
  }

  return profiles
}

function buildDefaultPromptProfile(nowIso: string): PromptTemplateProfile {
  return normalizePromptProfileMetadata(
    { id: PROMPT_DEFAULT_PROFILE_ID, name: '默认配置', createdAt: nowIso, updatedAt: nowIso },
    '默认配置',
    PROMPT_DEFAULT_PROFILE_ID,
    nowIso
  )
}

function buildDefaultPromptProfileSnapshot(_workflow: string): PromptProfileSnapshot {
  return {
    templates: getDefaultPromptTemplates().map(template => clonePromptTemplate(template)),
    versions: []
  }
}

function ensureBuiltinPromptProfiles(input: {
  profiles: PromptTemplateProfile[]
  snapshots: Record<string, PromptProfileSnapshot>
  workflow: string
  nowIso: string
}): {
  profiles: PromptTemplateProfile[]
  snapshots: Record<string, PromptProfileSnapshot>
} {
  const profileMap = new Map(
    input.profiles
      .filter(profile => profile.id !== LEGACY_SEEDANCE_PROFILE_ID)
      .map(profile => [profile.id, profile])
  )
  const {
    [LEGACY_SEEDANCE_PROFILE_ID]: _legacySeedanceSnapshot,
    ...snapshots
  } = input.snapshots

  if (!profileMap.has(PROMPT_DEFAULT_PROFILE_ID)) {
    profileMap.set(PROMPT_DEFAULT_PROFILE_ID, buildDefaultPromptProfile(input.nowIso))
  }
  snapshots[PROMPT_DEFAULT_PROFILE_ID] = buildDefaultPromptProfileSnapshot(input.workflow)

  const orderedProfiles: PromptTemplateProfile[] = []
  const defaultProfile = profileMap.get(PROMPT_DEFAULT_PROFILE_ID)
  if (defaultProfile) orderedProfiles.push(defaultProfile)

  for (const profile of input.profiles) {
    if (profile.id === PROMPT_DEFAULT_PROFILE_ID || profile.id === LEGACY_SEEDANCE_PROFILE_ID) continue
    if (orderedProfiles.some(item => item.id === profile.id)) continue
    orderedProfiles.push(profile)
  }

  for (const [profileId, profile] of profileMap.entries()) {
    if (orderedProfiles.some(item => item.id === profileId)) continue
    orderedProfiles.push(profile)
  }

  return {
    profiles: orderedProfiles,
    snapshots
  }
}

function normalizePromptProfileState(
  input: unknown,
  workflow: string,
  fallbackSnapshot: PromptProfileSnapshot
): PromptProfileState {
  const nowIso = new Date().toISOString()
  const source = input as {
    activeProfileId?: unknown
    profiles?: unknown
    snapshots?: unknown
  } | null

  const profiles = normalizePromptProfilesList(source?.profiles, nowIso)
  const snapshotsRaw = source?.snapshots && typeof source.snapshots === 'object'
    ? source.snapshots as Record<string, unknown>
    : {}

  const snapshots: Record<string, PromptProfileSnapshot> = {}
  for (const profile of profiles) {
    const rawSnapshot = snapshotsRaw[profile.id]
    snapshots[profile.id] = normalizePromptProfileSnapshot(rawSnapshot, workflow, fallbackSnapshot)
  }

  const ensured = ensureBuiltinPromptProfiles({
    profiles,
    snapshots,
    workflow,
    nowIso
  })

  const activeProfileIdRaw = normalizeOptionalText(source?.activeProfileId)
  const activeProfileIdCandidate = activeProfileIdRaw === LEGACY_SEEDANCE_PROFILE_ID
    ? PROMPT_DEFAULT_PROFILE_ID
    : activeProfileIdRaw
  const activeProfileId = ensured.profiles.some(item => item.id === activeProfileIdCandidate)
    ? activeProfileIdCandidate!
    : (ensured.profiles.find(item => item.id === PROMPT_DEFAULT_PROFILE_ID)?.id || ensured.profiles[0]!.id)

  return {
    activeProfileId,
    profiles: ensured.profiles,
    snapshots: ensured.snapshots
  }
}

async function buildActivePromptProfileSnapshot(
  workflow?: PromptWorkflowInput
): Promise<PromptProfileSnapshot> {
  const templates = await getAllPromptTemplates(workflow)
  const versions = await getAllVersions(workflow)

  return {
    templates: templates.map(clonePromptTemplate),
    versions: versions.map(clonePromptVersion)
  }
}

async function getPromptProfileState(
  workflow?: PromptWorkflowInput
): Promise<PromptProfileState> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const key = resolvePromptProfileStateKey(normalizedWorkflow)
  const rawValue = await readSystemConfigValueByKey(key)
  const fallbackSnapshot = await buildActivePromptProfileSnapshot(normalizedWorkflow)

  if (!rawValue) {
    const initial = normalizePromptProfileState(null, normalizedWorkflow, fallbackSnapshot)
    await upsertSystemConfigValue(key, JSON.stringify(initial))
    return initial
  }

  try {
    const parsed = JSON.parse(rawValue)
    return normalizePromptProfileState(parsed, normalizedWorkflow, fallbackSnapshot)
  } catch (error) {
    console.error('[PromptTemplate] 读取提示词配置方案失败，已回退默认方案:', error)
    const initial = normalizePromptProfileState(null, normalizedWorkflow, fallbackSnapshot)
    await upsertSystemConfigValue(key, JSON.stringify(initial))
    return initial
  }
}

async function getActiveReadonlyPromptProfileId(
  workflow?: PromptWorkflowInput
): Promise<string | null> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const rawValue = await readSystemConfigValueByKey(resolvePromptProfileStateKey(normalizedWorkflow))
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as { activeProfileId?: unknown }
    const activeProfileId = normalizeOptionalText(parsed.activeProfileId)
    return isPromptReadonlyProfile(activeProfileId) ? activeProfileId! : null
  } catch {
    return null
  }
}

async function getReadonlyPromptContent(
  id: PromptTemplateId,
  workflow?: PromptWorkflowInput
): Promise<string | null> {
  const activeProfileId = await getActiveReadonlyPromptProfileId(workflow)

  const templates = activeProfileId === PROMPT_DEFAULT_PROFILE_ID
    ? getDefaultPromptTemplates()
    : null

  return templates?.find(template => template.id === id)?.content || null
}

function throwDefaultPromptProfileReadonlyError(): never {
  const error = new Error('内置默认配置不可修改，请先新建并切换到其他配置方案') as Error & {
    statusCode: number
    statusMessage: string
  }
  error.statusCode = 403
  error.statusMessage = 'Forbidden'
  throw error
}

async function assertActivePromptProfileWritable(
  workflow?: PromptWorkflowInput
): Promise<void> {
  const state = await getPromptProfileState(workflow)
  if (isPromptReadonlyProfile(state.activeProfileId)) {
    throwDefaultPromptProfileReadonlyError()
  }
}

async function savePromptProfileState(
  state: PromptProfileState,
  workflow?: PromptWorkflowInput
): Promise<void> {
  const key = resolvePromptProfileStateKey(workflow)
  await upsertSystemConfigValue(key, JSON.stringify(state))
}

async function applyPromptProfileSnapshotToActiveStorage(
  snapshot: PromptProfileSnapshot,
  workflow?: PromptWorkflowInput
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.templatesKey, JSON.stringify(snapshot.templates))
  await upsertSystemConfigValue(keys.versionsKey, JSON.stringify(snapshot.versions))
}

async function syncActivePromptProfileSnapshot(
  workflow?: PromptWorkflowInput
): Promise<void> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const state = await getPromptProfileState(normalizedWorkflow)
  const snapshot = await buildActivePromptProfileSnapshot(normalizedWorkflow)
  const activeId = state.activeProfileId
  const profileIndex = state.profiles.findIndex(item => item.id === activeId)
  if (profileIndex === -1) return

  state.snapshots[activeId] = snapshot
  state.profiles[profileIndex] = {
    ...state.profiles[profileIndex]!,
    updatedAt: new Date().toISOString()
  }
  await savePromptProfileState(state, normalizedWorkflow)
}

export interface CreatePromptProfileInput {
  name: string
  description?: string
  cloneFromProfileId?: string
  activate?: boolean
}

export async function getPromptProfiles(
  workflow?: PromptWorkflowInput
): Promise<PromptProfileListResult> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const state = await getPromptProfileState(normalizedWorkflow)
  if (isPromptReadonlyProfile(state.activeProfileId)) {
    const snapshot = state.snapshots[state.activeProfileId]
    if (snapshot) {
      await applyPromptProfileSnapshotToActiveStorage(snapshot, normalizedWorkflow)
    }
  }

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles
  }
}

export async function createPromptProfile(
  input: CreatePromptProfileInput,
  workflow?: PromptWorkflowInput
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const name = normalizePromptProfileName(input.name)
  if (!name) return null

  const state = await getPromptProfileState(normalizedWorkflow)
  const sourceProfileId = normalizeOptionalText(input.cloneFromProfileId)
  const sourceId = sourceProfileId && state.snapshots[sourceProfileId]
    ? sourceProfileId
    : state.activeProfileId

  const sourceSnapshot = state.snapshots[sourceId]
  if (!sourceSnapshot) return null
  const sourceReadonly = isPromptReadonlyProfile(sourceId)

  let profileId = buildPromptProfileId()
  while (state.profiles.some(profile => profile.id === profileId)) {
    profileId = buildPromptProfileId()
  }

  const nowIso = new Date().toISOString()
  const profile: PromptTemplateProfile = {
    id: profileId,
    name,
    description: normalizeOptionalText(input.description),
    createdAt: nowIso,
    updatedAt: nowIso
  }

  state.profiles.push(profile)
  const snapshot = clonePromptProfileSnapshot(sourceSnapshot)
  if (sourceReadonly) {
    snapshot.templates = snapshot.templates.map(template => ({
      ...template,
      isCustomized: false
    }))
  }
  state.snapshots[profileId] = snapshot

  if (input.activate === true) {
    await applyPromptProfileSnapshotToActiveStorage(state.snapshots[profileId]!, normalizedWorkflow)
    state.activeProfileId = profileId
  }

  await savePromptProfileState(state, normalizedWorkflow)

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles
  }
}

export interface UpdatePromptProfileInput {
  name?: string
  description?: string
}

export async function updatePromptProfile(
  profileId: string,
  input: UpdatePromptProfileInput,
  workflow?: PromptWorkflowInput
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const targetId = normalizeOptionalText(profileId)
  if (!targetId) return null
  if (isPromptReadonlyProfile(targetId)) {
    throwDefaultPromptProfileReadonlyError()
  }

  const state = await getPromptProfileState(normalizedWorkflow)
  const index = state.profiles.findIndex(profile => profile.id === targetId)
  if (index === -1) return null

  const current = state.profiles[index]!
  const nextName = input.name !== undefined
    ? normalizePromptProfileName(input.name) || current.name
    : current.name
  const nextDescription = input.description !== undefined
    ? normalizeOptionalText(input.description)
    : current.description

  state.profiles[index] = {
    ...current,
    name: nextName,
    description: nextDescription,
    updatedAt: new Date().toISOString()
  }

  await savePromptProfileState(state, normalizedWorkflow)

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles
  }
}

export async function deletePromptProfile(
  profileId: string,
  workflow?: PromptWorkflowInput
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const targetId = normalizeOptionalText(profileId)
  if (!targetId) return null
  if (isPromptReadonlyProfile(targetId)) {
    throwDefaultPromptProfileReadonlyError()
  }

  const state = await getPromptProfileState(normalizedWorkflow)
  if (state.profiles.length <= 1) return null

  const index = state.profiles.findIndex(profile => profile.id === targetId)
  if (index === -1) return null

  const deletingActive = state.activeProfileId === targetId
  state.profiles.splice(index, 1)
  const { [targetId]: _removedSnapshot, ...restSnapshots } = state.snapshots
  state.snapshots = restSnapshots

  if (deletingActive) {
    const fallbackProfile = state.profiles[0]
    if (!fallbackProfile) return null
    const fallbackSnapshot = state.snapshots[fallbackProfile.id]
    if (!fallbackSnapshot) return null
    await applyPromptProfileSnapshotToActiveStorage(fallbackSnapshot, normalizedWorkflow)
    state.activeProfileId = fallbackProfile.id
  }

  await savePromptProfileState(state, normalizedWorkflow)

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles
  }
}

export async function activatePromptProfile(
  profileId: string,
  workflow?: PromptWorkflowInput
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizePromptScope(workflow)
  const targetId = normalizeOptionalText(profileId)
  if (!targetId) return null

  const state = await getPromptProfileState(normalizedWorkflow)
  const target = state.profiles.find(profile => profile.id === targetId)
  if (!target) return null

  const snapshot = state.snapshots[target.id]
  if (!snapshot) return null

  await applyPromptProfileSnapshotToActiveStorage(snapshot, normalizedWorkflow)
  state.activeProfileId = target.id

  const index = state.profiles.findIndex(profile => profile.id === target.id)
  if (index !== -1) {
    state.profiles[index] = {
      ...state.profiles[index]!,
      updatedAt: new Date().toISOString()
    }
  }

  await savePromptProfileState(state, normalizedWorkflow)

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles
  }
}

/**
 * 获取所有提示词模板
 */
export async function getAllPromptTemplates(
  workflow?: PromptWorkflowInput
): Promise<PromptTemplate[]> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const normalizedWorkflow = keys.scope
    const value = await readSystemConfigValueByKey(keys.templatesKey)

    if (value) {
      const parsed = JSON.parse(value) as PromptTemplate[]
      return mergeWithDefaultTemplates(parsed, normalizedWorkflow)
    }

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
  workflow?: PromptWorkflowInput
): Promise<PromptTemplate | null> {
  const templates = await getAllPromptTemplates(workflow)
  return templates.find(t => t.id === id) || null
}

/**
 * 获取提示词内容
 */
export async function getPromptContent(
  id: PromptTemplateId,
  workflow?: PromptWorkflowInput
): Promise<string | null> {
  const readonlyContent = await getReadonlyPromptContent(id, workflow)
  if (readonlyContent) return readonlyContent

  const template = await getPromptTemplate(id, workflow)
  if (!template) {
    return null
  }

  return template.content
}

/**
 * 更新提示词模板
 */
export async function updatePromptTemplate(
  id: PromptTemplateId,
  content: string,
  note?: string,
  workflow?: PromptWorkflowInput
): Promise<PromptTemplate | null> {
  try {
    await assertActivePromptProfileWritable(workflow)
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
    await syncActivePromptProfileSnapshot(workflow)

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
  workflow?: PromptWorkflowInput
): Promise<PromptTemplate | null> {
  try {
    await assertActivePromptProfileWritable(workflow)
    const templates = await getAllPromptTemplates(workflow)
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
    await saveVersion(id, oldTemplate.content, '重置前的版本', workflow)

    templates[index] = {
      ...defaultTemplate,
      isCustomized: false,
      updatedAt: new Date().toISOString()
    }

    await saveTemplates(templates, workflow)
    await syncActivePromptProfileSnapshot(workflow)

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
  workflow?: PromptWorkflowInput
): Promise<boolean> {
  try {
    await assertActivePromptProfileWritable(workflow)
    const keys = resolvePromptStorageKeys(workflow)
    const defaults = getDefaultPromptTemplates()

    await saveTemplates(defaults, workflow)
    await deleteSystemConfigValue(keys.versionsKey)

    await syncActivePromptProfileSnapshot(workflow)

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
  workflow?: PromptWorkflowInput
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
  workflow?: PromptWorkflowInput
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

  const unresolved = Array.from(
    new Set(
      Array.from(result.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g))
        .map(match => match[1])
    )
  )
  if (unresolved.length > 0) {
    const formatted = unresolved.map(name => `{{${name}}}`).join(', ')
    throw new Error(`提示词存在未替换变量: ${formatted}`)
  }

  return result
}

/**
 * 获取插值后的提示词（便捷函数）
 */
export async function getInterpolatedPrompt(
  id: PromptTemplateId,
  variables: Record<string, string | number | boolean | undefined>,
  workflow?: PromptWorkflowInput
): Promise<string | null> {
  const content = await getPromptContent(id, workflow)
  if (!content) {
    return null
  }

  try {
    return interpolateTemplate(content, variables)
  } catch (error) {
    console.error(`[PromptTemplate] 模板插值失败 (${id}):`, error)
    return null
  }
}

// ========== 内部函数 ==========

/**
 * 保存模板到数据库
 */
async function saveTemplates(
  templates: PromptTemplate[],
  workflow?: PromptWorkflowInput
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.templatesKey, JSON.stringify(templates))
}

/**
 * 保存版本到历史
 */
async function saveVersion(
  templateId: PromptTemplateId,
  content: string,
  note?: string,
  workflow?: PromptWorkflowInput
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
  workflow?: PromptWorkflowInput
): Promise<PromptVersion[]> {
  try {
    const keys = resolvePromptStorageKeys(workflow)
    const value = await readSystemConfigValueByKey(keys.versionsKey)

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
  workflow?: PromptWorkflowInput
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.versionsKey, JSON.stringify(versions))
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

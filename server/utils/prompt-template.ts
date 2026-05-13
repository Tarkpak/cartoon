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
  BilingualContent,
  PromptTemplateProfile
} from '../../shared/types/prompt-template'
import {
  applyPromptTemplateWorkflowDisplay,
  isPromptReadonlyProfile,
  PROMPT_DEFAULT_PROFILE_ID,
  isPromptTemplateVisibleForWorkflow
} from '../../shared/types/prompt-template'
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from '../../shared/types/project'
import {
  getDefaultPromptTemplates
} from './prompt-defaults'

// 新版按工作流分离 key
const PROMPT_TEMPLATES_KEY_PREFIX = 'prompt_templates'
const PROMPT_VERSIONS_KEY_PREFIX = 'prompt_versions'
const PROMPT_LANG_CONFIG_KEY_PREFIX = 'prompt_lang_config'
const PROMPT_PROFILE_STATE_KEY_PREFIX = 'prompt_profile_state'

type PromptWorkflowInput = ProjectWorkflowType | string | null | undefined
const LEGACY_SEEDANCE_PROFILE_ID = 'default_seedance'

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

interface PromptProfileSnapshot {
  templates: PromptTemplate[]
  versions: PromptVersion[]
  langConfig: PromptLangConfig
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

function resolvePromptProfileStateKey(workflow?: PromptWorkflowInput): string {
  const normalized = normalizeProjectWorkflowType(workflow)
  return `${PROMPT_PROFILE_STATE_KEY_PREFIX}_${normalized}`
}

/**
 * 获取默认语言配置
 * 素材一致性流程统一采用中文优先，避免跨模块理解偏差。
 */
function getDefaultLangConfig(_workflow: PromptWorkflowInput = 'asset_consistency'): PromptLangConfig {
  return {
    script_parsing: 'zh',
    script_parsing_short_drama: 'zh',
    script_episode_plan: 'zh',
    script_parsing_segment_context: 'zh',
    script_parsing_episode_drama_context: 'zh',
    prompt_translation_system: 'zh',
    prompt_translation_user: 'zh',
    character_sheet: 'zh',
    character_regeneration: 'zh',
    environment_reference_generation: 'zh',
    environment_reference_negative_prompt: 'zh',
    prop_asset_generation: 'zh',
    prop_asset_negative_prompt: 'zh',
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

function normalizePromptLangConfigValue(
  input: unknown,
  workflow: PromptWorkflowInput
): PromptLangConfig {
  const base = getDefaultLangConfig(workflow)
  if (!input || typeof input !== 'object') return base

  const merged: PromptLangConfig = { ...base }
  for (const templateId of Object.keys(base) as PromptTemplateId[]) {
    const lang = (input as Record<string, unknown>)[templateId]
    if (lang === 'zh' || lang === 'en') {
      merged[templateId] = lang
    }
  }

  return merged
}

function clonePromptTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    content: { ...template.content },
    variables: template.variables.map(variable => ({ ...variable }))
  }
}

function clonePromptVersion(version: PromptVersion): PromptVersion {
  return {
    ...version,
    content: { ...version.content }
  }
}

function clonePromptProfileSnapshot(snapshot: PromptProfileSnapshot): PromptProfileSnapshot {
  return {
    templates: snapshot.templates.map(clonePromptTemplate),
    versions: snapshot.versions.map(clonePromptVersion),
    langConfig: { ...snapshot.langConfig }
  }
}

function normalizePromptProfileSnapshot(
  input: unknown,
  workflow: ProjectWorkflowType,
  fallback: PromptProfileSnapshot
): PromptProfileSnapshot {
  const next = clonePromptProfileSnapshot(fallback)
  if (!input || typeof input !== 'object') return next

  const source = input as {
    templates?: unknown
    versions?: unknown
    langConfig?: unknown
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
          && value.content !== null
          && typeof value.content === 'object'
          && typeof value.content.zh === 'string'
          && typeof value.content.en === 'string'
      })
      .map(clonePromptVersion)
  }

  next.langConfig = normalizePromptLangConfigValue(source.langConfig, workflow)
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

function buildDefaultPromptProfileSnapshot(workflow: ProjectWorkflowType): PromptProfileSnapshot {
  return {
    templates: getDefaultPromptTemplates(workflow).map(template => clonePromptTemplate(template)),
    versions: [],
    langConfig: getDefaultLangConfig(workflow)
  }
}

function ensureBuiltinPromptProfiles(input: {
  profiles: PromptTemplateProfile[]
  snapshots: Record<string, PromptProfileSnapshot>
  workflow: ProjectWorkflowType
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
  workflow: ProjectWorkflowType,
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileSnapshot> {
  const templates = await getAllPromptTemplates(workflow)
  const versions = await getAllVersions(workflow)
  const langConfig = await getPromptLangConfig(workflow)

  return {
    templates: templates.map(clonePromptTemplate),
    versions: versions.map(clonePromptVersion),
    langConfig: { ...langConfig }
  }
}

async function getPromptProfileState(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileState> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<string | null> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  lang: 'zh' | 'en',
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<string | null> {
  const activeProfileId = await getActiveReadonlyPromptProfileId(workflow)
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)

  const templates = activeProfileId === PROMPT_DEFAULT_PROFILE_ID
    ? getDefaultPromptTemplates(normalizedWorkflow)
    : null

  return templates?.find(template => template.id === id)?.content[lang] || null
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const state = await getPromptProfileState(workflow)
  if (isPromptReadonlyProfile(state.activeProfileId)) {
    throwDefaultPromptProfileReadonlyError()
  }
}

async function savePromptProfileState(
  state: PromptProfileState,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const key = resolvePromptProfileStateKey(workflow)
  await upsertSystemConfigValue(key, JSON.stringify(state))
}

async function applyPromptProfileSnapshotToActiveStorage(
  snapshot: PromptProfileSnapshot,
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const keys = resolvePromptStorageKeys(workflow)
  await upsertSystemConfigValue(keys.templatesKey, JSON.stringify(snapshot.templates))
  await upsertSystemConfigValue(keys.versionsKey, JSON.stringify(snapshot.versions))
  await upsertSystemConfigValue(keys.langConfigKey, JSON.stringify(snapshot.langConfig))
}

async function syncActivePromptProfileSnapshot(
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<void> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileListResult> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptProfileListResult | null> {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
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
    await assertActivePromptProfileWritable(workflow)
    const keys = resolvePromptStorageKeys(workflow)
    const current = await getPromptLangConfig(workflow)
    const updated = { ...current, ...config }

    await upsertSystemConfigValue(keys.langConfigKey, JSON.stringify(updated))
    await syncActivePromptProfileSnapshot(workflow)

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
  const readonlyContent = await getReadonlyPromptContent(id, lang, workflow)
  if (readonlyContent) return readonlyContent

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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<PromptTemplate | null> {
  try {
    await assertActivePromptProfileWritable(workflow)
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
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<boolean> {
  try {
    await assertActivePromptProfileWritable(workflow)
    const keys = resolvePromptStorageKeys(workflow)
    const defaults = getDefaultPromptTemplates(keys.workflow)

    await saveTemplates(defaults, workflow)
    await deleteSystemConfigValue(keys.versionsKey)

    if (keys.legacyVersionsKey) {
      await deleteSystemConfigValue(keys.legacyVersionsKey)
    }

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
  lang?: 'zh' | 'en',
  workflow: PromptWorkflowInput = 'asset_consistency'
): Promise<string | null> {
  const actualLang = lang || await getPromptLang(id, workflow)
  const content = await getPromptContent(id, actualLang, workflow)
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

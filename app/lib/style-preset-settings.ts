import type { StyleCategory, StylePreset } from '#shared/types/styles'
import { STYLE_CATEGORIES } from '#shared/types/styles'

export interface StylePresetExportPayload {
  version: number
  exportedAt: string
  allPresets: StylePreset[]
  enabledStyleIds: string[]
  defaultStyleId: string
}

export interface StyleConfigResponse {
  success: boolean
  data?: {
    allPresets: StylePreset[]
    enabledStyleIds: string[]
    defaultStyleId: string
  }
}

export interface StylePresetExportResponse {
  success: boolean
  data?: StylePresetExportPayload
}

export interface StyleFormState {
  id: string
  name: string
  nameEn: string
  category: StyleCategory
  description: string
  prompt: string
  negativePrompt: string
  thumbnail: string
  isNew: boolean
  isPro: boolean
  enabled: boolean
  setAsDefault: boolean
}

export function createDefaultStyleFormState(): StyleFormState {
  return {
    id: '',
    name: '',
    nameEn: '',
    category: STYLE_CATEGORIES[0]?.id || 'japanese_anime',
    description: '',
    prompt: '',
    negativePrompt: '',
    thumbnail: '',
    isNew: false,
    isPro: false,
    enabled: true,
    setAsDefault: false
  }
}

export function normalizeStyleConfigState(
  allPresets: StylePreset[],
  enabledStyleIds: string[],
  defaultStyleId: string
) {
  const validStyleIds = new Set(allPresets.map(style => style.id))
  const dedupEnabled: string[] = []

  for (const styleId of enabledStyleIds) {
    if (!validStyleIds.has(styleId)) continue
    if (dedupEnabled.includes(styleId)) continue
    dedupEnabled.push(styleId)
  }

  if (dedupEnabled.length === 0) {
    dedupEnabled.push(...allPresets.map(style => style.id))
  }

  const normalizedDefault = dedupEnabled.includes(defaultStyleId)
    ? defaultStyleId
    : (dedupEnabled[0] || '')

  return {
    enabledStyleIds: dedupEnabled,
    defaultStyleId: normalizedDefault
  }
}

export function hasStyleConfigChanges(options: {
  currentEnabledIds: string[]
  savedEnabledIds: string[]
  currentDefaultStyleId: string
  savedDefaultStyleId: string
}) {
  if (options.currentEnabledIds.length !== options.savedEnabledIds.length) return true
  if (options.currentDefaultStyleId !== options.savedDefaultStyleId) return true

  for (let index = 0; index < options.currentEnabledIds.length; index += 1) {
    if (options.currentEnabledIds[index] !== options.savedEnabledIds[index]) {
      return true
    }
  }

  return false
}

export function filterStylePresets(options: {
  allStylePresets: StylePreset[]
  enabledStyleIdSet: Set<string>
  styleCategoryFilter: 'all' | 'enabled' | StyleCategory
  styleSearchKeyword: string
}) {
  const query = options.styleSearchKeyword.trim().toLowerCase()

  return options.allStylePresets.filter((style) => {
    const enabled = options.enabledStyleIdSet.has(style.id)

    if (options.styleCategoryFilter === 'enabled' && !enabled) {
      return false
    }

    if (
      options.styleCategoryFilter !== 'all'
      && options.styleCategoryFilter !== 'enabled'
      && style.category !== options.styleCategoryFilter
    ) {
      return false
    }

    if (!query) return true

    return (
      style.name.toLowerCase().includes(query)
      || style.nameEn.toLowerCase().includes(query)
      || style.description.toLowerCase().includes(query)
      || style.id.toLowerCase().includes(query)
    )
  })
}

export function getStyleCategoryName(category: StyleCategory): string {
  return STYLE_CATEGORIES.find(item => item.id === category)?.name || category
}

export function applyStyleFormState(options: {
  styleForm: StyleFormState
  style: StylePreset
  enabledStyleIdSet: Set<string>
  styleDefaultId: string
}) {
  options.styleForm.id = options.style.id
  options.styleForm.name = options.style.name
  options.styleForm.nameEn = options.style.nameEn
  options.styleForm.category = options.style.category
  options.styleForm.description = options.style.description
  options.styleForm.prompt = options.style.prompt
  options.styleForm.negativePrompt = options.style.negativePrompt || ''
  options.styleForm.thumbnail = options.style.thumbnail || ''
  options.styleForm.isNew = options.style.isNew === true
  options.styleForm.isPro = options.style.isPro === true
  options.styleForm.enabled = options.enabledStyleIdSet.has(options.style.id)
  options.styleForm.setAsDefault = options.styleDefaultId === options.style.id
}

export function buildStyleFormPayload(styleForm: StyleFormState) {
  return {
    id: styleForm.id.trim() || undefined,
    name: styleForm.name.trim(),
    nameEn: styleForm.nameEn.trim() || null,
    category: styleForm.category,
    description: styleForm.description.trim(),
    prompt: styleForm.prompt.trim(),
    negativePrompt: styleForm.negativePrompt.trim() || null,
    thumbnail: styleForm.thumbnail.trim() || null,
    isNew: styleForm.isNew,
    isPro: styleForm.isPro,
    enabled: styleForm.enabled,
    setAsDefault: styleForm.setAsDefault
  }
}

export function buildStyleExportFileName(date = new Date()) {
  const dateTag = date.toISOString().slice(0, 10)
  return `style-presets-${dateTag}.json`
}

export async function fetchStylePresetConfig() {
  return await $fetch<StyleConfigResponse>('/api/styles/config')
}

export async function createStylePreset(payload: ReturnType<typeof buildStyleFormPayload>) {
  await $fetch('/api/styles/presets', {
    method: 'POST',
    body: payload
  })
}

export async function updateStylePreset(
  styleId: string,
  payload: ReturnType<typeof buildStyleFormPayload>
) {
  await $fetch(`/api/styles/presets/${styleId}`, {
    method: 'PUT',
    body: payload
  })
}

export async function deleteStylePresetRequest(styleId: string) {
  await $fetch(`/api/styles/presets/${styleId}`, {
    method: 'DELETE'
  })
}

export async function resetStylePresetCatalog() {
  await $fetch('/api/styles/presets/reset', {
    method: 'POST'
  })
}

export async function importStylePresetCatalog(payload: unknown) {
  await $fetch('/api/styles/presets/import', {
    method: 'POST',
    body: { payload }
  })
}

export async function exportStylePresetCatalog() {
  return await $fetch<StylePresetExportResponse>('/api/styles/presets/export')
}

export async function saveStylePresetConfig(options: {
  enabledStyleIds: string[]
  defaultStyleId: string | null
}) {
  return await $fetch<StyleConfigResponse>('/api/styles/config', {
    method: 'PUT',
    body: {
      enabledStyleIds: options.enabledStyleIds,
      defaultStyleId: options.defaultStyleId
    }
  })
}

export async function parseStylePresetImportFile(file: File) {
  const rawText = await file.text()
  return JSON.parse(rawText)
}

export function downloadStylePresetExport(payload: StylePresetExportPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = buildStyleExportFileName()
  anchor.click()

  URL.revokeObjectURL(url)
}

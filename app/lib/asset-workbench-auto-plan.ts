import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { resolveTimeOfDayText } from '#shared/types/script'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { buildSceneEnvironmentCrossSpaceNote } from '~/lib/asset-workbench-environment'
import {
  collectSceneCharacterCandidates,
  findCharacterByNameLike,
  getValidAssetIdSet,
  resolveCharacterRefsFromScene,
  resolvePropRefsFromScene,
  sceneHasSameLocation
} from '~/lib/asset-workbench-reference-detection'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'

interface ApplyAutomaticAssetPlanOptions {
  scenes: SceneData[]
  characters: CharacterData[]
  sceneConfigs: Record<string, SceneConsistencyConfig>
  propAssets: PropAsset[]
  environmentAssetIds: string[]
  overwriteExistingConfigs?: boolean
  resolveSceneEnvironmentAssetId: (scene: SceneData) => string
  resolveSceneDescriptionWithoutAssetMentions: (description?: string) => string
  createCharacterId?: () => string
}

function buildContinuityNotes(
  scene: SceneData,
  index: number,
  scenes: SceneData[],
  characters: CharacterData[],
  currentCharacterNames: string[]
): string {
  const previous = index > 0 ? scenes[index - 1] : undefined
  const notes: string[] = []

  if (previous) {
    const previousCharacters = new Set(
      resolveCharacterRefsFromScene({
        scene: previous,
        characters
      }).matchedCharacterNames.map(name => normalizeToken(name))
    )

    const sharedCharacters = currentCharacterNames.filter((name) => {
      const normalized = normalizeToken(name)
      return !!normalized && previousCharacters.has(normalized)
    })

    if (sharedCharacters.length > 0) {
      notes.push(`延续角色状态：${sharedCharacters.join('、')}`)
    }

    if (sceneHasSameLocation(scene, previous)) {
      notes.push(`地点延续：${scene.setting?.location || '同场景'}`)
    } else if (scene.setting?.location && previous.setting?.location) {
      notes.push(`地点切换：${previous.setting.location} -> ${scene.setting.location}`)
    }

    const previousTimeOfDay = resolveTimeOfDayText(previous.setting?.timeOfDay)
    const currentTimeOfDay = resolveTimeOfDayText(scene.setting?.timeOfDay)
    if (currentTimeOfDay && previousTimeOfDay && currentTimeOfDay !== previousTimeOfDay) {
      notes.push(`时间切换：${previousTimeOfDay} -> ${currentTimeOfDay}`)
    }
  }

  const crossSpaceNote = buildSceneEnvironmentCrossSpaceNote(scene, scenes)
  if (crossSpaceNote) {
    notes.push(crossSpaceNote)
  }

  if (notes.length === 0) {
    notes.push('保持角色外观与场景主视觉连续')
  }

  return notes.join('；')
}

function buildAutoSceneConfig(
  scene: SceneData,
  index: number,
  options: Omit<ApplyAutomaticAssetPlanOptions, 'sceneConfigs' | 'overwriteExistingConfigs' | 'environmentAssetIds' | 'createCharacterId'>
): SceneConsistencyConfig {
  const refs = new Set<string>([options.resolveSceneEnvironmentAssetId(scene)])

  const { refs: characterRefs, matchedCharacterNames } = resolveCharacterRefsFromScene({
    scene,
    characters: options.characters
  })
  for (const ref of characterRefs) refs.add(ref)

  const propRefs = resolvePropRefsFromScene({
    scene,
    propAssets: options.propAssets,
    resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions
  })
  for (const ref of propRefs) refs.add(ref)

  const previous = index > 0 ? options.scenes[index - 1] : undefined
  if (previous && sceneHasSameLocation(scene, previous)) {
    refs.add(options.resolveSceneEnvironmentAssetId(previous))
  }

  return {
    sceneId: scene.id,
    mustReferenceAssetIds: uniqueSorted(Array.from(refs)),
    consistencyLevel: characterRefs.length > 0 ? 'lock' : 'soft',
    continuityNotes: buildContinuityNotes(
      scene,
      index,
      options.scenes,
      options.characters,
      matchedCharacterNames
    )
  }
}

function createDefaultCharacterId(): string {
  return `char_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function upsertCharactersFromScenes(
  scenes: SceneData[],
  characters: CharacterData[],
  createCharacterId: () => string
): boolean {
  let changed = false

  for (const scene of scenes) {
    for (const candidate of collectSceneCharacterCandidates(scene)) {
      let matched: CharacterData | undefined
      for (const alias of candidate.aliases) {
        matched = findCharacterByNameLike(alias, characters)
        if (matched) break
      }

      if (matched) {
        if (!matched.appearance && candidate.appearance) {
          matched.appearance = candidate.appearance
          changed = true
        }
        continue
      }

      characters.push({
        id: createCharacterId(),
        name: candidate.primaryName,
        appearance: candidate.appearance || `${candidate.primaryName}，保持与剧情设定一致`,
        role: characters.length === 0 ? 'protagonist' : 'supporting',
        generating: false,
        generatingViews: false
      })
      changed = true
    }
  }

  return changed
}

function areSceneConfigsEqual(left: SceneConsistencyConfig, right: SceneConsistencyConfig): boolean {
  return left.sceneId === right.sceneId
    && left.consistencyLevel === right.consistencyLevel
    && left.continuityNotes.trim() === right.continuityNotes.trim()
    && left.mustReferenceAssetIds.join('||') === right.mustReferenceAssetIds.join('||')
}

export function applyAutomaticAssetPlan(
  options: ApplyAutomaticAssetPlanOptions
): {
  characterChanged: boolean
  configChanged: boolean
  nextSceneConfigs: Record<string, SceneConsistencyConfig>
} {
  const characterChanged = upsertCharactersFromScenes(
    options.scenes,
    options.characters,
    options.createCharacterId || createDefaultCharacterId
  )
  const validAssetIds = getValidAssetIdSet(
    options.characters,
    options.environmentAssetIds,
    options.propAssets
  )
  const nextSceneConfigs: Record<string, SceneConsistencyConfig> = {}
  let configChanged = false

  for (let index = 0; index < options.scenes.length; index += 1) {
    const scene = options.scenes[index]
    if (!scene) continue

    const autoConfig = buildAutoSceneConfig(scene, index, options)
    const existing = options.sceneConfigs[scene.id]

    const baseConfig: SceneConsistencyConfig = !existing || options.overwriteExistingConfigs
      ? autoConfig
      : {
          sceneId: scene.id,
          mustReferenceAssetIds: uniqueSorted([
            ...existing.mustReferenceAssetIds,
            ...autoConfig.mustReferenceAssetIds
          ]),
          consistencyLevel: existing.consistencyLevel === 'lock' || autoConfig.consistencyLevel === 'lock' ? 'lock' : 'soft',
          continuityNotes: existing.continuityNotes.trim() || autoConfig.continuityNotes
        }

    const normalizedConfig: SceneConsistencyConfig = {
      sceneId: baseConfig.sceneId,
      mustReferenceAssetIds: baseConfig.mustReferenceAssetIds.filter(assetId => validAssetIds.has(assetId)),
      consistencyLevel: baseConfig.consistencyLevel,
      continuityNotes: baseConfig.continuityNotes.trim()
    }

    if (
      normalizedConfig.consistencyLevel === 'lock'
      && normalizedConfig.mustReferenceAssetIds.length === 0
    ) {
      normalizedConfig.consistencyLevel = 'soft'
    }

    nextSceneConfigs[scene.id] = normalizedConfig
    if (!existing || !areSceneConfigsEqual(existing, normalizedConfig)) {
      configChanged = true
    }
  }

  if (Object.keys(options.sceneConfigs).length !== Object.keys(nextSceneConfigs).length) {
    configChanged = true
  }

  return {
    characterChanged,
    configChanged,
    nextSceneConfigs
  }
}

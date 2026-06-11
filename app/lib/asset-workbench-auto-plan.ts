import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { resolveTimeOfDayText } from '#shared/types/script'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { buildSceneEnvironmentCrossSpaceNote } from '~/lib/asset-workbench-environment'
import {
  collectSceneCharacterCandidates,
  findCharacterByNormalizedName,
  getValidAssetIdSet,
  resolveCharacterRefsFromScene,
  sceneHasSameLocation,
  type SceneCharacterCandidate
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

  const propRefMap = new Map(
    options.propAssets
      .map(prop => [normalizeToken(prop.name), `prop:${prop.id}`] as const)
      .filter(([key]) => !!key)
  )
  for (const sceneProp of scene.props || []) {
    const ref = propRefMap.get(normalizeToken(sceneProp.name))
    if (ref) refs.add(ref)
  }

  const previous = index > 0 ? options.scenes[index - 1] : undefined
  if (previous && sceneHasSameLocation(scene, previous)) {
    refs.add(options.resolveSceneEnvironmentAssetId(previous))
  }

  return {
    sceneId: scene.id,
    mustReferenceAssetIds: uniqueSorted(Array.from(refs)),
    consistencyLevel: characterRefs.length > 0 ? 'lock' : 'soft',
    usePreviousLastFrameAsFirstFrame: index > 0 && scene.usePreviousLastFrameAsFirstFrame === true,
    continuityLinkReason: scene.continuityLinkReason?.trim() || '',
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

const EXPLICIT_VARIANT_NAME_REGEX = /([\p{L}\p{N}]{1,12}形态)/u
const VARIANT_KEYWORD_RULES: Array<{ pattern: RegExp, variantName: string }> = [
  { pattern: /(废土|末日|荒野|破败|灾变|三百年后)/u, variantName: '废土形态' },
  { pattern: /(现代|都市|城市|公司|办公室|街|医院|学校|公寓|手机|汽车|卡车|烧烤)/u, variantName: '现代形态' },
  { pattern: /(古代|王朝|宫廷|江湖|修仙|仙门|宗门|灵力|剑修)/u, variantName: '古代形态' }
]

function buildCandidateVariantContext(scene: SceneData, candidate: SceneCharacterCandidate): string {
  return [
    candidate.appearance || '',
    candidate.context || '',
    scene.title || '',
    scene.description || '',
    scene.narration || '',
    scene.setting?.location || '',
    scene.setting?.era || '',
    scene.setting?.mood || ''
  ].join('\n')
}

function inferCharacterVariantName(scene: SceneData, candidate: SceneCharacterCandidate): string {
  const context = buildCandidateVariantContext(scene, candidate)
  const explicit = context.match(EXPLICIT_VARIANT_NAME_REGEX)?.[1]?.trim()
  if (explicit) return explicit

  for (const rule of VARIANT_KEYWORD_RULES) {
    if (rule.pattern.test(context)) return rule.variantName
  }

  return '场景形态'
}

function findCompoundParentForCandidate(
  candidate: SceneCharacterCandidate,
  characters: CharacterData[]
): CharacterData | undefined {
  const compoundKey = normalizeToken(candidate.compoundName)
  if (!compoundKey) return undefined

  return characters.find((character) => {
    if (character.parentCharacterId) return false
    return normalizeToken(character.name) === compoundKey
  })
}

function buildVariantCharacterName(candidate: SceneCharacterCandidate, variantName: string): string {
  return `${candidate.primaryName}-${variantName}`
}

function findExistingVariantCharacter(
  candidate: SceneCharacterCandidate,
  parent: CharacterData,
  variantName: string,
  characters: CharacterData[]
): CharacterData | undefined {
  const displayNameKey = normalizeToken(buildVariantCharacterName(candidate, variantName))
  const primaryKey = normalizeToken(candidate.primaryName)
  const variantKey = normalizeToken(variantName)

  return characters.find((character) => {
    if (character.parentCharacterId !== parent.id) return false

    const nameKey = normalizeToken(character.name)
    if (nameKey && nameKey === displayNameKey) return true

    const characterVariantKey = normalizeToken(character.variantName)
    return !!primaryKey
      && !!variantKey
      && nameKey.startsWith(primaryKey)
      && characterVariantKey === variantKey
  })
}

function findLegacyAliasCharacter(
  candidate: SceneCharacterCandidate,
  parent: CharacterData,
  characters: CharacterData[]
): CharacterData | undefined {
  const primaryKey = normalizeToken(candidate.primaryName)
  if (!primaryKey) return undefined

  return characters.find((character) => {
    if (character.id === parent.id || character.parentCharacterId) return false
    return normalizeToken(character.name) === primaryKey
  })
}

function applyCharacterVariantMetadata(
  character: CharacterData,
  parent: CharacterData,
  candidate: SceneCharacterCandidate,
  variantName: string
): boolean {
  let changed = false
  const displayName = buildVariantCharacterName(candidate, variantName)

  if (character.parentCharacterId !== parent.id) {
    character.parentCharacterId = parent.id
    changed = true
  }
  if (character.variantName !== variantName) {
    character.variantName = variantName
    changed = true
  }
  if (character.name !== displayName) {
    character.name = displayName
    changed = true
  }
  if (!character.appearance && candidate.appearance) {
    character.appearance = candidate.appearance
    changed = true
  }

  return changed
}

function buildVariantCharacter(
  parent: CharacterData,
  candidate: SceneCharacterCandidate,
  variantName: string,
  createCharacterId: () => string
): CharacterData {
  return {
    id: createCharacterId(),
    parentCharacterId: parent.id,
    variantName,
    name: buildVariantCharacterName(candidate, variantName),
    appearance: candidate.appearance
      || `${candidate.primaryName}的${variantName}，${parent.appearance || '保持与剧情设定一致'}`,
    role: parent.role || 'supporting',
    personality: parent.personality,
    traits: parent.traits ? [...parent.traits] : undefined,
    background: parent.background,
    motivation: parent.motivation,
    speakingStyle: parent.speakingStyle,
    catchphrase: parent.catchphrase,
    voiceTone: parent.voiceTone,
    age: parent.age,
    gender: parent.gender,
    generating: false,
    generatingViews: false
  }
}

function upsertCharactersFromScenes(
  scenes: SceneData[],
  characters: CharacterData[],
  createCharacterId: () => string
): boolean {
  let changed = false

  for (const scene of scenes) {
    for (const candidate of collectSceneCharacterCandidates(scene)) {
      const compoundParent = findCompoundParentForCandidate(candidate, characters)
      if (compoundParent) {
        const variantName = inferCharacterVariantName(scene, candidate)
        const existingVariant = findExistingVariantCharacter(
          candidate,
          compoundParent,
          variantName,
          characters
        )
        const legacyAlias = existingVariant
          ? undefined
          : findLegacyAliasCharacter(candidate, compoundParent, characters)
        const matchedVariant = existingVariant || legacyAlias

        if (matchedVariant) {
          changed = applyCharacterVariantMetadata(
            matchedVariant,
            compoundParent,
            candidate,
            variantName
          ) || changed
          if (!matchedVariant.appearance && candidate.appearance) {
            matchedVariant.appearance = candidate.appearance
            changed = true
          }
          continue
        }

        characters.push(buildVariantCharacter(
          compoundParent,
          candidate,
          variantName,
          createCharacterId
        ))
        changed = true
        continue
      }

      const matched = findCharacterByNormalizedName(candidate.primaryName, characters)

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
    && left.usePreviousLastFrameAsFirstFrame === right.usePreviousLastFrameAsFirstFrame
    && (left.continuityLinkReason || '').trim() === (right.continuityLinkReason || '').trim()
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
    options.propAssets.map(prop => prop.id)
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
          continuityNotes: existing.continuityNotes.trim() || autoConfig.continuityNotes,
          usePreviousLastFrameAsFirstFrame: existing.usePreviousLastFrameAsFirstFrame ?? autoConfig.usePreviousLastFrameAsFirstFrame,
          continuityLinkReason: existing.continuityLinkReason?.trim() || autoConfig.continuityLinkReason
        }

    const normalizedConfig: SceneConsistencyConfig = {
      sceneId: baseConfig.sceneId,
      mustReferenceAssetIds: baseConfig.mustReferenceAssetIds.filter(assetId => validAssetIds.has(assetId)),
      consistencyLevel: baseConfig.consistencyLevel,
      continuityNotes: baseConfig.continuityNotes.trim(),
      usePreviousLastFrameAsFirstFrame: index > 0 && baseConfig.usePreviousLastFrameAsFirstFrame === true,
      continuityLinkReason: baseConfig.continuityLinkReason?.trim() || ''
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

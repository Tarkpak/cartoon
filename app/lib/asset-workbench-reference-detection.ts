import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'

const NARRATION_SPEAKERS = [
  '旁白',
  'narration',
  'voiceover',
  '画外音',
  'os',
  'vo',
  '内心独白'
]

export interface SceneCharacterCandidate {
  primaryName: string
  aliases: string[]
  appearance?: string
}

interface ResolveCharacterRefsOptions {
  scene: SceneData
  characters: CharacterData[]
}

interface ResolvePropRefsOptions {
  scene: SceneData
  propAssets: PropAsset[]
  resolveSceneDescriptionWithoutAssetMentions: (description?: string) => string
}

function isNarrationSpeaker(name: string): boolean {
  const normalized = normalizeToken(name)
  if (!normalized) return true

  return NARRATION_SPEAKERS.some(speaker => normalizeToken(speaker) === normalized)
}

function splitCandidateNames(rawName?: string): string[] {
  if (!rawName) return []

  return uniqueSorted(
    rawName
      .split(/[/／|｜、,，\s]+/g)
      .map(name => name.trim())
      .filter(Boolean)
  )
}

function createSceneCharacterCandidate(
  rawName?: string,
  appearance?: string
): SceneCharacterCandidate | null {
  const aliases = splitCandidateNames(rawName).filter(name => !isNarrationSpeaker(name))
  if (aliases.length === 0) return null

  return {
    primaryName: aliases[0] || rawName || '未命名角色',
    aliases,
    appearance: appearance?.trim() || undefined
  }
}

export function findCharacterByNameLike(
  name: string,
  characters: CharacterData[]
): CharacterData | undefined {
  const normalized = normalizeToken(name)
  if (!normalized) return undefined

  let fuzzyMatch: CharacterData | undefined
  for (const character of characters) {
    const target = normalizeToken(character.name)
    if (!target) continue

    if (target === normalized) {
      return character
    }

    if (!fuzzyMatch && (target.includes(normalized) || normalized.includes(target))) {
      fuzzyMatch = character
    }
  }

  return fuzzyMatch
}

export function collectSceneCharacterCandidates(scene: SceneData): SceneCharacterCandidate[] {
  const map = new Map<string, SceneCharacterCandidate>()

  for (const sceneCharacter of scene.characters) {
    const candidate = createSceneCharacterCandidate(sceneCharacter.name, sceneCharacter.appearance)
    if (!candidate) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key) continue

    const existing = map.get(key)
    if (existing) {
      existing.aliases = uniqueSorted([...existing.aliases, ...candidate.aliases])
      if (!existing.appearance && candidate.appearance) {
        existing.appearance = candidate.appearance
      }
      continue
    }

    map.set(key, candidate)
  }

  for (const dialogue of scene.dialogues) {
    const candidate = createSceneCharacterCandidate(dialogue.character)
    if (!candidate) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key || map.has(key)) continue
    map.set(key, candidate)
  }

  return Array.from(map.values())
}

function getSceneText(
  scene: SceneData,
  resolveSceneDescriptionWithoutAssetMentions: ResolvePropRefsOptions['resolveSceneDescriptionWithoutAssetMentions']
): string {
  return [
    scene.title || '',
    resolveSceneDescriptionWithoutAssetMentions(scene.description),
    scene.narration || '',
    scene.dialogues.map(item => `${item.character}:${item.text}`).join('\n')
  ]
    .join('\n')
    .toLowerCase()
}

export function getValidAssetIdSet(
  characters: CharacterData[],
  environmentAssetIds: string[],
  propAssets: PropAsset[]
): Set<string> {
  return new Set([
    ...characters.map(character => `char:${character.id}`),
    ...environmentAssetIds,
    ...propAssets.map(prop => `prop:${prop.id}`)
  ])
}

export function resolveCharacterRefsFromScene(
  options: ResolveCharacterRefsOptions
): { refs: string[], matchedCharacterNames: string[] } {
  const refs = new Set<string>()
  const matchedCharacterNames = new Set<string>()

  const candidates = collectSceneCharacterCandidates(options.scene)
  for (const candidate of candidates) {
    let matched: CharacterData | undefined

    for (const alias of candidate.aliases) {
      matched = findCharacterByNameLike(alias, options.characters)
      if (matched) break
    }

    if (!matched) {
      matched = findCharacterByNameLike(candidate.primaryName, options.characters)
    }

    if (!matched) continue

    refs.add(`char:${matched.id}`)
    matchedCharacterNames.add(matched.name)
  }

  return {
    refs: Array.from(refs),
    matchedCharacterNames: Array.from(matchedCharacterNames)
  }
}

export function resolvePropRefsFromScene(options: ResolvePropRefsOptions): string[] {
  if (options.propAssets.length === 0) return []

  const sceneText = getSceneText(
    options.scene,
    options.resolveSceneDescriptionWithoutAssetMentions
  )

  return options.propAssets
    .filter((prop) => {
      const name = prop.name.trim().toLowerCase()
      if (name.length < 2) return false
      return sceneText.includes(name)
    })
    .map(prop => `prop:${prop.id}`)
}

export function sceneHasSameLocation(currentScene: SceneData, previousScene?: SceneData): boolean {
  if (!previousScene) return false
  const current = normalizeToken(currentScene.setting?.location)
  const previous = normalizeToken(previousScene.setting?.location)
  return !!current && current === previous
}

import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
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

function isNarrationSpeaker(name: string): boolean {
  const normalized = normalizeToken(name)
  if (!normalized) return true

  return NARRATION_SPEAKERS.some(speaker => normalizeToken(speaker) === normalized)
}

function splitCandidateNames(rawName?: string): string[] {
  if (!rawName) return []

  const normalizedRaw = (rawName
    .split(/[:：]/u)[0] || '')
    .replace(/[（(][^）)]*[）)]/gu, ' ')
    .trim()

  return uniqueSorted(
    normalizedRaw
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

export function findCharacterByNormalizedName(
  name: string,
  characters: CharacterData[]
): CharacterData | undefined {
  const normalized = normalizeToken(name)
  if (!normalized) return undefined

  for (const character of characters) {
    const target = normalizeToken(character.name)
    if (!target) continue

    if (target === normalized) {
      return character
    }
  }

  return undefined
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

  return Array.from(map.values())
}

export function getValidAssetIdSet(
  characters: CharacterData[],
  environmentAssetIds: string[],
  propAssets: Array<string | { id: string }>
): Set<string> {
  return new Set([
    ...characters.map(character => `char:${character.id}`),
    ...environmentAssetIds,
    ...propAssets.map(prop => `prop:${typeof prop === 'string' ? prop : prop.id}`)
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
      matched = findCharacterByNormalizedName(alias, options.characters)
      if (matched) break
    }

    if (!matched) {
      matched = findCharacterByNormalizedName(candidate.primaryName, options.characters)
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

export function sceneHasSameLocation(currentScene: SceneData, previousScene?: SceneData): boolean {
  if (!previousScene) return false
  const current = normalizeToken(currentScene.setting?.location)
  const previous = normalizeToken(previousScene.setting?.location)
  return !!current && current === previous
}

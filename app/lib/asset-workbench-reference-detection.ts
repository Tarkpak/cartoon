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
  compoundName?: string
  context?: string
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

  const seen = new Set<string>()
  const names: string[] = []
  for (const name of normalizedRaw
    .split(/[/／|｜、,，\s]+/g)
    .map(item => item.trim())
    .filter(Boolean)
  ) {
    const key = normalizeToken(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }

  return names
}

function normalizeCompoundCharacterName(rawName?: string): string {
  return (rawName || '')
    .split(/[:：]/u)[0]
    .replace(/[（(][^）)]*[）)]/gu, ' ')
    .trim()
}

function countNormalizedOccurrences(context: string, name: string): number {
  const normalizedContext = normalizeToken(context)
  const normalizedName = normalizeToken(name)
  if (!normalizedContext || !normalizedName) return 0

  let count = 0
  let index = normalizedContext.indexOf(normalizedName)
  while (index >= 0) {
    count += 1
    index = normalizedContext.indexOf(normalizedName, index + normalizedName.length)
  }
  return count
}

function selectPrimaryAlias(aliases: string[], context?: string): string {
  let primary = aliases[0] || ''
  let bestScore = 0

  for (const alias of aliases) {
    const score = countNormalizedOccurrences(context || '', alias)
    if (score > bestScore) {
      primary = alias
      bestScore = score
    }
  }

  return primary
}

function buildCandidateAliases(
  primaryName: string,
  aliases: string[],
  rawName?: string
): string[] {
  const compoundName = normalizeCompoundCharacterName(rawName)
  const values = [
    primaryName,
    ...aliases,
    aliases.length > 1 ? compoundName : ''
  ]
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const name = value.trim()
    const key = normalizeToken(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }

  return result
}

function createSceneCharacterCandidate(
  rawName?: string,
  appearance?: string,
  context?: string
): SceneCharacterCandidate | null {
  const aliases = splitCandidateNames(rawName).filter(name => !isNarrationSpeaker(name))
  if (aliases.length === 0) return null
  const primaryName = selectPrimaryAlias(aliases, context)
  const compoundName = aliases.length > 1 ? normalizeCompoundCharacterName(rawName) : ''

  return {
    primaryName: primaryName || rawName || '未命名角色',
    aliases: buildCandidateAliases(primaryName, aliases, rawName),
    appearance: appearance?.trim() || undefined,
    compoundName: compoundName || undefined,
    context: context?.trim() || undefined
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
  const sceneContext = [
    scene.title || '',
    scene.description || '',
    scene.narration || ''
  ].join('\n')

  for (const sceneCharacter of scene.characters) {
    const candidate = createSceneCharacterCandidate(
      sceneCharacter.name,
      sceneCharacter.appearance,
      [sceneCharacter.appearance || '', sceneContext].join('\n')
    )
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

function findCompoundParentForCandidate(
  candidate: SceneCharacterCandidate,
  characters: CharacterData[]
): CharacterData | undefined {
  if (!candidate.compoundName) return undefined
  const compoundKey = normalizeToken(candidate.compoundName)
  if (!compoundKey) return undefined

  return characters.find((character) => {
    if (character.parentCharacterId) return false
    return normalizeToken(character.name) === compoundKey
  })
}

function scoreCharacterVariantForCandidate(
  candidate: SceneCharacterCandidate,
  variant: CharacterData
): number {
  const context = candidate.context || candidate.appearance || ''
  let score = 0

  if (variant.variantName) {
    score += countNormalizedOccurrences(context, variant.variantName) * 4
  }
  score += countNormalizedOccurrences(context, variant.name) * 2

  const candidateAppearance = normalizeToken(candidate.appearance)
  const variantAppearance = normalizeToken(variant.appearance)
  if (candidateAppearance && variantAppearance) {
    if (candidateAppearance === variantAppearance) {
      score += 8
    } else if (
      candidateAppearance.includes(variantAppearance)
      || variantAppearance.includes(candidateAppearance)
    ) {
      score += 4
    }
  }

  return score
}

function findCharacterVariantForCandidate(
  candidate: SceneCharacterCandidate,
  characters: CharacterData[]
): CharacterData | undefined {
  const parent = findCompoundParentForCandidate(candidate, characters)
  if (!parent) return undefined

  const primaryKey = normalizeToken(candidate.primaryName)
  if (!primaryKey) return undefined

  const variants = characters.filter((character) => {
    if (character.parentCharacterId !== parent.id) return false
    const nameKey = normalizeToken(character.name)
    return !!nameKey && nameKey.startsWith(primaryKey)
  })
  if (variants.length === 0) return undefined
  if (variants.length === 1) return variants[0]

  const scored = variants
    .map(character => ({
      character,
      score: scoreCharacterVariantForCandidate(candidate, character)
    }))
    .sort((left, right) => right.score - left.score)

  const best = scored[0]
  if (!best || best.score <= 0) return undefined
  return best.character
}

export function resolveCharacterRefsFromScene(
  options: ResolveCharacterRefsOptions
): { refs: string[], matchedCharacterNames: string[] } {
  const refs = new Set<string>()
  const matchedCharacterNames = new Set<string>()

  const candidates = collectSceneCharacterCandidates(options.scene)
  for (const candidate of candidates) {
    let matched: CharacterData | undefined = findCharacterVariantForCandidate(
      candidate,
      options.characters
    )

    if (!matched) {
      for (const alias of candidate.aliases) {
        matched = findCharacterByNormalizedName(alias, options.characters)
        if (matched) break
      }
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

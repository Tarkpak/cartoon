import { randomUUID } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db, characters as charactersTable, scenes as scenesTable, scripts as scriptsTable } from '../db'
import type { CharacterVoiceAsset } from '../../shared/types/character'
import type { VideoGenerationConfig } from '../../shared/types/video'
import { normalizeProjectVideoUrl } from '../../shared/utils/video-url'
import type { AsrDataSegment } from './asr'
import { transcribeFileOnline } from './asr'
import { persistAudioFileToCloud } from './audio-storage'
import { clipAudioSegment, extractAudioTrack, getVideoInfo } from './ffmpeg'
import { extractSceneDialoguesFromDescription } from './scene-dialogue'

type SceneDialogue = {
  character: string
  text: string
}

type CharacterRecordLike = Pick<typeof charactersTable.$inferSelect, 'id' | 'name' | 'voiceAsset'>

type LoadedSceneContext = {
  sceneId: string
  projectId: string | null
  dialogues: SceneDialogue[]
  characters: CharacterRecordLike[]
}

type DialogueMatch = {
  characterId: string
  characterName: string
  transcript: string
  expectedText: string
  matchScore: number
  startTimeMs: number
  endTimeMs: number
  durationMs: number
}

type VoiceReferenceCandidate = {
  characterId: string
  characterName: string
  voiceAsset: CharacterVoiceAsset
}

const MATCH_SEARCH_WINDOW = 6
const MAX_GROUP_SEGMENTS = 3
const MIN_CLIP_DURATION_MS = 1_800
const MAX_CLIP_DURATION_MS = 15_000
const MATCH_PADDING_START_MS = 120
const MATCH_PADDING_END_MS = 180

function normalizeSpeakerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’\-_.:：]/g, '')
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function safeJsonParse<T>(rawValue?: string | null): T | null {
  if (!rawValue?.trim()) return null

  try {
    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function parseCharacterVoiceAsset(rawValue?: string | null): CharacterVoiceAsset | null {
  return safeJsonParse<CharacterVoiceAsset>(rawValue)
}

async function loadSceneContext(sceneId: string): Promise<LoadedSceneContext | null> {
  if (!sceneId) return null

  const scene = await db.select().from(scenesTable).where(eq(scenesTable.id, sceneId)).get()
  if (!scene) return null

  const script = scene.scriptId
    ? await db.select().from(scriptsTable).where(eq(scriptsTable.id, scene.scriptId)).get()
    : null

  const dialogues = extractSceneDialoguesFromDescription(scene.description || '')

  const projectCharacters = script?.projectId
    ? await db.select().from(charactersTable).where(eq(charactersTable.projectId, script.projectId)).all()
    : []

  return {
    sceneId: scene.id,
    projectId: script?.projectId || null,
    dialogues,
    characters: projectCharacters
  }
}

function resolveCharacterRecordByName(
  speakerName: string,
  projectCharacters: CharacterRecordLike[]
): CharacterRecordLike | null {
  const normalizedSpeaker = normalizeSpeakerName(speakerName)
  if (!normalizedSpeaker) return null

  const exact = projectCharacters.find(item => normalizeSpeakerName(item.name) === normalizedSpeaker)
  if (exact) return exact

  return projectCharacters.find((item) => {
    const normalizedName = normalizeSpeakerName(item.name)
    return normalizedName.includes(normalizedSpeaker) || normalizedSpeaker.includes(normalizedName)
  }) || null
}

function listSceneVoiceReferenceCandidates(context: LoadedSceneContext): VoiceReferenceCandidate[] {
  const seen = new Set<string>()
  const candidates: VoiceReferenceCandidate[] = []

  for (const dialogue of context.dialogues) {
    const character = resolveCharacterRecordByName(dialogue.character, context.characters)
    if (!character || seen.has(character.id)) continue

    const voiceAsset = parseCharacterVoiceAsset(character.voiceAsset)
    if (!voiceAsset?.audioUrl) continue

    seen.add(character.id)
    candidates.push({
      characterId: character.id,
      characterName: character.name,
      voiceAsset
    })
  }

  return candidates
}

function resolveSingleSpeakerVoiceReference(context: LoadedSceneContext): VoiceReferenceCandidate | null {
  const uniqueSpeakerNames = Array.from(new Set(
    context.dialogues
      .map(item => normalizeSpeakerName(item.character))
      .filter(Boolean)
  ))

  if (uniqueSpeakerNames.length !== 1) return null

  const [onlySpeaker] = uniqueSpeakerNames
  if (!onlySpeaker) return null

  const character = resolveCharacterRecordByName(onlySpeaker, context.characters)
  if (!character) return null

  const voiceAsset = parseCharacterVoiceAsset(character.voiceAsset)
  if (!voiceAsset?.audioUrl) return null

  return {
    characterId: character.id,
    characterName: character.name,
    voiceAsset
  }
}

function pickPriorityVoiceCandidate(candidates: VoiceReferenceCandidate[]): VoiceReferenceCandidate | null {
  if (candidates.length === 0) return null
  const lockedCandidate = candidates.find(item => item.voiceAsset.locked === true)
  return lockedCandidate || candidates[0] || null
}

function resolvePreferredVoiceReference(options: {
  context: LoadedSceneContext
  candidates: VoiceReferenceCandidate[]
  allowMultiCandidateFallback?: boolean
}): VoiceReferenceCandidate | null {
  if (options.candidates.length === 1) {
    return options.candidates[0] || null
  }

  if (options.allowMultiCandidateFallback && options.candidates.length > 1) {
    return pickPriorityVoiceCandidate(options.candidates)
  }

  return resolveSingleSpeakerVoiceReference(options.context)
}

export async function enrichVideoConfigWithCharacterVoiceReference(options: {
  sceneId: string
  config: VideoGenerationConfig
  modelProvider?: string | null
  supportsExplicitAudioReference?: boolean
}): Promise<VideoGenerationConfig> {
  const context = await loadSceneContext(options.sceneId)
  if (!context || context.dialogues.length === 0) return options.config

  const candidates = listSceneVoiceReferenceCandidates(context)
  if (candidates.length === 0) return options.config

  const nextConfig: VideoGenerationConfig = { ...options.config }

  const canInjectAudioReference = options.supportsExplicitAudioReference || options.modelProvider === 'qwen'
  if (canInjectAudioReference && !nextConfig.audioUrl) {
    const allowMultiCandidateFallback = options.modelProvider === 'kling'
      && options.supportsExplicitAudioReference === true
    const preferredReference = resolvePreferredVoiceReference({
      context,
      candidates,
      allowMultiCandidateFallback
    })
    if (preferredReference?.voiceAsset.audioUrl) {
      nextConfig.audioUrl = preferredReference.voiceAsset.audioUrl
      console.log('[VoiceAsset] 已注入场景音频参考:', {
        sceneId: options.sceneId,
        candidateCount: candidates.length,
        characterId: preferredReference.characterId,
        characterName: preferredReference.characterName,
        usedMultiCandidateFallback: allowMultiCandidateFallback && candidates.length > 1
      })
    } else {
      console.log('[VoiceAsset] 未注入场景音频参考（候选角色不唯一）:', {
        sceneId: options.sceneId,
        candidateCount: candidates.length
      })
    }
  }

  return nextConfig
}

function lcsLength(left: string, right: string): number {
  if (!left || !right) return 0

  const prev = new Uint16Array(right.length + 1)
  const next = new Uint16Array(right.length + 1)

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left.charCodeAt(i - 1) === right.charCodeAt(j - 1)) {
        next[j] = (prev[j - 1] ?? 0) + 1
      } else {
        next[j] = Math.max(next[j - 1] || 0, prev[j] || 0)
      }
    }

    prev.set(next)
    next.fill(0)
  }

  return prev[right.length] || 0
}

function calculateTranscriptMatchScore(expectedText: string, actualText: string): number {
  const expected = normalizeComparableText(expectedText)
  const actual = normalizeComparableText(actualText)
  if (!expected || !actual) return 0
  if (expected === actual) return 1

  const shorter = expected.length < actual.length ? expected : actual
  const longer = expected.length < actual.length ? actual : expected
  if (longer.includes(shorter)) {
    return shorter.length / longer.length
  }

  const common = lcsLength(expected, actual)
  return (2 * common) / (expected.length + actual.length)
}

function resolveMatchThreshold(expectedText: string): number {
  const normalized = normalizeComparableText(expectedText)
  if (normalized.length <= 4) return 0.34
  if (normalized.length <= 8) return 0.42
  return 0.48
}

function matchDialoguesToAsrSegments(context: LoadedSceneContext, segments: AsrDataSegment[]): DialogueMatch[] {
  const results: DialogueMatch[] = []
  let cursor = 0

  for (const dialogue of context.dialogues) {
    const character = resolveCharacterRecordByName(dialogue.character, context.characters)
    if (!character) continue

    const threshold = resolveMatchThreshold(dialogue.text)
    let bestMatch: {
      startIndex: number
      endIndex: number
      transcript: string
      score: number
    } | null = null

    const maxStart = Math.min(segments.length - 1, cursor + MATCH_SEARCH_WINDOW)

    for (let startIndex = cursor; startIndex <= maxStart; startIndex += 1) {
      let combinedTranscript = ''

      for (
        let endIndex = startIndex;
        endIndex < segments.length && endIndex < startIndex + MAX_GROUP_SEGMENTS;
        endIndex += 1
      ) {
        const segment = segments[endIndex]
        if (!segment) continue

        combinedTranscript += segment.transcript
        const score = calculateTranscriptMatchScore(dialogue.text, combinedTranscript)

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            startIndex,
            endIndex,
            transcript: combinedTranscript,
            score
          }
        }
      }
    }

    if (!bestMatch || bestMatch.score < threshold) continue

    const startSegment = segments[bestMatch.startIndex]
    const endSegment = segments[bestMatch.endIndex]
    if (!startSegment || !endSegment) continue

    const startTimeMs = Math.max(0, startSegment.start_time - MATCH_PADDING_START_MS)
    const endTimeMs = endSegment.end_time + MATCH_PADDING_END_MS
    const durationMs = endTimeMs - startTimeMs
    if (durationMs <= MIN_CLIP_DURATION_MS || durationMs > MAX_CLIP_DURATION_MS) continue

    results.push({
      characterId: character.id,
      characterName: character.name,
      transcript: bestMatch.transcript,
      expectedText: dialogue.text,
      matchScore: bestMatch.score,
      startTimeMs,
      endTimeMs,
      durationMs
    })

    cursor = bestMatch.endIndex + 1
  }

  return results
}

function pickBestVoiceMatches(matches: DialogueMatch[]): DialogueMatch[] {
  const bestByCharacter = new Map<string, DialogueMatch>()

  for (const match of matches) {
    const previous = bestByCharacter.get(match.characterId)
    if (!previous) {
      bestByCharacter.set(match.characterId, match)
      continue
    }

    const previousWeight = previous.matchScore + Math.min(previous.durationMs / 8_000, 1) * 0.1
    const nextWeight = match.matchScore + Math.min(match.durationMs / 8_000, 1) * 0.1
    if (nextWeight > previousWeight) {
      bestByCharacter.set(match.characterId, match)
    }
  }

  return Array.from(bestByCharacter.values())
}

function shouldReplaceVoiceAsset(existing: CharacterVoiceAsset | null, next: CharacterVoiceAsset): boolean {
  if (!existing?.audioUrl) return true
  if (existing.locked) return false

  const existingScore = existing.matchScore ?? 0
  const nextScore = next.matchScore ?? 0
  const existingDuration = existing.durationMs ?? 0
  const nextDuration = next.durationMs ?? 0

  if (nextScore >= existingScore + 0.12) return true
  if (nextDuration >= Math.max(existingDuration * 1.2, existingDuration + 1_200) && nextScore >= existingScore - 0.05) {
    return true
  }

  return false
}

async function ensureFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveVideoFilePath(options: {
  tempDir: string
  remoteVideoUrl?: string
  persistedVideoData?: string
}): Promise<string | null> {
  const sourceUrl = options.remoteVideoUrl?.trim() || normalizeProjectVideoUrl(options.persistedVideoData)
  if (!sourceUrl) return null

  if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
    const response = await fetch(sourceUrl)
    if (!response.ok) {
      throw new Error(`下载视频失败: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const filePath = join(options.tempDir, 'source.mp4')
    await writeFile(filePath, buffer)
    return filePath
  }

  if (sourceUrl.startsWith('/api/video/file/')) {
    const filename = decodeURIComponent(sourceUrl.slice('/api/video/file/'.length))
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return null
    }

    const candidates = [
      join(process.cwd(), 'public', 'videos', filename),
      join(process.cwd(), '.output', 'public', 'videos', filename)
    ]
    for (const candidate of candidates) {
      if (await ensureFileExists(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function createVoiceAssetPayload(options: {
  audioUrl: string
  sceneId: string
  taskId: string
  match: DialogueMatch
}): CharacterVoiceAsset {
  return {
    audioUrl: options.audioUrl,
    locked: false,
    transcript: options.match.transcript,
    sourceSceneId: options.sceneId,
    sourceTaskId: options.taskId,
    startTimeMs: options.match.startTimeMs,
    endTimeMs: options.match.endTimeMs,
    durationMs: options.match.durationMs,
    matchScore: Number(options.match.matchScore.toFixed(4)),
    updatedAt: new Date().toISOString()
  }
}

function resolvePersistedAutoVoiceAsset(
  existing: CharacterVoiceAsset | null,
  next: CharacterVoiceAsset
): CharacterVoiceAsset {
  const isFirstAutoVoiceAsset = !existing?.audioUrl
  return {
    ...next,
    locked: isFirstAutoVoiceAsset ? true : next.locked === true
  }
}

async function applyVoiceAssetToCharacter(options: {
  characterId: string
  nextVoiceAsset: CharacterVoiceAsset
}): Promise<boolean> {
  const character = await db.select().from(charactersTable).where(eq(charactersTable.id, options.characterId)).get()
  if (!character) return false

  const existingVoiceAsset = parseCharacterVoiceAsset(character.voiceAsset)
  if (!shouldReplaceVoiceAsset(existingVoiceAsset, options.nextVoiceAsset)) {
    return false
  }
  const persistedVoiceAsset = resolvePersistedAutoVoiceAsset(existingVoiceAsset, options.nextVoiceAsset)

  await db.update(charactersTable)
    .set({
      voiceAsset: JSON.stringify(persistedVoiceAsset),
      updatedAt: new Date().toISOString()
    })
    .where(eq(charactersTable.id, options.characterId))

  return true
}

export async function extractCharacterVoiceAssetsFromSceneVideo(options: {
  sceneId: string
  taskId: string
  remoteVideoUrl?: string
  persistedVideoData?: string
}): Promise<void> {
  const context = await loadSceneContext(options.sceneId)
  if (!context || context.dialogues.length === 0) return

  const tempDir = join(
    process.cwd(),
    'data',
    'tmp',
    'voice-assets',
    `${options.taskId}_${Date.now()}_${randomUUID().slice(0, 8)}`
  )

  await mkdir(tempDir, { recursive: true })

  try {
    const videoPath = await resolveVideoFilePath({
      tempDir,
      remoteVideoUrl: options.remoteVideoUrl,
      persistedVideoData: options.persistedVideoData
    })
    if (!videoPath) return

    const videoInfo = await getVideoInfo(videoPath).catch(() => null)
    if (!videoInfo?.hasAudio) return

    const audioPath = join(tempDir, 'source.mp3')
    await extractAudioTrack(videoPath, audioPath)

    const transcription = await transcribeFileOnline(audioPath, {
      useCache: true,
      pollIntervalMs: 2_000,
      timeoutMs: 300_000
    })
    if (!transcription.segments.length) return

    const matchedDialogues = matchDialoguesToAsrSegments(context, transcription.segments)
    const bestMatches = pickBestVoiceMatches(matchedDialogues)
    if (bestMatches.length === 0) return

    for (const match of bestMatches) {
      const clippedPath = join(tempDir, `${match.characterId}.mp3`)
      await clipAudioSegment(
        audioPath,
        clippedPath,
        match.startTimeMs / 1_000,
        match.endTimeMs / 1_000
      )

      const audioUrl = await persistAudioFileToCloud({
        filePath: clippedPath,
        prefix: `voice_${match.characterName}_${options.sceneId}`
      })

      const nextVoiceAsset = createVoiceAssetPayload({
        audioUrl,
        sceneId: options.sceneId,
        taskId: options.taskId,
        match
      })

      const applied = await applyVoiceAssetToCharacter({
        characterId: match.characterId,
        nextVoiceAsset
      })

      if (applied) {
        console.log(`[VoiceAsset] 已更新角色声音资产: ${match.characterName} (${match.matchScore.toFixed(3)})`)
      }
    }
  } catch (error) {
    console.warn('[VoiceAsset] 场景角色声音资产提取失败:', {
      sceneId: options.sceneId,
      taskId: options.taskId,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export const __testUtils = {
  pickPriorityVoiceCandidate,
  resolvePreferredVoiceReference,
  resolveSingleSpeakerVoiceReference,
  calculateTranscriptMatchScore,
  matchDialoguesToAsrSegments,
  pickBestVoiceMatches,
  shouldReplaceVoiceAsset,
  resolvePersistedAutoVoiceAsset
}

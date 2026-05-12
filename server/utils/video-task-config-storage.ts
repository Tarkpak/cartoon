import type { GenerateVideoRequest } from '../../shared/types/video'
import { persistImageToPublic } from './image-storage'
import { persistAudioSourceToCloud } from './audio-storage'

export type VideoTaskConfig = GenerateVideoRequest['config']

type MediaPersistOptions = {
  source: string
  prefix: string
}

export type VideoTaskConfigMediaPersister = {
  persistImageSource: (options: MediaPersistOptions) => Promise<string>
  persistAudioSource: (options: MediaPersistOptions) => Promise<string>
}

const defaultMediaPersister: VideoTaskConfigMediaPersister = {
  async persistImageSource(options) {
    return await persistImageToPublic({
      source: options.source,
      prefix: options.prefix
    })
  },
  async persistAudioSource(options) {
    return await persistAudioSourceToCloud({
      source: options.source,
      prefix: options.prefix,
      category: 'voice-assets'
    })
  }
}

function toNonEmptyString(value?: string | null): string | undefined {
  const raw = value?.trim()
  return raw || undefined
}

function toSafePrefix(taskId: string, suffix: string): string {
  const safeTaskId = taskId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `video_task_${safeTaskId || 'unknown'}_${suffix}`
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export async function normalizeVideoTaskConfigForStorage(options: {
  taskId: string
  config: VideoTaskConfig
  mediaPersister?: Partial<VideoTaskConfigMediaPersister>
}): Promise<VideoTaskConfig> {
  const mediaPersister: VideoTaskConfigMediaPersister = {
    ...defaultMediaPersister,
    ...(options.mediaPersister || {})
  }

  const imageCache = new Map<string, string>()
  const audioCache = new Map<string, string>()

  const persistImageInput = async (source: string | undefined, suffix: string): Promise<string | undefined> => {
    const raw = toNonEmptyString(source)
    if (!raw) return undefined
    if (isHttpUrl(raw)) return raw

    const cached = imageCache.get(raw)
    if (cached) return cached

    const cloudUrl = await mediaPersister.persistImageSource({
      source: raw,
      prefix: toSafePrefix(options.taskId, suffix)
    })
    imageCache.set(raw, cloudUrl)
    return cloudUrl
  }

  const persistAudioInput = async (source: string | undefined, suffix: string): Promise<string | undefined> => {
    const raw = toNonEmptyString(source)
    if (!raw) return undefined
    if (isHttpUrl(raw)) return raw

    const cached = audioCache.get(raw)
    if (cached) return cached

    const cloudUrl = await mediaPersister.persistAudioSource({
      source: raw,
      prefix: toSafePrefix(options.taskId, suffix)
    })
    audioCache.set(raw, cloudUrl)
    return cloudUrl
  }

  const persistedReferenceImages: string[] = []
  const referenceImageSet = new Set<string>()

  for (const input of Array.isArray(options.config.referenceImages) ? options.config.referenceImages : []) {
    const cloudUrl = await persistImageInput(input, 'reference')
    if (!cloudUrl || referenceImageSet.has(cloudUrl)) continue
    referenceImageSet.add(cloudUrl)
    persistedReferenceImages.push(cloudUrl)
  }

  return {
    ...options.config,
    imageUrl: await persistImageInput(options.config.imageUrl, 'image'),
    firstFrame: await persistImageInput(options.config.firstFrame, 'first_frame'),
    lastFrame: await persistImageInput(options.config.lastFrame, 'last_frame'),
    referenceImages: persistedReferenceImages.length > 0 ? persistedReferenceImages : undefined,
    audioUrl: await persistAudioInput(options.config.audioUrl, 'audio')
  }
}

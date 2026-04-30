import type { AspectRatio, Resolution } from '../../shared/types/video'

export type UpstreamVideoProvider = 'qwen' | 'kling' | 'volcengine' | 'gemini'

export interface UpstreamVideoResultMetadata {
  duration: number
  resolution: Resolution
  aspectRatio: AspectRatio
  fps: number
  hasAudio: boolean
  lastFrame?: string
}

export interface UpstreamVideoTaskTracking {
  provider: UpstreamVideoProvider
  taskId?: string
  operationName?: string
  endpoint?: string
  modelId?: string
  timedOutAt?: string
  lastKnownStatus?: string
  resultMetadata: UpstreamVideoResultMetadata
}

export interface VideoTaskMetadataEnvelope {
  upstreamTask?: UpstreamVideoTaskTracking
  [key: string]: unknown
}

export function parseVideoTaskMetadata(raw?: string | null): VideoTaskMetadataEnvelope {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as VideoTaskMetadataEnvelope
  } catch {
    return {}
  }
}

export function stringifyVideoTaskMetadata(metadata: VideoTaskMetadataEnvelope): string | null {
  const entries = Object.entries(metadata).filter(([_, value]) => value !== undefined)
  if (entries.length === 0) return null
  return JSON.stringify(Object.fromEntries(entries))
}

export function setUpstreamVideoTaskMetadata(
  raw: string | null | undefined,
  upstreamTask: UpstreamVideoTaskTracking
): string {
  const metadata = parseVideoTaskMetadata(raw)
  metadata.upstreamTask = upstreamTask
  return stringifyVideoTaskMetadata(metadata) || '{}'
}

export function patchUpstreamVideoTaskMetadata(
  raw: string | null | undefined,
  patch: Partial<UpstreamVideoTaskTracking>
): string {
  const metadata = parseVideoTaskMetadata(raw)
  if (!metadata.upstreamTask) {
    throw new Error('缺少 upstreamTask，无法更新任务跟踪信息')
  }

  metadata.upstreamTask = {
    ...metadata.upstreamTask,
    ...patch,
    resultMetadata: patch.resultMetadata || metadata.upstreamTask.resultMetadata
  }

  return stringifyVideoTaskMetadata(metadata) || '{}'
}

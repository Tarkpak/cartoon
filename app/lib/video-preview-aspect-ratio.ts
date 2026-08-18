export interface VideoPreviewAspectRatio {
  cssValue: string
  portrait: boolean
}

const DEFAULT_VIDEO_PREVIEW_ASPECT_RATIO: VideoPreviewAspectRatio = {
  cssValue: '16 / 9',
  portrait: false
}

export function resolveVideoPreviewAspectRatio(value: unknown): VideoPreviewAspectRatio {
  if (typeof value !== 'string') return DEFAULT_VIDEO_PREVIEW_ASPECT_RATIO

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!match?.[1] || !match[2]) return DEFAULT_VIDEO_PREVIEW_ASPECT_RATIO

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DEFAULT_VIDEO_PREVIEW_ASPECT_RATIO
  }

  return {
    cssValue: `${width} / ${height}`,
    portrait: width < height
  }
}

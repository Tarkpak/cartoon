import type { VideoModelConfig } from '#shared/types/provider'

export function videoTestOptions(model: VideoModelConfig | null) {
  const id = model?.model.toLowerCase() ?? ''
  const seedance = model?.provider === 'volcengine' && id.includes('seedance')
  const resolutions = !seedance ? ['720p']
    : id.includes('seedance-2-5') ? ['480p', '720p', '1080p']
      : id.includes('fast') || id.includes('mini') ? ['480p', '720p']
        : ['480p', '720p', '1080p', '4k']
  return { maxDuration: model?.maxDuration ?? 15, resolutions, seedance }
}

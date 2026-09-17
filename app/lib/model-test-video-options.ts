import type { VideoModelConfig } from '#shared/types/provider'

export function videoTestOptions(model: VideoModelConfig | null) {
  if (model?.provider === 'autodl') {
    return { minDuration: 1, maxDuration: model.maxDuration ?? 15, resolutions: ['480p', '768p'], seedance: false }
  }
  const id = model?.model.toLowerCase() ?? ''
  const seedance = model?.provider === 'volcengine' && id.includes('seedance')
  const resolutions = !seedance ? ['720p']
    : id.includes('seedance-2-5') ? ['480p', '720p', '1080p']
      : id.includes('fast') || id.includes('mini') ? ['480p', '720p']
        : ['480p', '720p', '1080p', '4k']
  return { minDuration: 4, maxDuration: model?.maxDuration ?? 15, resolutions, seedance }
}

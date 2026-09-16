import { describe, expect, it } from 'vitest'
import { VideoModelConfigSchema } from '#shared/types/provider'
import { videoTestOptions } from './model-test-video-options'

describe('videoTestOptions', () => {
  it('uses Seedance 2.5 capabilities without advertising 4k', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'volcengine', model: 'doubao-seedance-2-5-260628', displayName: 'Seedance 2.5', maxDuration: 30 })
    expect(videoTestOptions(model)).toEqual({ maxDuration: 30, resolutions: ['480p', '720p', '1080p'], seedance: true })
  })

  it('retains 2.0 standard and fast resolution limits', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'volcengine', model: 'doubao-seedance-2-0-260128', displayName: 'Seedance 2.0', maxDuration: 15 })
    expect(videoTestOptions(model).resolutions).toContain('4k')
    expect(videoTestOptions({ ...model, model: 'doubao-seedance-2-0-fast-260128' }).resolutions).toEqual(['480p', '720p'])
    expect(videoTestOptions(null)).toEqual({ maxDuration: 15, resolutions: ['720p'], seedance: false })
  })
})

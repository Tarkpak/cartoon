import { describe, expect, it } from 'vitest'
import { VideoModelConfigSchema } from '#shared/types/provider'
import { videoTestOptions } from './model-test-video-options'

describe('videoTestOptions', () => {
  it('uses Seedance 2.5 capabilities without advertising 4k', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'volcengine', model: 'doubao-seedance-2-5-260628', displayName: 'Seedance 2.5', maxDuration: 30 })
    expect(videoTestOptions(model)).toEqual({ minDuration: 4, maxDuration: 30, resolutions: ['480p', '720p', '1080p'], seedance: true })
  })

  it('retains 2.0 standard and fast resolution limits', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'volcengine', model: 'doubao-seedance-2-0-260128', displayName: 'Seedance 2.0', maxDuration: 15 })
    expect(videoTestOptions(model).resolutions).toContain('4k')
    expect(videoTestOptions({ ...model, model: 'doubao-seedance-2-0-fast-260128' }).resolutions).toEqual(['480p', '720p'])
    expect(videoTestOptions(null)).toEqual({ minDuration: 4, maxDuration: 15, resolutions: ['720p'], seedance: false })
  })

  it('offers H3 resolutions and preserves the first/last frame duration limit', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'autodl', model: 'minimax_h3_lightx2v', displayName: 'H3', maxDuration: 10 })
    expect(videoTestOptions(model)).toEqual({ minDuration: 1, maxDuration: 10, resolutions: ['480p', '768p'], seedance: false })
  })
})

describe('Aliyun video test options', () => {
  it('offers Wan 3.0 duration and resolution limits', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'qwen', model: 'wan3.0-video-prime', displayName: 'Wan 3.0' })
    expect(videoTestOptions(model)).toEqual({ minDuration: 2, maxDuration: 30, resolutions: ['480p', '720p', '1080p'], seedance: false })
  })

  it('keeps HappyHorse and previous Wan limits separate', () => {
    const model = VideoModelConfigSchema.parse({ provider: 'qwen', model: 'happyhorse-1.1-i2v', displayName: 'HappyHorse' })
    expect(videoTestOptions(model).minDuration).toBe(3)
    expect(videoTestOptions(model).resolutions).not.toContain('4k')
    expect(videoTestOptions({ ...model, model: 'wan2.7-t2v' }).resolutions).toEqual(['720p', '1080p'])
  })
})

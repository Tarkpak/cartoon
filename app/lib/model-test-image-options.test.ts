import { describe, expect, it } from 'vitest'
import { buildImageTestOptions, defaultImageTestOptions, imageTestCapabilities, normalizeImageTestRatio, buildImageTestSizeParameters, resolveImageTestResolution, imageTestResultUrls, resolveImageTestPixelSize } from './model-test-image-options'

describe('image test options', () => {
  it('accepts common output dimensions and adapts the model request', () => {
    expect(resolveImageTestPixelSize('1920*1080')).toEqual({ outputSize: '1920x1080', generationSize: '1920x1088' })
    expect(resolveImageTestPixelSize('1080 × 1920')).toEqual({ outputSize: '1080x1920', generationSize: '1088x1920' })
    expect(resolveImageTestPixelSize('2048x1152')).toEqual({ outputSize: '2048x1152', generationSize: '2048x1152' })
    expect(resolveImageTestPixelSize('2881x2879')).toEqual({ outputSize: '2881x2879', generationSize: '2880x2864' })
    const selection = { provider: 'openai', model: 'gpt-image-2', aspectRatio: '1:1', resolution: '4K', size: '', hasResolution: true, hasSize: false }
    expect(buildImageTestSizeParameters({ ...defaultImageTestOptions(), sizeMode: 'size', size: '1920*1080' }, selection)).toEqual({ imageSize: '1920x1088', imageOutputSize: '1920x1080' })
  })
  it('handles multiple results and falls back to the single image URL', () => {
    expect(imageTestResultUrls({ imageUrls: ['one', 'two', null, ''] })).toEqual(['one', 'two'])
    expect(imageTestResultUrls({ imageUrls: [], imageUrl: 'fallback' })).toEqual(['fallback'])
    expect(imageTestResultUrls(undefined)).toEqual([])
    expect(imageTestResultUrls({ imageUrls: [null] })).toEqual([])
  })
  it('only submits size fields used by the selected mode', () => {
    const selection = { provider: 'openai', model: 'gpt-image-2', aspectRatio: '1:1', resolution: '4K', size: '1024x1024', hasResolution: true, hasSize: true }
    const options = defaultImageTestOptions()
    expect(buildImageTestSizeParameters(options, selection)).toEqual({ imageAspectRatio: '1:1', imageResolution: '4K' })
    options.sizeMode = 'size'
    options.size = '1536 × 864'
    expect(buildImageTestSizeParameters(options, selection)).toEqual({ imageSize: '1536x864' })
    options.sizeMode = 'auto'
    expect(buildImageTestSizeParameters(options, selection)).toEqual({ imageSize: 'auto' })
    options.sizeMode = 'ratio'
    options.ratio = '2.39:1'
    expect(buildImageTestSizeParameters(options, selection)).toEqual({ imageAspectRatio: '239:100', imageResolution: '4K' })
    options.sizeMode = 'size'
    for (const size of ['0x1024', '4096x2048', '2048x512', '16x16']) {
      options.size = size
      expect(() => buildImageTestSizeParameters(options, selection)).toThrow('尺寸')
    }
  })
  it('validates only active advanced fields', () => {
    const options = { ...defaultImageTestOptions(), output_compression: NaN, partial_images: NaN }
    expect(buildImageTestOptions(options, 'openai', 'gpt-image-2', 0)).toMatchObject({ output_format: 'png' })
    options.output_format = 'webp'
    expect(() => buildImageTestOptions(options, 'openai', 'gpt-image-2', 0)).toThrow('压缩质量')
    options.output_format = 'png'
    options.stream = true
    expect(() => buildImageTestOptions(options, 'openai', 'gpt-image-2', 0)).toThrow('预览数量')
  })
  it('syncs resolution to the model while preserving valid choices', () => {
    expect(resolveImageTestResolution('4K', ['2K'])).toBe('2K')
    expect(resolveImageTestResolution('2K', ['2K', '4K'])).toBe('2K')
    expect(resolveImageTestResolution('', ['2K', '4K'])).toBe('4K')
    expect(resolveImageTestResolution('4K', [])).toBe('')
  })
  it('normalizes decimal ratios and rejects unsupported ratios', () => {
    expect(normalizeImageTestRatio('2.39:1')).toBe('239:100')
    expect(normalizeImageTestRatio('1 : 1.5')).toBe('2:3')
    for (const value of ['0:1', '4:1', 'oops', '1e2:1']) expect(() => normalizeImageTestRatio(value)).toThrow()
  })
  it('builds image options with format-specific compression', () => {
    const options = defaultImageTestOptions()
    expect(buildImageTestOptions(options, 'openai', 'gpt-image-2', 0)).toEqual({ background: 'auto', output_format: 'png', n: 1, moderation: 'auto' })
    options.output_format = 'webp'
    options.n = 3
    expect(buildImageTestOptions(options, 'custom_openai', 'gpt-image-2.5-flare', 0)).toMatchObject({ n: 3, output_compression: 100 })
  })
  it('omits unsupported and reference-only options', () => {
    const options = { ...defaultImageTestOptions(), input_fidelity: 'high', markup: 'data:image/png;base64,test' }
    expect(buildImageTestOptions(options, 'openai', 'gpt-image-2', 1)).not.toHaveProperty('input_fidelity')
    expect(buildImageTestOptions(options, 'openai', 'gpt-image-2', 1)).not.toHaveProperty('markup')
    expect(buildImageTestOptions(options, 'gemini', 'gemini-image', 0)).toBeUndefined()
    expect(imageTestCapabilities('openai', 'gpt-image-1.5').customSize).toBe(false)
    expect(imageTestCapabilities('custom_openai', 'models/gpt-image-2.5-flare').markup).toBe(true)
  })
  it('rejects incompatible backgrounds, invalid counts and missing references', () => {
    expect(() => buildImageTestOptions({ ...defaultImageTestOptions(), background: 'transparent', output_format: 'jpeg' }, 'openai', 'gpt-image-2', 0)).toThrow('透明背景')
    expect(() => buildImageTestOptions({ ...defaultImageTestOptions(), n: 1.2 }, 'openai', 'gpt-image-2', 0)).toThrow('生成数量')
    expect(() => buildImageTestOptions({ ...defaultImageTestOptions(), mask: 'test' }, 'openai', 'gpt-image-2', 0)).toThrow('参考图')
  })
})

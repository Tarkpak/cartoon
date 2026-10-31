import { describe, expect, it } from 'vitest'
import { buildImageTestOptions, defaultImageTestOptions, imageTestCapabilities, normalizeImageTestRatio } from './model-test-image-options'

describe('image test options', () => {
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

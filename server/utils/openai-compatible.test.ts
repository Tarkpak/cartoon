import { describe, expect, it } from 'vitest'
import { __openaiCompatibleTestUtils } from './openai-compatible'

describe('openai-compatible image strategy', () => {
  it('treats gpt-image-2 as regular size model on non-ApiMart baseUrl', () => {
    const strategy = __openaiCompatibleTestUtils.resolveOpenAICompatibleImageStrategy({
      providerConfig: { baseUrl: 'http://localhost:8317/v1' },
      model: 'gpt-image-2',
      size: '2048*1024',
      aspectRatio: '2:1',
      quality: 'auto'
    })

    expect(strategy.isApiMartProvider).toBe(false)
    expect(strategy.isApiMartGptImage2Series).toBe(false)
    expect(strategy.resolvedSize).toBe('2048x1024')
    expect(strategy.useImageUrlsInGenerations).toBe(false)
    expect(strategy.quality).toBe('auto')
    expect(strategy.resolution).toBeUndefined()
  })

  it('keeps ApiMart ratio mode for gpt-image-2 on ApiMart endpoints', () => {
    const strategy = __openaiCompatibleTestUtils.resolveOpenAICompatibleImageStrategy({
      providerConfig: { baseUrl: 'https://api.apimart.com/v1' },
      model: 'gpt-image-2',
      size: '2048*1024',
      aspectRatio: '2:1',
      quality: 'auto'
    })

    expect(strategy.isApiMartProvider).toBe(true)
    expect(strategy.isApiMartGptImage2).toBe(true)
    expect(strategy.isApiMartGptImage2Series).toBe(true)
    expect(strategy.resolvedSize).toBe('2:1')
    expect(strategy.useImageUrlsInGenerations).toBe(true)
    expect(strategy.quality).toBeUndefined()
    expect(strategy.resolution).toBe('1k')
  })

  it('detects apimart in baseUrl case-insensitively', () => {
    expect(__openaiCompatibleTestUtils.isApiMartBaseUrl('https://APIMART.example.com/v1')).toBe(true)
    expect(__openaiCompatibleTestUtils.isApiMartBaseUrl('http://localhost:8317/v1')).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('model reasoning settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('shares saved settings between global defaults and workflows', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ success: true, data: { 'custom_openai:gpt-6.1-sol': 'medium' } })
    vi.stubGlobal('$fetch', fetch)
    const { useModelReasoningSettings } = await import('./useModelReasoningSettings')
    const global = useModelReasoningSettings()
    const workflow = useModelReasoningSettings()
    await Promise.all([global.load(), workflow.load()])
    expect(fetch).toHaveBeenCalledTimes(1)
    await workflow.save('custom_openai', 'gpt-6.1-sol', 'medium')
    expect(global.efforts.value['custom_openai:gpt-6.1-sol']).toBe('medium')
    expect(fetch).toHaveBeenLastCalledWith('/api/model-providers/reasoning', {
      method: 'PUT', body: { provider: 'custom_openai', model: 'gpt-6.1-sol', effort: 'medium' }
    })
  })

  it('preserves the saved setting and reports a failed update', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { 'custom_openai:gpt-6.1-sol': 'low' } })
      .mockRejectedValueOnce(new Error('保存失败'))
    vi.stubGlobal('$fetch', fetch)
    const { useModelReasoningSettings } = await import('./useModelReasoningSettings')
    const settings = useModelReasoningSettings()
    await settings.load()
    await settings.save('custom_openai', 'gpt-6.1-sol', 'high')
    expect(settings.efforts.value['custom_openai:gpt-6.1-sol']).toBe('low')
    expect(settings.error.value).toBe('保存失败')
    expect(settings.saving.value).toBe(false)
  })
})

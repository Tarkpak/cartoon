import { describe, expect, it } from 'bun:test'
import { buildAvailableModelCatalog, CLIENT_MODEL_PROVIDER_KEYS, manualProviderSeedAvailableModels, providerSupportsModelSync, resolveProviderModelState } from './model-provider-models'

describe('AutoDL catalog', () => {
  it('publishes H3 workflows as video models to clients', () => {
    const models = manualProviderSeedAvailableModels('autodl')
    expect(CLIENT_MODEL_PROVIDER_KEYS).toContain('autodl')
    expect(models).toHaveLength(4)
    expect(buildAvailableModelCatalog('autodl', models).every(model => model.kind === 'video')).toBe(true)
  })

  it('does not send OpenAI model sync requests to the workflow service', () => {
    expect(providerSupportsModelSync('autodl')).toBe(false)
    expect(manualProviderSeedAvailableModels('unknown')).toEqual([])
  })
})

describe('Topaz catalog', () => {
  it('publishes video enhancement models to clients', () => {
    const models = manualProviderSeedAvailableModels('topaz')
    expect(CLIENT_MODEL_PROVIDER_KEYS).toContain('topaz')
    expect(models).toEqual(['ganim-1', 'prob-4'])
    expect(buildAvailableModelCatalog('topaz', models).every(model => model.kind === 'video')).toBe(true)
  })

  it('uses the fixed catalog instead of dynamic model sync', () => {
    expect(providerSupportsModelSync('topaz')).toBe(false)
  })
})


describe('OpenAI offline catalog', () => {
  it('expands old default lists without enabling extra models', () => {
    const state = resolveProviderModelState({ providerKey: 'openai',
      modelsJson: '["gpt-4.1"]', availableModelsJson: '["gpt-4.1","gpt-image-1"]' })
    expect(state.availableModels.length).toBeGreaterThan(100)
    expect(state.availableModels).toContain('gpt-image-2')
    expect(state.availableModels).toContain('gpt-6.1-sol')
    expect(state.models).toEqual(['gpt-4.1'])
    expect(new Set(state.availableModels).size).toBe(state.availableModels.length)
    expect(state.syncedAt).toBeNull()
  })

  it('retains account models and reports sync errors when falling back offline', () => {
    const state = resolveProviderModelState({ providerKey: 'openai', modelsJson: '["private-model"]',
      availableModelsJson: '["private-model"]', syncedAt: '2026-10-28T15:29:55.408Z', syncError: 'timeout' })
    expect(state.availableModels).toContain('private-model')
    expect(state.availableModels).toContain('gpt-image-2')
    expect(state.syncError).toBe('timeout')
    expect(state.models).toEqual(['private-model'])
  })

  it('uses successful account syncs as authoritative and leaves other providers unchanged', () => {
    const state = resolveProviderModelState({ providerKey: 'openai',
      availableModelsJson: '["gpt-image-2"]', syncedAt: '2026-10-28T15:29:55.408Z' })
    expect(state.availableModels).toEqual(['gpt-image-2'])
    expect(resolveProviderModelState({ providerKey: 'custom_openai', availableModelsJson: '["custom-model"]' }).availableModels)
      .toEqual(['custom-model'])
  })
})

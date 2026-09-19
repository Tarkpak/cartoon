import { describe, expect, it } from 'bun:test'
import { buildAvailableModelCatalog, CLIENT_MODEL_PROVIDER_KEYS, manualProviderSeedAvailableModels, providerSupportsModelSync } from './model-provider-models'

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

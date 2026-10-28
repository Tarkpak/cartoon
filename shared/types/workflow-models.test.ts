import { describe, expect, it } from 'vitest'
import { WorkflowImageGenerationModelOptionsSchema, WorkflowModelsSchema, WorkflowStepSchema, WORKFLOW_STEP_CONFIGS } from './workflow-models'

describe('OpenAI image quality settings', () => {
  it('preserves extended quality settings when saving image options', () => {
    for (const openaiImageQuality of ['xhigh', 'max']) {
      expect(WorkflowImageGenerationModelOptionsSchema.parse({ openaiImageQuality }).openaiImageQuality)
        .toBe(openaiImageQuality)
    }
  })

  it('keeps the default and rejects unsupported quality values', () => {
    expect(WorkflowImageGenerationModelOptionsSchema.parse({}).openaiImageQuality).toBe('auto')
    expect(WorkflowImageGenerationModelOptionsSchema.safeParse({ openaiImageQuality: 'invalid' }).success)
      .toBe(false)
  })
})

describe('independent asset image models', () => {
  it('orders image workflows as characters, environments, props and other assets', () => {
    expect(WORKFLOW_STEP_CONFIGS.filter(step => step.category === 'image').map(step => step.id))
      .toEqual(['character_portrait', 'frame_generation', 'prop_generation', 'other_asset_generation'])
  })

  it('preserves separate model selections for characters, props and other assets', () => {
    const models = {
      character_portrait: 'character-model',
      prop_generation: 'prop-model',
      other_asset_generation: 'other-model',
      frame_generation: 'environment-model'
    }
    expect(WorkflowModelsSchema.parse(models)).toEqual(models)
    for (const id of ['prop_generation', 'other_asset_generation']) {
      expect(WorkflowStepSchema.parse(id)).toBe(id)
      expect(WORKFLOW_STEP_CONFIGS.find(step => step.id === id)?.category).toBe('image')
    }
  })

  it('accepts existing configurations without new asset overrides', () => {
    expect(WorkflowModelsSchema.parse({ character_portrait: 'existing-model' }))
      .toEqual({ character_portrait: 'existing-model' })
    expect(WorkflowStepSchema.safeParse('unknown_asset_step').success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { WorkflowImageGenerationModelOptionsSchema } from './workflow-models'

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

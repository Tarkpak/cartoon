import { describe, expect, it } from 'vitest'
import { formatWorkflowStylePrompt } from './workflow-style-prompt'

describe('formatWorkflowStylePrompt', () => {
  it('does not duplicate the style suffix when preset prompt already includes it', () => {
    expect(formatWorkflowStylePrompt('ghibli', {
      name: '吉卜力',
      prompt: 'Ghibli style'
    })).toBe('吉卜力, Ghibli style')
  })

  it('adds a style suffix to plain English prompt text', () => {
    expect(formatWorkflowStylePrompt('city_romance', {
      name: '都市情感',
      prompt: 'city romance'
    })).toBe('都市情感, city romance style')
  })

  it('falls back to style id when preset is unavailable', () => {
    expect(formatWorkflowStylePrompt('ghibli')).toBe('ghibli style')
  })
})

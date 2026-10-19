import { describe, expect, it } from 'vitest'
import { resolveProjectDetailPath, resolveProjectWorkbenchPath } from '../../shared/types/project'

describe('project workbench routes', () => {
  it('preserves the original workbench routes and stages', () => {
    expect(resolveProjectDetailPath('p/1')).toBe('/asset-workbench?project=p%2F1')
    expect(resolveProjectWorkbenchPath('p1', 'videos')).toBe('/asset-workbench?project=p1&stage=videos')
  })
})

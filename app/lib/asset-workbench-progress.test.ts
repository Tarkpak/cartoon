import { describe, expect, it } from 'vitest'
import { generatedEpisodePlans } from './asset-workbench-progress'

describe('generated episode directory state', () => {
  it('does not count migration holding episodes as a generated directory', () => {
    expect(generatedEpisodePlans()).toEqual([])
    expect(generatedEpisodePlans([{ id: 'legacy-unassigned', title: '未分集内容' }])).toEqual([])
  })

  it('counts real plans and preserves migration data without mutating it', () => {
    const placeholder = { id: 'legacy-unassigned-1', title: '未分集内容' }
    const plan = { id: 'episode_1', title: '第一集', charCount: 100 }
    const items = [placeholder, plan]
    expect(generatedEpisodePlans(items)).toEqual([plan])
    expect(items).toEqual([placeholder, plan])
    expect(generatedEpisodePlans([{ ...placeholder, charCount: 100 }])).toHaveLength(1)
  })
})

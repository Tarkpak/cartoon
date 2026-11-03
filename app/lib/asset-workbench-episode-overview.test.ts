import { describe, expect, it } from 'vitest'
import { buildEpisodeOverviews, resolveSceneDescriptionOverviewText } from './asset-workbench-episode-overview'

describe('episode overviews', () => {
  it('prefers timeline beats and strips their time prefixes', () => {
    expect(resolveSceneDescriptionOverviewText('场景功能：\n0-3s：她推门进来\n3-6秒: 灯灭了\n6-9s：尖叫')).toBe('她推门进来 灯灭了')
  })

  it('skips structured headings when there is no timeline', () => {
    expect(resolveSceneDescriptionOverviewText('镜头设计\n雨夜的街口\n远处有车灯')).toBe('雨夜的街口 远处有车灯')
  })

  it('summarises up to three scenes per episode and clips long text', () => {
    const scenes = [
      { episodeId: 'e1', title: '开场', description: '0-2s：雨夜' },
      { episodeId: 'e1', title: '对峙', description: '对峙：两人僵持' },
      { episodeId: 'e1', title: '', description: '逃跑' },
      { episodeId: 'e1', title: '第四场', description: '不应出现' },
      { episodeId: 'e2', title: 'x'.repeat(200), description: '' }
    ]
    const overviews = buildEpisodeOverviews([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], scenes)
    expect(overviews.e1).toBe('开场：雨夜；对峙：两人僵持；逃跑')
    expect(overviews.e2).toBe(`${'x'.repeat(180)}...`)
    expect(overviews.e3).toBeUndefined()
  })
})

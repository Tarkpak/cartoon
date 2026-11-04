import { describe, expect, it } from 'vitest'
import { buildSceneDescriptionBlocks } from './scene-description-layout'

describe('buildSceneDescriptionBlocks', () => {
  it('separates section labels and timelines while preserving inline asset links', () => {
    const asset = { id: 'char:hero', name: '主人公', type: 'character' as const }
    expect(buildSceneDescriptionBlocks([
      { type: 'text', text: '场景功能/情绪定位：发现异常。\n镜头设计：0-5秒，' },
      { type: 'asset', asset },
      { type: 'text', text: '回头。\n5-10秒，固定镜头。\n声音设计：锅声。' }
    ])).toEqual([
      { label: '场景功能/情绪定位', segments: [{ type: 'text', text: '发现异常。' }] },
      { label: '镜头设计', segments: [
        { type: 'text', text: '0-5秒，' }, { type: 'asset', asset }, { type: 'text', text: '回头。' }
      ] },
      { segments: [{ type: 'text', text: '5-10秒，固定镜头。' }] },
      { label: '声音设计', segments: [{ type: 'text', text: '锅声。' }] }
    ])
  })

  it('keeps ordinary descriptions and inline label references intact, ignoring blank lines', () => {
    expect(buildSceneDescriptionBlocks([
      { type: 'text', text: '\r\n她翻开写着声音设计：雨声的笔记。\r\n\r\n' }
    ])).toEqual([{ segments: [{ type: 'text', text: '她翻开写着声音设计：雨声的笔记。' }] }])
    expect(buildSceneDescriptionBlocks([])).toEqual([])
  })
})

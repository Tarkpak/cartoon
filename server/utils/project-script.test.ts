import { describe, expect, it } from 'vitest'
import {
  mergeStoredProjectScriptData,
  parseStoredProjectScript,
  serializeStoredProjectScript
} from './project-script'

describe('project script storage', () => {
  it('preserves episode plan when serializing and parsing script data', () => {
    const episodePlan = [{
      id: 'episode_001',
      title: '第1集：开端',
      index: 1,
      startOffset: 0,
      endOffset: 1200,
      charCount: 1200,
      episodeAssets: {
        characters: [{ name: '阿青' }],
        props: [{ name: '铜铃' }],
        environments: [{ location: '旧宅' }]
      }
    }]

    const serialized = serializeStoredProjectScript(mergeStoredProjectScriptData({
      novelText: '完整剧本文本',
      episodePlan
    }))

    expect(parseStoredProjectScript(serialized)?.episodePlan).toEqual(episodePlan)
  })

  it('keeps existing episode plan when unrelated script fields are merged', () => {
    const existing = mergeStoredProjectScriptData({
      episodePlan: [{
        id: 'episode_001',
        title: '第1集',
        index: 1,
        startOffset: 0,
        endOffset: 800
      }]
    })

    const merged = mergeStoredProjectScriptData({
      selectedStyleId: 'ink'
    }, existing)

    expect(merged.episodePlan).toEqual(existing.episodePlan)
  })
})

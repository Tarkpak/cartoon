import { describe, expect, it } from 'vitest'
import { createEmptyScriptWritingStudio } from '#shared/types/script-writing'
import { appendEpisodeHistory } from './script-writing-episode-history'

function createStudio() {
  const studio = createEmptyScriptWritingStudio()
  studio.episodes = [{ id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '原正文', review: '' }]
  return studio
}

describe('episode history', () => {
  it('keeps an independent copy and skips duplicate content', () => {
    const studio = createStudio()
    studio.episodes[0]!.draftSource = '内部输入指纹'.repeat(10_000)
    const saved = appendEpisodeHistory(studio, 'episode_1', '编辑前')
    expect(appendEpisodeHistory(saved, 'episode_1', '重复记录')).toBe(saved)
    saved.episodes[0]!.draft = ''
    expect(saved.versions[0]?.snapshot.episodes[0]?.draft).toBe('原正文')
    expect(saved.versions[0]?.snapshot.episodes).toHaveLength(1)
    expect(saved.versions[0]?.snapshot.episodes[0]).not.toHaveProperty('draftSource')
    expect(appendEpisodeHistory(saved, 'missing', '无效分集')).toBe(saved)
  })

  it('keeps the latest 30 automatic records per episode and retains pinned records', () => {
    let studio = createStudio()
    studio.episodes.push({ ...studio.episodes[0]!, id: 'episode_2', index: 2 })
    studio = appendEpisodeHistory(studio, 'episode_2', '其他集')
    studio = appendEpisodeHistory(studio, 'episode_1', '固定记录')
    studio.versions[0]!.pinned = true
    for (let index = 0; index < 35; index++) {
      studio.episodes[0]!.draft = `修订 ${index}`
      studio = appendEpisodeHistory(studio, 'episode_1', '自动记录')
    }
    expect(studio.versions.filter(version => version.episodeId === 'episode_1' && !version.pinned)).toHaveLength(30)
    expect(studio.versions.some(version => version.pinned)).toBe(true)
    expect(studio.versions.some(version => version.episodeId === 'episode_2')).toBe(true)
    expect(studio.versions[0]?.snapshot.episodes[0]?.draft).toBe('修订 34')
  })
})

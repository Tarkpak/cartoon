import { describe, expect, it } from 'vitest'
import {
  appendScriptWritingVersion,
  createEmptyScriptWritingStudio,
  deleteScriptWritingVersion,
  ensureScriptWritingEpisodeIds,
  normalizeScriptWritingStudio,
  buildScriptWritingPublication,
  createScriptWritingBriefFingerprint,
  createScriptWritingDraftInputFingerprint,
  createScriptWritingOutlineInputFingerprint,
  createScriptWritingReviewInputFingerprint,
  resolveScriptWritingFreshness,
  resolveScriptWritingPublicationReadiness,
  renderScriptWritingText,
  restoreScriptWritingVersion,
  setScriptWritingVersionPinned
} from './script-writing'

describe('script writing studio', () => {
  it('normalizes invalid persisted data to an empty studio', () => {
    expect(normalizeScriptWritingStudio({ brief: { episodeCount: 0 } }))
      .toEqual(createEmptyScriptWritingStudio())
  })

  it('adds backwards-compatible defaults for new creative controls', () => {
    const studio = createEmptyScriptWritingStudio()
    const legacy = JSON.parse(JSON.stringify(studio))
    delete legacy.brief.customGenre
    delete legacy.brief.customAudience
    delete legacy.brief.sourceMaterial
    delete legacy.brief.referenceStyle
    delete legacy.brief.protectedContent
    delete legacy.lockedStoryBibleFields

    const normalized = normalizeScriptWritingStudio(legacy)
    expect(normalized.brief).toMatchObject({
      customGenre: '',
      customAudience: '',
      sourceMaterial: '',
      referenceStyle: '',
      protectedContent: ''
    })
    expect(normalized.lockedStoryBibleFields).toEqual([])
  })

  it('assigns stable character ids to legacy story bibles and snapshots', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.storyBible = {
      premise: '',
      theme: '',
      world: '',
      tone: '',
      characters: [
        { id: '', name: '林默', role: '', profile: '', motivation: '', arc: '' },
        { id: 'lead', name: '周岚', role: '', profile: '', motivation: '', arc: '' }
      ],
      rules: []
    }
    const versioned = appendScriptWritingVersion(studio, '第一版')

    const normalized = normalizeScriptWritingStudio(versioned)
    expect(normalized.storyBible?.characters.map(character => character.id))
      .toEqual(['character_1', 'lead'])
    expect(normalized.versions[0]?.snapshot.storyBible?.characters.map(character => character.id))
      .toEqual(['character_1', 'lead'])
  })

  it('creates and restores immutable versions', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '最初的创意'
    studio.episodes = [{
      id: 'episode_1',
      index: 1,
      title: '相遇',
      summary: '',
      hook: '',
      beats: [],
      draft: '初稿',
      review: ''
    }]
    const versioned = appendScriptWritingVersion(studio, '第一版', new Date('2026-08-10T00:00:00.000Z'))
    versioned.episodes[0]!.draft = '修改稿'
    versioned.brief.idea = '修改后的创意'

    const restored = restoreScriptWritingVersion(versioned, versioned.versions[0]!.id)
    expect(restored?.episodes[0]?.draft).toBe('初稿')
    expect(restored?.brief.idea).toBe('最初的创意')
    expect(versioned.episodes[0]?.draft).toBe('修改稿')
  })

  it('marks downstream content stale when its source changes', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '失忆律师追查真相'
    studio.storyBible = { premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: [] }
    studio.provenance.storyBibleInput = createScriptWritingBriefFingerprint(studio.brief)
    studio.episodes = [{ id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文', review: '' }]
    studio.provenance.outlineInput = createScriptWritingOutlineInputFingerprint(studio)
    studio.episodes[0]!.draftSource = createScriptWritingDraftInputFingerprint(studio, 'episode_1')

    expect(resolveScriptWritingFreshness(studio)).toMatchObject({ storyBibleStale: false, outlineStale: false, staleDraftIds: [] })
    studio.storyBible.premise = '新的核心冲突'
    const freshness = resolveScriptWritingFreshness(studio)
    expect(freshness.outlineStale).toBe(true)
    expect(freshness.staleDraftIds).toEqual(['episode_1'])
  })

  it('builds exact episode offsets for structured publication', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [
      { id: '1', index: 1, title: '开局', summary: '', hook: '反转', beats: [], draft: '第一集正文', review: '' },
      { id: '2', index: 2, title: '追查', summary: '', hook: '', beats: [], draft: '第二集正文', review: '' }
    ]
    const publication = buildScriptWritingPublication(studio)
    expect(publication.episodes).toHaveLength(2)
    for (const episode of publication.episodes) {
      expect(publication.text.slice(episode.startOffset, episode.endOffset)).toContain(`第${episode.index}集`)
      expect(episode.charCount).toBe(episode.endOffset - episode.startOffset)
    }
  })

  it('deduplicates episode ids and reindexes by episode order', () => {
    const episodes = ensureScriptWritingEpisodeIds([
      { id: 'episode_1', index: 3, title: '结局', summary: '', hook: '', beats: [], draft: '', review: '' },
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '', review: '' },
      { id: '', index: 2, title: '反转', summary: '', hook: '', beats: [], draft: '', review: '' }
    ])

    expect(episodes.map(episode => episode.index)).toEqual([1, 2, 3])
    expect(episodes.map(episode => episode.title)).toEqual(['开局', '反转', '结局'])
    expect(new Set(episodes.map(episode => episode.id)).size).toBe(3)
    expect(episodes[0]?.id).toBe('episode_1')
  })

  it('keeps drafts intact when normalizing persisted studios', () => {
    const studio = appendScriptWritingVersion(
      createEmptyScriptWritingStudio(),
      '生成分集大纲前'
    )
    studio.episodes = [
      { id: '1', index: 1, title: '开局', summary: '大纲', hook: '钩子', beats: [], draft: '用户正文', review: '' }
    ]

    expect(normalizeScriptWritingStudio(studio).episodes[0]?.draft).toBe('用户正文')
  })

  it('skips appending a version when the snapshot is unchanged', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [{ id: 'episode_1', index: 1, title: '相遇', summary: '', hook: '', beats: [], draft: '初稿', review: '' }]
    const once = appendScriptWritingVersion(studio, '第一版')
    const twice = appendScriptWritingVersion(once, '第二版')

    expect(twice.versions).toHaveLength(1)
    expect(twice.versions[0]?.label).toBe('第一版')
  })

  it('normalizes legacy version metadata as pinned milestones', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '旧项目'
    const versioned = appendScriptWritingVersion(studio, '旧版')
    const legacy = JSON.parse(JSON.stringify(versioned))
    delete legacy.versions[0].note
    delete legacy.versions[0].kind
    delete legacy.versions[0].pinned
    delete legacy.versions[0].source

    expect(normalizeScriptWritingStudio(legacy).versions[0]).toMatchObject({
      note: '',
      kind: 'milestone',
      pinned: true,
      source: 'unknown'
    })
  })

  it('rotates unpinned protection versions while preserving pinned milestones', () => {
    let studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '里程碑内容'
    studio = appendScriptWritingVersion(studio, '重要节点', { kind: 'milestone', pinned: true })
    const milestoneId = studio.versions[0]!.id

    for (let index = 0; index < 105; index += 1) {
      studio.brief.idea = `保护内容 ${index}`
      studio = appendScriptWritingVersion(studio, `保护 ${index}`, {
        kind: 'protection',
        pinned: false,
        source: 'brief'
      }, new Date(2026, 7, 11, 0, 0, index))
    }

    expect(studio.versions.filter(version => !version.pinned)).toHaveLength(100)
    expect(studio.versions.some(version => version.id === milestoneId)).toBe(true)
    expect(studio.versions.find(version => version.id === milestoneId)?.kind).toBe('milestone')
  })

  it('restores individual sections without replacing unrelated content', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '历史设定'
    studio.storyBible = { premise: '历史圣经', theme: '', world: '', tone: '', characters: [], rules: [] }
    studio.episodes = [
      { id: 'episode_1', index: 1, title: '历史第一集', summary: '历史大纲', hook: '', beats: [], draft: '历史正文', review: '历史意见' },
      { id: 'episode_2', index: 2, title: '历史第二集', summary: '', hook: '', beats: [], draft: '历史第二集正文', review: '' }
    ]
    studio.review = { score: 81, summary: '历史审校', issues: [], suggestions: [], episodeNotes: [] }
    const versioned = appendScriptWritingVersion(studio, '历史版')
    const versionId = versioned.versions[0]!.id
    versioned.brief.idea = '当前设定'
    versioned.storyBible = { premise: '当前圣经', theme: '', world: '', tone: '', characters: [], rules: [] }
    versioned.episodes[0] = { ...versioned.episodes[0]!, title: '当前第一集', draft: '当前正文' }
    versioned.episodes[1] = { ...versioned.episodes[1]!, draft: '当前第二集正文' }
    versioned.review = null

    const briefRestored = restoreScriptWritingVersion(versioned, versionId, 'brief')!
    expect(briefRestored.brief.idea).toBe('历史设定')
    expect(briefRestored.episodes[0]?.draft).toBe('当前正文')

    const bibleRestored = restoreScriptWritingVersion(versioned, versionId, 'story_bible')!
    expect(bibleRestored.storyBible?.premise).toBe('历史圣经')
    expect(bibleRestored.brief.idea).toBe('当前设定')

    const outlineRestored = restoreScriptWritingVersion(versioned, versionId, 'outline')!
    expect(outlineRestored.episodes[0]?.title).toBe('历史第一集')
    expect(outlineRestored.episodes[0]?.draft).toBe('当前正文')

    const episodeRestored = restoreScriptWritingVersion(versioned, versionId, 'episode', 'episode_1')!
    expect(episodeRestored.episodes[0]?.draft).toBe('历史正文')
    expect(episodeRestored.episodes[1]?.draft).toBe('当前第二集正文')

    const reviewRestored = restoreScriptWritingVersion(versioned, versionId, 'review')!
    expect(reviewRestored.review?.summary).toBe('历史审校')
    expect(reviewRestored.episodes[0]?.draft).toBe('当前正文')
    expect(reviewRestored.episodes[0]?.review).toBe('历史意见')
  })

  it('pins, unpins, and deletes versions without changing current content', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.brief.idea = '当前创意'
    const versioned = appendScriptWritingVersion(studio, '保护版', { kind: 'protection', pinned: false })
    const versionId = versioned.versions[0]!.id
    const pinned = setScriptWritingVersionPinned(versioned, versionId, true)
    expect(pinned.versions[0]?.pinned).toBe(true)
    expect(pinned.brief.idea).toBe('当前创意')

    const unpinned = setScriptWritingVersionPinned(pinned, versionId, false)
    expect(unpinned.versions[0]?.pinned).toBe(false)
    const deleted = deleteScriptWritingVersion(unpinned, versionId)
    expect(deleted.versions).toHaveLength(0)
    expect(deleted.brief.idea).toBe('当前创意')
  })

  it('renders only drafted episodes in episode order', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [
      { id: '2', index: 2, title: '反转', summary: '', hook: '', beats: [], draft: '第二集正文', review: '' },
      { id: '1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '第一集正文', review: '' },
      { id: '3', index: 3, title: '结局', summary: '', hook: '', beats: [], draft: ' ', review: '' }
    ]

    expect(renderScriptWritingText(studio)).toBe('第1集 开局\n\n第一集正文\n\n第2集 反转\n\n第二集正文')
  })

  it('requires complete current drafts and a current review for formal publication', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.storyBible = { premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: [] }
    studio.provenance.storyBibleInput = createScriptWritingBriefFingerprint(studio.brief)
    studio.episodes = [{ id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文', review: '' }]
    studio.provenance.outlineInput = createScriptWritingOutlineInputFingerprint(studio)
    studio.episodes[0]!.draftSource = createScriptWritingDraftInputFingerprint(studio, 'episode_1')

    expect(resolveScriptWritingPublicationReadiness(studio)).toMatchObject({
      ready: false,
      blockers: ['尚未全剧审校']
    })

    studio.review = { score: 90, summary: '可以发布', issues: [], suggestions: [], episodeNotes: [] }
    studio.provenance.reviewInput = createScriptWritingReviewInputFingerprint(studio)
    expect(resolveScriptWritingPublicationReadiness(studio)).toEqual({ ready: true, blockers: [] })

    studio.episodes[0]!.summary = '调整后的大纲'
    expect(resolveScriptWritingPublicationReadiness(studio)).toMatchObject({
      ready: false,
      blockers: ['1 集正文待确认']
    })
  })

  it('requires the review pass score and every remediation task before publication', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.storyBible = { premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: [] }
    studio.provenance.storyBibleInput = createScriptWritingBriefFingerprint(studio.brief)
    studio.episodes = [{ id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文', review: '' }]
    studio.provenance.outlineInput = createScriptWritingOutlineInputFingerprint(studio)
    studio.episodes[0]!.draftSource = createScriptWritingDraftInputFingerprint(studio, 'episode_1')
    studio.review = {
      score: 72,
      summary: '需要整改',
      issues: ['结尾缺少钩子'],
      suggestions: ['补充反转'],
      episodeNotes: []
    }
    studio.provenance.reviewInput = createScriptWritingReviewInputFingerprint(studio)

    expect(resolveScriptWritingPublicationReadiness(studio).blockers).toEqual([
      '审校分数低于 80',
      '1 项整改未完成'
    ])

    studio.review.score = 86
    expect(resolveScriptWritingPublicationReadiness(studio).blockers).toEqual(['1 项整改未完成'])
    studio.resolvedReviewItems = ['review_task_1']
    expect(resolveScriptWritingPublicationReadiness(studio)).toEqual({ ready: true, blockers: [] })
  })
})

import { nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyScriptWritingStudio, normalizeScriptWritingStudio } from '#shared/types/script-writing'
import { useScriptWritingStudio } from './useScriptWritingStudio'

describe('useScriptWritingStudio', () => {
  const fetchMock = vi.fn()
  const testGlobal = globalThis as typeof globalThis & { $fetch?: unknown }
  let originalFetch: unknown

  beforeEach(() => {
    originalFetch = testGlobal.$fetch
    testGlobal.$fetch = fetchMock
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    testGlobal.$fetch = originalFetch
  })

  it('stores a valid generated story bible and persists it', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '一个失忆律师发现自己正在为过去的自己辩护'
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        storyBible: {
          premise: '律师追查失忆真相',
          theme: '责任与自我宽恕',
          world: '现代都市',
          tone: '悬疑克制',
          characters: [{ name: '林默', role: '主角', profile: '失忆律师', motivation: '寻找真相', arc: '逃避到承担' }],
          rules: ['证据必须前置']
        }
      }
    })
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })

    expect(await writing.generateStoryBible()).toBe(true)
    expect(studio.value.storyBible?.characters[0]?.name).toBe('林默')
    expect(studio.value.storyBible?.characters[0]?.id).toBe('character_1')
    expect(studio.value.versions[0]?.label).toBe('生成故事圣经前')
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('passes revision instructions and preserves locked story bible fields', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '失忆律师追查真相'
    studio.value.storyBible = {
      premise: '不可替换的核心命题',
      theme: '旧主题',
      world: '现代都市',
      tone: '克制',
      characters: [],
      rules: []
    }
    studio.value.lockedStoryBibleFields = ['premise']
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        storyBible: {
          premise: '模型试图替换的命题',
          theme: '新主题',
          world: '现代都市',
          tone: '悬疑',
          characters: [],
          rules: []
        }
      }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateStoryBible(true, '只加强主题')).toBe(true)
    expect(writing.pendingGeneration.value?.kind).toBe('story_bible')
    if (writing.pendingGeneration.value?.kind === 'story_bible') {
      expect(writing.pendingGeneration.value.storyBible.premise).toBe('不可替换的核心命题')
      expect(writing.pendingGeneration.value.storyBible.theme).toBe('新主题')
    }
    expect(fetchMock.mock.calls[0]?.[1]?.body.context).toMatchObject({
      instruction: '只加强主题',
      lockedFields: ['premise']
    })
  })

  it('sends resolved custom genre and audience values to the model', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '一场非典型家庭冒险'
    studio.value.brief.genre = '其他'
    studio.value.brief.customGenre = '公路音乐喜剧'
    studio.value.brief.audience = '其他'
    studio.value.brief.customAudience = '银发用户'
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        storyBible: {
          premise: '一路寻找旧友', theme: '', world: '', tone: '', characters: [], rules: []
        }
      }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateStoryBible()).toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]?.body.context.brief).toMatchObject({
      genre: '公路音乐喜剧',
      audience: '银发用户'
    })
  })

  it('keeps an invalid edited candidate open instead of committing it', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '旧标题', summary: '', hook: '', beats: [], draft: '旧正文', review: '' }
    ]
    fetchMock.mockResolvedValue({
      success: true,
      data: { episodes: [{ id: 'episode_1', index: 1, title: '候选标题', summary: '', hook: '', beats: [] }] }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateOutline(true)).toBe(true)
    if (writing.pendingGeneration.value?.kind === 'outline') {
      writing.pendingGeneration.value.episodes[0]!.title = ''
    }
    expect(await writing.applyPendingGeneration()).toBe(false)
    expect(writing.pendingGeneration.value?.kind).toBe('outline')
    expect(studio.value.episodes[0]?.title).toBe('旧标题')
  })

  it('commits generated content in one assignment for defineModel refs', async () => {
    const source = createEmptyScriptWritingStudio()
    source.brief.idea = '一个失忆律师发现自己正在为过去的自己辩护'
    let assignedStudio: typeof source | undefined
    const modelRef = {
      get value() {
        return source
      },
      set value(value: typeof source) {
        assignedStudio = value
      }
    } as Ref<typeof source>
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        storyBible: {
          premise: '律师追查失忆真相',
          theme: '责任与自我宽恕',
          world: '现代都市',
          tone: '悬疑克制',
          characters: [{ name: '林默', role: '主角', profile: '失忆律师', motivation: '寻找真相', arc: '逃避到承担' }],
          rules: ['证据必须前置']
        }
      }
    })
    const writing = useScriptWritingStudio({
      studio: modelRef,
      saveProject: vi.fn(async () => true)
    })

    expect(await writing.generateStoryBible()).toBe(true)
    expect(assignedStudio?.storyBible?.characters[0]?.name).toBe('林默')
    expect(assignedStudio?.versions[0]?.label).toBe('生成故事圣经前')
  })

  it('discards draft content returned by outline generation', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.episodeCount = 1
    studio.value.storyBible = {
      premise: '律师追查失忆真相',
      theme: '责任与自我宽恕',
      world: '现代都市',
      tone: '悬疑克制',
      characters: [],
      rules: []
    }
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        episodes: [{
          id: 'episode_1',
          index: 1,
          title: '开局',
          summary: '律师收到匿名证据',
          hook: '证据来自过去的自己',
          beats: ['收到证据'],
          draft: '模型不应在大纲阶段生成的正文',
          review: '模型不应返回的审校'
        }]
      }
    })
    const writing = useScriptWritingStudio({
      studio,
      saveProject: vi.fn(async () => true)
    })

    expect(await writing.generateOutline()).toBe(true)
    expect(studio.value.episodes[0]?.draft).toBe('')
    expect(studio.value.episodes[0]?.review).toBe('')
  })

  it('generates every unfinished episode in order without replacing existing drafts', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相',
      theme: '',
      world: '',
      tone: '',
      characters: [],
      rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '已有正文', review: '' },
      { id: 'episode_2', index: 2, title: '追查', summary: '', hook: '', beats: [], draft: '', review: '' },
      { id: 'episode_3', index: 3, title: '真相', summary: '', hook: '', beats: [], draft: '', review: '' }
    ]
    fetchMock
      .mockResolvedValueOnce({ success: true, data: { episodeId: 'episode_2', draft: '第二集正文' } })
      .mockResolvedValueOnce({ success: true, data: { episodeId: 'episode_3', draft: '第三集正文' } })
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })

    expect(await writing.generateRemainingEpisodeDrafts()).toBe(true)
    expect(studio.value.episodes.map(episode => episode.draft))
      .toEqual(['已有正文', '第二集正文', '第三集正文'])
    expect(studio.value.versions[0]?.label).toBe('批量生成未成稿前')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(writing.batchCompleted.value).toBe(2)
  })

  it('sends the continuity ledger and stores the returned episode state', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文一', review: '', continuityNotes: '钥匙由林默保管' },
      { id: 'episode_2', index: 2, title: '追查', summary: '', hook: '', beats: [], draft: '', review: '' }
    ]
    fetchMock.mockResolvedValue({
      success: true,
      data: { episodeId: 'episode_2', draft: '正文二', continuityNotes: '钥匙交给周岚' }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateEpisodeDraft('episode_2', false, false, '强化道具流转')).toBe(true)
    expect(studio.value.episodes[1]?.continuityNotes).toBe('钥匙交给周岚')
    expect(fetchMock.mock.calls[0]?.[1]?.body.context).toMatchObject({
      instruction: '强化道具流转',
      continuityLedger: [{ episodeId: 'episode_1', index: 1, notes: '钥匙由林默保管' }]
    })
  })

  it('resumes a paused batch without resetting progress', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '', review: '' },
      { id: 'episode_2', index: 2, title: '结局', summary: '', hook: '', beats: [], draft: '', review: '' }
    ]
    fetchMock.mockImplementationOnce(async () => {
      writing.pauseBatchGeneration()
      return { success: true, data: { episodeId: 'episode_1', draft: '第一集' } }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateRemainingEpisodeDrafts()).toBe(false)
    expect(writing.batchCompleted.value).toBe(1)
    expect(writing.isBatchPaused.value).toBe(true)

    fetchMock.mockResolvedValueOnce({ success: true, data: { episodeId: 'episode_2', draft: '第二集' } })
    expect(await writing.generateRemainingEpisodeDrafts()).toBe(true)
    expect(writing.batchCompleted.value).toBe(2)
    expect(writing.batchTotal.value).toBe(2)
    expect(writing.isBatchPaused.value).toBe(false)
  })

  it('exposes request failures without mutating content', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '测试创意'
    fetchMock.mockRejectedValue(new Error('模型不可用'))
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateStoryBible()).toBe(false)
    expect(studio.value.storyBible).toBeNull()
    expect(writing.error.value).toContain('模型不可用')
  })

  it('keeps an outline whose episode count differs and surfaces a notice', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.episodeCount = 3
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        episodes: [
          { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [] },
          { id: 'episode_1', index: 2, title: '反转', summary: '', hook: '', beats: [] }
        ]
      }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateOutline()).toBe(true)
    expect(studio.value.episodes).toHaveLength(2)
    expect(new Set(studio.value.episodes.map(episode => episode.id)).size).toBe(2)
    expect(writing.notice.value).toContain('2')
  })

  it('continues batch generation after a failed episode and reports it', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '', review: '' },
      { id: 'episode_2', index: 2, title: '追查', summary: '', hook: '', beats: [], draft: '', review: '' }
    ]
    fetchMock
      .mockRejectedValueOnce(new Error('模型不可用'))
      .mockResolvedValueOnce({ success: true, data: { episodeId: 'episode_2', draft: '第二集正文' } })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateRemainingEpisodeDrafts()).toBe(false)
    expect(studio.value.episodes.map(episode => episode.draft)).toEqual(['', '第二集正文'])
    expect(writing.error.value).toContain('第 1 集')
    expect(writing.batchCompleted.value).toBe(1)
  })

  it('rejects overlapping requests while one action is running', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '测试创意'
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation(() => new Promise(resolve => {
      resolveFetch = resolve
    }))
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    const first = writing.generateStoryBible()
    expect(await writing.generateStoryBible()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch({ success: false })
    await first
  })

  it('applies review episode notes to matching episodes', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文', review: '' }
    ]
    studio.value = normalizeScriptWritingStudio(studio.value)
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        review: {
          score: 80,
          summary: '整体成立',
          issues: ['第1集节奏偏慢'],
          suggestions: ['压缩开场'],
          episodeNotes: [{ episodeId: 'episode_1', notes: '开场铺垫过长' }]
        }
      }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.reviewDrafts()).toBe(true)
    expect(studio.value.review?.score).toBe(80)
    expect(studio.value.episodes[0]?.review).toBe('开场铺垫过长')
  })

  it('keeps the review task list while a single episode is revised', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '旧正文', review: '旧意见' }
    ]
    studio.value.review = {
      score: 70,
      summary: '需要修改',
      issues: ['节奏慢'],
      suggestions: ['压缩开场'],
      episodeNotes: [{ episodeId: 'episode_1', notes: '旧意见' }],
      tasks: [{ id: 'review_task_1', category: '节奏', severity: 'medium', episodeId: 'episode_1', location: '开场', issue: '节奏慢', suggestion: '压缩开场' }]
    }
    studio.value.resolvedReviewItems = ['review_task_1']
    fetchMock.mockResolvedValue({
      success: true,
      data: { episodeId: 'episode_1', draft: '新正文', continuityNotes: '' }
    })
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.generateEpisodeDraft('episode_1', true)).toBe(true)
    expect(studio.value.review?.tasks?.[0]?.id).toBe('review_task_1')
    expect(studio.value.resolvedReviewItems).toEqual(['review_task_1'])
    expect(studio.value.episodes[0]?.review).toBe('')
    expect(studio.value.provenance.reviewInput).toBe('')
  })

  it('requires every episode to be drafted before full review', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '正文', review: '' },
      { id: 'episode_2', index: 2, title: '结局', summary: '', hook: '', beats: [], draft: '', review: '' }
    ]
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })

    expect(await writing.reviewDrafts()).toBe(false)
    expect(writing.error.value).toContain('全部分集')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a named pinned milestone with a note and skips duplicate content', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '版本测试'
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })

    expect(await writing.createMilestone('人物关系定稿', '主角动机已经确认', 'bible'))
      .toEqual({ created: true, saved: true })
    expect(studio.value.versions[0]).toMatchObject({
      label: '人物关系定稿',
      note: '主角动机已经确认',
      kind: 'milestone',
      pinned: true,
      source: 'bible'
    })

    expect(await writing.createMilestone('重复版本')).toEqual({ created: false, saved: true })
    expect(studio.value.versions).toHaveLength(1)
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('creates a protection version before partial and full restores', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '历史创意'
    studio.value.episodes = [
      { id: 'episode_1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '历史正文', review: '' },
      { id: 'episode_2', index: 2, title: '结局', summary: '', hook: '', beats: [], draft: '历史结局', review: '' }
    ]
    const writing = useScriptWritingStudio({ studio, saveProject: vi.fn(async () => true) })
    await writing.createMilestone('历史版')
    const versionId = studio.value.versions[0]!.id
    studio.value.brief.idea = '当前创意'
    studio.value.episodes[0]!.draft = '当前正文'
    studio.value.episodes[1]!.draft = '当前结局'

    expect(await writing.restoreVersion(versionId, 'episode', 'episode_1')).toBe(true)
    expect(studio.value.episodes[0]?.draft).toBe('历史正文')
    expect(studio.value.episodes[1]?.draft).toBe('当前结局')
    expect(studio.value.brief.idea).toBe('当前创意')
    expect(studio.value.versions[0]).toMatchObject({
      kind: 'protection',
      pinned: false,
      source: 'restore',
      episodeId: 'episode_1'
    })

    studio.value.brief.idea = '再次修改'
    expect(await writing.restoreVersion(versionId, 'all')).toBe(true)
    expect(studio.value.brief.idea).toBe('历史创意')
    expect(studio.value.versions[0]).toMatchObject({ kind: 'protection', source: 'restore' })
  })

  it('persists pin and delete operations', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.brief.idea = '版本管理'
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })
    await writing.createMilestone('管理测试')
    const versionId = studio.value.versions[0]!.id

    expect(await writing.setVersionPinned(versionId, false)).toBe(true)
    expect(studio.value.versions[0]?.pinned).toBe(false)
    expect(await writing.deleteVersion(versionId)).toBe(true)
    expect(studio.value.versions).toHaveLength(0)
    expect(saveProject).toHaveBeenCalledTimes(3)
  })

  it('keeps an edited stale draft stale until it is explicitly confirmed', async () => {
    const studio = ref(createEmptyScriptWritingStudio())
    studio.value.storyBible = {
      premise: '追查真相', theme: '', world: '', tone: '', characters: [], rules: []
    }
    studio.value.episodes = [
      {
        id: 'episode_1', index: 1, title: '开局', summary: '旧大纲', hook: '', beats: ['收到线索'],
        draft: '人工修改后的旧正文', review: '', draftSource: 'old-source'
      }
    ]
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })

    expect(await writing.confirmEpisodeDraftCurrent('episode_1')).toBe(true)
    expect(studio.value.episodes[0]?.draftSource).not.toBe('old-source')
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('auto-saves edited writing content after the debounce delay', async () => {
    vi.useFakeTimers()
    const studio = ref(createEmptyScriptWritingStudio())
    const saveProject = vi.fn(async () => true)
    const writing = useScriptWritingStudio({ studio, saveProject })

    studio.value.brief.idea = '用户刚输入的创意'
    await nextTick()
    expect(writing.autoSaveState.value).toBe('dirty')
    await vi.advanceTimersByTimeAsync(1000)

    expect(saveProject).toHaveBeenCalledOnce()
    expect(writing.autoSaveState.value).toBe('saved')
  })
})

import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectsIndexPage } from './useProjectsIndexPage'

describe('useProjectsIndexPage', () => {
  let activate: () => void
  const push = vi.fn()
  const toastError = vi.fn()
  const fetchMock = vi.fn()
  let storage: Map<string, string>

  beforeEach(() => {
    vi.clearAllMocks()
    storage = new Map()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    } })
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', vi.fn())
    vi.stubGlobal('onMounted', vi.fn())
    vi.stubGlobal('onActivated', (callback: () => void) => { activate = callback })
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useRoute', () => ({ path: '/projects', query: {} }))
    vi.stubGlobal('useToast', () => ({ toast: { error: toastError } }))
    vi.stubGlobal('useCloudAdmin', () => ({
      bootstrap: vi.fn(), loadStatus: vi.fn(), currentUser: ref({ id: 'owner' })
    }))
    vi.stubGlobal('useStylePresets', () => ({
      presets: ref([{ id: 'style-1' }, { id: 'style-2' }]), categories: ref([]), defaultStyleId: ref('style-1'),
      loading: ref(false), resolveStyleById: vi.fn(), loadStylePresets: vi.fn()
    }))
    vi.stubGlobal('$fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('restores the last successfully used video preset across page instances', async () => {
    fetchMock.mockResolvedValue({ success: true, project: { id: 'created' } })
    const page = useProjectsIndexPage()
    await page.openCreateDialog()
    page.newProject.value.title = '科普视频'
    page.newProject.value.styleId = 'style-2'
    page.newProject.value.scriptParseMode = 'origin_explainer'
    await page.createProject()

    const nextPage = useProjectsIndexPage()
    await nextPage.openCreateDialog()
    expect(nextPage.newProject.value).toMatchObject({
      title: '', styleId: 'style-2', scriptParseMode: 'origin_explainer'
    })
  })

  it.each(['{invalid', JSON.stringify({ styleId: 'deleted', scriptParseMode: 'removed' })])(
    'falls back to defaults for an invalid saved preset: %s',
    async (saved) => {
      storage.set('playlet:last-video-project-preset:owner', saved)
      const page = useProjectsIndexPage()
      await page.openCreateDialog()
      expect(page.newProject.value).toMatchObject({ styleId: 'style-1', scriptParseMode: 'premium_drama' })
    }
  )

  it('does not replace the last used preset after failed creation', async () => {
    const saved = JSON.stringify({ styleId: 'style-2', scriptParseMode: 'origin_explainer' })
    storage.set('playlet:last-video-project-preset:owner', saved)
    fetchMock.mockResolvedValue({ success: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const page = useProjectsIndexPage()
    await page.openCreateDialog()
    page.newProject.value.title = '失败项目'
    page.newProject.value.styleId = 'style-1'
    await page.createProject()
    expect(storage.get('playlet:last-video-project-preset:owner')).toBe(saved)
    vi.restoreAllMocks()
  })

  it('creates a named draft before navigation and reloads it when returning to the cached list', async () => {
    const draft = { id: 'new-project', title: '未解析项目', status: 'draft', totalScenes: 0 }
    fetchMock.mockImplementation(async (url: string) => url === '/api/project/create'
      ? { success: true, project: draft }
      : { projects: [draft], pagination: { page: 1, total: 1 } })
    const page = useProjectsIndexPage()
    activate()
    expect(fetchMock).not.toHaveBeenCalled()
    page.newProject.value.title = draft.title
    await page.createProject()
    expect(fetchMock).toHaveBeenCalledWith('/api/project/create', expect.objectContaining({
      method: 'POST', body: expect.objectContaining({ title: draft.title, projectType: 'video' })
    }))
    expect(push).toHaveBeenCalledWith('/asset-workbench?project=new-project')
    expect(page.projects.value).toEqual([])

    activate()
    await vi.waitFor(() => expect(page.projects.value).toEqual([draft]))
    expect(page.totalProjects.value).toBe(1)
  })

  it('refreshes the current page and reports a failed return request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const page = useProjectsIndexPage()
    activate()
    page.currentPage.value = 2
    activate()
    await vi.waitFor(() => expect(page.error.value).toBe('获取项目列表失败'))
    expect(fetchMock).toHaveBeenCalledWith('/api/project/list', expect.objectContaining({
      query: expect.objectContaining({ page: 2 })
    }))
    vi.restoreAllMocks()
  })

  it('keeps the creation dialog and name when persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ success: false, message: '保存失败' })
    const page = useProjectsIndexPage()
    page.showCreateDialog.value = true
    page.newProject.value.title = '待保存项目'
    await page.createProject()
    expect(push).not.toHaveBeenCalled()
    expect(page.showCreateDialog.value).toBe(true)
    expect(page.newProject.value.title).toBe('待保存项目')
    expect(toastError).toHaveBeenCalled()
    expect(page.creating.value).toBe(false)
    vi.restoreAllMocks()
  })
})

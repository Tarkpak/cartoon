import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useCloudAdmin', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('shares one in-flight bootstrap across layout and page consumers', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    vi.stubGlobal('$fetch', fetchMock)

    const { useCloudAdmin } = await import('./useCloudAdmin')
    const layoutBootstrap = useCloudAdmin().bootstrap()
    const projectsPageBootstrap = useCloudAdmin().bootstrap()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveRequest?.({
      success: true,
      data: {
        authenticated: true,
        configured: true,
        baseUrl: 'https://admin.example.com',
        dataSync: {
          syncVersion: 2,
          projects: { imported: 40, skipped: 0, failed: 0 }
        }
      }
    })

    const [layoutStatus, projectsPageStatus] = await Promise.all([
      layoutBootstrap,
      projectsPageBootstrap
    ])

    expect(layoutStatus).toEqual(projectsPageStatus)
    expect(layoutStatus.dataSync?.projects).toEqual({ imported: 40, skipped: 0, failed: 0 })
  })
})

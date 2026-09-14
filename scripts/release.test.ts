import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleVisibilityToggle } from './release'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('release workflow and visibility', () => {
  const repo = { owner: 'example', repo: 'desktop' }
  const run = {
    id: 2,
    name: 'Desktop Release',
    head_branch: 'v1.0.0',
    head_sha: 'abc',
    html_url: 'https://github.com/example/desktop/actions/runs/2',
    status: 'completed',
    conclusion: 'success'
  }

  function setup(options: { private?: boolean, conclusion?: string, missing?: boolean, restoreFails?: boolean } = {}) {
    vi.useFakeTimers()
    const events: string[] = []
    let listings = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (init?.method === 'PATCH') {
        const isPrivate = JSON.parse(init.body as string).private
        events.push(`private:${isPrivate}`)
        return Response.json({}, { status: isPrivate && options.restoreFails ? 403 : 200 })
      }
      if (url.pathname.endsWith('/desktop')) {
        return Response.json({ private: options.private ?? false })
      }
      if (url.pathname.endsWith('/workflows/desktop-release.yml/runs')) {
        expect(url.searchParams.get('branch')).toBe('v1.0.0')
        expect(url.searchParams.get('head_sha')).toBe('abc')
        expect(url.searchParams.get('event')).toBe('push')
        listings++
        const oldRun = { ...run, id: 1 }
        const unrelated = { ...run, id: 3, head_branch: 'other' }
        return Response.json({ workflow_runs: listings <= 2 || options.missing ? [oldRun, unrelated] : [oldRun, unrelated, run] })
      }
      expect(url.pathname.endsWith('/actions/runs/2')).toBe(true)
      events.push('completed')
      return Response.json({ ...run, conclusion: options.conclusion ?? 'success' })
    }))
    return events
  }

  it.each([false, true])('waits for a fresh matching run and makes the repo private (initial private: %s)', async (isPrivate) => {
    const events = setup({ private: isPrivate })
    const result = handleVisibilityToggle(repo, 'v1.0.0', 'abc', () => { events.push('push') })
    await vi.runAllTimersAsync()
    await result
    expect(events).toEqual([...(isPrivate ? ['private:false'] : []), 'push', 'completed', 'private:true'])
  })

  it.each([
    { conclusion: 'failure', message: '构建失败' },
    { missing: true, message: '启动超时' },
    { restoreFails: true, message: '设置仓库可见性失败' }
  ])('rejects on $message', async (options) => {
    const events = setup(options)
    const assertion = expect(handleVisibilityToggle(repo, 'v1.0.0', 'abc', () => {})).rejects.toThrow(options.message)
    await vi.runAllTimersAsync()
    await assertion
    expect(events.at(-1)).toBe('private:true')
  })

  it('restores privacy when pushing fails', async () => {
    const events = setup({ private: true })
    await expect(handleVisibilityToggle(repo, 'v1.0.0', 'abc', () => {
      throw new Error('push failed')
    })).rejects.toThrow('push failed')
    expect(events).toEqual(['private:false', 'private:true'])
  })
})

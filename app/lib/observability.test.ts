import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerWorkbenchCollaboration } from './workbench-collaboration'
import { $fetch, observedFetch } from './observability'

let unregister: (() => void) | undefined
afterEach(() => { unregister?.(); vi.unstubAllGlobals() })

describe('generation request lease cleanup', () => {
  for (const transport of ['fetch', 'ofetch'] as const) {
    for (const outcome of ['success', 'http-error', 'network-error', 'prepare-error'] as const) {
      it(`settles ${transport} cleanup on ${outcome}`, async () => {
        const cleanup = vi.fn(async () => {})
        unregister = registerWorkbenchCollaboration('p', async (_path, body, onSettled) => {
          onSettled?.(cleanup)
          if (outcome === 'prepare-error') throw new Error('preparation failed')
          return body
        })
        vi.stubGlobal('fetch', vi.fn(async () => {
          if (outcome === 'network-error') throw new Error('connection lost')
          return new Response('{}', { status: outcome === 'http-error' ? 409 : 200, headers: { 'content-type': 'application/json' } })
        }))
        const body = { projectId: 'p' }
        const request = transport === 'fetch'
          ? observedFetch('/api/script/write', { method: 'POST', body: JSON.stringify(body) })
          : $fetch('/api/script/write', { method: 'POST', body, retry: 0 })
        if (outcome === 'success' || (transport === 'fetch' && outcome === 'http-error')) {
          const result = await request
          if (result instanceof Response) await result.text()
        }
        else await expect(request).rejects.toThrow()
        expect(cleanup).toHaveBeenCalledTimes(1)
      })
    }
  }

  it('holds a streaming request lease until the response is cancelled', async () => {
    const cleanup = vi.fn(async () => {})
    const cancel = vi.fn()
    unregister = registerWorkbenchCollaboration('p', async (_path, body, onSettled) => { onSettled?.(cleanup); return body })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }))))
    const response = await observedFetch('/api/script/parse-stream', { method: 'POST', body: JSON.stringify({ projectId: 'p' }) })
    expect(cleanup).not.toHaveBeenCalled()
    await response.body!.cancel()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

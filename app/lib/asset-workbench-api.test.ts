import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAssetWorkbenchScript } from './asset-workbench-api'

function createJsonLineStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    }
  })
}

describe('asset-workbench-api', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('does not attach an abort signal to script parse stream requests', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined()
      return new Response(createJsonLineStream([
        JSON.stringify({
          type: 'progress',
          payload: {
            step: 'parsing',
            message: 'Parsing',
            progress: 72
          }
        }),
        JSON.stringify({
          type: 'result',
          payload: {
            success: true,
            data: {
              scenes: []
            }
          }
        })
      ]), {
        status: 200
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onProgress = vi.fn()
    const response = await parseAssetWorkbenchScript({
      text: 'source text',
      scriptParseMode: 'short_drama',
      style: 'anime',
      episodePlan: [{
        id: 'episode_001',
        title: 'Episode 1',
        index: 1,
        startOffset: 0,
        endOffset: 10
      }],
      onProgress
    })

    expect(response.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith({
      source: 'progress',
      step: 'parsing',
      message: 'Parsing',
      progress: 72,
      chunkIndex: undefined,
      chunkCount: undefined
    })
  })
})

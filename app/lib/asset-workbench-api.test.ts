import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observedFetch } from '~/lib/observability'

vi.mock('~/lib/observability', () => ({
  observedFetch: vi.fn()
}))

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
  const observedFetchMock = observedFetch as unknown as {
    mockReset: () => void
    mockResolvedValue: (value: Response) => void
    mock: {
      calls: Array<[RequestInfo | URL, RequestInit | undefined]>
    }
  }

  beforeEach(() => {
    observedFetchMock.mockReset()
  })

  it('does not attach an abort signal to script parse stream requests', async () => {
    const { parseAssetWorkbenchScript } = await import('./asset-workbench-api')
    observedFetchMock.mockResolvedValue(
      new Response(createJsonLineStream([
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
    )

    const onProgress = vi.fn()
    const response = await parseAssetWorkbenchScript({
      text: 'source text',
      targetEpisodeId: 'episode_001',
      scriptParseMode: 'premium_drama',
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
    expect(observedFetchMock.mock.calls).toHaveLength(1)
    const [, requestInit] = observedFetchMock.mock.calls[0]
    expect(requestInit?.signal).toBeUndefined()
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      text: 'source text',
      targetEpisodeId: 'episode_001'
    })
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

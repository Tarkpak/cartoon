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
  it('streams directory progress and returns the complete episode plan', async () => {
    const { prepareAssetWorkbenchEpisodePlan } = await import('./asset-workbench-api')
    const episodes = [{ id: 'ep1', title: '第一集', index: 1, startOffset: 0, endOffset: 6 }]
    observedFetchMock.mockResolvedValue(new Response(createJsonLineStream([
      JSON.stringify({ type: 'progress', payload: {
        step: 'generating', message: '正在接收内容', streamState: 'receiving', outputChars: 128
      } }),
      JSON.stringify({ type: 'result', payload: { success: true, data: { episodes } } })
    ])))
    const onProgress = vi.fn()
    const signal = new AbortController().signal
    await expect(prepareAssetWorkbenchEpisodePlan('source', 'premium_drama', { onProgress, signal }))
      .resolves.toEqual(episodes)
    expect(observedFetchMock.mock.calls[0][0]).toBe('/api/script/episode-plan-stream')
    expect(observedFetchMock.mock.calls[0][1]?.signal).toBe(signal)
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      streamState: 'receiving', outputChars: 128
    }))
  })

  it('rejects directory streams that end before returning a complete result', async () => {
    const { prepareAssetWorkbenchEpisodePlan } = await import('./asset-workbench-api')
    observedFetchMock.mockResolvedValue(new Response(createJsonLineStream([
      JSON.stringify({ type: 'progress', payload: { step: 'generating', message: '等待模型输出' } })
    ])))
    await expect(prepareAssetWorkbenchEpisodePlan('source', 'premium_drama', { onProgress: vi.fn() }))
      .rejects.toThrow('未收到结果')
  })

  function requestOptions() {
    return { text: 'source', targetEpisodeId: 'episode_001', episodePlan: [], onProgress: vi.fn() }
  }

  it('cancels and unlocks the response when a stream event fails', async () => {
    const { parseAssetWorkbenchScript } = await import('./asset-workbench-api')
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"error","payload":{"message":"第 3 批失败","step":"batch_retry","chunkIndex":2,"chunkCount":4}}\n'))
      }, cancel
    })
    const response = new Response(stream)
    observedFetchMock.mockResolvedValue(response)
    const options = requestOptions()
    await expect(parseAssetWorkbenchScript(options)).rejects.toThrow('第 3 批失败')
    expect(options.onProgress).toHaveBeenCalledWith(expect.objectContaining({ step: 'batch_retry', chunkIndex: 2, chunkCount: 4 }))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(response.body?.locked).toBe(false)
  })

  it('preserves UTF-8 across chunks and accepts a final event without a newline', async () => {
    const { parseAssetWorkbenchScript } = await import('./asset-workbench-api')
    const bytes = new TextEncoder().encode('{"type":"result","payload":{"success":true,"data":{"title":"甜品诞生记","scenes":[]}}}')
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      }
    }))
    observedFetchMock.mockResolvedValue(response)
    const signal = new AbortController().signal
    const result = await parseAssetWorkbenchScript({ ...requestOptions(), signal })
    expect(result.data?.title).toBe('甜品诞生记')
    expect(observedFetchMock.mock.calls[0][1]?.signal).toBe(signal)
    expect(response.body?.locked).toBe(false)
  })

  it('rejects an unfinished stream instead of returning an empty success', async () => {
    const { parseAssetWorkbenchScript } = await import('./asset-workbench-api')
    const response = new Response(createJsonLineStream(['{"type":"heartbeat","payload":{}}']))
    observedFetchMock.mockResolvedValue(response)
    await expect(parseAssetWorkbenchScript(requestOptions())).rejects.toThrow('未收到结果')
    expect(response.body?.locked).toBe(false)
  })

})

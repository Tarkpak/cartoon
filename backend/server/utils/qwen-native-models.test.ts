import { describe, expect, it } from 'bun:test'
import { fetchQwenNativeModels, qwenNativeModelsEndpoint } from './qwen-native-models'

describe('Qwen native model catalog', () => {
  it('uses the native path while preserving regional and workspace hosts', () => {
    for (const host of ['dashscope.aliyuncs.com', 'workspace.cn-beijing.maas.aliyuncs.com', 'dashscope-intl.aliyuncs.com']) {
      expect(qwenNativeModelsEndpoint(`https://${host}/compatible-mode/v1`).href).toBe(`https://${host}/api/v1/models`)
    }
  })

  it('fetches every page, including a video model missing from the compatible catalog', async () => {
    const pages: string[] = []
    const models = await fetchQwenNativeModels('https://dashscope.aliyuncs.com/compatible-mode/v1', 'test-key', async (url, init) => {
      pages.push(url.searchParams.get('page_no')!)
      expect(init.headers).toEqual({ accept: 'application/json', authorization: 'Bearer test-key' })
      const model = pages.length === 1 ? 'qwen3.8-max' : 'wan3.0-video'
      return Response.json({ success: true, output: { total: 2, models: [{ model }] } })
    })
    expect(pages).toEqual(['1', '2'])
    expect(models).toEqual(['qwen3.8-max', 'wan3.0-video'])
  })

  it('rejects upstream HTTP and application errors', async () => {
    for (const response of [new Response('', { status: 403 }), Response.json({ success: false, code: 'AccessDenied' })]) {
      await expect(fetchQwenNativeModels('https://dashscope.aliyuncs.com', 'key', async () => response)).rejects.toThrow()
    }
  })

  it('rejects malformed, empty or repeated pages instead of saving a partial list', async () => {
    for (const payload of [{ data: [] }, { output: { total: 1, models: [] } }, { output: { total: 2, models: [{ model: 'qwen' }] } }]) {
      await expect(fetchQwenNativeModels('https://dashscope.aliyuncs.com', 'key', async () => Response.json(payload))).rejects.toThrow()
    }
  })
})

import { normalizeModelList, type NativeProviderModel } from './model-provider-models'

export function qwenNativeModelsEndpoint(baseUrl: string) {
  const url = new URL(baseUrl)
  url.pathname = '/api/v1/models'
  url.search = ''
  url.hash = ''
  return url
}

// The OpenAI-compatible catalog omits native models such as Wan video.
export async function fetchQwenNativeModels(baseUrl: string, apiKey: string, request: (url: URL, init: RequestInit) => Promise<Response> = fetch): Promise<NativeProviderModel[]> {
  const models: NativeProviderModel[] = []
  let received = 0
  const pageSize = 100
  for (let page = 1; page <= 1000; page++) {
    const url = qwenNativeModelsEndpoint(baseUrl)
    url.searchParams.set('page_no', String(page))
    url.searchParams.set('page_size', String(pageSize))
    const response = await request(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`Native model catalog HTTP ${response.status}`)
    const payload = await response.json()
    if (payload.success === false || payload.code) {
      throw new Error(`Native model catalog failed: ${payload.message || payload.code || 'unknown error'}`)
    }
    const output = payload.output
    if (!output || !Array.isArray(output.models) || !Number.isInteger(output.total) || output.total < 0) {
      throw new Error('Invalid native model catalog response')
    }
    const ids = normalizeModelList(output.models.map((item: { model?: unknown } | null) => item?.model))
    if (ids.length !== output.models.length) throw new Error('Invalid native model catalog entries')
    const next = normalizeModelList([...models.map(item => item.model), ...ids])
    if (ids.length === 0 || next.length === models.length) {
      throw new Error('Native model catalog returned an empty or repeated page')
    }
    for (const item of output.models) {
      if (models.some(existing => existing.model === item.model)) continue
      models.push({ model: item.model, name: typeof item.name === 'string' ? item.name : undefined,
        description: typeof item.description === 'string' ? item.description : undefined,
        capabilities: normalizeModelList(item.capabilities),
        inference_metadata: { response_modality: normalizeModelList(item.inference_metadata?.response_modality) } })
    }
    received += output.models.length
    if (received >= output.total) return models
  }
  throw new Error('Native model catalog exceeded pagination limit')
}

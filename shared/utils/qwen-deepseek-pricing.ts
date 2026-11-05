import catalog from '../qwen-deepseek-pricing.json'

type Usage = Record<string, unknown>
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const seconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function estimateQwenDeepSeek(provider: string, model: string, operation: string, usage: Usage) {
  if (provider !== 'qwen' && provider !== 'deepseek') return null
  if (provider === 'qwen' && usage.pricingRegion !== 'cn-beijing') return null
  let cost: number
  let basis = 'official-list-price'
  if (operation === 'generateText') {
    const { inputTokens: input, outputTokens: output, cachedTokens: cached } = usage
    if (!integer(input) || !integer(output) || !integer(cached) || cached > input
      || Number(usage.cacheWriteTokens || 0) > 0 || !['default', 'standard'].includes(String(usage.serviceTier ?? 'default'))) return null
    const rows = (catalog[provider] as Record<string, (number | null)[][]>)[model]
    const row = rows?.find(r => input <= Number(r[0]))
    if (!row || (cached > 0 && row[2] == null)) return null
    const amount = BigInt(input - cached) * BigInt(row[1]!) + BigInt(cached) * BigInt(row[2] ?? 0) + BigInt(output) * BigInt(row[3]!)
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null
    cost = Number(amount)
    if (provider === 'deepseek') basis = 'official-peak-reference'
  } else if (provider === 'qwen' && operation === 'generateImage') {
    const row = (catalog.imageNanoCny as Record<string, number[]>)[model]
    if (!row || !integer(usage.outputImages) || (row[0] > 0 && !integer(usage.inputImages))) return null
    cost = (row[0] ? Number(usage.inputImages) * row[0] : 0) + usage.outputImages * row[1]
  } else if (provider === 'qwen' && operation === 'generateVideo' && usage.videoStatus === 'SUCCEEDED') {
    const rate = (catalog.videoNanoCnyPerSecond as Record<string, Record<string, number>>)[model]?.[String(usage.resolution)]
    if (!rate || !seconds(usage.durationSeconds)) return null
    let input = 0
    if (model.startsWith('wan3.0-video')) {
      if (!seconds(usage.inputVideoSeconds)) return null
      input = usage.inputVideoSeconds
    }
    cost = Math.round((input + usage.durationSeconds) * rate)
  } else return null
  if (!integer(cost)) return null
  return { cost, snapshot: { version: catalog.version, source: catalog.sources[provider], model,
    currency: provider === 'qwen' ? 'CNY' : 'USD', basis, region: usage.pricingRegion } }
}

export function priceQwenDeepSeekRecord(record: Record<string, unknown>) {
  const usage = record.usage as Usage | undefined
  if (!usage || usage.costNanoUsd != null || usage.costNanoCny != null) return record
  const provider = String(record.provider)
  const result = estimateQwenDeepSeek(provider, String(usage.model ?? record.model), String(record.operation), usage)
  if (!result) return record
  return { ...record, usage: { ...usage, [provider === 'qwen' ? 'costNanoCny' : 'costNanoUsd']: result.cost,
    currency: result.snapshot.currency, pricingStatus: 'priced', priceSnapshot: result.snapshot } }
}

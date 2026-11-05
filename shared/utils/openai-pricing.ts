import catalog from '../openai-pricing.json'

type Rule = { short: Array<number | null>, long: Array<number | null> | null }
type Usage = Record<string, unknown>
export function estimateOpenAI(model: string, operation: string, usage: Usage) {
  const image = operation === 'generateImage'
  if (!image && operation !== 'generateText') return null
  const models = (image ? catalog.image : catalog.text) as Record<string, Record<string, Rule>>
  const normalized = model.trim().replace(/^(models\/)+/, '').trim()
  const id = Object.keys(models).find(id => {
    if (normalized === id) return true
    const date = normalized.slice(id.length + 1)
    return normalized.startsWith(`${id}-`) && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
  })
  if (!id) return null
  const integer = (key: string, fallback?: number) => {
    const value = usage[key] ?? fallback
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  const input = integer('inputTokens')
  const output = integer('outputTokens')
  const cached = integer('cachedTokens', 0)
  if (input == null || output == null || cached == null || cached > input || integer('cacheWriteTokens', 0) !== 0) return null
  const tier = usage.serviceTier === 'priority' ? 'fast' : String(usage.serviceTier || 'default')
  const long = input > 272000 && models[id].default.long != null
  const rates = models[id][tier]?.[long ? 'long' : 'short']
  if (!rates || rates[0] == null || rates[2] == null) return null
  let base: bigint
  if (image) {
    const text = integer('textInputTokens')
    const im = integer('imageInputTokens')
    if (text == null || im == null || text + im !== input || cached !== 0 || integer('textOutputTokens', 0) !== 0 || rates[3] == null) return null
    base = BigInt(text) * BigInt(rates[0]) + BigInt(im) * BigInt(rates[3]) + BigInt(output) * BigInt(rates[2])
  } else {
    if (cached > 0 && rates[1] == null) return null
    base = BigInt(input - cached) * BigInt(rates[0]) + BigInt(cached) * BigInt(rates[1] || 0) + BigInt(output) * BigInt(rates[2])
  }
  const cost = (base + BigInt(500)) / BigInt(1000)
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return { costNanoUsd: Number(cost), priceSnapshot: { version: catalog.version, source: catalog.source, basis: 'official-reference', model: id, serviceTier: tier, context: long ? 'long' : 'short', ratesMicroUsdPerMillion: rates } }
}

export function priceOpenAIRecord(record: Record<string, unknown>) {
  const usage = record.usage as Usage | undefined
  if (record.provider !== 'openai' || !usage || usage.costNanoUsd != null) return record
  const estimate = estimateOpenAI(String(usage.model || record.model || ''), String(record.operation || ''), usage)
  return estimate ? { ...record, usage: { ...usage, ...estimate, currency: 'USD', pricingStatus: 'priced' } } : record
}

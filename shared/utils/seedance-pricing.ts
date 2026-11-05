import catalog from '../seedance-pricing.json'

export function estimateSeedance(model: string, usage: Record<string, unknown>) {
  const normalized = model.trim().toLowerCase().replace(/[._]/g, '-').replace(/^models\//, '')
  const models = catalog.models as Record<string, Record<string, Record<string, number[]>>>
  const id = Object.keys(models).find(id => normalized === id || (normalized.startsWith(`${id}-`) && /^\d{6}$/.test(normalized.slice(id.length + 1))))
  if (!id) return null
  const status = usage.videoStatus
  if (!['succeeded', 'failed', 'cancelled', 'expired'].includes(String(status))) return null
  const failed = status !== 'succeeded'
  const tokens = failed ? 0 : usage.outputTokens
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) return null
  const tier = String(usage.serviceTier || 'default')
  const mode = tier === 'default' || tier === 'online' ? 'online' : tier === 'flex' || tier === 'offline' ? 'offline' : ''
  const resolution = usage.resolution === '2160p' ? '4k' : String(usage.resolution || '').toLowerCase()
  const rates = models[id][mode]?.[resolution] || models[id][mode]?.['*']
  const hasVideo = usage.hasVideoInput
  const rate = rates && (typeof hasVideo === 'boolean' ? rates[hasVideo ? 1 : 0] : rates[0] === rates[1] ? rates[0] : undefined)
  if (!failed && (rate == null || usage.draftSourceUnknown === true)) return null
  const cost = failed ? 0 : tokens * Math.round(rate! * 1000)
  if (!Number.isSafeInteger(cost)) return null
  return { costNanoCny: cost, currency: 'CNY', pricingStatus: 'priced', priceSnapshot: { version: catalog.version, source: catalog.source, model: id, currency: 'CNY', rateCnyPerMillion: rate ?? null, resolution, hasVideoInput: hasVideo ?? null, serviceTier: mode, basis: failed ? 'official-failed-no-charge' : 'official-completion-tokens' } }
}

export function priceSeedanceRecord(record: Record<string, unknown>) {
  const usage = record.usage as Record<string, unknown> | undefined
  if (record.provider !== 'volcengine' || record.operation !== 'generateVideo' || !usage || usage.costNanoCny != null || usage.costNanoUsd != null) return record
  const estimate = estimateSeedance(String(usage.model || record.model || ''), usage)
  return estimate ? { ...record, usage: { ...usage, ...estimate } } : record
}

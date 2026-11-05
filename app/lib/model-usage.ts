export interface UsageTotals {
  calls: number
  unknownCalls: number
  pricedCalls: number
  inputTokens: number
  outputTokens: number
  costNanoUsd: number
  costNanoCny?: number
  pricedUsdCalls?: number
  pricedCnyCalls?: number
  averageCostNanoCny?: number | null
  averageCostNanoUsd?: number | null
  coverage?: number
}

export interface UsageGroup extends UsageTotals { key: string, label: string }
export interface UsageFilters { startDate: string, endDate: string, projectId: string, providerInstanceId: string, model: string, stage: string, currency?: string }
export interface UsageRecord {
  id: string
  createdAt: string
  requestId?: string
  model: string
  provider: string
  providerInstanceId?: string
  providerInstanceName?: string
  projectId?: string
  stage?: string
  operation: string
  status: string
  usage: {
    model?: string
    usageStatus: string
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    cachedTokens: number
    reasoningTokens: number | null
    textInputTokens: number | null
    imageInputTokens: number | null
    costNanoUsd: number | null
    costNanoCny?: number | null
    currency?: string
    videoStatus?: string
    billingUnit?: string
    inputImages?: number | null
    outputImages?: number | null
    durationSeconds?: number | null
    inputVideoSeconds?: number | null
    characters?: number | null
    pricingStatus: string
    priceSnapshot?: { version?: string, source?: string }
  }
}

export interface UsageData {
  total: UsageTotals
  today: UsageTotals
  month: UsageTotals
  records: UsageRecord[]
  projects: UsageGroup[]
  stages: UsageGroup[]
  models: UsageGroup[]
  options: { projects: UsageGroup[], providers: UsageGroup[], models: UsageGroup[], stages: UsageGroup[] }
  page: number
  pageSize: number
  totalPages: number
}

export function usageStage(value: string) {
  return ({ generateText: '文本生成 / 剧本解析', generateImage: '图片生成 / 编辑', generateVideo: '视频生成', scene_detail: '分镜细化', video_review: '视频审查' } as Record<string, string>)[value] || value
}

export function usageProvider(id: string, options: Array<{ key: string, label: string }> = []) {
  if (id.endsWith(':legacy')) {
    const names: Record<string, string> = { openai: 'OpenAI', qwen: '通义千问', deepseek: 'DeepSeek', volcengine: '火山引擎' }
    return `${names[id.split(':')[0]] || '兼容供应商'} · 历史未区分`
  }
  const name = options.find(item => item.key === id)?.label
  return name && name !== id ? `${name} · ${id.slice(-6)}` : id
}

export function usageModelGroup(key: string) {
  try {
    const parts: unknown = JSON.parse(key)
    if (Array.isArray(parts) && parts.length === 3 && parts.every(item => typeof item === 'string')) {
      return { instanceId: parts[0] as string, model: parts[1] as string, stage: parts[2] as string }
    }
  } catch { /* Old / invalid group labels remain readable. */ }
  return { instanceId: '', model: key, stage: '' }
}

export function usageCost(value: number | null, currency = 'USD') {
  if (value == null) return '暂无法估价'
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (value > 0 && value < 100_000) return `< ${symbol}0.0001`
  return `${symbol}${(value / 1e9).toFixed(4)}`
}

export function usageTotalsCost(value: UsageTotals) {
  const costs: string[] = []
  if (value.pricedUsdCalls ?? value.pricedCalls) costs.push(usageCost(value.costNanoUsd))
  if (value.pricedCnyCalls) costs.push(usageCost(value.costNanoCny || 0, 'CNY'))
  return costs.join(' / ') || '暂无法估价'
}

export function usageTokens(value: number | null) {
  return value == null ? '未知' : value.toLocaleString('zh-CN')
}

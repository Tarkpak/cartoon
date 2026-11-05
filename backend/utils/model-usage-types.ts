export interface UsageTotals {
  calls: number
  pricedCalls: number
  unknownCalls: number
  inputTokens: number
  outputTokens: number
  costNanoUsd: number
  costNanoCny: number
  pricedUsdCalls: number
  pricedCnyCalls: number
}

export interface UsageGroup extends UsageTotals {
  key: string
  label: string
}

export interface UsageDetail {
  id: string
  userId: string
  userName: string
  createdAt: string
  projectId: string | null
  requestId: string | null
  provider: string | null
  providerInstanceName: string | null
  model: string | null
  stage: string | null
  status: string | null
  inputTokens: number | null
  outputTokens: number | null
  costNanoUsd: number | null
  costNanoCny: number | null
  currency: string
  videoStatus?: string
  billingUnit?: string
  inputImages?: number | null
  outputImages?: number | null
  durationSeconds?: number | null
  inputVideoSeconds?: number | null
  characters?: number | null
  usageStatus: string
}

export interface AdminUsageData {
  total: UsageTotals
  users: UsageGroup[]
  models: UsageGroup[]
  records: UsageDetail[]
  pagination: { page: number, pageSize: number, total: number }
  options: {
    users: Array<{ label: string, value: string }>
    providers: string[]
    models: string[]
  }
}

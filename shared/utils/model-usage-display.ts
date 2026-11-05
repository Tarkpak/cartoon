export interface LogUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  costNanoUsd?: number | null
  costNanoCny?: number | null
  currency?: string
  videoStatus?: string
  usageStatus?: string
  billingUnit?: string
  inputImages?: number | null
  outputImages?: number | null
  durationSeconds?: number | null
  inputVideoSeconds?: number | null
  characters?: number | null
}

export function logUsageTokens(usage?: LogUsage | null) {
  const token = (value?: number | null) => value == null ? '未知' : value.toLocaleString('zh-CN')
  if (usage?.billingUnit === 'images') return `图片输入 ${token(usage.inputImages)} / 输出 ${token(usage.outputImages)} 张`
  if (usage?.billingUnit === 'seconds') return `视频输入 ${token(usage.inputVideoSeconds)} / 输出 ${token(usage.durationSeconds)} 秒`
  if (usage?.billingUnit === 'characters') return `语音合成 ${token(usage.characters)} 字符`
  if (usage?.videoStatus) return `视频计费 token ${token(usage.outputTokens)}`
  return usage ? `输入 ${token(usage.inputTokens)} / 输出 ${token(usage.outputTokens)}` : '未采集用量'
}

export function logUsageCost(usage?: LogUsage | null) {
  const cny = usage?.currency === 'CNY'
  const value = cny ? usage?.costNanoCny : usage?.costNanoUsd
  return value == null ? '未估价' : `${cny ? '¥' : '$'}${(value / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 9 })}`
}

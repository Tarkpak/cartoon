export type DurationProfile = 'http' | 'model'
export type DurationLevel = 'neutral' | 'normal' | 'warning' | 'critical'

const DURATION_THRESHOLDS: Record<DurationProfile, { warning: number, critical: number }> = {
  http: { warning: 1_000, critical: 3_000 },
  model: { warning: 15_000, critical: 60_000 }
}

function normalizeDuration(value: unknown): number | null {
  const duration = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function formatDurationMs(value: unknown): string {
  const duration = normalizeDuration(value)
  if (duration === null) return '-'

  if (duration < 1_000) return `${Math.round(duration)} ms`
  if (duration < 60_000) {
    const seconds = duration / 1_000
    const precision = seconds < 10 ? 2 : 1
    return `${Number(seconds.toFixed(precision))} s`
  }

  const totalSeconds = Math.round(duration / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) parts.push(`${hours} h`)
  if (minutes > 0) parts.push(`${minutes} min`)
  if (seconds > 0 && hours === 0) parts.push(`${seconds} s`)

  return parts.join(' ') || '0 s'
}

export function durationLevel(value: unknown, profile: DurationProfile): DurationLevel {
  const duration = normalizeDuration(value)
  if (duration === null) return 'neutral'

  const thresholds = DURATION_THRESHOLDS[profile]
  if (duration >= thresholds.critical) return 'critical'
  if (duration >= thresholds.warning) return 'warning'
  return 'normal'
}

export function durationBarPercent(value: unknown, profile: DurationProfile): number {
  const duration = normalizeDuration(value)
  if (duration === null || duration === 0) return 0

  const { critical } = DURATION_THRESHOLDS[profile]
  return Math.min(100, Math.max(8, (duration / critical) * 100))
}

export function durationExactLabel(value: unknown): string {
  const duration = normalizeDuration(value)
  if (duration === null) return '无耗时数据'
  return `精确耗时 ${Math.round(duration).toLocaleString('en-US')} ms`
}

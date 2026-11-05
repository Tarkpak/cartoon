import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import { priceOpenAIRecord } from '../../../shared/utils/openai-pricing'
import { priceSeedanceRecord } from '../../../shared/utils/seedance-pricing'
import { priceQwenDeepSeekRecord } from '../../../shared/utils/qwen-deepseek-pricing'

// Match a single attempt, never a whole request (which may contain retries).
export const modelLogUsageSql = `(SELECT json_extract(usage.record_json, '$.usage') FROM model_usage_records usage
  WHERE usage.user_id=l.user_id AND usage.id=l.client_event_id)`

export function ensureModelUsageSchema(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS model_usage_records (
    user_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL,
    record_json TEXT NOT NULL, PRIMARY KEY(user_id, id));
    CREATE INDEX IF NOT EXISTS idx_usage_user_date ON model_usage_records(user_id, created_at);`)
  // Only fill missing estimates; historical priced records are immutable.
  const rows = db.query("SELECT user_id,id,record_json FROM model_usage_records WHERE json_extract(record_json,'$.provider')='openai' AND json_extract(record_json,'$.usage.costNanoUsd') IS NULL").all() as Array<{ user_id: string, id: string, record_json: string }>
  db.transaction(() => {
    const update = db.prepare('UPDATE model_usage_records SET record_json=? WHERE user_id=? AND id=?')
    for (const row of rows) {
      const record = JSON.parse(row.record_json)
      const priced = priceOpenAIRecord(record)
      if (priced !== record) update.run(JSON.stringify(priced), row.user_id, row.id)
    }
  })()
}

export function saveModelUsage(db: Database, userId: string, eventId: string | null, value: unknown) {
  if (value == null) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 400, message: '用量记录无效' })
  const record = priceQwenDeepSeekRecord(priceSeedanceRecord(priceOpenAIRecord(value as Record<string, unknown>)))
  const usage = record.usage as Record<string, unknown> | undefined
  if (!eventId || record.id !== eventId || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || !usage || !['reported', 'unknown'].includes(String(usage.usageStatus))) {
    throw createError({ statusCode: 400, message: '用量记录身份或格式无效' })
  }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd', 'costNanoCny', 'inputImages', 'outputImages', 'characters']) {
    const n = usage[key]
    if (n != null && (!Number.isSafeInteger(n) || Number(n) < 0)) throw createError({ statusCode: 400, message: '用量数值无效' })
  }
  for (const key of ['durationSeconds', 'inputVideoSeconds']) {
    const n = usage[key]
    if (n != null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw createError({ statusCode: 400, message: '用量时长无效' })
  }
  // Explicit allowlist: never persist credentials or arbitrary request/response content.
  const safeUsage = Object.fromEntries(['usageStatus', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens',
    'textInputTokens', 'imageInputTokens', 'textOutputTokens', 'cacheWriteTokens', 'model', 'serviceTier', 'upstreamId', 'costNanoUsd', 'costNanoCny', 'currency', 'pricingStatus', 'priceSnapshot', 'videoStatus', 'resolution', 'hasVideoInput', 'durationSeconds', 'draftSourceUnknown', 'pricingRegion', 'billingUnit', 'inputImages', 'outputImages', 'inputVideoSeconds', 'characters']
    .map(key => [key, usage[key]]))
  const safe = Object.fromEntries(['id', 'createdAt', 'requestId', 'projectId', 'sceneId', 'taskId', 'provider', 'providerInstanceId', 'providerInstanceName', 'stage', 'model', 'operation', 'status']
    .map(key => [key, typeof record[key] === 'string' ? record[key].slice(0, 256) : null]))
  const json = JSON.stringify({ ...safe, usage: safeUsage })
  if (json.length > 16_384) throw createError({ statusCode: 400, message: '用量记录过大' })
  db.prepare(`INSERT INTO model_usage_records(user_id,id,created_at,record_json) VALUES(?,?,?,?)
    ON CONFLICT(user_id,id) DO UPDATE SET record_json=excluded.record_json
    WHERE json_extract(model_usage_records.record_json, '$.usage.usageStatus') != 'reported'
      OR (COALESCE(json_extract(model_usage_records.record_json,'$.usage.costNanoUsd'),json_extract(model_usage_records.record_json,'$.usage.costNanoCny')) IS NULL
          AND COALESCE(json_extract(excluded.record_json,'$.usage.costNanoUsd'),json_extract(excluded.record_json,'$.usage.costNanoCny')) IS NOT NULL)`)
    .run(userId, eventId, record.createdAt, json)
}

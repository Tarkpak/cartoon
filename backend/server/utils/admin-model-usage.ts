import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import type { AdminUsageData, UsageDetail, UsageGroup, UsageTotals } from '../../utils/model-usage-types'

const source = `SELECT r.id, r.user_id AS userId,
  COALESCE(NULLIF(u.display_name,''),u.account,r.user_id) AS userName,
  r.created_at AS createdAt,
  json_extract(record_json,'$.projectId') AS projectId,
  json_extract(record_json,'$.requestId') AS requestId,
  json_extract(record_json,'$.provider') AS provider,
  json_extract(record_json,'$.providerInstanceName') AS providerInstanceName,
  COALESCE(json_extract(record_json,'$.providerInstanceId'),json_extract(record_json,'$.provider') || ':legacy','unknown') AS instanceId,
  COALESCE(json_extract(record_json,'$.usage.model'),json_extract(record_json,'$.model'),'未知模型') AS model,
  COALESCE(json_extract(record_json,'$.stage'),json_extract(record_json,'$.operation')) AS stage,
  json_extract(record_json,'$.status') AS status,
  json_extract(record_json,'$.usage.inputTokens') AS inputTokens,
  json_extract(record_json,'$.usage.outputTokens') AS outputTokens,
  json_extract(record_json,'$.usage.costNanoUsd') AS costNanoUsd,
  json_extract(record_json,'$.usage.costNanoCny') AS costNanoCny,
  COALESCE(json_extract(record_json,'$.usage.currency'),'USD') AS currency,
  json_extract(record_json,'$.usage.videoStatus') AS videoStatus,
  json_extract(record_json,'$.usage.billingUnit') AS billingUnit,
  json_extract(record_json,'$.usage.inputImages') AS inputImages,
  json_extract(record_json,'$.usage.outputImages') AS outputImages,
  json_extract(record_json,'$.usage.durationSeconds') AS durationSeconds,
  json_extract(record_json,'$.usage.inputVideoSeconds') AS inputVideoSeconds,
  json_extract(record_json,'$.usage.characters') AS characters,
  json_extract(record_json,'$.usage.usageStatus') AS usageStatus
  FROM model_usage_records r LEFT JOIN users u ON u.id=r.user_id`

const aggregates = `COUNT(*) AS calls, COUNT(COALESCE(costNanoUsd,costNanoCny)) AS pricedCalls,
  COALESCE(SUM(CASE WHEN usageStatus='reported' THEN 0 ELSE 1 END),0) AS unknownCalls,
  COALESCE(SUM(inputTokens),0) AS inputTokens, COALESCE(SUM(outputTokens),0) AS outputTokens,
  COALESCE(SUM(costNanoUsd),0) AS costNanoUsd,COALESCE(SUM(costNanoCny),0) AS costNanoCny,
  COUNT(costNanoUsd) AS pricedUsdCalls,COUNT(costNanoCny) AS pricedCnyCalls`

function dateBound(raw: string, next: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw createError({ statusCode: 400, message: '日期格式无效' })
  const utc = Date.parse(`${raw}T00:00:00Z`)
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== raw) {
    throw createError({ statusCode: 400, message: '日期无效' })
  }
  return new Date(utc - 8 * 3600000 + (next ? 86400000 : 0)).toISOString()
}

export function queryAdminModelUsage(db: Database, query: Record<string, unknown>): AdminUsageData {
  const params: (string | number)[] = []
  const clauses: string[] = []
  const field = (key: string) => {
    const value = query[key]
    if (value == null || value === '') return ''
    if (typeof value !== 'string' || value.length > 256) throw createError({ statusCode: 400, message: `${key} 无效` })
    return value
  }
  const start = field('startDate')
  const end = field('endDate')
  const currency = field('currency')
  if (currency && !['USD', 'CNY'].includes(currency)) throw createError({ statusCode: 400, message: '币种无效' })
  const sortCost = currency === 'CNY' ? 'costNanoCny' : 'costNanoUsd'
  if (start) { clauses.push('julianday(createdAt)>=julianday(?)'); params.push(dateBound(start, false)) }
  if (end) { clauses.push('julianday(createdAt)<julianday(?)'); params.push(dateBound(end, true)) }
  if (start && end && start > end) throw createError({ statusCode: 400, message: '开始日期不能晚于结束日期' })
  for (const key of ['userId', 'provider', 'model', 'projectId', 'currency']) {
    const value = field(key)
    if (value) { clauses.push(`${key}=?`); params.push(value) }
  }
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(query[key] ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw createError({ statusCode: 400, message: `${key} 无效` })
    return value
  }
  const page = integer('page', 1, 1_000_000)
  const pageSize = integer('pageSize', 50, 100)
  const filtered = `WITH ledger AS (${source}), filtered AS (SELECT * FROM ledger ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''})`
  return db.transaction(() => {
    const total = db.query(`${filtered} SELECT ${aggregates} FROM filtered`).get(...params) as UsageTotals
    const users = db.query(`${filtered} SELECT userId AS key, MAX(userName) AS label, ${aggregates}
      FROM filtered GROUP BY userId ORDER BY ${sortCost} DESC,calls DESC,key LIMIT 20`).all(...params) as UsageGroup[]
    const models = db.query(`${filtered} SELECT json_array(instanceId,model) AS key,
      COALESCE(MAX(providerInstanceName),MAX(provider),'未知供应商') || ' / ' || model AS label, ${aggregates}
      FROM filtered GROUP BY instanceId,model ORDER BY ${sortCost} DESC,calls DESC,key LIMIT 20`).all(...params) as UsageGroup[]
    const records = db.query(`${filtered} SELECT id,userId,userName,createdAt,projectId,requestId,provider,providerInstanceName,model,stage,status,inputTokens,outputTokens,costNanoUsd,costNanoCny,currency,videoStatus,usageStatus,billingUnit,inputImages,outputImages,durationSeconds,inputVideoSeconds,characters
      FROM filtered ORDER BY julianday(createdAt) DESC,userId,id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as UsageDetail[]
    const options = {
      users: db.query(`WITH ledger AS (${source}) SELECT userId AS value, MAX(userName) AS label FROM ledger GROUP BY userId ORDER BY label`).all() as Array<{ value: string, label: string }>,
      providers: (db.query(`WITH ledger AS (${source}) SELECT DISTINCT provider AS value FROM ledger WHERE provider IS NOT NULL ORDER BY value`).all() as Array<{ value: string }>).map(r => r.value),
      models: (db.query(`WITH ledger AS (${source}) SELECT DISTINCT model AS value FROM ledger ORDER BY value`).all() as Array<{ value: string }>).map(r => r.value)
    }
    return { total, users, models, records, pagination: { page, pageSize, total: total.calls }, options }
  })()
}

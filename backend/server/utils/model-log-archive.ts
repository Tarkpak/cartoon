import { randomUUID } from 'node:crypto'
import type { Database } from 'bun:sqlite'

const ARCHIVE_BATCH_ROWS = 100
const ARCHIVE_BATCH_BYTES = 5 * 1024 * 1024

interface ArchiveCandidate {
  id: string
  payload_bytes: number
}

export function archiveModelLogsIfNeeded(db: Database, maxRows: number, timestamp: string) {
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM model_call_logs WHERE archived_at IS NULL
  `).get() as { count: number }
  if (count.count <= maxRows) return 0

  const overflow = count.count - maxRows
  const candidates = db.prepare(`
    SELECT id,
           COALESCE(length(CAST(request_json AS BLOB)), 0)
             + COALESCE(length(CAST(response_json AS BLOB)), 0)
             + COALESCE(length(CAST(media_refs_json AS BLOB)), 0)
             + COALESCE(length(CAST(error_json AS BLOB)), 0) AS payload_bytes
    FROM model_call_logs
    WHERE archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(Math.min(overflow, ARCHIVE_BATCH_ROWS)) as ArchiveCandidate[]

  const ids: string[] = []
  let payloadBytes = 0
  for (const candidate of candidates) {
    if (ids.length > 0 && payloadBytes + candidate.payload_bytes > ARCHIVE_BATCH_BYTES) break
    ids.push(candidate.id)
    payloadBytes += candidate.payload_bytes
  }
  if (ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT * FROM model_call_logs
    WHERE id IN (${placeholders})
    ORDER BY created_at ASC
  `).all(...ids)

  db.transaction(() => {
    db.prepare(`
      INSERT INTO log_archives (id, archive_type, row_count, payload_json, created_at)
      VALUES (?, 'model_call_logs', ?, ?, ?)
    `).run(randomUUID(), rows.length, JSON.stringify(rows), timestamp)
    db.prepare(`
      UPDATE model_call_logs
      SET archived_at = ?, request_json = '{}', response_json = '{}',
          media_refs_json = '[]', error_json = '{}'
      WHERE id IN (${placeholders})
    `).run(timestamp, ...ids)
  })()

  return rows.length
}

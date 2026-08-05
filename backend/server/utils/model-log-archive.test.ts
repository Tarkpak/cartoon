import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { archiveModelLogsIfNeeded } from './model-log-archive'

describe('model log archiving', () => {
  const databases: Database[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('archives only the overflow and clears its large payload fields', () => {
    const database = new Database(':memory:')
    databases.push(database)
    database.exec(`
      CREATE TABLE model_call_logs (
        id TEXT PRIMARY KEY,
        client_event_id TEXT,
        request_json TEXT,
        response_json TEXT,
        media_refs_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE log_archives (
        id TEXT PRIMARY KEY,
        archive_type TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`
      INSERT INTO model_call_logs
        (id, client_event_id, request_json, response_json, media_refs_json, error_json, created_at)
      VALUES (?, ?, ?, '{}', '[]', '{}', ?)
    `)
    for (let index = 0; index < 5; index += 1) {
      insert.run(`log-${index}`, `event-${index}`, JSON.stringify({ payload: 'x'.repeat(100) }), `2026-01-01T00:00:0${index}.000Z`)
    }

    expect(archiveModelLogsIfNeeded(database, 3, '2026-01-02T00:00:00.000Z')).toBe(2)
    expect(database.query('SELECT COUNT(*) AS count FROM model_call_logs WHERE archived_at IS NULL').get())
      .toEqual({ count: 3 })
    expect(database.query(`
      SELECT client_event_id, request_json FROM model_call_logs
      WHERE archived_at IS NOT NULL ORDER BY created_at
    `).all()).toEqual([
      { client_event_id: 'event-0', request_json: '{}' },
      { client_event_id: 'event-1', request_json: '{}' }
    ])
    const archive = database.query('SELECT row_count, payload_json FROM log_archives').get() as {
      row_count: number
      payload_json: string
    }
    expect(archive.row_count).toBe(2)
    expect(JSON.parse(archive.payload_json)).toHaveLength(2)
  })
})

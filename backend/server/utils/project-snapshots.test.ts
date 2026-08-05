import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { storeProjectSnapshot } from './project-snapshots'

describe('project snapshot retention', () => {
  const databases: Database[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  function createDatabase() {
    const database = new Database(':memory:')
    databases.push(database)
    database.exec(`
      CREATE TABLE user_project_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    return database
  }

  it('does not store an unchanged latest snapshot', () => {
    const database = createDatabase()
    const input = {
      id: 'snapshot-1',
      userId: 'user-1',
      projectId: 'project-1',
      snapshotJson: '{"version":1}',
      createdAt: '2026-01-01T00:00:00.000Z'
    }

    expect(storeProjectSnapshot(database, input)).toBe(true)
    expect(storeProjectSnapshot(database, { ...input, id: 'snapshot-2' })).toBe(false)
    expect(database.query('SELECT COUNT(*) AS count FROM user_project_snapshots').get())
      .toEqual({ count: 1 })
  })

  it('keeps only the newest snapshots for a project', () => {
    const database = createDatabase()
    for (let index = 0; index < 25; index += 1) {
      storeProjectSnapshot(database, {
        id: `snapshot-${index}`,
        userId: 'user-1',
        projectId: 'project-1',
        snapshotJson: JSON.stringify({ index }),
        createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`
      })
    }

    const rows = database.query(`
      SELECT id FROM user_project_snapshots
      WHERE project_id = 'project-1'
      ORDER BY created_at ASC
    `).all() as Array<{ id: string }>
    expect(rows).toHaveLength(20)
    expect(rows[0]?.id).toBe('snapshot-5')
    expect(rows.at(-1)?.id).toBe('snapshot-24')
  })
})

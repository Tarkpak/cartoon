import type { Database } from 'bun:sqlite'

export const PROJECT_SNAPSHOT_RETENTION = 20
const PROJECT_SNAPSHOT_CLEANUP_BATCH = 100

interface ProjectSnapshotInput {
  id: string
  userId: string
  projectId: string
  snapshotJson: string
  createdAt: string
}

export function storeProjectSnapshot(
  db: Database,
  input: ProjectSnapshotInput,
  retention = PROJECT_SNAPSHOT_RETENTION
) {
  const latest = db.prepare(`
    SELECT snapshot_json
    FROM user_project_snapshots
    WHERE project_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).get(input.projectId) as { snapshot_json: string } | undefined

  let inserted = false
  if (latest?.snapshot_json !== input.snapshotJson) {
    db.prepare(`
      INSERT INTO user_project_snapshots
        (id, user_id, project_id, snapshot_json, snapshot_version, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(input.id, input.userId, input.projectId, input.snapshotJson, input.createdAt)
    inserted = true
  }

  const staleRows = db.prepare(`
    SELECT id
    FROM user_project_snapshots
    WHERE project_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ? OFFSET ?
  `).all(
    input.projectId,
    PROJECT_SNAPSHOT_CLEANUP_BATCH,
    Math.max(1, retention)
  ) as Array<{ id: string }>
  if (staleRows.length > 0) {
    const placeholders = staleRows.map(() => '?').join(', ')
    db.prepare(`DELETE FROM user_project_snapshots WHERE id IN (${placeholders})`)
      .run(...staleRows.map(row => row.id))
  }

  return inserted
}

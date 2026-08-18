import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  canonicalCloudProjectMembers,
  canonicalizeCloudProjectSnapshot,
  normalizeProjectPermissions,
  permissionsForProjectRole,
  projectMemberCan
} from './project-permissions'

describe('project permissions', () => {
  const databases: Database[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('resolves role presets independently of stored custom values', () => {
    expect(permissionsForProjectRole('editor', ['delete'])).toEqual([
      'view',
      'edit',
      'generate',
      'export'
    ])
  })

  it('filters custom permissions and checks access', () => {
    expect(normalizeProjectPermissions(['export', 'unknown', 'view'])).toEqual(['view', 'export'])
    expect(projectMemberCan({
      role: 'custom',
      permissions_json: JSON.stringify(['view', 'export'])
    }, 'export')).toBe(true)
    expect(projectMemberCan({
      role: 'viewer',
      permissions_json: JSON.stringify(['edit'])
    }, 'edit')).toBe(false)
  })

  it('makes generate imply view and edit for custom roles', () => {
    expect(permissionsForProjectRole('custom', ['generate'])).toEqual([
      'view',
      'edit',
      'generate'
    ])
  })

  it('replaces untrusted snapshot members with canonical database members', () => {
    const database = new Database(':memory:')
    databases.push(database)
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        display_name TEXT NOT NULL
      );
      CREATE TABLE project_members (
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users VALUES ('member-1', 'editor@example.com', 'Editor');
      INSERT INTO project_members VALUES (
        'project-1', 'member-1', 'editor', '[]',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      );
    `)

    const snapshot = canonicalizeCloudProjectSnapshot({
      name: 'Project',
      access: { role: 'owner' },
      members: [{ userId: 'attacker', role: 'manager' }]
    }, canonicalCloudProjectMembers(database, 'project-1'))

    expect(snapshot).toEqual({
      name: 'Project',
      members: [{
        userId: 'member-1',
        account: 'editor@example.com',
        displayName: 'Editor',
        role: 'editor',
        permissions: ['view', 'edit', 'generate', 'export'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      }]
    })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  expandLibraryAssetBundleDependencies,
  LIBRARY_ASSET_SELECT,
  libraryAssetVersions,
  libraryBundleAssetIds,
  type LibraryAssetRow
} from './library-assets'

describe('library asset versions', () => {
  const databases: Database[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('returns cloud versions newest first with public field names', () => {
    const database = new Database(':memory:')
    databases.push(database)
    database.exec(`
      CREATE TABLE library_asset_versions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        url TEXT NOT NULL,
        object_key TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        content_hash TEXT,
        change_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, version)
      )
    `)
    database.prepare(`
      INSERT INTO library_asset_versions
        (id, asset_id, version, url, mime_type, size_bytes, content_hash, change_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('v1', 'asset-1', 1, '/one.webp', 'image/webp', 10, 'hash-1', '', '2026-01-01T00:00:00.000Z')
    database.prepare(`
      INSERT INTO library_asset_versions
        (id, asset_id, version, url, mime_type, size_bytes, content_hash, change_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('v2', 'asset-1', 2, '/two.webp', 'image/webp', 20, 'hash-2', 'new pose', '2026-01-02T00:00:00.000Z')

    expect(libraryAssetVersions(database, 'asset-1')).toEqual([
      {
        id: 'v2',
        version: 2,
        url: '/two.webp',
        objectKey: undefined,
        mimeType: 'image/webp',
        sizeBytes: 20,
        contentHash: 'hash-2',
        changeNote: 'new pose',
        createdAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'v1',
        version: 1,
        url: '/one.webp',
        objectKey: undefined,
        mimeType: 'image/webp',
        sizeBytes: 10,
        contentHash: 'hash-1',
        changeNote: '',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ])
  })
})

describe('library character bundle sharing', () => {
  it('normalizes every linked asset id once', () => {
    expect(libraryBundleAssetIds({
      baseImageAssetId: 'base',
      voiceAssetId: 'voice',
      viewAssetIds: { front: 'base', side: 'side' },
      expressionAssetIds: ['expression', 'expression'],
      poseAssetIds: ['pose']
    })).toEqual(['base', 'voice', 'side', 'expression', 'pose'])
  })

  it('includes dependencies for use permission but not view-only permission', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, account TEXT NOT NULL, display_name TEXT NOT NULL);
      CREATE TABLE library_assets (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, local_asset_id TEXT NOT NULL,
        media_type TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', url TEXT NOT NULL,
        object_key TEXT, mime_type TEXT, size_bytes INTEGER, width INTEGER, height INTEGER,
        duration_ms INTEGER, content_hash TEXT, perceptual_hash TEXT, source_type TEXT NOT NULL DEFAULT 'upload',
        source_url TEXT, source_project_id TEXT, copyright_note TEXT NOT NULL DEFAULT '',
        license_expires_at TEXT, favorite INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'private',
        use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, bundle_json TEXT, version INTEGER NOT NULL DEFAULT 1,
        local_created_at TEXT, local_updated_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE library_asset_shares (asset_id TEXT NOT NULL, user_id TEXT NOT NULL, permission TEXT NOT NULL);
      CREATE TABLE library_asset_versions (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version INTEGER NOT NULL, url TEXT NOT NULL,
        object_key TEXT, mime_type TEXT, size_bytes INTEGER, content_hash TEXT,
        change_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
    `)
    database.prepare('INSERT INTO users (id, account, display_name) VALUES (?, ?, ?)').run('owner', 'owner', 'Owner')
    database.prepare('INSERT INTO users (id, account, display_name) VALUES (?, ?, ?)').run('viewer', 'viewer', 'Viewer')
    const insertAsset = database.prepare(`
      INSERT INTO library_assets
        (id, user_id, local_asset_id, media_type, category, name, url, source_type, visibility,
         bundle_json, created_at, updated_at)
      VALUES (?, 'owner', ?, ?, ?, ?, ?, 'upload', 'shared', ?, '2026-01-01', '2026-01-01')
    `)
    insertAsset.run('parent-cloud', 'parent', 'image', 'character', 'Character', '/parent.webp', JSON.stringify({ viewAssetIds: { side: 'side' }, voiceAssetId: 'voice' }))
    insertAsset.run('side-cloud', 'side', 'image', 'character', 'Character side', '/side.webp', null)
    insertAsset.run('voice-cloud', 'voice', 'audio', 'character_voice', 'Character voice', '/voice.mp3', null)
    database.prepare('INSERT INTO library_asset_shares (asset_id, user_id, permission) VALUES (?, ?, ?)').run('parent-cloud', 'viewer', 'use')
    const parent = database.prepare(`${LIBRARY_ASSET_SELECT} WHERE a.id = ? LIMIT 1`)
      .get('viewer', 'viewer', 'parent-cloud') as LibraryAssetRow

    const expanded = expandLibraryAssetBundleDependencies(database, 'viewer', [parent])
    expect(expanded.map(row => [row.local_asset_id, row.permission])).toEqual([
      ['parent', 'use'],
      ['voice', 'use'],
      ['side', 'use']
    ])
    expect(expandLibraryAssetBundleDependencies(database, 'viewer', [{ ...parent, permission: 'view' }]))
      .toHaveLength(1)
    database.close()
  })
})

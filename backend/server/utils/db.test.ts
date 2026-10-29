import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function initialize(dataDir: string) {
  const result = spawnSync(process.execPath, ['-e', `
    const { getDb } = await import(${JSON.stringify(new URL('./db.ts', import.meta.url).href)});
    getDb().close();
  `], {
    env: { ...process.env, PLAYLET_ADMIN_DATA_DIR: dataDir },
    encoding: 'utf8'
  })
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
}

test('initializes defaults and preserves imported provider IDs and credentials on restart', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'playlet-db-test-'))
  try {
    initialize(dataDir)
    const db = new Database(join(dataDir, 'playlet-admin.db'))
    try {
      expect(db.query('SELECT COUNT(*) AS count FROM model_providers').get()).toEqual({ count: 9 })
      db.exec('PRAGMA foreign_keys = ON')
      db.prepare("UPDATE provider_credentials SET encrypted_api_key = 'existing-key' WHERE provider_id = 'provider_qwen'").run()
      db.prepare("DELETE FROM model_providers WHERE provider_key = 'openai'").run()
      db.prepare(`
        INSERT INTO model_providers (id, provider_key, display_name, base_url, enabled, created_at, updated_at)
        VALUES ('imported-openai-id', 'openai', 'Imported OpenAI', 'https://example.com/v1', 0, 'test', 'test')
      `).run()
      initialize(dataDir)
      initialize(dataDir)
      expect(db.query("SELECT provider_id FROM provider_credentials WHERE provider_id = 'imported-openai-id'").get())
        .toEqual({ provider_id: 'imported-openai-id' })
      expect(db.query("SELECT display_name, base_url, enabled FROM model_providers WHERE provider_key = 'openai'").get())
        .toEqual({ display_name: 'Imported OpenAI', base_url: 'https://example.com/v1', enabled: 0 })
      expect(db.query("SELECT encrypted_api_key FROM provider_credentials WHERE provider_id = 'provider_qwen'").get())
        .toEqual({ encrypted_api_key: 'existing-key' })
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      db.close()
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

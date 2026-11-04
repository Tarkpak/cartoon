import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ensureSkillRunSchema, normalizeSkillContext, saveSkillRun } from './skill-logs'

const base = { id: 'run-1', projectId: 'p', projectName: '1105', stage: 'scene_detail', skills: [{ id: 'writer', name: 'human-writing', version: 'v1' }], createdAt: '2026-11-05T00:00:00Z', status: 'running' }

describe('skill telemetry', () => {
  it('preserves execution identity and batch metadata, accepts old callers without skills', () => {
    expect(normalizeSkillContext(undefined)).toBeNull()
    const context = normalizeSkillContext({ ...base, runId: base.id, batchStart: 1, batchEnd: 3, attempt: 2, secret: 'must not persist' })!
    expect(context.runId).toBe('run-1')
    expect(context.attempt).toBe(2)
    expect(context.skills[0]?.name).toBe('human-writing')
    expect(context).not.toHaveProperty('secret')
    expect(() => normalizeSkillContext({ ...base, runId: '', attempt: 0 })).toThrow()
    expect(() => normalizeSkillContext({ ...base, runId: base.id, skills: Array(17).fill(base.skills[0]) })).toThrow()
  })

  it('keeps terminal results across out-of-order delivery and isolates accounts', () => {
    const db = new Database(':memory:')
    try {
      db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b');")
      ensureSkillRunSchema(db)
      ensureSkillRunSchema(db)
      saveSkillRun(db, 'a', base)
      saveSkillRun(db, 'a', { ...base, status: 'succeeded', result: { message: 'done', sceneCount: 3 }, durationMs: 700 })
      saveSkillRun(db, 'a', base)
      saveSkillRun(db, 'a', { ...base, status: 'failed' })
      saveSkillRun(db, 'b', { ...base, status: 'failed', result: { message: 'before model call' } })
      const rows = db.query('SELECT user_id,status,body_json FROM skill_runs ORDER BY user_id').all() as Array<{user_id: string, status: string, body_json: string}>
      expect(rows.map(r => r.status)).toEqual(['succeeded','failed'])
      expect(JSON.parse(rows[0]!.body_json).durationMs).toBe(700)
      expect(JSON.parse(rows[1]!.body_json).result.message).toBe('before model call')
      expect(() => saveSkillRun(db,'a',{...base,status:'fake'})).toThrow()
      expect(db.query('SELECT count(*) AS count FROM skill_runs').get()).toEqual({count:2})
    } finally { db.close() }
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ensureProjectEditLeaseSchema, operateProjectEditLease, requireProjectEditLease } from './project-edit-leases'

describe('project edit leases', () => {
  const databases: Database[] = []
  function setup() {
    const db = new Database(':memory:')
    databases.push(db)
    ensureProjectEditLeaseSchema(db)
    return db
  }
  const input = { ownerUserId: 'owner', localProjectId: 'p1', userId: 'editor', deviceId: 'device1', sessionId: 'window1', action: 'acquire' as const, canTakeover: false, nowMs: 1000 }
  afterEach(() => databases.splice(0).forEach(db => db.close()))

  it('allows one editor and denies a second device or window of the same user', () => {
    const db = setup()
    const first = operateProjectEditLease(db, input)
    expect(first.editable).toBe(true)
    expect(operateProjectEditLease(db, { ...input, deviceId: 'device2' }).editable).toBe(false)
    expect(operateProjectEditLease(db, { ...input, sessionId: 'window2' }).editable).toBe(false)
    expect(operateProjectEditLease(db, { ...input, userId: 'other' }).editable).toBe(false)
    expect(() => requireProjectEditLease(db, { ...input, token: first.lease!.token })).not.toThrow()
    expect(() => requireProjectEditLease(db, { ...input, token: undefined })).toThrow()
  })

  it('renews only the holder and lets an expired lease be acquired', () => {
    const db = setup()
    const first = operateProjectEditLease(db, input)
    const renewed = operateProjectEditLease(db, { ...input, action: 'heartbeat', token: first.lease!.token, nowMs: 30_000 })
    expect(renewed.lease!.expires_at).toBe(120_000)
    expect(operateProjectEditLease(db, { ...input, action: 'heartbeat', sessionId: 'other', token: first.lease!.token }).editable).toBe(false)
    expect(() => requireProjectEditLease(db, { ...input, token: first.lease!.token, nowMs: 120_000 })).toThrow()
    const next = operateProjectEditLease(db, { ...input, sessionId: 'other', nowMs: 120_000 })
    expect(next.editable).toBe(true)
    expect(next.lease!.token).not.toBe(first.lease!.token)
  })

  it('fences the old holder after takeover and ignores its late release', () => {
    const db = setup()
    const first = operateProjectEditLease(db, input)
    expect(() => operateProjectEditLease(db, { ...input, action: 'takeover', sessionId: 'other' })).toThrow()
    const next = operateProjectEditLease(db, { ...input, action: 'takeover', userId: 'owner', sessionId: 'other', canTakeover: true })
    expect(next.editable).toBe(true)
    expect(() => requireProjectEditLease(db, { ...input, token: first.lease!.token })).toThrow()
    operateProjectEditLease(db, { ...input, action: 'release', token: first.lease!.token })
    expect(() => requireProjectEditLease(db, { ...input, userId: 'owner', token: next.lease!.token })).not.toThrow()
    expect(operateProjectEditLease(db, { ...input, action: 'heartbeat', token: first.lease!.token }).editable).toBe(false)
  })

  it('keeps leases scoped to the project owner and permits a valid release', () => {
    const db = setup()
    const first = operateProjectEditLease(db, input)
    expect(operateProjectEditLease(db, { ...input, ownerUserId: 'other-owner' }).editable).toBe(true)
    operateProjectEditLease(db, { ...input, action: 'release', token: first.lease!.token })
    expect(operateProjectEditLease(db, { ...input, userId: 'other' }).editable).toBe(true)
  })
})

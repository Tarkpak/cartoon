import { describe, expect, it } from 'vitest'
import { applyCollaborationPatch, diffCollaborationBody } from './collaboration-patch'

describe('collaboration field patches', () => {
  it('sends changed fields and preserves unrelated scene and media data', () => {
    const before = { writing: { text: 'old', title: 'title' }, scenes: [{ id: 's', videoUrl: 'https://example.com/v' }] }
    const after = { ...before, writing: { ...before.writing, text: 'new' } }
    const patch = diffCollaborationBody(before, after)
    expect(patch).toEqual([{ path: ['writing', 'text'], value: 'new' }])
    expect(applyCollaborationPatch(before, patch)).toEqual(after)
    expect(before.writing.text).toBe('old')
  })
  it('supports deletion and array order changes', () => {
    const before = { list: [1, 2], extra: true }
    const after = { list: [2, 1] }
    expect(applyCollaborationPatch(before, diffCollaborationBody(before, after))).toEqual(after)
  })
  it('updates only the changed field in an ordered array of identified objects', () => {
    const before = { scenes: Array.from({ length: 100 }, (_, index) => ({ id: `s${index}`, description: 'original', videoUrl: 'https://example.com/video' })) }
    const after = structuredClone(before)
    after.scenes[37]!.description = 'changed'
    const patch = diffCollaborationBody(before, after, true)
    expect(patch).toEqual([{ path: ['scenes', '37', 'description'], value: 'changed' }])
    expect(JSON.stringify(patch).length).toBeLessThan(JSON.stringify(after).length / 50)
    expect(applyCollaborationPatch(before, patch)).toEqual(after)
    expect(diffCollaborationBody(before, after)).toEqual([{ path: ['scenes'], value: after.scenes }])
  })
  it('keeps array membership, duplicates and ordering atomic', () => {
    for (const [before, after] of [
      [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]],
      [[{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]],
      [[{ id: 'a' }, { id: 'a' }], [{ id: 'a', text: 'new' }, { id: 'a' }]]
    ]) {
      const patch = diffCollaborationBody({ scenes: before }, { scenes: after }, true)
      expect(patch).toEqual([{ path: ['scenes'], value: after }])
      expect(applyCollaborationPatch({ scenes: before }, patch)).toEqual({ scenes: after })
    }
  })
  it('rejects array holes, array metadata writes and element deletions', () => {
    for (const path of [['scenes', '1', 'text'], ['scenes', '-1'], ['scenes', 'length'], ['scenes', '01']]) {
      expect(() => applyCollaborationPatch({ scenes: [{ id: 'a' }] }, [{ path, value: 'x' }])).toThrow()
    }
    expect(() => applyCollaborationPatch({ scenes: [{ id: 'a' }] }, [{ path: ['scenes', '0'], remove: true }])).toThrow()
  })
  it('rejects unsafe paths and missing parents', () => {
    expect(() => applyCollaborationPatch({}, [{ path: ['__proto__', 'polluted'], value: true }])).toThrow()
    expect(() => applyCollaborationPatch({}, [{ path: ['missing', 'text'], value: 'x' }])).toThrow()
  })
})

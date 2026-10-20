import { describe, expect, it } from 'vitest'
import { mergeCollaborationValue } from './collaboration-merge'

describe('three-way collaboration merge', () => {
  it('combines independent fields and scenes without losing remote additions', () => {
    const base = { scenes: [{ id: 's', text: 'old', prompt: 'old' }] }
    const local = { scenes: [{ id: 's', text: 'mine', prompt: 'old' }] }
    const remote = { scenes: [{ id: 's', text: 'old', prompt: 'theirs' }, { id: 'new', text: 'added' }] }
    expect(mergeCollaborationValue(base, local, remote)).toEqual({ value: { scenes: [{ id: 's', text: 'mine', prompt: 'theirs' }, { id: 'new', text: 'added' }] }, conflicts: [] })
  })
  it('requires a choice for overlapping text and respects the selected version', () => {
    const preview = mergeCollaborationValue({ text: 'old' }, { text: 'mine' }, { text: 'theirs' })
    expect(preview.conflicts).toHaveLength(1)
    expect(mergeCollaborationValue({ text: 'old' }, { text: 'mine' }, { text: 'theirs' }, { [preview.conflicts[0]!.key]: 'remote' }).value).toEqual({ text: 'theirs' })
  })
  it('does not silently discard edits when the other member deletes a scene', () => {
    const base = [{ id: 's', text: 'old' }], local = [{ id: 's', text: 'mine' }]
    const preview = mergeCollaborationValue(base, local, [])
    expect(preview.conflicts).toHaveLength(1)
    expect(mergeCollaborationValue(base, local, [], { [preview.conflicts[0]!.key]: 'remote' }).value).toEqual([])
  })
  it('requires explicit review of concurrent reordering', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }
    expect(mergeCollaborationValue([a, b, c], [b, a, c], [a, c, b]).conflicts).toHaveLength(1)
  })
})

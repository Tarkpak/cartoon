export interface MergeConflict {
  key: string
  path: string[]
  local: unknown
  remote: unknown
}
export type MergeChoices = Record<string, 'local' | 'remote'>
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const identified = (v: unknown): v is Array<Record<string, unknown> & { id: string }> => Array.isArray(v) && v.every(item => object(item) && typeof item.id === 'string') && new Set(v.map(item => item.id)).size === v.length

/** Three-way merge: only overlapping edits require a choice. Deletions remain deletions. */
export function mergeCollaborationValue(base: unknown, local: unknown, remote: unknown, choices: MergeChoices = {}, path: string[] = []): { value: unknown, conflicts: MergeConflict[] } {
  if (equal(local, base)) return { value: remote, conflicts: [] }
  if (equal(remote, base) || equal(local, remote)) return { value: local, conflicts: [] }
  if (object(base) && object(local) && object(remote)) {
    const value: Record<string, unknown> = Object.create(null)
    const conflicts: MergeConflict[] = []
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const merged = mergeCollaborationValue(base[key], local[key], remote[key], choices, [...path, key])
      if (merged.value !== undefined) value[key] = merged.value
      conflicts.push(...merged.conflicts)
    }
    return { value, conflicts }
  }
  if (identified(base) && identified(local) && identified(remote)) {
    const ids = (items: typeof base) => items.map(item => item.id)
    const baseIds = ids(base), localIds = ids(local), remoteIds = ids(remote)
    // Concurrent structural changes need explicit review of the whole collection.
    if (equal(baseIds, localIds) || equal(baseIds, remoteIds) || equal(localIds, remoteIds)) {
      const order = equal(baseIds, localIds) ? remoteIds : localIds
      const lookup = (items: typeof base, id: string) => items.find(item => item.id === id)
      const value: unknown[] = [], conflicts: MergeConflict[] = []
      // Include removed IDs too, so deletion versus editing is never silently lost.
      for (const id of new Set([...order, ...baseIds, ...localIds, ...remoteIds])) {
        const merged = mergeCollaborationValue(lookup(base, id), lookup(local, id), lookup(remote, id), choices, [...path, id])
        if (merged.value !== undefined) value.push(merged.value)
        conflicts.push(...merged.conflicts)
      }
      return { value, conflicts }
    }
  }
  const key = JSON.stringify(path)
  return { value: choices[key] === 'remote' ? remote : local, conflicts: [{ key, path, local, remote }] }
}

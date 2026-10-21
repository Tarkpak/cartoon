import type { CollaborationBody } from '../types/project-collaboration'

export interface CollaborationPatch { path: string[], value?: unknown, remove?: true }
const object = (value: unknown): value is CollaborationBody => !!value && typeof value === 'object' && !Array.isArray(value)
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])

// Array element paths are enabled only after fieldPatchV2 capability negotiation.
// A resource revision fences indices; structural changes replace the array atomically.
export function diffCollaborationBody(before: CollaborationBody, after: CollaborationBody, arrayElements = false): CollaborationPatch[] {
  const changes: CollaborationPatch[] = []
  function visit(old: CollaborationBody, next: CollaborationBody, path: string[]) {
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
      const target = [...path, key]
      const oldArray = old[key]
      const nextArray = next[key]
      if (!(key in next)) changes.push({ path: target, remove: true })
      else if (arrayElements && Array.isArray(oldArray) && Array.isArray(nextArray)
        && oldArray.length > 0 && oldArray.length === nextArray.length
        && oldArray.every((item, index) => object(item) && typeof item.id === 'string' && object(nextArray[index]) && item.id === nextArray[index].id)
        && new Set(oldArray.map(item => item.id)).size === oldArray.length) {
        for (let index = 0; index < oldArray.length; index++) visit(oldArray[index], nextArray[index], [...target, String(index)])
      }
      else if (object(old[key]) && object(next[key])) visit(old[key], next[key], target)
      else changes.push({ path: target, value: next[key] })
    }
  }
  visit(before, after, [])
  return changes
}

export function applyCollaborationPatch(body: CollaborationBody, patches: CollaborationPatch[]): CollaborationBody {
  if (!Array.isArray(patches) || !patches.length || patches.length > 10000) throw new Error('字段修改数量无效')
  const result = structuredClone(body)
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || !patch.path.length || patch.path.length > 64 || patch.path.some(key => typeof key !== 'string' || forbidden.has(key))) throw new Error('字段修改路径无效')
    let target: CollaborationBody | unknown[] = result
    const read = (value: CollaborationBody | unknown[], key: string): unknown => {
      if (Array.isArray(value)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new Error('数组修改下标无效')
        return value[Number(key)]
      }
      return value[key]
    }
    for (const key of patch.path.slice(0, -1)) {
      const child = read(target, key)
      if (!Object.hasOwn(target, key) || (!object(child) && !Array.isArray(child))) throw new Error('字段修改目标不存在')
      target = child
    }
    const key = patch.path[patch.path.length - 1]!
    if (Array.isArray(target)) {
      // Membership and ordering changes must use a complete array replacement.
      read(target, key)
      if (patch.remove) throw new Error('不能使用字段修改删除数组元素')
    }
    if (patch.remove === true) delete (target as CollaborationBody)[key]
    else {
      if (!Object.hasOwn(patch, 'value') || patch.value === undefined) throw new Error('字段修改内容无效')
      Object.defineProperty(target, key, { value: structuredClone(patch.value), enumerable: true, writable: true, configurable: true })
    }
  }
  return result
}

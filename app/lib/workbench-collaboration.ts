import { composeProjectSnapshot, splitProjectSnapshot } from '../../shared/utils/project-collaboration'
import type { CollaborationBody, CollaborationResource } from '../../shared/types/project-collaboration'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const keyOf = (item: Pick<CollaborationResource, 'type' | 'id'>) => JSON.stringify([item.type, item.id])

/** Apply only fields changed in the existing UI; preserve fields it does not expose. */
export function patchWorkbenchFields(original: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return copy(original ?? null)
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].every(item => typeof record(item).id === 'string')) {
    const previous = new Map(before.map(item => [record(item).id, item]))
    const source = new Map((Array.isArray(original) ? original : []).map(item => [record(item).id, item]))
    return after.map(item => patchWorkbenchFields(source.get(record(item).id), previous.get(record(item).id), item))
  }
  if (after && typeof after === 'object' && !Array.isArray(after)) {
    const result = { ...record(original) }
    const old = record(before)
    const next = record(after)
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (equal(old[key], next[key])) continue
      if (!(key in next)) delete result[key]
      else result[key] = patchWorkbenchFields(result[key], old[key], next[key])
    }
    return result
  }
  return after === undefined ? null : copy(after)
}

export function workbenchSaveView(body: CollaborationBody): CollaborationBody {
  const { scenes, characters, name, description, status, styleId, aspectRatio, scriptParseMode, ...script } = copy(body)
  void status // Status is derived from all episodes; it must not lock settings on every scene save.
  return { project: { name, description, styleId, aspectRatio, scriptParseMode }, script, scenes, characters }
}

const sceneWorkflowFields = ['sceneConfigs', 'sceneVideoHistories'] as const

/** Scene-specific workbench metadata follows its episode rather than settings. */
function splitWorkbenchSnapshot(value: CollaborationBody) {
  const resources = splitProjectSnapshot(value)
  const settings = resources.find(item => item.type === 'settings')!
  const workflow = record(record(settings.body!.script).assetWorkflow)
  for (const field of sceneWorkflowFields) {
    if (!(field in workflow)) continue
    const entries = record(workflow[field])
    for (const episode of resources.filter(item => item.type === 'episode')) {
      const ids = new Set((episode.body!.scenes as CollaborationBody[]).map(scene => scene.id))
      episode.body!.workbench = { ...record(episode.body!.workbench), [field]: Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id))) }
    }
    delete workflow[field]
  }
  if ('characterHistories' in workflow) {
    const histories = record(workflow.characterHistories)
    for (const character of resources.filter(item => item.type === 'character')) {
      character.body!.workbench = { ...record(character.body!.workbench), assetHistory: histories[character.id] || [] }
    }
    delete workflow.characterHistories
  }
  return resources
}

export function composeWorkbenchSnapshot(resources: CollaborationResource[]): CollaborationBody {
  return copy(composeProjectSnapshot(resources))
}

export function buildWorkbenchMutations(resources: CollaborationResource[], before: CollaborationBody, after: CollaborationBody) {
  const snapshot = composeWorkbenchSnapshot(resources)
  const next = splitWorkbenchSnapshot(patchWorkbenchFields(snapshot, workbenchSaveView(before), workbenchSaveView(after)) as CollaborationBody)
  const previous = new Map(resources.map(item => [keyOf(item), item]))
  const normalized = new Map(splitWorkbenchSnapshot(snapshot).map(item => [keyOf(item), item]))
  const desired = new Map(next.map(item => [keyOf(item), item]))
  const mutations: Array<{ type: CollaborationResource['type'], id: string, expectedRevision: number, body: CollaborationBody | null }> = []
  for (const [key, item] of desired) {
    const old = previous.get(key)
    if (old?.deleted) throw new Error('编辑对象已删除，请刷新后核对本地草稿')
    if (!equal(normalized.get(key)?.body, item.body)) mutations.push({ type: item.type, id: item.id, expectedRevision: old?.revision ?? 0, body: old ? patchWorkbenchFields(old.body, normalized.get(key)?.body, item.body) as CollaborationBody : item.body })
  }
  for (const [key, item] of previous) {
    if (!item.deleted && !desired.has(key)) mutations.push({ type: item.type, id: item.id, expectedRevision: item.revision, body: null })
  }
  return mutations
}

export type WorkbenchRequestPreparation = (path: string, body: CollaborationBody) => Promise<CollaborationBody>
const preparations = new Map<string, WorkbenchRequestPreparation>()
export function registerWorkbenchCollaboration(id: string, prepare: WorkbenchRequestPreparation) {
  preparations.set(id, prepare)
  return () => { if (preparations.get(id) === prepare) preparations.delete(id) }
}

/** Both JSON and streaming requests from the original workbench use this hook. */
export async function prepareWorkbenchRequest(path: string, body: unknown): Promise<unknown> {
  const value = typeof body === 'string' ? (() => { try { return JSON.parse(body) } catch { return undefined } })() : body
  const input = record(value)
  const id = input.projectId
  if (typeof id !== 'string' || !preparations.has(id) || !/^\/api\/(script\/(write|parse|parse-stream|episode-plan)|character\/(generate|voice\/upload)|asset-workflow\/)/.test(path)) return body
  const prepared = await preparations.get(id)!(path, input)
  return typeof body === 'string' ? JSON.stringify(prepared) : prepared
}

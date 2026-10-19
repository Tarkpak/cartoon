import { afterEach, describe, expect, it } from 'vitest'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
import { buildWorkbenchMutations, composeWorkbenchSnapshot, patchWorkbenchFields, prepareWorkbenchRequest, registerWorkbenchCollaboration } from './workbench-collaboration'

const snapshot = {
  project: { id: 'p', name: '原项目', status: 'draft', createdAt: 'v1', ownerUserId: 'owner' },
  script: { id: 'script', episodePlan: [{ id: 'a', index: 1 }, { id: 'b', index: 2 }], hiddenSetting: '保留' },
  scenes: [{ id: 's1', episodeId: 'a', description: 'A', videoUrl: 'https://shared.example/a.mp4', custom: '保留镜头字段' }, { id: 's2', episodeId: 'b', description: 'B' }],
  characters: [{ id: 'c', name: '角色', voiceAsset: { audioUrl: 'https://shared.example/voice.mp3' } }]
}
const view = () => ({ name: '原项目', status: 'draft', episodePlan: structuredClone(snapshot.script.episodePlan), scenes: snapshot.scenes.map(({ custom: _custom, ...scene }) => structuredClone(scene)), characters: structuredClone(snapshot.characters) })
let unregister: (() => void) | undefined
afterEach(() => unregister?.())
describe('original workbench resource adapter', () => {
  it('saves only the edited episode and retains fields hidden by the original UI', () => {
    const before = view()
    const after = view()
    after.scenes[0]!.description = '修改 A'
    after.status = 'in_progress'
    const changes = buildWorkbenchMutations(splitProjectSnapshot(snapshot), before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ type: 'episode', id: 'a', expectedRevision: 1 })
    expect(changes[0]!.body!.scenes).toEqual([{ ...snapshot.scenes[0], description: '修改 A' }])
  })
  it('keeps remote array additions and ordering while applying local field changes', () => {
    const before = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]
    const after = [{ id: 'a', text: 'local' }, { id: 'b', text: 'B' }]
    const remote = [{ id: 'b', text: 'remote' }, { id: 'new', text: 'new' }, { id: 'a', text: 'A' }]
    expect(patchWorkbenchFields(remote, before, after)).toEqual([{ id: 'b', text: 'remote' }, { id: 'new', text: 'new' }, { id: 'a', text: 'local' }])
  })
  it('uses a separate character revision and preserves voice assets', () => {
    const before = view()
    const after = view()
    after.characters[0]!.name = '新角色名'
    expect(buildWorkbenchMutations(splitProjectSnapshot(snapshot), before, after)).toEqual([{ type: 'character', id: 'c', expectedRevision: 1, body: { ...snapshot.characters[0], name: '新角色名' } }])
  })
  it('creates directory and episode changes together without replacing another episode', () => {
    const before = view()
    const after = view()
    after.episodePlan.push({ id: 'new', index: 3 })
    const changes = buildWorkbenchMutations(splitProjectSnapshot(snapshot), before, after)
    expect(changes.map(({ type, id }) => [type, id])).toEqual([['directory', 'directory'], ['episode', 'new']])
    expect(changes[1]!.expectedRevision).toBe(0)
  })
  it('does not submit defaults introduced during UI normalization', () => {
    const before = { ...view(), aspectRatio: '16:9', scenes: view().scenes.map(item => ({ ...item, cameraAngle: 'eye_level' })) }
    expect(buildWorkbenchMutations(splitProjectSnapshot(snapshot), before, structuredClone(before))).toEqual([])
    expect(patchWorkbenchFields({ a: 1, hidden: 2 }, { a: 1 }, { a: 3 })).toEqual({ a: 3, hidden: 2 })
  })
  it('enriches original streaming requests while leaving collaboration writes untouched', async () => {
    unregister = registerWorkbenchCollaboration('p', async (_path, body) => ({ ...body, collaborationInput: { type: 'episode', id: 'a', revision: 1 } }))
    const enriched = JSON.parse(await prepareWorkbenchRequest('/api/script/parse-stream', JSON.stringify({ projectId: 'p' })) as string)
    expect(enriched.collaborationInput.id).toBe('a')
    expect(await prepareWorkbenchRequest('/api/project/p/collaboration', { projectId: 'p' })).toEqual({ projectId: 'p' })
  })
  it('stores scene history and configuration with its episode rather than shared settings', () => {
    const source = structuredClone(snapshot) as Record<string, any>
    source.script.assetWorkflow = { version: 1, props: [], sceneConfigs: { s1: { sceneId: 's1', prompt: '原提示' }, s2: { sceneId: 's2' } }, sceneVideoHistories: {} }
    const resources = splitProjectSnapshot(source)
    const before = { ...view(), assetWorkflow: structuredClone(source.script.assetWorkflow) }
    const after = structuredClone(before)
    after.assetWorkflow.sceneConfigs.s1.prompt = '仅修改第一集提示'
    after.assetWorkflow.sceneVideoHistories.s1 = [{ videoUrl: 'https://shared.example/keep.mp4' }]
    const changes = buildWorkbenchMutations(resources, before, after)
    expect(changes.map(item => [item.type, item.id])).toEqual([['episode', 'a']])
    const changed = changes[0]!
    const updated = resources.map(item => item.type === changed.type && item.id === changed.id ? { ...item, body: changed.body } : item)
    const rebuilt = composeWorkbenchSnapshot(updated) as Record<string, any>
    expect(rebuilt.script.assetWorkflow.sceneConfigs.s1.prompt).toBe('仅修改第一集提示')
    expect(rebuilt.script.assetWorkflow.sceneConfigs.s2).toEqual({ sceneId: 's2' })
    expect(rebuilt.script.assetWorkflow.sceneVideoHistories.s1[0].videoUrl).toBe('https://shared.example/keep.mp4')
  })

})

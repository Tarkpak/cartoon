import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { ProjectCollaborationClient } from './project-collaboration-client'
import { adoptCollaborationAsset, assetGenerationInput, parseCollaborationAssetResult } from './project-collaboration-assets'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
async function setup() {
  const resources = splitProjectSnapshot({ project: { id: 'p', name: 'keep' }, script: { episodePlan: [{ id: 'e', index: 1 }], assetWorkflow: { props: [{ id: 'a', referenceImage: 'old', unknown: 1 }, { id: 'b', referenceImage: 'keep' }] } }, scenes: [{ id: 's', episodeId: 'e', videoUrl: 'keep' }], characters: [{ id: 'c', name: 'keep', baseImage: 'old' }] })
  const client = new ProjectCollaborationClient(async () => ({ enabled: true, protocolVersion: 1, cursor: 0, resources }))
  await client.load()
  return client
}
function result(kind: 'character' | 'prop') {
  return parseCollaborationAssetResult({ id: 'r', kind: 'asset-image', status: 'completed', createdAt: '2026-10-19', url: 'https://shared.example/image.png', collaboration: { projectId: 'p', actorId: 'u', assetKind: kind, assetId: kind === 'character' ? 'c' : 'a', resourceType: kind === 'character' ? 'character' : 'settings', resourceId: kind === 'character' ? 'c' : 'settings', revision: 1, settingsRevision: 1 } })
}
describe('public collaboration asset adoption', () => {
  it('changes only the target character image', async () => {
    const client = await setup()
    adoptCollaborationAsset(client, result('character'))
    expect(client.get('character', 'c')?.body).toEqual({ id: 'c', name: 'keep', baseImage: 'https://shared.example/image.png' })
    expect(client.get('settings', 'settings')?.dirty).toBe(false)
    expect(client.get('episode', 'e')?.dirty).toBe(false)
  })
  it('changes only the selected prop and preserves settings and other props', async () => {
    const client = await setup()
    adoptCollaborationAsset(client, result('prop'))
    expect(client.get('settings', 'settings')?.body).toMatchObject({ project: { name: 'keep' }, script: { assetWorkflow: { props: [{ id: 'a', referenceImage: 'https://shared.example/image.png', unknown: 1 }, { id: 'b', referenceImage: 'keep' }] } } })
    expect(client.get('episode', 'e')?.dirty).toBe(false)
  })
  it('adopts extracted voice only into the target, locks the first voice and preserves locked voices', async () => {
    const client = await setup()
    const base = result('character')
    const voice = parseCollaborationAssetResult({ ...base, kind: 'asset-voice', url: 'https://shared.example/voice.mp3', voiceAsset: { audioUrl: 'https://shared.example/voice.mp3', transcript: '对白', sourceTaskId: 'task' } })
    adoptCollaborationAsset(client, reactive(voice))
    expect(client.get('character', 'c')?.body).toMatchObject({ baseImage: 'old', voiceAsset: { locked: true, transcript: '对白', sourceTaskId: 'task' } })
    expect(client.get('settings', 'settings')?.dirty).toBe(false)
    const locked = await setup()
    locked.get('character', 'c')!.body!.voiceAsset = { locked: true, audioUrl: 'https://shared.example/keep.mp3' }
    expect(() => adoptCollaborationAsset(locked, voice)).toThrow('音色已锁定')
    expect(locked.get('character', 'c')?.body?.voiceAsset).toMatchObject({ audioUrl: 'https://shared.example/keep.mp3' })
  })
  it('rejects stale versions, local-only media, dirty settings and missing targets', async () => {
    const client = await setup()
    const output = result('prop')
    expect(() => adoptCollaborationAsset(client, { ...output, collaboration: { ...output.collaboration, revision: 2 } })).toThrow('输入已变化')
    expect(() => adoptCollaborationAsset(client, { ...output, url: '/api/image/file/local.png' })).toThrow('共享存储')
    expect(() => assetGenerationInput(client, 'prop', 'missing')).toThrow('不存在')
    client.edit('settings', 'settings', { local: 'keep' })
    expect(() => adoptCollaborationAsset(client, output)).toThrow('先保存')
    expect(client.get('settings', 'settings')?.body).toEqual({ local: 'keep' })
    expect(() => parseCollaborationAssetResult({ ...output, collaboration: { ...output.collaboration, resourceType: 'character' } })).toThrow('格式无效')
  })
})

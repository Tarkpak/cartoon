import { describe, expect, it } from 'vitest'
import { parseCollaborationAssetResult } from './project-collaboration-assets'

function result(kind: 'character' | 'prop') {
  return { id: 'r', kind: 'asset-image', status: 'completed', createdAt: '2026-10-19', url: 'https://shared.example/image.png', collaboration: { projectId: 'p', actorId: 'u', assetKind: kind, assetId: kind === 'character' ? 'c' : 'a', resourceType: kind === 'character' ? 'character' : 'settings', resourceId: kind === 'character' ? 'c' : 'settings', revision: 1, settingsRevision: 1 } }
}
describe('public collaboration asset results', () => {
  it('accepts character and prop results with canonical targets', () => {
    expect(parseCollaborationAssetResult(result('character')).collaboration.resourceId).toBe('c')
    expect(parseCollaborationAssetResult(result('prop')).collaboration.resourceId).toBe('settings')
  })
  it('requires voice results to match their extracted voice asset', () => {
    const voice = { ...result('character'), kind: 'asset-voice', url: 'https://shared.example/voice.mp3' }
    expect(parseCollaborationAssetResult({ ...voice, voiceAsset: { audioUrl: voice.url, transcript: '对白' } }).kind).toBe('asset-voice')
    expect(() => parseCollaborationAssetResult({ ...voice, voiceAsset: { audioUrl: 'https://shared.example/other.mp3', transcript: '对白' } })).toThrow('语音结果格式无效')
  })
  it('rejects mismatched targets and invalid revisions', () => {
    const output = result('prop')
    expect(() => parseCollaborationAssetResult({ ...output, collaboration: { ...output.collaboration, resourceType: 'character' } })).toThrow('格式无效')
    expect(() => parseCollaborationAssetResult({ ...output, collaboration: { ...output.collaboration, revision: 0 } })).toThrow('格式无效')
  })
})

import { describe, expect, it } from 'vitest'
import { ProjectCollaborationClient } from './project-collaboration-client'
import { adoptCollaborationMedia, mediaGenerationInput, parseCollaborationMediaResult, type CollaborationMediaResult } from './project-collaboration-media'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
async function setup() {
  const resources = splitProjectSnapshot({ project: { id: 'p' }, script: { episodePlan: [{ id: 'e', index: 1, title: 'A' }] }, scenes: [{ id: 's', episodeId: 'e', description: 'keep', firstFrame: 'old-image', lastFrame: 'old-last', videoUrl: 'old-video', custom: true }, { id: 'other', episodeId: 'e', videoUrl: 'untouched' }], characters: [] })
  const client = new ProjectCollaborationClient(async () => ({ enabled: true, protocolVersion: 1, cursor: 0, resources }))
  await client.load()
  return client
}
function result(kind: 'image' | 'video' = 'image'): CollaborationMediaResult {
  return { id: 'r', kind, status: 'completed', progress: 100, createdAt: '2026-10-19T00:00:00Z', url: 'https://shared.example/media', collaboration: { projectId: 'p', actorId: 'actor', episodeId: 'e', sceneId: 's', revision: 1, settingsRevision: 1 } }
}
describe('scoped media adoption', () => {
  it('updates only the target image and preserves other scene fields', async () => {
    const client = await setup()
    adoptCollaborationMedia(client, parseCollaborationMediaResult(result()))
    expect(client.get('episode', 'e')?.body?.scenes).toEqual([
      { id: 's', episodeId: 'e', description: 'keep', firstFrame: 'https://shared.example/media', lastFrame: 'old-last', videoUrl: 'old-video', custom: true, referenceStatus: 'done' },
      { id: 'other', episodeId: 'e', videoUrl: 'untouched' }
    ])
    expect(client.get('settings', 'settings')?.dirty).toBe(false)
  })
  it('preserves the previous video in history and removes its obsolete last frame', async () => {
    const client = await setup()
    adoptCollaborationMedia(client, result('video'))
    const scene = (client.get('episode', 'e')?.body?.scenes as Record<string, unknown>[])[0]!
    expect(scene).toMatchObject({ firstFrame: 'old-image', videoUrl: 'https://shared.example/media', videoStatus: 'done', videoHistory: [{ videoUrl: 'old-video' }] })
    expect(scene.lastFrame).toBeUndefined()
  })
  it('rejects stale, moved, incomplete and local-only results without altering the draft', async () => {
    const client = await setup()
    const original = structuredClone(client.get('episode', 'e')?.body)
    expect(() => adoptCollaborationMedia(client, { ...result(), collaboration: { ...result().collaboration, revision: 2 } })).toThrow('输入已变化')
    expect(() => mediaGenerationInput(client, 'e', 'missing')).toThrow('移动或删除')
    expect(() => adoptCollaborationMedia(client, { ...result(), status: 'processing' })).toThrow('尚未完成')
    for (const url of ['/api/image/local', 'http://localhost/file', 'data:image/png;base64,AAA']) expect(() => adoptCollaborationMedia(client, { ...result(), url })).toThrow('共享存储')
    expect(client.get('episode', 'e')?.body).toEqual(original)
    expect(client.hasUnsavedChanges).toBe(false)
    expect(() => parseCollaborationMediaResult({ ...result(), collaboration: {} })).toThrow('格式无效')
  })
})

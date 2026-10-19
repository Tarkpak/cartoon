import { describe, expect, it } from 'vitest'
import { ProjectCollaborationClient } from './project-collaboration-client'
import { adoptCollaborationDraft, generationInput, parseCollaborationDraftResult } from './project-collaboration-generation'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
const result = () => ({ id: 'result', createdAt: '2026-10-19T00:00:00Z', collaboration: { projectId: 'p', actorId: 'actor', episodeId: 'a', revision: 1, settingsRevision: 1 }, data: { episodeId: 'a', draft: '生成正文', continuityNotes: '连续性' } })
async function setup() {
  const resources = splitProjectSnapshot({ project: { id: 'p' }, script: { episodePlan: [{ id: 'a', index: 1, title: 'A' }] }, scenes: [{ id: 's', episodeId: 'a', videoUrl: 'keep' }], characters: [] })
  const client = new ProjectCollaborationClient(async () => ({ enabled: true, protocolVersion: 1, cursor: 0, resources }))
  await client.load()
  return client
}
describe('collaboration generation adoption', () => {
  it('adopts writing fields only and leaves scene media and plan intact', async () => {
    const client = await setup()
    expect(generationInput(client, 'a')).toEqual({ episodeId: 'a', revision: 1, settingsRevision: 1 })
    adoptCollaborationDraft(client, parseCollaborationDraftResult(result()))
    expect(client.get('episode', 'a')?.body).toMatchObject({ plan: { id: 'a', title: 'A' }, writing: { draft: '生成正文', continuityNotes: '连续性' }, scenes: [{ videoUrl: 'keep' }] })
    expect(client.get('settings', 'settings')?.dirty).toBe(false)
  })
  it('preserves results and local text when input revisions or drafts no longer match', async () => {
    const client = await setup()
    const output = result()
    expect(() => adoptCollaborationDraft(client, { ...output, collaboration: { ...output.collaboration, settingsRevision: 2 } })).toThrow('输入已变化')
    client.edit('episode', 'a', { local: '保留' })
    expect(() => adoptCollaborationDraft(client, output)).toThrow('先保存')
    expect(client.get('episode', 'a')?.body).toEqual({ local: '保留' })
    expect(output.data.draft).toBe('生成正文')
    expect(() => parseCollaborationDraftResult({ ...output, data: { episodeId: 'other', draft: 'wrong' } })).toThrow('格式无效')
  })
})

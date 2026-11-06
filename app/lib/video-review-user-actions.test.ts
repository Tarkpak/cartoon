import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../pages/asset-workbench.vue', import.meta.url), 'utf8')

// Exercise the page's actual action with controlled dialog and persistence results.
function createAction(confirmed: boolean, saved = true) {
  const scene = { id: 's1', description: '原描述', videoUrl: 'old.mp4', descriptionHistory: [] }
  const draft = { before: '原描述', description: '新描述', videoUrl: 'old.mp4' }
  const context = {
    reviewRepairDrafts: { value: { s1: draft } },
    scenes: { value: [scene] },
    projectId: { value: 'p1' },
    canEditProject: { value: true },
    isSceneBusy: vi.fn(() => false),
    confirm: vi.fn(async () => confirmed),
    saveProject: vi.fn(async () => saved),
    invalidateSceneVideoState: vi.fn(),
    retryScene: vi.fn(async () => undefined)
  }
  const start = source.indexOf('async function confirmReviewRepairVideo(')
  const end = source.indexOf('\nfunction retryShotReview(', start)
  const code = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 })
  const action = new Function(...Object.keys(context), `${code}; return confirmReviewRepairVideo`)(...Object.values(context))
  return { context, scene, action }
}

describe('review video generation requires user confirmation', () => {
  it('does not change the description or submit a task when cancelled', async () => {
    const { context, scene, action } = createAction(false)
    await action('s1')
    expect(scene.description).toBe('原描述')
    expect(context.saveProject).not.toHaveBeenCalled()
    expect(context.retryScene).not.toHaveBeenCalled()
  })

  it('applies and saves the approved description before submitting the video', async () => {
    const { context, scene, action } = createAction(true)
    await action('s1')
    expect(scene.description).toBe('新描述')
    expect(context.retryScene).toHaveBeenCalledWith('s1')
    expect(context.saveProject.mock.invocationCallOrder[0]).toBeLessThan(context.retryScene.mock.invocationCallOrder[0]!)
  })

  it('does not submit a video if saving fails', async () => {
    const { context, action } = createAction(true, false)
    await action('s1')
    expect(context.retryScene).not.toHaveBeenCalled()
  })

  it.each(['project', 'description'])('rejects a stale approval after changing %s', async (change) => {
    const { context, scene, action } = createAction(true)
    context.confirm.mockImplementationOnce(async () => {
      if (change === 'project') context.projectId.value = 'p2'
      else scene.description = '人工修改'
      return true
    })
    await action('s1')
    expect(context.retryScene).not.toHaveBeenCalled()
    expect(context.saveProject).not.toHaveBeenCalled()
  })
})

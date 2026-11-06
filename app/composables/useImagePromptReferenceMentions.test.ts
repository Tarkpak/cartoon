import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import { useImagePromptReferenceMentions } from './useImagePromptReferenceMentions'

const { readState, renderEditor, setCaret } = vi.hoisted(() => ({
  readState: vi.fn(() => ({ text: '生成图片', caret: 2 })),
  renderEditor: vi.fn(),
  setCaret: vi.fn()
}))

vi.mock('~/lib/contenteditable-mention', async (importOriginal) => ({
  ...await importOriginal<typeof import('~/lib/contenteditable-mention')>(),
  readContentEditableEditorState: readState,
  renderContentEditableTextWithMatches: renderEditor,
  setContentEditableEditorCaret: setCaret
}))

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  // Emulate the renderer's deferred caret restoration, which focuses the editor.
  renderEditor.mockImplementation((options) => {
    if (typeof options.caretOffset === 'number') {
      nextTick(() => options.setCaret(options.caretOffset))
    }
  })
})

afterEach(() => {
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const prompt = ref('生成图片')
  const images = ref<string[]>([])
  const editor = scope.run(() => useImagePromptReferenceMentions({
    activeTab: ref('image'),
    imagePrompt: computed({ get: () => prompt.value, set: value => { prompt.value = value } }),
    referenceImages: images
  }))!
  return { prompt, images, editor }
}

describe('image prompt focus', () => {
  it('does not restore focus after clicking away from the prompt', async () => {
    const { editor } = setup()
    editor.handlePromptTextareaFocus()
    editor.handlePromptTextareaBlur()
    await nextTick()
    expect(renderEditor).toHaveBeenCalled()
    expect(setCaret).not.toHaveBeenCalled()
  })

  it('does not steal focus when prompt or references update in the background', async () => {
    const { prompt, images } = setup()
    prompt.value = '新的提示词'
    images.value.push('reference.png')
    await nextTick()
    await nextTick()
    await nextTick()
    expect(renderEditor).toHaveBeenCalled()
    expect(setCaret).not.toHaveBeenCalled()
  })

  it('preserves the caret when references change while editing', async () => {
    const { images, editor } = setup()
    editor.handlePromptTextareaFocus()
    images.value.push('reference.png')
    await nextTick()
    await nextTick()
    await nextTick()
    expect(setCaret).toHaveBeenCalledWith(expect.objectContaining({ offset: 2 }))
  })
})

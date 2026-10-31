import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useImagePromptReferenceEditor } from './useImagePromptReferenceEditor'

class ControlledReader {
  static readers: ControlledReader[] = []
  result: string | null = null
  onload?: () => void
  onerror?: () => void
  readAsDataURL() { ControlledReader.readers.push(this) }
  finish(result: string) { this.result = result; this.onload?.() }
}

function setup() {
  const images = ref<string[]>([])
  const prompt = ref('')
  const editor = useImagePromptReferenceEditor({
    activeTab: ref('image'),
    imagePrompt: computed({ get: () => prompt.value, set: value => { prompt.value = value } }),
    referenceImages: images,
    maxReferences: 4
  })
  const upload = (count = 1) => editor.handleReferenceImageUpload({
    target: { files: Array.from({ length: count }, () => ({ type: 'image/png' })), value: 'selected' }
  } as unknown as Event)
  return { images, editor, upload }
}

beforeEach(() => {
  ControlledReader.readers = []
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('FileReader', ControlledReader)
  vi.stubGlobal('useImagePromptReferenceMentions', () => ({}))
})
afterEach(() => vi.unstubAllGlobals())

describe('reference image uploads', () => {
  it('preserves selection order when reads finish out of order', async () => {
    const { images, editor, upload } = setup()
    const pending = upload(2)
    expect(editor.referenceImagesUploading.value).toBe(true)
    ControlledReader.readers[1]!.finish('second')
    ControlledReader.readers[0]!.finish('first')
    await pending
    expect(images.value).toEqual(['first', 'second'])
    expect(editor.referenceImagesUploading.value).toBe(false)
  })
  it('discards uploads after a model or project changes', async () => {
    const { images, upload } = setup()
    const pending = upload()
    images.value = []
    ControlledReader.readers[0]!.finish('old-model-image')
    await pending
    expect(images.value).toEqual([])
  })
  it('reports read errors and allows the next batch to finish', async () => {
    const { images, editor, upload } = setup()
    const first = upload()
    const second = upload()
    ControlledReader.readers[1]!.finish('valid')
    ControlledReader.readers[0]!.onerror?.()
    await Promise.all([first, second])
    expect(images.value).toEqual(['valid'])
    expect(editor.referenceUploadError.value).toContain('读取失败')
    expect(editor.referenceImagesUploading.value).toBe(false)
  })
})

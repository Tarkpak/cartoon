import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadModelTestMedia } from './model-test-download'

const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
const fetchMock = vi.fn()
const createObjectURL = vi.fn(() => 'blob:download')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('window', { location: { href: 'https://app.example/test', origin: 'https://app.example' } })
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('downloads remote media through the proxy and uses its actual format', async () => {
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/webp' }) })
  await downloadModelTestMedia('https://cdn.example/image', 'result', 'png')
  expect(fetchMock).toHaveBeenCalledWith('/api/video/download?url=https%3A%2F%2Fcdn.example%2Fimage')
  expect(anchor.download).toBe('result.webp')
  expect(anchor.click).toHaveBeenCalledOnce()
  expect(anchor.remove).toHaveBeenCalledOnce()
  vi.runAllTimers()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
})

it('downloads local and inline results directly', async () => {
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/wav' }) })
  for (const source of ['/api/audio/file/test', 'data:audio/wav;base64,YQ==', 'blob:audio']) {
    await downloadModelTestMedia(source, 'audio', 'mp3')
    expect(fetchMock).toHaveBeenLastCalledWith(source)
    expect(anchor.download).toBe('audio.wav')
  }
})

it('reports download errors without creating an empty file', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 502 })
  await expect(downloadModelTestMedia('/missing', 'result', 'png')).rejects.toThrow('502')
  expect(anchor.click).not.toHaveBeenCalled()
  expect(createObjectURL).not.toHaveBeenCalled()
})

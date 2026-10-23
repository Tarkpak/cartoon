import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareSubtitleErasureSource } from './subtitle-erasure-source'

const pageUrl = 'http://127.0.0.1:43127/project'

afterEach(() => vi.unstubAllGlobals())

describe('prepareSubtitleErasureSource', () => {
  it('submits hosted videos without downloading or requiring a TOS reupload', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const upload = vi.fn()
    const videoUrl = 'https://media.example.com/video.mp4?signature=abc'
    expect(await prepareSubtitleErasureSource(videoUrl, 'scene.mp4', pageUrl, upload)).toEqual({ videoUrl })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads local video bytes with the original file name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('video bytes')))
    const result = { videoUrl: 'https://storage.example.com/source.mp4', sourceObjectKey: 'source.mp4' }
    const upload = vi.fn().mockResolvedValue(result)
    expect(await prepareSubtitleErasureSource('/api/video/file/a.mp4', 'scene.mp4', pageUrl, upload)).toEqual(result)
    const file = upload.mock.calls[0]![0].get('video') as File
    expect(file.name).toBe('scene.mp4')
    expect(await file.text()).toBe('video bytes')
  })

  it.each([404, 500])('does not submit unreadable local videos (%s)', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    const upload = vi.fn()
    await expect(prepareSubtitleErasureSource('/api/video/file/a.mp4', 'scene.mp4', pageUrl, upload)).rejects.toThrow('读取分镜视频失败')
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects empty local videos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')))
    const upload = vi.fn()
    await expect(prepareSubtitleErasureSource('/api/video/file/a.mp4', 'scene.mp4', pageUrl, upload)).rejects.toThrow('分镜视频内容为空')
    expect(upload).not.toHaveBeenCalled()
  })
})

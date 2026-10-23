export interface SubtitleErasureSource {
  videoUrl: string
  sourceObjectKey?: string
}

export async function prepareSubtitleErasureSource(
  videoUrl: string,
  fileName: string,
  pageUrl: string,
  upload: (form: FormData) => Promise<SubtitleErasureSource>
): Promise<SubtitleErasureSource> {
  const source = new URL(videoUrl, pageUrl)
  if (['http:', 'https:'].includes(source.protocol) && source.origin !== new URL(pageUrl).origin) {
    return { videoUrl: source.href }
  }
  const response = await fetch(videoUrl)
  if (!response.ok) throw new Error('读取分镜视频失败')
  const blob = await response.blob()
  if (!blob.size) throw new Error('分镜视频内容为空')
  const form = new FormData()
  form.append('video', blob, fileName)
  return upload(form)
}

export interface MediaResources {
  mediaType?: 'video' | 'image' | 'audio'
  imageUrls?: string[]
  videoUrls?: string[]
  audioUrl?: string | null
  livePhotos?: { imageIndex: number, url: string, coverUrl?: string }[]
  subtitles?: { start: number, end: number, text: string }[] | null
}

export interface MediaResourceDownload {
  kind: 'video' | 'image' | 'audio' | 'livePhoto' | 'subtitles'
  index?: number
  label: string
}

export function mediaResourceDownloads(profile: MediaResources): MediaResourceDownload[] {
  const resources: MediaResourceDownload[] = []
  if ((profile.videoUrls?.length || 0) > 1) {
    profile.videoUrls?.forEach((_, index) => resources.push({ kind: 'video', index, label: `视频 ${index + 1}` }))
  }
  if (profile.mediaType !== 'image' && profile.imageUrls?.length) {
    resources.push({ kind: 'image', label: `全部图片 · ${profile.imageUrls.length} 张` })
  }
  profile.livePhotos?.forEach((photo, index) => {
    resources.push({ kind: 'livePhoto', index, label: `实况视频 · 第 ${photo.imageIndex + 1} 张` })
  })
  if (profile.audioUrl && profile.mediaType !== 'audio') resources.push({ kind: 'audio', label: '音频' })
  if (profile.subtitles?.length) resources.push({ kind: 'subtitles', label: '字幕 · SRT' })
  return resources
}

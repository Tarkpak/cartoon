function formatUploadLimit(maxFileSize: number): string {
  const sizeInMb = maxFileSize / (1024 * 1024)
  return Number.isInteger(sizeInMb) ? `${sizeInMb}MB` : `${sizeInMb.toFixed(1)}MB`
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

export function resolveImageFileMimeType(file: Pick<File, 'name' | 'type'>): string | undefined {
  const reportedType = file.type.trim().toLowerCase()
  if (reportedType.startsWith('image/')) return reportedType

  const extension = file.name.split('.').pop()?.trim().toLowerCase() || ''
  return IMAGE_MIME_BY_EXTENSION[extension]
}

export function resetFileInput(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (input) {
    input.value = ''
  }
}

export function assertValidImageFile(file: File, maxFileSize: number) {
  if (!resolveImageFileMimeType(file)) {
    throw new Error('仅支持上传图片文件')
  }

  if (file.size > maxFileSize) {
    throw new Error(`图片大小不能超过 ${formatUploadLimit(maxFileSize)}`)
  }
}

export function assertValidAudioFile(file: File, maxFileSize: number) {
  if (!file.type.startsWith('audio/')) {
    throw new Error('仅支持上传音频文件')
  }

  if (file.size > maxFileSize) {
    throw new Error(`音频大小不能超过 ${formatUploadLimit(maxFileSize)}`)
  }
}

export async function fileToDataUrl(file: File): Promise<string> {
  const mimeType = resolveImageFileMimeType(file)
  if (!mimeType) {
    throw new Error('仅支持上传图片文件')
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('读取图片文件失败，请重试'))
    }
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('仅支持图片文件上传'))
        return
      }

      const separatorIndex = reader.result.indexOf(',')
      if (separatorIndex < 0) {
        reject(new Error('读取图片文件失败，请重试'))
        return
      }

      resolve(`data:${mimeType};base64,${reader.result.slice(separatorIndex + 1)}`)
    }
    reader.readAsDataURL(file)
  })
}

export async function fileToAudioDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('读取音频文件失败，请重试'))
    }
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:audio/')) {
        reject(new Error('仅支持音频文件上传'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadAssetImage(source: string, prefix: string, projectId: string): Promise<string> {
  const response = await $fetch<{
    success: boolean
    imageUrl?: string
  }>('/api/asset-workflow/upload-image', {
    method: 'POST',
    body: {
      projectId,
      imageData: source,
      prefix
    }
  })

  if (!response.success || !response.imageUrl) {
    throw new Error('图片上传失败，请稍后重试')
  }

  return response.imageUrl
}

export async function uploadImageFile(file: File, options: {
  maxFileSize: number
  prefix: string
  projectId: string
}) {
  assertValidImageFile(file, options.maxFileSize)
  const dataUrl = await fileToDataUrl(file)
  return await uploadAssetImage(dataUrl, options.prefix, options.projectId)
}

export async function uploadAssetAudio(source: string, prefix: string, projectId: string): Promise<string> {
  const response = await $fetch<{
    success: boolean
    audioUrl?: string
  }>('/api/character/voice/upload', {
    method: 'POST',
    body: {
      projectId,
      audioData: source,
      prefix
    }
  })

  if (!response.success || !response.audioUrl) {
    throw new Error('音频上传失败，请稍后重试')
  }

  return response.audioUrl
}

export async function uploadAudioFile(file: File, options: {
  maxFileSize: number
  prefix: string
  projectId: string
}) {
  assertValidAudioFile(file, options.maxFileSize)
  const dataUrl = await fileToAudioDataUrl(file)
  return await uploadAssetAudio(dataUrl, options.prefix, options.projectId)
}

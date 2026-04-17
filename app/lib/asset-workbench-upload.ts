function formatUploadLimit(maxFileSize: number): string {
  const sizeInMb = maxFileSize / (1024 * 1024)
  return Number.isInteger(sizeInMb) ? `${sizeInMb}MB` : `${sizeInMb.toFixed(1)}MB`
}

export function resetFileInput(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (input) {
    input.value = ''
  }
}

export function assertValidImageFile(file: File, maxFileSize: number) {
  if (!file.type.startsWith('image/')) {
    throw new Error('仅支持上传图片文件')
  }

  if (file.size > maxFileSize) {
    throw new Error(`图片大小不能超过 ${formatUploadLimit(maxFileSize)}`)
  }
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('读取图片文件失败，请重试'))
    }
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        reject(new Error('仅支持图片文件上传'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadAssetImage(source: string, prefix: string): Promise<string> {
  const response = await $fetch<{
    success: boolean
    imageUrl?: string
  }>('/api/asset-workflow/upload-image', {
    method: 'POST',
    body: {
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
}) {
  assertValidImageFile(file, options.maxFileSize)
  const dataUrl = await fileToDataUrl(file)
  return await uploadAssetImage(dataUrl, options.prefix)
}

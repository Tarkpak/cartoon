import type { VoiceGenerationTask, VoiceHealth, VoiceProfile } from '#shared/types/voice'

interface ApiResponse<T> {
  success: boolean
  data: T
}

export async function getVoiceHealth() {
  const response = await $fetch<ApiResponse<VoiceHealth>>('/api/voice/health')
  return response.data
}

export async function getVoicePresetPreview(speakerId: string) {
  const response = await $fetch<ApiResponse<import('#shared/types/voice').VoicePresetPreview>>(
    `/api/voice/presets/${encodeURIComponent(speakerId)}/preview`,
    { method: 'POST' }
  )
  return response.data
}

export async function listVoiceProfiles() {
  const response = await $fetch<ApiResponse<{ items: VoiceProfile[] }>>('/api/voice/profiles')
  return response.data.items
}

export async function cloneVoice(input: {
  name: string
  audioData: string
  referenceText?: string
  demoText?: string
  language: number
  enableAudioDenoise: boolean
  disableVolumeNormalization: boolean
  consentConfirmed: boolean
}) {
  const response = await $fetch<ApiResponse<{ profile: VoiceProfile }>>('/api/voice/profiles', {
    method: 'POST',
    body: input
  })
  return response.data.profile
}

export async function refreshVoiceProfile(id: string) {
  const response = await $fetch<ApiResponse<{ profile: VoiceProfile }>>(`/api/voice/profiles/${encodeURIComponent(id)}/refresh`, {
    method: 'POST'
  })
  return response.data.profile
}

export async function activateVoiceProfile(id: string) {
  const response = await $fetch<ApiResponse<{ task: VoiceGenerationTask }>>(`/api/voice/profiles/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
    body: { confirmCharge: true }
  })
  return response.data.task
}

export async function archiveVoiceProfile(id: string) {
  await $fetch(`/api/voice/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listVoiceGenerations() {
  const response = await $fetch<ApiResponse<{ items: VoiceGenerationTask[] }>>('/api/voice/generations')
  return response.data.items
}

export async function createVoiceGeneration(input: Record<string, unknown>) {
  const response = await $fetch<ApiResponse<{ task: VoiceGenerationTask }>>('/api/voice/generations', {
    method: 'POST',
    body: input
  })
  return response.data.task
}

export async function retryVoiceGeneration(id: string) {
  const response = await $fetch<ApiResponse<{ task: VoiceGenerationTask }>>(`/api/voice/generations/${encodeURIComponent(id)}/retry`, {
    method: 'POST'
  })
  return response.data.task
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

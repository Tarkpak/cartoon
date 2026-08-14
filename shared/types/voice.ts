import { z } from 'zod'

export const VoiceProfileStatusSchema = z.enum(['not_found', 'training', 'ready', 'failed', 'active'])
export type VoiceProfileStatus = z.infer<typeof VoiceProfileStatusSchema>

export const VoiceProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.literal('volcengine'),
  speakerId: z.string(),
  customSpeakerId: z.string().optional(),
  status: VoiceProfileStatusSchema,
  language: z.number().int(),
  sourceAssetId: z.string().optional(),
  sourceAudioUrl: z.string().optional(),
  previewAssetId: z.string().optional(),
  previewAudioUrl: z.string().optional(),
  errorMessage: z.string().optional(),
  activatedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>

export const VoiceGenerationStatusSchema = z.enum(['queued', 'generating', 'completed', 'failed'])
export type VoiceGenerationStatus = z.infer<typeof VoiceGenerationStatusSchema>

export const VoiceGenerationTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['preset', 'prompt', 'reference_audio', 'reference_image', 'profile']),
  voiceProfileId: z.string().optional(),
  prompt: z.string(),
  status: VoiceGenerationStatusSchema,
  progress: z.number().int().min(0).max(100),
  resultAssetId: z.string().optional(),
  audioUrl: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  originalDurationMs: z.number().int().nonnegative().optional(),
  subtitle: z.unknown().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional()
})
export type VoiceGenerationTask = z.infer<typeof VoiceGenerationTaskSchema>

export const VoiceHealthSchema = z.object({
  configured: z.boolean(),
  provider: z.literal('volcengine'),
  endpoint: z.string()
})
export type VoiceHealth = z.infer<typeof VoiceHealthSchema>

export const VoicePresetPreviewSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('generating'),
    speakerId: z.string(),
    retryAfterMs: z.number().int().positive()
  }),
  z.object({
    status: z.literal('ready'),
    speakerId: z.string(),
    audioUrl: z.string().url(),
    cached: z.boolean()
  })
])
export type VoicePresetPreview = z.infer<typeof VoicePresetPreviewSchema>

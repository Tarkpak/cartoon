import { z } from 'zod'

// ==================== 音频类型 ====================

/** 音乐风格 */
export const MusicStyleSchema = z.enum([
  'ambient',      // 环境音
  'dramatic',     // 戏剧性
  'romantic',     // 浪漫
  'action',       // 动作
  'mysterious',   // 神秘
  'happy',        // 欢快
  'sad',          // 悲伤
  'tense',        // 紧张
])
export type MusicStyle = z.infer<typeof MusicStyleSchema>

/** 音频生成配置 */
export const AudioGenerationConfigSchema = z.object({
  prompt: z.string().describe('音乐描述'),
  style: MusicStyleSchema.optional().describe('音乐风格'),
  duration: z.number().min(1).max(60).describe('时长(秒)'),
  tempo: z.enum(['slow', 'medium', 'fast']).optional().default('medium').describe('节奏'),
})
export type AudioGenerationConfig = z.infer<typeof AudioGenerationConfigSchema>

/** 生成的音频 */
export const GeneratedAudioSchema = z.object({
  id: z.string().describe('音频ID'),
  audioData: z.string().describe('音频数据 (base64)'),
  format: z.enum(['mp3', 'wav', 'ogg']).default('mp3').describe('音频格式'),
  duration: z.number().describe('实际时长(秒)'),
  sampleRate: z.number().default(44100).describe('采样率'),
  createdAt: z.string().datetime().describe('创建时间'),
})
export type GeneratedAudio = z.infer<typeof GeneratedAudioSchema>

// ==================== TTS 配音 ====================

/** TTS 语音配置 */
export const TTSConfigSchema = z.object({
  text: z.string().describe('要转换的文本'),
  voice: z.string().optional().describe('语音ID'),
  speed: z.number().min(0.5).max(2).default(1).describe('语速'),
  pitch: z.number().min(0.5).max(2).default(1).describe('音调'),
  language: z.string().default('zh-CN').describe('语言'),
})
export type TTSConfig = z.infer<typeof TTSConfigSchema>

/** 生成的配音 */
export const GeneratedVoiceoverSchema = z.object({
  id: z.string().describe('配音ID'),
  characterName: z.string().optional().describe('角色名'),
  text: z.string().describe('原文本'),
  audioData: z.string().describe('音频数据 (base64)'),
  duration: z.number().describe('时长(秒)'),
  createdAt: z.string().datetime().describe('创建时间'),
})
export type GeneratedVoiceover = z.infer<typeof GeneratedVoiceoverSchema>

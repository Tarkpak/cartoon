export const API_BASE_URL = 'https://member.bilibili.com/x/bcut/rubick-interface'
export const DEFAULT_USER_AGENT
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
export const DEFAULT_MODEL_ID = '7'

export const SUPPORTED_AUDIO_FORMATS = ['flac', 'aac', 'm4a', 'mp3', 'wav'] as const
export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number]

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface ResourceCreateResponse {
  resource_id: string
  title: string
  type: number
  in_boss_key: string
  size: number
  upload_urls: string[]
  upload_id: string
  per_size: number
}

export interface ResourceCompleteResponse {
  resource_id: string
  download_url: string
}

export interface AsrTaskCreateResponse {
  resource: string
  result: string
  task_id: string
}

export enum AsrResultState {
  Stop = 0,
  Running = 1,
  Error = 3,
  Complete = 4
}

export interface AsrResultResponse {
  task_id: string
  result?: string | AsrData
  remark: string
  state: number
}

export interface AsrDataWord {
  label: string
  start_time: number
  end_time: number
}

export interface AsrDataSegment {
  start_time: number
  end_time: number
  transcript: string
  words: AsrDataWord[]
}

export interface AsrData {
  utterances: AsrDataSegment[]
  version: string
}

export interface WaitForResultProgress {
  state: number
  remark: string
  taskId: string
  elapsedMs: number
}

export interface WaitForResultOptions {
  taskId?: string
  intervalMs?: number
  timeoutMs?: number
  onProgress?: (progress: WaitForResultProgress) => void
}

export interface BcutAsrClientOptions {
  baseUrl?: string
  userAgent?: string
  modelId?: string
  fetchImpl?: typeof fetch
}

export interface TranscribeResult {
  taskId: string
  data: AsrData
  segments: AsrDataSegment[]
  text: string
  srt: string
  lrc: string
  json: string
  cached: boolean
  audioHash?: string
}

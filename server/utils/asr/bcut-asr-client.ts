import { readFile } from 'node:fs/promises'
import { AsrClientError } from './errors'
import {
  type AsrData,
  type AsrResultResponse,
  AsrResultState,
  type AsrTaskCreateResponse,
  type BcutAsrClientOptions,
  DEFAULT_MODEL_ID,
  DEFAULT_USER_AGENT,
  type ResourceCompleteResponse,
  type ResourceCreateResponse,
  type WaitForResultOptions
} from './types'
import { detectAudioFormat, getFileName, normalizeAudioFormat, sleep } from './utils'

export class BcutAsrClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly modelId: string

  private soundName = ''
  private soundFmt = ''
  private soundBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array()

  private inBossKey = ''
  private resourceId = ''
  private uploadId = ''
  private uploadUrls: string[] = []
  private perSize = 0
  private etags: string[] = []
  private downloadUrl = ''

  public taskId?: string

  constructor(options: BcutAsrClientOptions = {}) {
    if (!options.fetchImpl && typeof fetch !== 'function') {
      throw new AsrClientError('No fetch implementation found.')
    }

    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? process.env.BCUT_ASR_BASE_URL ?? 'https://member.bilibili.com/x/bcut/rubick-interface'
    this.userAgent = options.userAgent ?? process.env.BCUT_ASR_USER_AGENT ?? DEFAULT_USER_AGENT
    this.modelId = options.modelId ?? process.env.BCUT_ASR_MODEL_ID ?? DEFAULT_MODEL_ID
  }

  public async setDataFromFile(filePath: string): Promise<void> {
    const format = detectAudioFormat(filePath)
    const buffer = await readFile(filePath).catch((error) => {
      throw new AsrClientError(`Failed to read audio file: ${filePath}`, { details: error })
    })

    this.setData(new Uint8Array(buffer), format, getFileName(filePath))
  }

  public setData(data: Uint8Array<ArrayBufferLike>, format: string, name?: string): void {
    const normalized = normalizeAudioFormat(format)
    if (!normalized) {
      throw new AsrClientError(`Unsupported audio format: ${format}`)
    }

    this.soundBuffer = data
    if (this.soundBuffer.length === 0) {
      throw new AsrClientError('Audio data is empty.')
    }

    this.soundFmt = normalized
    this.soundName = name?.trim() ? name.trim() : `${Date.now()}.${normalized}`
  }

  public async upload(): Promise<void> {
    this.ensureAudioData()

    const params = new URLSearchParams({
      type: '2',
      name: this.soundName,
      size: String(this.soundBuffer.length),
      resource_file_type: this.soundFmt,
      model_id: this.modelId
    })

    const response = await this.requestApi<ResourceCreateResponse>(`${this.baseUrl}/resource/create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: params.toString()
    })

    this.inBossKey = response.in_boss_key
    this.resourceId = response.resource_id
    this.uploadId = response.upload_id
    this.uploadUrls = response.upload_urls ?? []
    this.perSize = Number(response.per_size) || 0
    this.etags = []

    if (!this.uploadUrls.length || this.perSize <= 0) {
      throw new AsrClientError('Invalid upload configuration returned by API.', { details: response })
    }

    await this.uploadParts()
    await this.commitUpload()
  }

  public async createTask(): Promise<string> {
    if (!this.downloadUrl) {
      throw new AsrClientError('download_url is empty. Call upload() before createTask().')
    }

    const response = await this.requestApi<AsrTaskCreateResponse>(`${this.baseUrl}/task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        resource: this.downloadUrl,
        model_id: this.modelId
      })
    })

    this.taskId = response.task_id
    return response.task_id
  }

  public async result(taskId?: string): Promise<AsrResultResponse> {
    const finalTaskId = taskId ?? this.taskId
    if (!finalTaskId) {
      throw new AsrClientError('taskId is required.')
    }

    const url = new URL(`${this.baseUrl}/task/result`)
    url.searchParams.set('model_id', this.modelId)
    url.searchParams.set('task_id', finalTaskId)

    return this.requestApi<AsrResultResponse>(url.toString(), { method: 'GET' })
  }

  public parseResult(resultPayload: string | AsrData): AsrData {
    const data = typeof resultPayload === 'string'
      ? JSON.parse(resultPayload) as AsrData
      : resultPayload

    if (!data || !Array.isArray(data.utterances)) {
      throw new AsrClientError('Invalid ASR result payload.', { details: data })
    }

    return data
  }

  public async waitForResult(options: WaitForResultOptions = {}): Promise<AsrData> {
    const taskId = options.taskId ?? this.taskId
    if (!taskId) {
      throw new AsrClientError('taskId is required for waitForResult().')
    }

    const intervalMs = Math.max(300, Math.floor(options.intervalMs ?? 2000))
    const timeoutMs = Math.max(intervalMs, Math.floor(options.timeoutMs ?? 300_000))
    const startTs = Date.now()

    for (;;) {
      if (Date.now() - startTs > timeoutMs) {
        throw new AsrClientError(`ASR task timeout after ${timeoutMs}ms`, { details: { taskId } })
      }

      const response = await this.result(taskId)
      options.onProgress?.({
        state: response.state,
        remark: response.remark,
        taskId,
        elapsedMs: Date.now() - startTs
      })

      if (response.state === AsrResultState.Complete) {
        if (response.result === undefined || response.result === null) {
          throw new AsrClientError('ASR task completed with empty result payload.', { details: response })
        }

        return this.parseResult(response.result)
      }

      if (response.state === AsrResultState.Error) {
        throw new AsrClientError(`ASR task failed: ${response.remark}`, { details: response })
      }

      if (response.state !== AsrResultState.Stop && response.state !== AsrResultState.Running) {
        throw new AsrClientError(`Unknown ASR task state: ${response.state}`, { details: response })
      }

      await sleep(intervalMs)
    }
  }

  public async transcribeFile(
    filePath: string,
    waitOptions: Omit<WaitForResultOptions, 'taskId'> = {}
  ): Promise<{ taskId: string, data: AsrData }> {
    await this.setDataFromFile(filePath)
    await this.upload()
    const taskId = await this.createTask()
    const data = await this.waitForResult({ ...waitOptions, taskId })
    return { taskId, data }
  }

  private ensureAudioData(): void {
    if (!this.soundBuffer.length) {
      throw new AsrClientError('Audio data is not set.')
    }
    if (!this.soundFmt) {
      throw new AsrClientError('Audio format is not set.')
    }
    if (!this.soundName) {
      throw new AsrClientError('Audio file name is not set.')
    }
  }

  private async uploadParts(): Promise<void> {
    this.etags = []

    for (let index = 0; index < this.uploadUrls.length; index += 1) {
      const url = this.uploadUrls[index]
      if (!url) continue

      const start = index * this.perSize
      const end = Math.min((index + 1) * this.perSize, this.soundBuffer.length)
      const chunk = this.soundBuffer.subarray(start, end)

      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          'user-agent': this.userAgent
        },
        body: Buffer.from(chunk)
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new AsrClientError(`Upload chunk failed with HTTP ${response.status}`, {
          details: body.slice(0, 500)
        })
      }

      this.etags.push(response.headers.get('etag') ?? '')
    }
  }

  private async commitUpload(): Promise<void> {
    const params = new URLSearchParams({
      in_boss_key: this.inBossKey,
      resource_id: this.resourceId,
      etags: this.etags.join(','),
      upload_id: this.uploadId,
      model_id: this.modelId
    })

    const response = await this.requestApi<ResourceCompleteResponse>(
      `${this.baseUrl}/resource/create/complete`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: params.toString()
      }
    )

    this.downloadUrl = response.download_url
    if (!this.downloadUrl) {
      throw new AsrClientError('download_url is empty after completing upload.', { details: response })
    }
  }

  private async requestApi<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        'user-agent': this.userAgent,
        ...(init.headers || {})
      }
    })

    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      throw new AsrClientError(`Request failed with HTTP ${response.status}`, {
        details: raw.slice(0, 1000)
      })
    }

    let payload: { code?: number, message?: string, data?: T }
    try {
      payload = JSON.parse(raw) as { code?: number, message?: string, data?: T }
    } catch (error) {
      throw new AsrClientError('Failed to parse API response.', { details: error })
    }

    if (payload.code !== 0) {
      throw new AsrClientError(`API error: ${payload.message || payload.code}`, { details: payload })
    }

    if (payload.data === undefined) {
      throw new AsrClientError('API response data is empty.', { details: payload })
    }

    return payload.data
  }
}

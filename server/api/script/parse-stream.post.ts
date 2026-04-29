import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import {
  ParseScriptRequestSchema
} from '../../../shared/types/script'
import {
  executeScriptParse,
  type ScriptParseProgressEvent
} from './parse.post'

type ParseStreamEvent
  = | { type: 'progress', payload: ScriptParseProgressEvent, timestamp: string }
    | { type: 'heartbeat', payload: { message: string }, timestamp: string }
    | {
      type: 'result'
      payload: {
        success: true
        data: Awaited<ReturnType<typeof executeScriptParse>>['data']
        formattedTimeline: Awaited<ReturnType<typeof executeScriptParse>>['formattedTimeline']
        parseStrategy: Awaited<ReturnType<typeof executeScriptParse>>['parseStrategy']
      }
      timestamp: string
    }
    | { type: 'error', payload: { message: string, code?: string }, timestamp: string }

function resolveStreamErrorPayload(error: unknown): { message: string, code?: string } {
  if (error instanceof GeminiError || error instanceof QwenError) {
    const err = error as { message?: string, code?: string }
    return {
      message: err.message || '剧本解析失败',
      code: err.code
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message || '剧本解析失败'
    }
  }

  return {
    message: '剧本解析失败'
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = ParseScriptRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const encoder = new TextEncoder()
  let latestMessage = '解析中，请稍候'
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const write = (eventPayload: ParseStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(eventPayload)}\n`))
      }

      const writeProgress = (payload: ScriptParseProgressEvent) => {
        latestMessage = payload.message || latestMessage
        write({
          type: 'progress',
          payload,
          timestamp: new Date().toISOString()
        })
      }

      heartbeatTimer = setInterval(() => {
        write({
          type: 'heartbeat',
          payload: {
            message: latestMessage
          },
          timestamp: new Date().toISOString()
        })
      }, 3000)

      try {
        writeProgress({
          step: 'accepted',
          message: '已接收解析请求，准备开始',
          progress: 1
        })

        const parsed = await executeScriptParse({
          ...parseResult.data,
          onProgress: writeProgress
        })

        write({
          type: 'result',
          payload: {
            success: true,
            data: parsed.data,
            formattedTimeline: parsed.formattedTimeline,
            parseStrategy: parsed.parseStrategy
          },
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        write({
          type: 'error',
          payload: resolveStreamErrorPayload(error),
          timestamp: new Date().toISOString()
        })
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
})

import { z } from 'zod'
import { listCloudStorageFiles } from '../../utils/cloud-storage'

const TosFilesQuerySchema = z.object({
  prefix: z.string().optional(),
  delimiter: z.string().optional(),
  maxKeys: z.coerce.number().int().min(1).max(1000).optional(),
  continuationToken: z.string().optional()
})

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message || record.Message || record.code || record.Code || record.statusCode
    if (message) return String(message)
  }
  return String(error)
}

function normalizeErrorDetail(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  return {
    name: record.name,
    code: record.code || record.Code,
    statusCode: record.statusCode,
    requestId: record.requestId,
    ec: record.ec,
    message: record.message || record.Message,
    data: record.data
  }
}

export default defineEventHandler(async (event) => {
  const parsed = TosFilesQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const data = await listCloudStorageFiles(parsed.data)
    return {
      success: true,
      data
    }
  } catch (error) {
    console.error('[TOSFiles] 读取 TOS 文件失败:', normalizeErrorDetail(error) || error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: {
        message: normalizeErrorMessage(error),
        detail: normalizeErrorDetail(error)
      }
    })
  }
})

import { z } from 'zod'
import { listModelDebugLogs } from '../../utils/model-debug-log'

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  status: z.enum(['success', 'error']).optional(),
  keyword: z.string().min(1).optional()
})

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = QuerySchema.safeParse(query)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '查询参数无效',
      message: parsed.error.issues.map(item => item.message).join(', ')
    })
  }

  const logs = listModelDebugLogs(parsed.data)

  return {
    success: true,
    data: {
      logs,
      total: logs.length
    }
  }
})

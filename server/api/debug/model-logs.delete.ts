import { clearModelDebugLogs } from '../../utils/model-debug-log'

export default defineEventHandler(async () => {
  await clearModelDebugLogs()
  return {
    success: true
  }
})

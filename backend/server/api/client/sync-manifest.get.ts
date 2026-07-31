import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  requireAuth(event)

  return {
    success: true,
    data: {
      syncVersion: 2,
      endpoints: {
        projects: '/api/client/projects',
        promptState: '/api/client/prompt-state',
        modelPreferences: '/api/client/model-preferences',
        libraryAssets: '/api/client/library/assets',
        modelCallLogs: '/api/client/model-call-logs'
      }
    }
  }
})

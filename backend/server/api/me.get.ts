import { requireAuth, publicUser } from '../utils/auth'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  return {
    success: true,
    data: {
      user: publicUser(auth.user),
      deviceId: auth.deviceId
    }
  }
})


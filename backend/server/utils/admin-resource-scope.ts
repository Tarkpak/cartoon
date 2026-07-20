export function projectOwnerScope(role: 'admin' | 'user', userId: string) {
  return role === 'admin'
    ? { where: '', params: [] as string[] }
    : { where: 'WHERE p.user_id = ?', params: [userId] }
}

export function projectSyncOwnerId(input: {
  role: 'admin' | 'user'
  authenticatedUserId: string
  requestedOwnerId?: string | null
}) {
  if (input.role !== 'admin') return input.authenticatedUserId
  return input.requestedOwnerId?.trim() || input.authenticatedUserId
}

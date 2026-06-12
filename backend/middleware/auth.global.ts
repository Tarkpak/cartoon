export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  if (to.path === '/setup') {
    const status = await $fetch<{ data: { initialized: boolean } }>('/api/setup/status').catch(() => null)
    if (status?.data.initialized) return navigateTo('/login')
    return
  }

  if (to.path === '/login') {
    const status = await $fetch<{ data: { initialized: boolean } }>('/api/setup/status').catch(() => null)
    if (!status?.data.initialized) return navigateTo('/setup')
    return
  }

  const me = await $fetch('/api/me').catch(() => null)
  if (!me) return navigateTo('/login')
})


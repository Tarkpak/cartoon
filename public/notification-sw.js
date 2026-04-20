self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })

    for (const client of clientList) {
      const url = new URL(client.url)
      if (url.origin !== self.location.origin) {
        continue
      }

      if ('focus' in client) {
        await client.focus()
      }

      if ('navigate' in client) {
        await client.navigate(targetUrl)
      }
      return
    }

    await clients.openWindow(targetUrl)
  })())
})

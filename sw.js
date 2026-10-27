// Recebe os avisos enviados pelo Supabase, mesmo com a agenda fechada.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Tarefa'
  const body = data.body || ''
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      tag: data.tag,
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: self.registration.scope },
    })
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    windows.forEach((client) => client.postMessage({ type: 'reminder', title, body }))
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => client.url.startsWith(self.registration.scope))
    if (open) return open.focus()
    return self.clients.openWindow(event.notification.data?.url || self.registration.scope)
  })())
})

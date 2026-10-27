// Recebe os avisos enviados pelo Supabase, mesmo com a agenda fechada,
// e guarda uma cópia da agenda para ela abrir sem internet.
const CACHE = 'agenda-arquivos'
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'vendor/supabase-2.117.3.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // Um arquivo que falhar não impede os outros; ele entra na cópia na próxima vez que carregar.
    await Promise.all(FILES.map((file) => cache.add(new Request(file, { cache: 'reload' })).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Com internet, sempre pega a versão mais nova do site; sem internet, usa a cópia guardada.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    try {
      // Uma navegação não pode ser refeita com opções; por isso vai só o endereço.
      const fresh = await fetch(request.mode === 'navigate' ? request.url : request, { cache: 'no-cache' })
      // Resposta que passou por redirecionamento é recusada pelo navegador numa navegação; vai uma cópia limpa.
      const response = fresh.redirected
        ? new Response(fresh.body, { status: fresh.status, statusText: fresh.statusText, headers: fresh.headers })
        : fresh
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true })
        ?? (request.mode === 'navigate' ? await cache.match('./') : undefined)
      if (cached) return cached
      throw error
    }
  })())
})

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

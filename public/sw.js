const VERSION = 'programacion-tv-v1'
const APP_CACHE = `${VERSION}-app`
const GUIDE_CACHE = `${VERSION}-guide`
const GUIDE_PATH = '/data/guide.json'
const APP_SHELL = ['./', './manifest.webmanifest', './favicon.svg', './pwa-icon.svg']

function isGuideRequest(request) {
  const url = new URL(request.url)
  return url.pathname.endsWith(GUIDE_PATH)
}

function withCacheHeader(response) {
  const headers = new Headers(response.headers)
  headers.set('X-Programacion-TV-Cache', 'true')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
  clients.forEach((client) => client.postMessage(message))
}

async function cacheAppShell() {
  const cache = await caches.open(APP_CACHE)
  await cache.addAll(APP_SHELL)
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(cacheAppShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  if (isGuideRequest(request)) {
    event.respondWith(fetchGuide(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./')))
    return
  }

  event.respondWith(cacheFirst(request))
})

async function fetchGuide(request) {
  const cache = await caches.open(GUIDE_CACHE)

  try {
    const networkResponse = await fetch(request)

    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone())
      notifyClients({ type: 'GUIDE_NETWORK_OK' })
    }

    return networkResponse
  } catch {
    const cachedResponse = await cache.match(request)

    if (cachedResponse) {
      notifyClients({ type: 'GUIDE_CACHE_USED' })
      return withCacheHeader(cachedResponse)
    }

    notifyClients({ type: 'GUIDE_CACHE_MISSING' })
    throw new Error('No hay una guía cacheada disponible.')
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request)
  if (cachedResponse) return cachedResponse

  const networkResponse = await fetch(request)

  if (networkResponse.ok && request.url.startsWith(self.location.origin)) {
    const cache = await caches.open(APP_CACHE)
    await cache.put(request, networkResponse.clone())
  }

  return networkResponse
}

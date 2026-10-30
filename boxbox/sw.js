/*
 * Box Box service worker.
 *
 * The game has no backend — the engine, the career and the saves are all on the
 * device — so once the shell is cached it should run with no network at all.
 *
 * Strategy: network-first for navigations so a newly deployed build is picked up
 * as soon as there is a connection, falling back to the cached shell offline;
 * cache-first for hashed build assets, which never change under a given URL.
 */

const VERSION = 'boxbox-v1'
// Everything lives under the worker's scope (the site serves the game at /boxbox/).
const BASE = new URL(self.registration.scope).pathname
const SHELL = [
  '',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'apple-touch-icon.png',
  // self-hosted so they can be cached at all; a cross-origin font never could be
  'fonts/barlow-400.woff2',
  'fonts/barlow-500.woff2',
  'fonts/barlow-600.woff2',
  'fonts/barlow-700.woff2',
  'fonts/barlow-condensed-600.woff2',
  'fonts/barlow-condensed-700.woff2',
  'fonts/barlow-condensed-700-italic.woff2',
  'fonts/barlow-condensed-800-italic.woff2',
].map((p) => BASE + p)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // a missing optional file must not fail the whole install
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // only this game's old caches: the site's own caches live on the same origin
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('boxbox-') || k.startsWith('grid-')) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(BASE + 'index.html', copy))
          return res
        })
        .catch(() => caches.match(BASE + 'index.html').then((r) => r ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          // only cache what came back whole; opaque and error responses are skipped
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})

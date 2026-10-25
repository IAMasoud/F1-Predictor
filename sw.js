/*
 * F1 AI Race Predictor — Service Worker
 * Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Authorship canary: F1PRED-AM-2026-9f3c2a7b4e
 */
const CACHE = 'f1-predictor-v76';
const STATIC = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/screens.css',
  '/screens.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-96.png',
  '/icons/icon-512.png',
  '/season.js',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&family=Barlow:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only GET requests are cacheable; the app's own API (/api/…) and every other
  // site's data (Supabase, Jolpica, OpenF1, weather, the local bridge) always go
  // straight to the network. That keeps the cache small: just the app shell.
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!(sameOrigin || isFont) || (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/join')))) return;

  // Page loads: the latest app from the network (so a deploy shows on the first open),
  // the cached copy when offline or the network takes longer than 4 seconds.
  // Only the app itself is cached as the offline page; /privacy and /terms just load.
  if (e.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('/index.html', clone)).catch(() => {});
        }
        return res;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Static files: network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push notification received
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'F1 Race Predictor', {
      body: data.body || 'Race weekend update!',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      data: { url: data.url || '/' },
      vibrate: [100, 50, 100],
    })
  );
});

// Tap notification → open app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('f1-predictor'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

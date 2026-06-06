/*
 * F1 AI Race Predictor — Service Worker
 * Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Authorship canary: F1PRED-AM-2026-9f3c2a7b4e
 */
const CACHE = 'f1-predictor-v55';
const STATIC = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-96.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Titillium+Web:wght@300;400;600;700&family=Rajdhani:wght@400;500;600;700&display=swap'
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

  // Never cache Supabase, OpenRouter, or live F1 API calls
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('ergast.com') ||
    url.hostname.includes('jolpi.ca') ||
    url.hostname.includes('open-meteo.com')
  ) {
    return;
  }

  // For navigation requests: serve from cache, fall back to network
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then(cached => cached || fetch(e.request))
    );
    return;
  }

  // For everything else: network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
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

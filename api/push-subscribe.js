/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';

// Only real browser push services may be stored as a push address.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const PREF_TYPES = ['predictionReady', 'raceWeekend', 'qualifying', 'sprint', 'countdown', 'results', 'rainAlert', 'dataFetched', 'liveLights'];

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (rateLimited(`push:${clientIp(req)}`, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });

  const { subscription, preferences } = req.body || {};
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!validEndpoint(endpoint)) return res.status(400).json({ error: 'Invalid subscription' });
  if (typeof p256dh !== 'string' || p256dh.length > 200 || !B64URL.test(p256dh) ||
      typeof auth !== 'string' || auth.length > 100 || !B64URL.test(auth)) {
    return res.status(400).json({ error: 'Invalid subscription keys' });
  }

  // Known notification types only, each true/false.
  const prefs = {};
  for (const t of PREF_TYPES) {
    if (typeof preferences?.[t] === 'boolean') prefs[t] = preferences[t];
  }

  try {
    const r = await sb('push_subscriptions', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { endpoint, p256dh, auth, preferences: prefs, created_at: new Date().toISOString() },
    });
    if (!r.ok) {
      console.warn('[push-subscribe] save failed', r.status, (await r.text()).slice(0, 200));
      return res.status(500).json({ error: 'Could not save subscription' });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.warn('[push-subscribe]', e.message);
    res.status(500).json({ error: 'Could not save subscription' });
  }
}

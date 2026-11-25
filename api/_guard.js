/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Shared request guards for the public endpoints (not a route — "_" files aren't deployed as endpoints).
import { createHmac, timingSafeEqual } from 'node:crypto';

// Only the app itself may call these endpoints (browsers always send Origin on POST).
// the site's own addresses: pitwall.company (and www), the original vercel.app address and its previews, local dev
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?pitwall\.company$|^https:\/\/f1-predictor(-theta|(-[a-z0-9-]+)?-ahmoudy365-6346s-projects)\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;

export function isAllowedOrigin(req) {
  return ALLOWED_ORIGIN.test(req.headers.origin || '');
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}

// Best-effort limiter (per server instance): at most `max` hits per `windowMs` for a key.
const hits = new Map();
export function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  const limited = recent.length >= max;
  if (!limited) recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return limited;
}

// Supabase REST call with the server-only service key (bypasses row-level security).
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SB_URL, key = process.env.SB_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
}

// Signed unsubscribe token for a subscriber id (so links don't need the email address).
export function unsubToken(id) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET not set');
  return createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 32);
}
export function validUnsubToken(id, token) {
  try {
    const a = Buffer.from(unsubToken(id)), b = Buffer.from(String(token || ''));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

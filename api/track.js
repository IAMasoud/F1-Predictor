/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Anonymous usage events for the admin dashboard. No cookies and nothing stored on the
// device: a visitor is a hash of IP + browser + a salt that changes every day, so they
// can be counted for one day but never followed across days. Browsers that send
// "Do Not Track" or "Global Privacy Control" are not counted at all (checked client-side).
import { createHmac, createHash } from 'node:crypto';
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';

const NAMES = new Set(['view', 'screen', 'generate', 'install', 'push_on', 'email_join', 'share', 'error']);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|vercel-screenshot/i;
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);

function device(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'phone';
  return 'desktop';
}
function os(ua) {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}
function browser(ua) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
function visitorHash(ip, ua) {
  const day = new Date().toISOString().slice(0, 10);
  const salt = createHmac('sha256', process.env.SB_SERVICE_KEY || 'f1').update(`track:${day}`).digest('hex');
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 24);
}
function refDomain(ref) {
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    return h && !/f1-predictor/.test(h) ? h.slice(0, 80) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAllowedOrigin(req)) return res.status(403).end();
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT.test(ua)) return res.status(204).end();
  const ip = clientIp(req);
  if (rateLimited(`track:${ip}`, 60, 60 * 1000)) return res.status(429).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const list = (Array.isArray(body?.events) ? body.events : [body]).slice(0, 20);
  const visitor = visitorHash(ip, ua);
  const country = clip(String(req.headers['x-vercel-ip-country'] || ''), 2);
  const common = { visitor, country, device: device(ua), os: os(ua), browser: browser(ua) };
  const rows = list
    .filter(e => e && NAMES.has(e.name))
    .map(e => ({
      ...common,
      name: e.name,
      screen: clip(e.screen, 24),
      referrer: refDomain(e.ref),
      standalone: e.standalone === true,
      lang: clip(e.lang, 12),
      app_version: clip(e.v, 16),
      detail: clip(e.detail, 160),
    }));
  if (!rows.length) return res.status(204).end();
  try {
    const r = await sb('events', { method: 'POST', body: rows, prefer: 'return=minimal' });
    if (!r.ok) console.warn('[track] insert failed', r.status, (await r.text()).slice(0, 160));
  } catch (e) {
    console.warn('[track]', e.message);
  }
  res.status(204).end();
}

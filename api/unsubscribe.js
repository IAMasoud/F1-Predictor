/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Unsubscribe from the race-report email.
//  • GET/POST ?id=…&t=…  — the signed link in every email (POST = one-click from mail apps)
//  • POST {email}         — from the site, for older emails whose link had no id
import { isAllowedOrigin, clientIp, rateLimited, sb, validUnsubToken } from './_guard.js';

const page = (title, msg) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0d0d0d;color:#eee;font-family:-apple-system,Segoe UI,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;padding:32px;text-align:center"><div style="color:#E10600;font-weight:800;font-size:28px;letter-spacing:1px">F1 PREDICTOR</div>
<h1 style="font-size:20px;margin:18px 0 8px">${title}</h1><p style="color:#aaa;line-height:1.5">${msg}</p>
<a href="/" style="display:inline-block;margin-top:16px;color:#fff;background:#E10600;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700">Open the app</a></div></body></html>`;

export default async function handler(req, res) {
  const id = String(req.query?.id || '');
  const token = String(req.query?.t || '');

  // Signed link from an email
  if (id) {
    if (!/^\d{1,12}$/.test(id) || !validUnsubToken(id, token)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(page('Link not valid', 'This unsubscribe link is incomplete or has been changed. Use the link from the email again.'));
    }
    try {
      const r = await sb(`subscribers?id=eq.${id}`, { method: 'PATCH', body: { active: false }, prefer: 'return=minimal' });
      if (!r.ok) throw new Error('supabase ' + r.status);
    } catch (e) {
      console.warn('[unsubscribe]', e.message);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(page('Something went wrong', 'We could not update your subscription. Please try the link again in a minute.'));
    }
    if (req.method === 'POST') return res.status(200).json({ ok: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page('You are unsubscribed', 'You will not receive any more race-report emails.'));
  }

  // From the site (older emails): by email address. Always answers the same way,
  // so it can't be used to check whether an address is subscribed.
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (rateLimited('unsub:' + clientIp(req), 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes('@')) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    await sb(`subscribers?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: { active: false }, prefer: 'return=minimal' });
  } catch (e) { console.warn('[unsubscribe]', e.message); }
  res.status(200).json({ ok: true });
}

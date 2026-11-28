/*
 * Pitwall — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: PITWALL-AM-2026-9f3c2a7b4e
 */
// Newsletter sign-up. The subscribers table is not readable or writable from the
// browser; this endpoint writes it with the server key after validating the email.
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (rateLimited('sub:' + clientIp(req), 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many sign-ups — try again later.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

  try {
    const r = await sb('subscribers?on_conflict=email', {
      method: 'POST',
      body: { email, subscribed_at: new Date().toISOString(), active: true },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (!r.ok) {
      console.warn('[subscribe] supabase', r.status, (await r.text()).slice(0, 200));
      return res.status(502).json({ error: 'Could not save your subscription — please try again.' });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.warn('[subscribe]', e.message);
    res.status(502).json({ error: 'Could not save your subscription — please try again.' });
  }
}

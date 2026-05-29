/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subscription, preferences } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  const SB_URL = process.env.SB_URL;
  const SB_SERVICE_KEY = process.env.SB_SERVICE_KEY;
  if (!SB_URL || !SB_SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/push_subscriptions`, {
      method: 'POST',
      headers: {
        'apikey': SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh,
        auth: subscription.keys?.auth,
        preferences: preferences || {},
        created_at: new Date().toISOString(),
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: 'DB error', details: err });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

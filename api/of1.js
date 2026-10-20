/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Server-side proxy for OpenF1 API calls.
// Routing through Vercel's server IP avoids the 429 rate-limit that mobile
// clients hit when calling api.openf1.org directly.
// Also handles OpenF1's live-session lockout (401) gracefully.
export const config = { maxDuration: 20 };

const ALLOWED_PREFIX = 'https://api.openf1.org/v1/';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url || !url.startsWith(ALLOWED_PREFIX)) {
    return res.status(400).json({ error: 'Invalid or missing url parameter' });
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    const body = await upstream.text();

    // OpenF1 locks down during live sessions — detect and signal the client
    if (upstream.status === 401 || upstream.status === 403) {
      const isLiveLock = body.includes('Live F1 session') || body.includes('authenticated');
      return res
        .status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('X-OF1-Live-Lock', isLiveLock ? '1' : '0')
        .setHeader('X-OF1-Upstream-Status', String(upstream.status))
        .send('[]');
    }

    // 429 rate-limit — return empty + header so client can back off
    if (upstream.status === 429) {
      return res
        .status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('X-OF1-Rate-Limited', '1')
        .send('[]');
    }

    // Live feeds stay fresh; schedule-like data (meetings, sessions, drivers, stints, pit stops)
    // barely changes, so Vercel's cache answers repeat visitors instead of OpenF1's free limit.
    const live = /\/v1\/(position|intervals|race_control|car_data|location|team_radio|weather|laps)\b/.test(url);
    res.status(upstream.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', live ? 'public, s-maxage=30, stale-while-revalidate=60' : 'public, s-maxage=600, stale-while-revalidate=3600')
      .send(body);
  } catch (err) {
    res.status(502).json({ error: 'OpenF1 proxy error', details: err.message });
  }
}

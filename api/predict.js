/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Vercel Hobby allows up to 60s per function — give AI calls room to finish.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 20000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const key = process.env.OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://f1-predictor-theta.vercel.app',
        'X-Title': 'F1 Race Predictor',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: 'You are an expert F1 race analyst. Always respond with valid JSON only — no markdown, no preamble, no explanation outside the JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 1.0,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(40000)
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}

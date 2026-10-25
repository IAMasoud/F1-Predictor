/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
import { generateText } from './_ai.js';
import { isAllowedOrigin, clientIp, rateLimited } from './_guard.js';

// Vercel Hobby allows up to 60s per function — give AI calls room to finish.
export const config = { maxDuration: 60 };

const SYSTEM = 'You are an expert F1 race analyst. Always respond with valid JSON only — no markdown, no preamble, no explanation outside the JSON.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  // The owner's check that the Groq backup key works: Bearer CRON_SECRET and { test: 'groq' }.
  if (req.body?.test === 'groq' && process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`) {
    try {
      const out = await generateText({ system: 'Reply with JSON only.', prompt: 'Reply with {"ok": true, "word": "box"}.', deadlineMs: 25000, only: 'groq', meta: { source: 'test' } });
      return res.status(200).json({ ok: true, model: out.model, provider: out.provider, text: out.text.slice(0, 80) });
    } catch (e) { return res.status(502).json({ ok: false, error: String(e.message).slice(0, 200) }); }
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  // 12 AI requests per 10 minutes per visitor
  if (rateLimited('predict:' + clientIp(req), 12, 10 * 60 * 1000)) {
    return res.status(429).json({ error: { message: 'Too many predictions in a short time — wait a few minutes and try again.' } });
  }

  const { prompt, race, stage } = req.body || {};
  const tag = v => (typeof v === 'string' && /^[a-zA-Z_]{2,24}$/.test(v) ? v : null);
  if (!prompt || typeof prompt !== 'string' || prompt.length > 20000) {
    return res.status(400).json({ error: { message: 'Invalid prompt' } });
  }

  try {
    const out = await generateText({ system: SYSTEM, prompt, temperature: 0.8, deadlineMs: 40000, // page gives up at 45s
      meta: { source: 'user', race: tag(race), stage: tag(stage) } });
    // Same shape the page already reads: data.choices[0].message.content
    res.status(200).json({
      choices: [{ message: { role: 'assistant', content: out.text } }],
      model: out.model,
      provider: out.provider,
    });
  } catch (err) {
    res.status([429, 503].includes(err.status) ? err.status : 502).json({ error: { message: err.message } });
  }
}

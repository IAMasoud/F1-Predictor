/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
import { generateText } from './_ai.js';

// Vercel Hobby allows up to 60s per function — give AI calls room to finish.
export const config = { maxDuration: 60 };

// Only the app itself may call this endpoint (browsers always send Origin on POST).
const ALLOWED_ORIGIN = /^https:\/\/f1-predictor(-theta|(-[a-z0-9-]+)?-ahmoudy365-6346s-projects)\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;

// Best-effort per-IP limit (per server instance): 12 requests per 10 minutes.
const WINDOW_MS = 10 * 60 * 1000, MAX_PER_WINDOW = 12;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const SYSTEM = 'You are an expert F1 race analyst. Always respond with valid JSON only — no markdown, no preamble, no explanation outside the JSON.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  if (!ALLOWED_ORIGIN.test(req.headers.origin || '')) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: { message: 'Too many predictions in a short time — wait a few minutes and try again.' } });
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 20000) {
    return res.status(400).json({ error: { message: 'Invalid prompt' } });
  }

  try {
    const out = await generateText({ system: SYSTEM, prompt, temperature: 0.8, deadlineMs: 40000 }); // page gives up at 45s
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

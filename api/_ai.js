/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Shared AI caller (not a route — files starting with "_" are not deployed as endpoints).
// Free providers only: Google Gemini free tier (primary), Groq free plan (optional backup).
// Neither has billing attached, so neither can ever charge.

// Free-tier models tried in order. A busy model answers 503 within ~1s, so walking the
// list is cheap; each attempt is also capped so one hung model can't eat the whole budget.
const GEMINI_MODELS = [
  { model: 'gemini-flash-latest',      thinkingLevel: 'low' },
  { model: 'gemini-3.5-flash',         thinkingLevel: 'low' },
  { model: 'gemini-3.7-flash',         thinkingLevel: 'low' },
  { model: 'gemini-3.6-flash',         thinkingLevel: 'low' },
  // The lite models answer fast but think less: Groq (when set up) is asked before them.
  { model: 'gemini-flash-lite-latest', thinkingLevel: 'minimal', lite: true },
  { model: 'gemini-3.1-flash-lite',    thinkingLevel: 'minimal', lite: true },
];
const PER_ATTEMPT_MS = 30000;
import { sb } from './_guard.js';

// One row per attempt in ai_calls, for the admin dashboard. Never blocks or breaks a call.
async function logAttempts(rows, meta = {}) {
  if (!rows.length || !process.env.SB_SERVICE_KEY) return;
  const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
  try {
    await sb('ai_calls', { method: 'POST', prefer: 'return=minimal', body: rows.map(r => ({
      source: clip(meta.source, 12), race: clip(meta.race, 24), stage: clip(meta.stage, 16),
      model: clip(r.model, 48), ok: r.ok, ms: r.ms, error: clip(r.error, 200),
    })) });
  } catch { /* logging is best-effort */ }
}
const GROQ_MODEL = 'openai/gpt-oss-120b';

export class AIError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function callGemini({ model, thinkingLevel }, key, { system, prompt, temperature, maxTokens }, timeoutMs) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new AIError(data?.error?.message || `Gemini HTTP ${r.status}`, r.status);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new AIError(`Gemini returned no text (${data?.candidates?.[0]?.finishReason || 'unknown'})`, 502);
  return { text, model: data.modelVersion || model, provider: 'gemini' };
}

async function callGroq(key, { system, prompt, temperature }, timeoutMs) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: 3000, // free plan allows 8K tokens/min including the prompt
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new AIError(data?.error?.message || `Groq HTTP ${r.status}`, r.status);
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new AIError('Groq returned no text', 502);
  return { text, model: GROQ_MODEL, provider: 'groq' };
}

/* Try each free provider in order until one answers inside the time budget.
   `waits` is the pause before each pass over the model list: the free tier's "high demand"
   answers usually clear within a minute, so scheduled calls (which nobody is waiting on)
   pass longer waits than a visitor's Generate button does.
   Returns { text, model, provider }. Throws AIError (status 429 when every provider is rate-limited). */
export async function generateText({ system = '', prompt, temperature = 0.8, maxTokens = 8192, deadlineMs = 40000,
  waits = [0, 1500], perAttemptMs = PER_ATTEMPT_MS, meta, only }) {
  const started = Date.now();
  const left = () => deadlineMs - (Date.now() - started);
  const opts = { system, prompt, temperature, maxTokens };
  const errors = [];
  const attempts = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  let groqTried = false;
  const tryGroq = async () => {
    groqTried = true;
    const t0 = Date.now();
    try {
      const out = await callGroq(groqKey, opts, Math.min(left(), perAttemptMs));
      attempts.push({ model: GROQ_MODEL, ok: true, ms: Date.now() - t0 });
      await logAttempts(attempts, meta);
      return out;
    } catch (e) {
      errors.push({ who: 'groq', status: e.status, msg: e.message });
      attempts.push({ model: GROQ_MODEL, ok: false, ms: Date.now() - t0, error: `${e.status || e.name} ${e.message}` });
      return null;
    }
  };
  // only: 'groq' checks the backup key on its own (the owner's test in api/predict.js).
  if (only === 'groq') {
    if (!groqKey) throw new AIError('GROQ_API_KEY is not set', 500);
    const out = await tryGroq();
    if (out) return out;
    await logAttempts(attempts, meta);
    throw new AIError(errors[0]?.msg || 'Groq did not answer', errors[0]?.status || 502);
  }
  for (let pass = 0; geminiKey && pass < waits.length && left() >= 4000; pass++) {
    if (waits[pass]) {
      if (left() < waits[pass] + 6000) break;
      await new Promise(r => setTimeout(r, waits[pass]));
    }
    for (const m of GEMINI_MODELS) {
      if (left() < 4000) break;
      if (m.lite && groqKey && !groqTried) { const out = await tryGroq(); if (out) return out; if (left() < 4000) break; }
      const t0 = Date.now();
      try {
        const out = await callGemini(m, geminiKey, opts, Math.min(left(), perAttemptMs));
        console.log(`[ai] ${m.model} ok in ${Date.now() - t0}ms (${out.model})`);
        attempts.push({ model: m.model, ok: true, ms: Date.now() - t0 });
        await logAttempts(attempts, meta);
        return out;
      }
      catch (e) {
        errors.push({ who: m.model, status: e.status, msg: e.message });
        attempts.push({ model: m.model, ok: false, ms: Date.now() - t0, error: `${e.status || e.name} ${e.message}` });
        console.warn(`[ai] ${m.model} failed after ${Date.now() - t0}ms: ${e.status || e.name} ${String(e.message).slice(0, 200)}`);
        // A rejected key won't work on another model or pass.
        if (e.status === 401 || e.status === 403) { pass = waits.length; break; }
      }
    }
    // The backup provider goes right after the first full pass, before any waiting.
    if (pass === 0 && groqKey && !groqTried && left() >= 4000) { const out = await tryGroq(); if (out) return out; }
  }
  if (groqKey && !groqTried && left() >= 4000) { const out = await tryGroq(); if (out) return out; }
  await logAttempts(attempts, meta); // a success returned above, already logged

  if (!geminiKey && !groqKey) throw new AIError('No AI key configured on the server', 500);
  console.warn('[ai] all providers failed:', JSON.stringify(errors));
  const allLimited = errors.length && errors.every(e => e.status === 429);
  const allBusy = errors.length && errors.every(e => [429, 500, 503, 504].includes(e.status) || /timeout|abort/i.test(e.msg));
  throw new AIError(
    allLimited ? 'The free AI quota is used up for now — try again later.'
    : allBusy  ? 'The free AI is busy right now — try again in a few minutes.'
               : `AI unavailable (${errors.map(e => `${e.who}: ${e.status || e.msg}`).join('; ')})`,
    allLimited ? 429 : allBusy ? 503 : 502
  );
}

/* Same as generateText but parses the first {...} JSON object out of the reply. */
export async function generateJSON(args) {
  const res = await generateText(args);
  const s = res.text.indexOf('{'), e = res.text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new AIError('No JSON in AI response', 502);
  return { ...res, json: JSON.parse(res.text.slice(s, e + 1)) };
}

/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// The Pit Wall admin API. Every request needs a Supabase sign-in token for the admin
// account (one email, role "admin"); data is read and written with the server key.
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';
import { loadSeason, sessionEndMs } from '../season.js';

export const config = { maxDuration: 60 };

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ahmoudy365@gmail.com').toLowerCase();
const STAGE_ORDER = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];
const tokens = new Map(); // token → { email, until }

// Results are stored as Jolpica driver ids; predictions carry 3-letter codes. Compare codes.
const ID_ABBR = { antonelli:'ANT', russell:'RUS', leclerc:'LEC', norris:'NOR', hamilton:'HAM', piastri:'PIA', max_verstappen:'VER',
  bearman:'BEA', gasly:'GAS', ocon:'OCO', hadjar:'HAD', lawson:'LAW', colapinto:'COL', sainz:'SAI', albon:'ALB', bortoleto:'BOR',
  hulkenberg:'HUL', stroll:'STR', lindblad:'LIN', arvid_lindblad:'LIN', alonso:'ALO', bottas:'BOT', perez:'PER', tsunoda:'TSU' };
const toAbbr = id => ID_ABBR[id] || String(id || '').slice(0, 3).toUpperCase();

async function adminFor(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096) return null;
  const hit = tokens.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const r = await fetch(`${process.env.SB_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SB_SERVICE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const u = await r.json().catch(() => ({}));
  const email = String(u?.email || '').toLowerCase();
  if (email !== ADMIN_EMAIL || u?.app_metadata?.role !== 'admin') return null;
  if (tokens.size > 200) tokens.clear();
  tokens.set(token, { email, until: Date.now() + 60000 });
  return email;
}

async function json(path, opts) {
  const r = await sb(path, opts);
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn, body = {}) => json(`rpc/${fn}`, { method: 'POST', body });

// ── season numbers for the AI, from the saved predictions ──
function aiSeason(preds) {
  const byRound = {};
  preds.filter(p => p.pred_type === 'race' && p.stage !== 'final' && !p.hidden && Array.isArray(p.actual_results) && p.actual_results.length)
    .forEach(p => (byRound[p.round] ||= []).push(p));
  let scored = 0, sum = 0, aiRaces = 0, winners = 0, podium = 0, podiumTotal = 0;
  const perRace = [];
  for (const [round, rows] of Object.entries(byRound)) {
    const rank = p => (p.fallback ? 100 : 0) + (STAGE_ORDER.indexOf(p.stage) + 1 || 50);
    const best = rows.slice().sort((a, b) => rank(a) - rank(b))[0];
    if (best.accuracy == null) continue;
    scored++; sum += best.accuracy;
    const top = best.top3 || [];
    const act = best.actual_results.map(toAbbr);
    if (!best.fallback) {
      aiRaces++;
      if (top[0] && top[0] === act[0]) winners++;
      top.forEach(id => { podiumTotal++; if (act.slice(0, 3).includes(id)) podium++; });
    }
    perRace.push({ round: +round, circuit: best.circuit_id, stage: best.stage, accuracy: best.accuracy, baseline: !!best.fallback,
      called: top[0] || null, winner: act[0] || null });
  }
  perRace.sort((a, b) => a.round - b.round);
  return { races: scored, average: scored ? Math.round(sum / scored) : null, aiRaces, winners, podium, podiumTotal, perRace };
}

async function predictionsList() {
  const rows = await json('predictions?select=id,round,circuit_id,race_name,pred_type,stage,created_at,accuracy,hidden,actual_results,fallback:prediction->_fallback,top10:prediction->top10&order=created_at.desc&limit=400');
  return rows.map(p => ({
    ...p,
    fallback: p.fallback === true,
    top3: (p.top10 || []).slice(0, 3).map(d => String(d?.abbr || '').toUpperCase()).filter(Boolean),
    winner: p.top10?.[0]?.abbr || null,
    winProb: p.top10?.[0]?.winProb ?? null,
    top10: undefined,
  }));
}

function raceEndMs(r) { return sessionEndMs(r, 'race') ?? Date.parse(`${r.date}T23:59:00Z`); }
function stagesFor(r) { return r.sprint ? ['beforeSprintQ', 'afterSprintQ', 'afterSprint', 'afterQuali'] : ['beforeQuali', 'afterQuali']; }

async function weekend(preds) {
  const { season, races } = await loadSeason();
  const now = Date.now();
  const next = races.find(r => raceEndMs(r) > now) || null;
  const last = [...races].reverse().find(r => raceEndMs(r) <= now) || null;
  const calls = r => stagesFor(r).map(stage => {
    const rows = preds.filter(p => p.circuit_id === r.circuitId && +p.round === r.round && p.pred_type === 'race' && p.stage === stage);
    const best = rows.find(p => !p.fallback && !p.hidden) || rows.find(p => !p.hidden) || rows[0] || null;
    return { stage, id: best?.id || null, ai: best ? !best.fallback : null, hidden: !!best?.hidden,
      winner: best?.winner || null, winProb: best?.winProb ?? null, accuracy: best?.accuracy ?? null, created_at: best?.created_at || null };
  });
  const at = (d, t) => (d && t ? `${d}T${t}:00Z` : null);
  const sessions = r => [
    ['FP1', at(r.fp1Date, r.fp1UTC)], ...(r.sprint
      ? [['Sprint quali', at(r.sprintQualiDate, r.sprintQualiUTC)], ['Sprint', at(r.sprintDate, r.sprintUTC)]]
      : [['FP2', at(r.fp2Date, r.fp2UTC)], ['FP3', at(r.fp3Date, r.fp3UTC)]]),
    ['Quali', at(r.qualiDate, r.qualiUTC)], ['Race', at(r.date, r.raceUTC)],
  ].map(([name, start]) => ({ name, start }));
  const log = last ? await json(`newsletter_log?circuit_id=eq.${last.circuitId}&season=eq.${season}&order=ts.desc&limit=1`).catch(() => []) : [];
  const pick = r => r && { round: r.round, name: r.name, circuit: r.circuit, circuitId: r.circuitId, date: r.date, sprint: r.sprint, sessions: sessions(r), calls: calls(r) };
  return { season, next: pick(next), last: last && { ...pick(last), newsletter: log?.[0] || null } };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ip = clientIp(req);
  if (rateLimited(`admin:${ip}`, 120, 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });
  if (req.method === 'POST' && !isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  const email = await adminFor(req);
  if (!email) return res.status(401).json({ error: 'Sign in first' });

  const view = String(req.query?.view || '');
  const action = String(req.query?.action || '');
  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 30, 1), 365);
  const self = `https://${req.headers.host}`;

  try {
    if (req.method === 'GET') {
      if (view === 'me') return res.json({ email });
      if (view === 'overview') {
        const [traffic, subs, push, preds, jobs] = await Promise.all([
          rpc('admin_overview', { days }),
          json('subscribers?select=id&active=eq.true'),
          json('push_subscriptions?select=endpoint'),
          predictionsList(),
          rpc('admin_job_status'),
        ]);
        const w = await weekend(preds);
        return res.json({ traffic, subscribers: subs.length, push: push.length, ai: aiSeason(preds),
          predictions: { total: preds.length, baselines: preds.filter(p => p.fallback).length, hidden: preds.filter(p => p.hidden).length },
          jobs, weekend: w });
      }
      if (view === 'ai') {
        const [calls, preds, jobs] = await Promise.all([rpc('admin_ai', { days }), predictionsList(), rpc('admin_job_status')]);
        return res.json({ calls, ai: aiSeason(preds), jobs });
      }
      if (view === 'predictions') return res.json({ predictions: await predictionsList() });
      if (view === 'weekend') return res.json(await weekend(await predictionsList()));
      if (view === 'subscribers') {
        const [subs, push, log] = await Promise.all([
          json('subscribers?select=id,email,subscribed_at,active&order=subscribed_at.desc'),
          json('push_subscriptions?select=endpoint,created_at,preferences&order=created_at.desc'),
          json('newsletter_log?select=*&order=ts.desc&limit=20'),
        ]);
        return res.json({
          subscribers: subs,
          push: push.map(p => ({ service: (p.endpoint.match(/^https:\/\/([^/]+)/) || [])[1] || '?', created_at: p.created_at,
            on: Object.values(p.preferences || {}).filter(v => v !== false).length })),
          sends: log,
        });
      }
      return res.status(400).json({ error: 'Unknown view' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (action === 'hide') {
        if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) return res.status(400).json({ error: 'Bad id' });
        await json(`predictions?id=eq.${body.id}`, { method: 'PATCH', body: { hidden: body.hidden !== false }, prefer: 'return=minimal' });
        return res.json({ ok: true });
      }
      if (action === 'run') {
        const job = String(body.job || '');
        const fn = u => fetch(u, { method: 'POST', signal: AbortSignal.timeout(55000) }).then(r => r.json());
        if (job === 'scoring') return res.json(await fn(`${process.env.SB_URL}/functions/v1/auto-results${body.all ? '?all=1' : ''}`));
        if (job === 'sync') return res.json(await fn(`${process.env.SB_URL}/functions/v1/supabase-sync`));
        if (job === 'predictions') {
          const r = await fetch(`${self}/api/push-send?mode=predictions`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55000) });
          return res.json(await r.json());
        }
        return res.status(400).json({ error: 'Unknown job' });
      }
      if (action === 'newsletter') {
        const circuit = /^[a-z_]{3,20}$/.test(String(body.circuit || '')) ? body.circuit : '';
        const q = new URLSearchParams({ ...(circuit ? { circuit } : {}), ...(body.send === true ? {} : { preview: '1' }) });
        const r = await fetch(`${self}/api/send-newsletter?${q}`, {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
          body: '{}', signal: AbortSignal.timeout(55000),
        });
        return res.status(r.status).json(await r.json());
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.warn('[admin]', e.message);
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
}

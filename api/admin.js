/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// The Pit Wall admin API. Every request needs a Supabase sign-in token for an admin account
// (app_metadata.role "admin", or the owner); data is read and written with the server key.
// Only the owner can add or remove admins and change where the weekly report is delivered.
import { randomBytes } from 'node:crypto';
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';
import { loadSeason, sessionEndMs } from '../season.js';

export const config = { maxDuration: 60 };

const OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'ahmoudy365@gmail.com').toLowerCase();
const OWNER_DEFAULTS = { name: 'Ahmed Masoud', title: 'Founder & CEO' };
const SITE = 'https://f1-predictor-theta.vercel.app';
const INVITE_DAYS = 14;
const STAGE_ORDER = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];
const tokens = new Map(); // token → { me, until }

// Results are stored as Jolpica driver ids; predictions carry 3-letter codes. Compare codes.
const ID_ABBR = { antonelli:'ANT', russell:'RUS', leclerc:'LEC', norris:'NOR', hamilton:'HAM', piastri:'PIA', max_verstappen:'VER',
  bearman:'BEA', gasly:'GAS', ocon:'OCO', hadjar:'HAD', lawson:'LAW', colapinto:'COL', sainz:'SAI', albon:'ALB', bortoleto:'BOR',
  hulkenberg:'HUL', stroll:'STR', lindblad:'LIN', arvid_lindblad:'LIN', alonso:'ALO', bottas:'BOT', perez:'PER', tsunoda:'TSU' };
const toAbbr = id => ID_ABBR[id] || String(id || '').slice(0, 3).toUpperCase();

const lower = v => String(v || '').trim().toLowerCase();
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const cleanEmail = v => { const e = lower(v); return e.length <= 254 && EMAIL_RE.test(e) ? e : ''; };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function profile(u) {
  const email = lower(u?.email);
  const owner = email === OWNER_EMAIL || u?.app_metadata?.role === 'owner';
  if (!owner && u?.app_metadata?.role !== 'admin') return null;
  const meta = u.user_metadata || {};
  return {
    id: u.id, email, owner, role: owner ? 'owner' : 'admin',
    name: clip(meta.full_name || (owner ? OWNER_DEFAULTS.name : ''), 60),
    title: clip(meta.title || (owner ? OWNER_DEFAULTS.title : 'Admin'), 40),
    created_at: u.created_at || null, last_sign_in_at: u.last_sign_in_at || null,
  };
}

async function adminFor(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096) return null;
  const hit = tokens.get(token);
  if (hit && hit.until > Date.now()) return hit.me;
  const r = await fetch(`${process.env.SB_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SB_SERVICE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const me = profile(await r.json().catch(() => ({})));
  if (!me) return null;
  if (tokens.size > 200) tokens.clear();
  tokens.set(token, { me, until: Date.now() + 60000 });
  return me;
}

/* Supabase Auth admin API (service key): list, create, update and delete sign-in accounts. */
async function authAdmin(path, { method = 'GET', body } = {}) {
  const key = process.env.SB_SERVICE_KEY;
  const r = await fetch(`${process.env.SB_URL}/auth/v1/admin/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.msg || j.message || j.error_description || `Auth error ${r.status}`); e.status = r.status; e.code = j.error_code || j.code; throw e; }
  return j;
}
async function allUsers() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await authAdmin(`users?page=${page}&per_page=200`);
    const users = j.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

async function json(path, opts) {
  const r = await sb(path, opts);
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn, body = {}) => json(`rpc/${fn}`, { method: 'POST', body });

// The ops edge function: daily scan, weekly report, delivery test.
async function ops(task) {
  const r = await fetch(`${process.env.SB_URL}/functions/v1/ops?task=${task}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(55000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `The ops job answered ${r.status}`);
  return body;
}

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
  const log = last ? await json(`newsletter_log?round=eq.${last.round}&season=eq.${season}&sent=gt.0&order=ts.desc&limit=1`).catch(() => []) : [];
  const pick = r => r && { round: r.round, name: r.name, circuit: r.circuit, circuitId: r.circuitId, date: r.date, sprint: r.sprint, sessions: sessions(r), calls: calls(r) };
  return { season, next: pick(next), last: last && { ...pick(last), ended: raceEndMs(last), newsletter: log?.[0] || null } };
}

/* Where the weekly report goes. Tokens never leave the server; the page only sees what is set. */
const SETTINGS = {
  telegram_token: /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/,
  telegram_chat: /^-?\d{3,20}$/,
  discord_webhook: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,100}$/,
  whatsapp_phone: /^\+?\d{8,15}$/,
  whatsapp_key: /^[A-Za-z0-9]{4,24}$/,
};
async function readSettings() {
  const rows = await json('app_settings?select=key,value');
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}
function deliveryStatus(s) {
  const tail = v => (v ? `…${String(v).slice(-3)}` : null);
  return {
    telegram: { on: !!(s.telegram_token && s.telegram_chat), bot: !!s.telegram_token, chat: tail(s.telegram_chat) },
    discord: { on: !!s.discord_webhook },
    whatsapp: { on: !!(s.whatsapp_phone && s.whatsapp_key), phone: tail(s.whatsapp_phone) },
  };
}

/* Team invites and applications (owner only). */
const inviteState = i => i.revoked ? 'cancelled' : i.used_at ? 'used' : Date.parse(i.expires_at) < Date.now() ? 'expired' : 'waiting';
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* The answer email, written as a letter from the owner. */
function decisionEmail({ accepted, name, role, note }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const body = accepted
    ? [`Congrats, and welcome to the team!`,
       `I'm really happy to tell you that you've been accepted to join F1 Predictor as ${role}.`,
       `You can sign in to Pit Wall, our team dashboard, with the email and password you chose when you applied.`]
    : [`Thank you for applying to join F1 Predictor as ${role}, and for the time you put into your application.`,
       `I'm really sorry, but we couldn't accept you this time.`,
       `I wish you all the best, and I hope our paths cross again.`];
  const extra = String(note || '').trim().slice(0, 1500);
  const P = t => `<p style="margin:0 0 14px;color:#d6d6d6;font:400 15px/1.6 Arial,Helvetica,sans-serif">${escHtml(t).replace(/\n/g, '<br>')}</p>`;
  const html = `<div style="background:#070708;padding:28px 12px">
  <div style="max-width:520px;margin:0 auto;background:#111113;border-radius:12px;padding:28px 26px">
    <div style="font:700 12px Arial,Helvetica,sans-serif;letter-spacing:3px;color:#ffffff"><span style="color:#ff2a2a">&#9679;&#9679;&#9679;&#9679;</span><span style="color:#3a3a3e">&#9679;</span>&nbsp; F1 PREDICTOR</div>
    <h1 style="margin:22px 0 16px;font:italic 800 28px/1.1 'Arial Narrow',Arial,sans-serif;text-transform:uppercase;color:#ffffff">${accepted ? 'Welcome to the team' : 'Thank you for applying'}</h1>
    ${P(`Hi ${first},`)}${body.map(P).join('')}${extra ? P(extra) : ''}
    ${accepted ? `<a href="${SITE}/admin" style="display:inline-block;margin:4px 0 18px;background:#e01e1e;color:#ffffff;text-decoration:none;font:700 14px Arial,Helvetica,sans-serif;letter-spacing:.5px;text-transform:uppercase;padding:12px 22px;border-radius:8px">Sign in to Pit Wall</a>` : ''}
    <p style="margin:8px 0 0;color:#ffffff;font:700 15px Arial,Helvetica,sans-serif">Ahmed Masoud</p>
    <p style="margin:2px 0 0;color:#949494;font:400 13px Arial,Helvetica,sans-serif">Founder &amp; CEO, F1 Predictor</p>
  </div></div>`;
  const text = [`Hi ${first},`, ...body, ...(extra ? [extra] : []), ...(accepted ? [`Sign in: ${SITE}/admin`] : [])].join('\n\n') + '\n\nAhmed Masoud\nFounder & CEO, F1 Predictor';
  return { subject: accepted ? `Welcome to the F1 Predictor team, ${first}` : 'Your F1 Predictor application', html, text };
}
async function sendMail({ to, subject, html, text }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('Email is not set up on the server');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: { name: OWNER_DEFAULTS.name, email: process.env.NEWSLETTER_FROM_EMAIL || OWNER_EMAIL },
      replyTo: { name: OWNER_DEFAULTS.name, email: OWNER_EMAIL }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`The email service answered ${r.status}`);
}
async function signedFileUrl(bucket, path, seconds, download) {
  const key = process.env.SB_SERVICE_KEY;
  const r = await fetch(`${process.env.SB_URL}/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds }), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Could not open that file');
  return `${process.env.SB_URL}/storage/v1${j.signedURL}${download ? `&download=${encodeURIComponent(download)}` : ''}`;
}
async function removeFile(bucket, path) {
  const key = process.env.SB_SERVICE_KEY;
  await fetch(`${process.env.SB_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] }), signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

async function signedReportUrl(path) {
  const key = process.env.SB_SERVICE_KEY;
  const r = await fetch(`${process.env.SB_URL}/storage/v1/object/sign/reports/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Could not open that report');
  return `${process.env.SB_URL}/storage/v1${j.signedURL}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ip = clientIp(req);
  if (rateLimited(`admin:${ip}`, 120, 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });
  if (req.method === 'POST' && !isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  const me = await adminFor(req);
  if (!me) return res.status(401).json({ error: 'Sign in first' });

  const view = String(req.query?.view || '');
  const action = String(req.query?.action || '');
  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 30, 1), 365);
  const self = `https://${req.headers.host}`;
  const ownerOnly = () => res.status(403).json({ error: 'Only the owner can do this' });

  try {
    if (req.method === 'GET') {
      if (view === 'me') {
        const pending = me.owner ? (await json('member_applications?status=eq.pending&select=id').catch(() => []))?.length || 0 : 0;
        return res.json({ id: me.id, email: me.email, name: me.name, title: me.title, role: me.role, owner: me.owner, pending });
      }
      if (view === 'overview') {
        const [traffic, subs, push, preds, jobs] = await Promise.all([
          rpc('admin_overview', { days }),
          json('subscribers?select=id&active=eq.true'),
          json('push_subscriptions?select=endpoint'),
          predictionsList(),
          rpc('admin_job_status'),
        ]);
        const w = await weekend(preds);
        const health = await json('health_checks?select=ts,ok,failed&order=ts.desc&limit=1').catch(() => []);
        const pending = me.owner ? (await json('member_applications?status=eq.pending&select=id').catch(() => []))?.length || 0 : 0;
        return res.json({ traffic, subscribers: subs.length, push: push.length, ai: aiSeason(preds),
          predictions: { total: preds.length, baselines: preds.filter(p => p.fallback).length, hidden: preds.filter(p => p.hidden).length },
          jobs, weekend: w, health: health?.[0] || null, members_pending: pending });
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
      if (view === 'races') {
        // Finished races this season, newest first, with every race-report send.
        const { season, races } = await loadSeason();
        const now = Date.now();
        const log = await json(`newsletter_log?season=eq.${season}&select=round,ts,sent,failed,kind&order=ts.desc`);
        return res.json({ season, races: races.filter(r => raceEndMs(r) <= now).reverse()
          .map(r => ({ round: r.round, name: r.name, circuitId: r.circuitId, date: r.date, sends: (log || []).filter(l => l.round === r.round && l.sent > 0) })) });
      }
      if (view === 'admins') {
        const list = (await allUsers()).map(profile).filter(Boolean)
          .sort((a, b) => (b.owner - a.owner) || String(a.created_at).localeCompare(String(b.created_at)));
        return res.json({ admins: list, you: me.id, canManage: me.owner });
      }
      if (view === 'invites') {
        if (!me.owner) return ownerOnly();
        const rows = await json('admin_invites?select=id,token,role,created_at,expires_at,used_at,revoked&order=created_at.desc&limit=50');
        return res.json({ invites: (rows || []).map(i => ({ id: i.id, role: i.role, created_at: i.created_at, expires_at: i.expires_at, used_at: i.used_at,
          state: inviteState(i), link: inviteState(i) === 'waiting' ? `${SITE}/join#t=${i.token}` : null })) });
      }
      if (view === 'members') {
        if (!me.owner) return ownerOnly();
        const rows = await json('member_applications?select=*&order=created_at.desc&limit=300');
        return res.json({ applications: rows || [] });
      }
      if (view === 'health') {
        const [scans, log, reports, settings] = await Promise.all([
          json('health_checks?select=*&order=ts.desc&limit=14'),
          json('maintenance_log?select=*&order=ts.desc&limit=80'),
          json('weekly_reports?select=id,created_at,week_start,week_end,summary,delivered&order=created_at.desc&limit=12'),
          readSettings(),
        ]);
        return res.json({ scans, log, reports, delivery: deliveryStatus(settings), canManage: me.owner });
      }
      return res.status(400).json({ error: 'Unknown view' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      if (action === 'hide') {
        if (!UUID_RE.test(String(body.id || ''))) return res.status(400).json({ error: 'Bad id' });
        await json(`predictions?id=eq.${body.id}`, { method: 'PATCH', body: { hidden: body.hidden !== false }, prefer: 'return=minimal' });
        return res.json({ ok: true });
      }

      if (action === 'run') {
        const job = String(body.job || '');
        const fn = u => fetch(u, { method: 'POST', signal: AbortSignal.timeout(55000) }).then(r => r.json());
        if (job === 'scoring') return res.json(await fn(`${process.env.SB_URL}/functions/v1/auto-results${body.all ? '?all=1' : ''}`));
        if (job === 'sync') return res.json(await fn(`${process.env.SB_URL}/functions/v1/supabase-sync`));
        if (job === 'predictions') {
          // When the free AI is busy the job keeps retrying for a few minutes, longer than this page waits.
          try {
            const r = await fetch(`${self}/api/push-send?mode=predictions`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55000) });
            return res.json(await r.json().catch(() => ({ ok: r.ok })));
          } catch { return res.json({ ok: true, working: true }); }
        }
        if (job === 'scan') return res.json(await ops('scan'));
        if (job === 'weekly') return res.json(await ops('weekly'));
        return res.status(400).json({ error: 'Unknown job' });
      }

      // Race report: preview it, send a test to yourself, or send it to every subscriber.
      if (action === 'newsletter') {
        const circuit = /^[a-z_]{3,20}$/.test(String(body.circuit || '')) ? body.circuit : '';
        const mode = ['preview', 'test', 'send'].includes(body.mode) ? body.mode : body.send === true ? 'send' : 'preview';
        const q = new URLSearchParams({ ...(circuit ? { circuit } : {}),
          ...(mode === 'preview' ? { preview: '1' } : mode === 'test' ? { test: '1' } : {}),
          ...(mode === 'send' && body.force === true ? { force: '1' } : {}) });
        const r = await fetch(`${self}/api/send-newsletter?${q}`, {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(mode === 'test' ? { to: me.email } : {}), signal: AbortSignal.timeout(58000),
        });
        return res.status(r.status).json(await r.json().catch(() => ({ error: 'The email service did not answer' })));
      }

      // Race report list: add or remove an email address.
      if (action === 'sub_add') {
        const email = cleanEmail(body.email);
        if (!email) return res.status(400).json({ error: 'That doesn’t look like an email address' });
        const had = await json(`subscribers?email=eq.${encodeURIComponent(email)}&select=id,active`);
        await json('subscribers?on_conflict=email', { method: 'POST', body: { email, active: true }, prefer: 'resolution=merge-duplicates,return=minimal' });
        return res.json({ ok: true, status: had?.length ? (had[0].active ? 'already' : 'back') : 'added' });
      }
      if (action === 'sub_remove') {
        const id = parseInt(body.id, 10);
        if (!(id > 0)) return res.status(400).json({ error: 'Bad id' });
        await json(`subscribers?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
        return res.json({ ok: true });
      }

      // Team invites (owner only): a role and a one-time link the person uses to apply.
      if (action === 'invite_create') {
        if (!me.owner) return ownerOnly();
        const role = clip(body.role, 40);
        if (role.length < 2) return res.status(400).json({ error: 'Type their role first' });
        const token = randomBytes(32).toString('base64url');
        const expires_at = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
        const row = (await json('admin_invites', { method: 'POST', prefer: 'return=representation', body: { token, role, created_by: me.id, expires_at } }))?.[0];
        return res.json({ ok: true, id: row?.id, role, expires_at, link: `${SITE}/join#t=${token}` });
      }
      if (action === 'invite_revoke') {
        if (!me.owner) return ownerOnly();
        if (!UUID_RE.test(String(body.id || ''))) return res.status(400).json({ error: 'Bad id' });
        await json(`admin_invites?id=eq.${body.id}`, { method: 'PATCH', body: { revoked: true }, prefer: 'return=minimal' });
        return res.json({ ok: true });
      }

      // Applications (owner only): open the CV, accept or reject (sends the email), delete.
      if (action === 'member_cv' || action === 'member_decide' || action === 'member_delete') {
        if (!me.owner) return ownerOnly();
        if (!UUID_RE.test(String(body.id || ''))) return res.status(400).json({ error: 'Bad id' });
        const app = (await json(`member_applications?id=eq.${body.id}&select=*`))?.[0];
        if (!app) return res.status(404).json({ error: 'That application is gone' });
        if (action === 'member_cv') {
          if (!app.cv_path) return res.status(404).json({ error: 'No CV was sent with this application' });
          return res.json({ url: await signedFileUrl('applications', app.cv_path, 3600, app.cv_name || 'CV') });
        }
        if (action === 'member_delete') {
          if (app.status === 'pending' && app.auth_user_id) await authAdmin(`users/${app.auth_user_id}`, { method: 'DELETE' }).catch(() => {});
          if (app.cv_path) await removeFile('applications', app.cv_path);
          await json(`member_applications?id=eq.${app.id}`, { method: 'DELETE', prefer: 'return=minimal' });
          return res.json({ ok: true });
        }
        const decision = body.decision === 'accept' ? 'accepted' : body.decision === 'reject' ? 'rejected' : '';
        if (!decision) return res.status(400).json({ error: 'Accept or reject?' });
        if (app.status !== 'pending') return res.status(409).json({ error: `This application was already ${app.status}` });
        const note = clip(body.note, 1500);
        if (decision === 'accepted') {
          if (!app.auth_user_id) return res.status(409).json({ error: 'This application has no sign-in account' });
          // Unblock their account and make it an admin with the role from the invite.
          const u = await authAdmin(`users/${app.auth_user_id}`).catch(() => null);
          if (!u) return res.status(409).json({ error: 'Their sign-in account is missing. Delete this application and send a new invite.' });
          await authAdmin(`users/${app.auth_user_id}`, { method: 'PUT', body: { ban_duration: 'none',
            app_metadata: { ...(u.app_metadata || {}), role: 'admin' }, user_metadata: { ...(u.user_metadata || {}), full_name: app.full_name, title: app.role } } });
        } else if (app.auth_user_id) {
          await authAdmin(`users/${app.auth_user_id}`, { method: 'DELETE' }).catch(() => {});
        }
        let email_status = 'sent';
        try { await sendMail({ to: app.email, ...decisionEmail({ accepted: decision === 'accepted', name: app.full_name, role: app.role, note }) }); }
        catch (e) { email_status = `failed: ${e.message}`.slice(0, 120); }
        await json(`member_applications?id=eq.${app.id}`, { method: 'PATCH', prefer: 'return=minimal', body: {
          status: decision, decided_at: new Date().toISOString(), decided_by: me.id, decision_note: note || null, email_status,
          ...(decision === 'rejected' ? { auth_user_id: null } : {}) } });
        return res.json({ ok: true, status: decision, email: email_status });
      }

      // Admins (owner only). New admins join through an invite (above).
      if (action === 'admin_remove') {
        if (!me.owner) return ownerOnly();
        const id = String(body.id || '');
        if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Bad id' });
        if (id === me.id) return res.status(400).json({ error: 'You can’t remove your own account' });
        const p = profile(await authAdmin(`users/${id}`));
        if (!p) return res.status(404).json({ error: 'That account is not an admin' });
        if (p.owner) return res.status(400).json({ error: 'The owner can’t be removed' });
        await authAdmin(`users/${id}`, { method: 'DELETE' });
        for (const [t, v] of tokens) if (v.me.id === id) tokens.delete(t);
        return res.json({ ok: true });
      }

      // Weekly report delivery (owner only). An empty value clears that setting.
      if (action === 'settings') {
        if (!me.owner) return ownerOnly();
        const rows = [], clear = [];
        for (const [k, re] of Object.entries(SETTINGS)) {
          if (!(k in body)) continue;
          const v = String(body[k] ?? '').trim().replace(/\s+/g, '');
          if (!v) { clear.push(k); continue; }
          if (!re.test(v)) return res.status(400).json({ error: `That ${k.replace('_', ' ')} doesn’t look right` });
          rows.push({ key: k, value: v, updated_at: new Date().toISOString() });
        }
        if (rows.length) await json('app_settings?on_conflict=key', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
        if (clear.length) await json(`app_settings?key=in.(${clear.join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
        return res.json({ ok: true, delivery: deliveryStatus(await readSettings()) });
      }
      // Telegram: after messaging the bot once, find that chat and save it.
      if (action === 'telegram_chat') {
        if (!me.owner) return ownerOnly();
        const s = await readSettings();
        if (!s.telegram_token) return res.status(400).json({ error: 'Save the bot token first' });
        const r = await fetch(`https://api.telegram.org/bot${s.telegram_token}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10000) });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) return res.status(400).json({ error: 'Telegram did not accept that bot token' });
        const msg = (j.result || []).map(u => u.message || u.channel_post || u.my_chat_member).filter(Boolean).pop();
        const chat = msg?.chat?.id;
        if (!chat) return res.status(404).json({ error: 'No message found yet. Open your bot in Telegram, press Start or send it any message, then try again.' });
        await json('app_settings?on_conflict=key', { method: 'POST', body: [{ key: 'telegram_chat', value: String(chat), updated_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
        return res.json({ ok: true, delivery: deliveryStatus(await readSettings()) });
      }
      if (action === 'notify_test') {
        if (!me.owner) return ownerOnly();
        return res.json(await ops('test'));
      }
      if (action === 'report_link') {
        const id = parseInt(body.id, 10);
        if (!(id > 0)) return res.status(400).json({ error: 'Bad id' });
        const row = (await json(`weekly_reports?id=eq.${id}&select=path`))?.[0];
        if (!row) return res.status(404).json({ error: 'No such report' });
        return res.json({ url: await signedReportUrl(row.path) });
      }
      if (action === 'log_resolve') {
        const id = parseInt(body.id, 10);
        if (!(id > 0)) return res.status(400).json({ error: 'Bad id' });
        await json(`maintenance_log?id=eq.${id}`, { method: 'PATCH', body: { resolved: true, resolved_ts: new Date().toISOString() }, prefer: 'return=minimal' });
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.warn('[admin]', e.message);
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
}

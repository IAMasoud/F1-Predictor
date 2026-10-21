// Ops: the daily scan of the live site, the weekly one-page report, and delivering both
// (Telegram, Discord, WhatsApp through CallMeBot). Called by pg_cron and the admin page with
// the shared CRON_SECRET:  ?task=scan | weekly | test
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
// The shared season calendar (season.js in the repo root).
import { loadSeason, sessionEndMs } from '../../../season.js';

const SITE = 'https://f1-predictor-theta.vercel.app';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const HOUR = 3600e3, DAY = 24 * HOUR;

type Check = { name: string; ok: boolean; detail: string };
type Json = Record<string, any>;

const reply = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function db(path: string, { method = 'GET', body, prefer }: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: Json = {}) => db(`rpc/${fn}`, { method: 'POST', body: args });

async function timed(url: string, init: RequestInit = {}, ms = 15000) {
  const t0 = Date.now();
  const r = await fetch(url, { redirect: 'follow', ...init, signal: AbortSignal.timeout(ms) });
  return { r, ms: Date.now() - t0 };
}

/* ════════════════ delivery ════════════════ */
async function settings(): Promise<Json> {
  const rows = await db('app_settings?select=key,value');
  return Object.fromEntries((rows || []).map((r: Json) => [r.key, r.value]));
}
function channels(s: Json) {
  return {
    telegram: !!(s.telegram_token && s.telegram_chat),
    discord: !!s.discord_webhook,
    whatsapp: !!(s.whatsapp_phone && s.whatsapp_key),
  };
}
async function sendText(s: Json, text: string, link?: string) {
  const out: Json = {};
  const on = channels(s);
  if (on.telegram) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${s.telegram_token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: s.telegram_chat, text: link ? `${text}\n${link}` : text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000),
      });
      out.telegram = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (e) { out.telegram = String((e as Error).message).slice(0, 60); }
  }
  if (on.discord) {
    try {
      const r = await fetch(s.discord_webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: (link ? `${text}\n${link}` : text).slice(0, 1900) }), signal: AbortSignal.timeout(15000) });
      out.discord = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (e) { out.discord = String((e as Error).message).slice(0, 60); }
  }
  if (on.whatsapp) out.whatsapp = await whatsapp(s, link ? `${text}\n${link}` : text);
  return out;
}
async function whatsapp(s: Json, text: string) {
  try {
    const q = new URLSearchParams({ phone: String(s.whatsapp_phone).replace(/^\+/, ''), text: text.slice(0, 1500), apikey: s.whatsapp_key });
    const r = await fetch(`https://api.callmebot.com/whatsapp.php?${q}`, { signal: AbortSignal.timeout(25000) });
    const body = (await r.text()).toLowerCase();
    return r.ok && !/error|invalid|not allowed|wrong/.test(body) ? 'ok' : `CallMeBot: ${body.replace(/<[^>]+>/g, ' ').trim().slice(0, 80) || r.status}`;
  } catch (e) { return String((e as Error).message).slice(0, 60); }
}
async function sendPdf(s: Json, pdf: Uint8Array<ArrayBuffer>, filename: string, caption: string, link: string) {
  const out: Json = {};
  const on = channels(s);
  const file = () => new Blob([pdf], { type: 'application/pdf' });
  if (on.telegram) {
    try {
      const f = new FormData();
      f.append('chat_id', String(s.telegram_chat));
      f.append('caption', caption.slice(0, 1000));
      f.append('document', file(), filename);
      const r = await fetch(`https://api.telegram.org/bot${s.telegram_token}/sendDocument`, { method: 'POST', body: f, signal: AbortSignal.timeout(30000) });
      out.telegram = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (e) { out.telegram = String((e as Error).message).slice(0, 60); }
  }
  if (on.discord) {
    try {
      const f = new FormData();
      f.append('payload_json', JSON.stringify({ content: caption.slice(0, 1900) }));
      f.append('files[0]', file(), filename);
      const r = await fetch(s.discord_webhook, { method: 'POST', body: f, signal: AbortSignal.timeout(30000) });
      out.discord = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (e) { out.discord = String((e as Error).message).slice(0, 60); }
  }
  // WhatsApp through CallMeBot only takes text: the summary and a link to the PDF.
  if (on.whatsapp) out.whatsapp = await whatsapp(s, `${caption}\n\nThe one-page report (link works for 30 days):\n${link}`);
  return out;
}

/* ════════════════ daily scan ════════════════ */
function dueAt(stage: string, r: Json) {
  const at = (d?: string, t?: string) => (d && t ? Date.parse(`${d}T${t}:00Z`) : NaN);
  const open = Date.parse(`${r.date}T00:00:00Z`) - 3 * DAY;
  return ({
    beforeQuali: open, beforeSprintQ: open,
    afterSprintQ: at(r.sprintQualiDate, r.sprintQualiUTC) + 45 * 6e4,
    afterSprint: at(r.sprintDate, r.sprintUTC) + 60 * 6e4,
    afterQuali: at(r.qualiDate, r.qualiUTC) + 60 * 6e4,
  } as Json)[stage] ?? open;
}
const STAGE_NAME: Json = { beforeSprintQ: 'before sprint quali', afterSprintQ: 'after sprint quali', afterSprint: 'after the sprint', beforeQuali: 'before quali', afterQuali: 'after quali' };

async function scan() {
  const checks: Check[] = [];
  const check = async (name: string, fn: () => Promise<{ ok?: boolean; detail?: string }>) => {
    try { const r = await fn(); checks.push({ name, ok: r.ok !== false, detail: r.detail || '' }); }
    catch (e) { checks.push({ name, ok: false, detail: String((e as Error).message || e).slice(0, 200) }); }
  };
  const now = Date.now();
  const { season, races } = await loadSeason();

  await check('Home page loads', async () => {
    const { r, ms } = await timed(`${SITE}/`);
    const html = await r.text();
    if (!r.ok) return { ok: false, detail: `answered ${r.status}` };
    if (!html.includes('screens.js') || !html.includes('app.js')) return { ok: false, detail: 'the page is missing its scripts' };
    return { detail: `${(ms / 1000).toFixed(1)} s` };
  });
  let version = '';
  await check('App code and offline cache match', async () => {
    const [a, s] = await Promise.all([timed(`${SITE}/app.js`), timed(`${SITE}/sw.js`)]);
    if (!a.r.ok || !s.r.ok) return { ok: false, detail: `app.js ${a.r.status}, sw.js ${s.r.status}` };
    version = ((await a.r.text()).match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || '';
    const cache = ((await s.r.text()).match(/CACHE\s*=\s*'f1-predictor-v(\d+)'/) || [])[1] || '';
    const v = (version.match(/(\d+)\.(\d+)/) || []).slice(1).join('');
    const minor = (version.match(/\d+\.(\d+)/) || [])[1] || '';
    if (!version || !cache) return { ok: false, detail: 'could not read the version' };
    if (cache !== minor && cache !== v) return { ok: false, detail: `version ${version} but cache v${cache}` };
    return { detail: version };
  });
  await check('Screens, privacy and terms pages load', async () => {
    const paths = ['/screens.js', '/screens.css', '/privacy', '/terms', '/manifest.json'];
    const res = await Promise.all(paths.map(p => timed(`${SITE}${p}`).then(x => [p, x.r.status] as const).catch(() => [p, 0] as const)));
    const bad = res.filter(([, st]) => st !== 200);
    return bad.length ? { ok: false, detail: bad.map(([p, st]) => `${p} ${st || 'no answer'}`).join(', ') } : { detail: 'all 200' };
  });
  await check('Admin page loads and stays locked', async () => {
    const [page, api] = await Promise.all([timed(`${SITE}/admin`), timed(`${SITE}/api/admin?view=me`)]);
    if (!page.r.ok) return { ok: false, detail: `/admin answered ${page.r.status}` };
    if (api.r.status !== 401) return { ok: false, detail: `the admin API answered ${api.r.status} without a sign-in` };
    return { detail: 'locked without a sign-in' };
  });
  await check('Email service (Brevo) accepts our key', async () => {
    const { r } = await timed(`${SITE}/api/send-newsletter?check=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } }, 15000);
    const d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: d?.error || `the check answered ${r.status}` };
    return d?.ok ? { detail: 'race reports and team emails can go out' } : { ok: false, detail: d?.error || 'no answer' };
  });
  await check('OpenF1 helper answers', async () => {
    const { r } = await timed(`${SITE}/api/of1?url=${encodeURIComponent(`https://api.openf1.org/v1/meetings?year=${season}`)}`, {}, 20000);
    if (!r.ok) return { ok: false, detail: `answered ${r.status}` };
    const busy = r.headers.get('x-of1-rate-limited') === '1' || r.headers.get('x-of1-live-lock') === '1';
    const d = await r.json().catch(() => null);
    if (busy) return { detail: 'OpenF1 is busy or locked during a session (normal)' };
    return Array.isArray(d) && d.length ? { detail: `${d.length} meetings` } : { ok: false, detail: 'empty answer' };
  });
  await check('Official results feed (Jolpica) answers', async () => {
    const { r } = await timed('https://api.jolpi.ca/ergast/f1/current/last/results.json');
    const d = r.ok ? await r.json() : null;
    const race = d?.MRData?.RaceTable?.Races?.[0];
    return race ? { detail: `latest: ${race.raceName}` } : { ok: false, detail: `answered ${r.status}` };
  });
  await check('Scheduled jobs run on time', async () => {
    const jobs = await rpc('admin_job_status');
    const maxGap: Json = { 'auto-results': 2.5 * HOUR, 'supabase-sync': HOUR, 'retry-predictions': 0.75 * HOUR, 'rollup-analytics': 26 * HOUR, 'race-report': 2 * HOUR, 'weekly-report': 8 * DAY };
    const bad: string[] = [];
    for (const j of jobs || []) {
      if (!j.active) { bad.push(`${j.jobname} is switched off`); continue; }
      const gap = maxGap[j.jobname];
      if (gap && j.last_start && now - Date.parse(j.last_start) > gap) bad.push(`${j.jobname} last ran ${Math.round((now - Date.parse(j.last_start)) / HOUR)} h ago`);
      if (j.last_status && !['succeeded', 'running', 'starting'].includes(j.last_status)) bad.push(`${j.jobname}: last run ${j.last_status}`);
    }
    return bad.length ? { ok: false, detail: bad.join('; ') } : { detail: `${(jobs || []).length} jobs` };
  });
  await check('The AI answered today', async () => {
    const since = new Date(now - DAY).toISOString();
    const rows = await db(`ai_calls?ts=gte.${since}&select=ok,error,model&order=ts.desc&limit=500`);
    if (!rows?.length) return { detail: 'no AI calls were needed' };
    const ok = rows.filter((r: Json) => r.ok).length;
    if (!ok) return { ok: false, detail: `all ${rows.length} attempts failed; last: ${String(rows[0]?.error || '').slice(0, 90)}` };
    return { detail: `${ok} of ${rows.length} attempts answered` };
  });
  // Inside a race weekend: every call that is due should be a real AI call.
  const live = races.find((r: Json) => { const end = sessionEndMs(r, 'race') ?? 0; return now >= Date.parse(`${r.date}T00:00:00Z`) - 3 * DAY && now <= end; });
  if (live) {
    await check(`${live.name}: the AI's calls are in`, async () => {
      const stages = live.sprint ? ['beforeSprintQ', 'afterSprintQ', 'afterSprint', 'afterQuali'] : ['beforeQuali', 'afterQuali'];
      const preds = await db(`predictions?circuit_id=eq.${live.circuitId}&round=eq.${live.round}&pred_type=eq.race&select=stage,created_at,fallback:prediction->_fallback`);
      const bad: string[] = [];
      for (const st of stages) {
        const due = dueAt(st, live);
        if (!(now > due + HOUR)) continue;
        const p = (preds || []).find((x: Json) => x.stage === st);
        if (!p) bad.push(`no call ${STAGE_NAME[st]}`);
        else if (p.fallback === true && now - Date.parse(p.created_at) > 2 * HOUR) bad.push(`${STAGE_NAME[st]} is still a baseline`);
      }
      return bad.length ? { ok: false, detail: bad.join('; ') } : { detail: 'every due call is an AI call' };
    });
  }
  // After a race: the report should have gone out within half a day.
  const last = [...races].reverse().find((r: Json) => (sessionEndMs(r, 'race') ?? 0) <= now);
  if (last) {
    const ended = sessionEndMs(last, 'race') ?? 0;
    if (now - ended > 12 * HOUR && now - ended < 4 * DAY) {
      await check(`${last.name}: race report sent`, async () => {
        const rows = await db(`newsletter_log?season=eq.${season}&round=eq.${last.round}&sent=gt.0&select=ts,sent&limit=1`);
        return rows?.length ? { detail: `sent to ${rows[0].sent}` } : { ok: false, detail: 'not sent yet' };
      });
    }
  }
  await check('No errors in visitors’ browsers', async () => {
    const since = new Date(now - DAY).toISOString();
    const rows = await db(`events?name=eq.error&ts=gte.${since}&select=detail,browser&order=ts.desc&limit=50`);
    if (!rows?.length) return { detail: 'none in the last 24 hours' };
    const top = Object.entries(rows.reduce((m: Json, r: Json) => { const k = String(r.detail || '?').slice(0, 80); m[k] = (m[k] || 0) + 1; return m; }, {}))
      .sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`);
    // One stray error (a browser extension, a dropped connection) isn't worth an alarm.
    return { ok: rows.length < 2, detail: `${rows.length} in 24 h: ${top.join('; ')}` };
  });

  const failed = checks.filter(c => !c.ok);
  await db('health_checks', { method: 'POST', body: { ok: !failed.length, failed: failed.length, checks }, prefer: 'return=minimal' });

  // One open log row per problem; problems that pass again are marked fixed.
  const open = await db('maintenance_log?kind=eq.found&resolved=eq.false&source=eq.scan&select=id,fingerprint');
  const openBy = new Map((open || []).map((r: Json) => [r.fingerprint, r.id]));
  const fresh: Check[] = [];
  for (const c of checks) {
    const fp = `scan:${c.name}`;
    if (!c.ok && !openBy.has(fp)) {
      fresh.push(c);
      await db('maintenance_log', { method: 'POST', prefer: 'return=minimal', body: { kind: 'found', title: c.name, detail: c.detail, source: 'scan', fingerprint: fp } }).catch(() => {});
    } else if (c.ok && openBy.has(fp)) {
      await db(`maintenance_log?id=eq.${openBy.get(fp)}`, { method: 'PATCH', prefer: 'return=minimal', body: { resolved: true, resolved_ts: new Date().toISOString(), detail: `Passing again: ${c.detail}` } }).catch(() => {});
    }
  }
  // Tell the owner straight away, but only about problems that are new today.
  let alerted: Json | null = null;
  if (fresh.length) {
    const s = await settings();
    if (Object.values(channels(s)).some(Boolean)) {
      alerted = await sendText(s, `F1 Predictor: today's scan found ${fresh.length} new problem${fresh.length === 1 ? '' : 's'}:\n${fresh.map(c => `- ${c.name}: ${c.detail}`).join('\n')}`, `${SITE}/admin#health`);
    }
  }
  return { ok: !failed.length, failed: failed.length, version, checks, alerted };
}

/* ════════════════ weekly report ════════════════ */
const ID_ABBR: Json = { antonelli:'ANT', russell:'RUS', leclerc:'LEC', norris:'NOR', hamilton:'HAM', piastri:'PIA', max_verstappen:'VER',
  bearman:'BEA', gasly:'GAS', ocon:'OCO', hadjar:'HAD', lawson:'LAW', colapinto:'COL', sainz:'SAI', albon:'ALB', bortoleto:'BOR',
  hulkenberg:'HUL', stroll:'STR', lindblad:'LIN', arvid_lindblad:'LIN', alonso:'ALO', bottas:'BOT', perez:'PER', tsunoda:'TSU' };
const toAbbr = (id: string) => ID_ABBR[id] || String(id || '').slice(0, 3).toUpperCase();
const PRE = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];

async function gather() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1);   // end of yesterday
  const start = new Date(end.getTime() - 7 * DAY + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startIso = start.toISOString(), endIso = end.toISOString(), afterIso = new Date(end.getTime() + 1).toISOString();
  const { season, races } = await loadSeason();

  // Every number covers exactly the dates printed on the report (whole UTC days).
  const [traffic, subs, push, preds, scans, log, sends] = await Promise.all([
    rpc('report_week', { p_start: iso(start), p_end: iso(end) }),
    db('subscribers?select=id,subscribed_at,active'),
    db('push_subscriptions?select=created_at'),
    db('predictions?select=round,circuit_id,stage,pred_type,created_at,accuracy,hidden,actual_results,fallback:prediction->_fallback,top10:prediction->top10&stage=neq.final&order=created_at.desc&limit=500'),
    db(`health_checks?ts=gte.${startIso}&ts=lt.${afterIso}&select=ts,ok,failed,checks&order=ts.asc`),
    db(`maintenance_log?select=*&order=ts.desc&limit=200`),
    db(`newsletter_log?ts=gte.${startIso}&ts=lt.${afterIso}&sent=gt.0&select=round,circuit_id,sent,ts,kind`),
  ]);
  const inWeek = (t?: string) => !!t && t >= startIso && t <= endIso;
  const active = (subs || []).filter((s: Json) => s.active !== false);
  const newSubs = active.filter((s: Json) => inWeek(s.subscribed_at)).length;
  const weekPreds = (preds || []).filter((p: Json) => inWeek(p.created_at));

  // The AI's season score and this week's races (its last call before each race).
  const byRound: Json = {};
  (preds || []).filter((p: Json) => p.pred_type === 'race' && !p.hidden && Array.isArray(p.actual_results) && p.actual_results.length).forEach((p: Json) => (byRound[p.round] ||= []).push(p));
  const bestOf = (rows: Json[]) => rows.slice().sort((a, b) => ((a.fallback === true ? 100 : 0) + (PRE.indexOf(a.stage) + 1 || 50)) - ((b.fallback === true ? 100 : 0) + (PRE.indexOf(b.stage) + 1 || 50)))[0];
  const scored = Object.values(byRound).map((rows: any) => bestOf(rows)).filter((b: Json) => b && b.accuracy != null);
  const seasonAvg = scored.length ? Math.round(scored.reduce((s: number, b: Json) => s + b.accuracy, 0) / scored.length) : null;
  const weekRaces = races.filter((r: Json) => { const e = sessionEndMs(r, 'race') ?? 0; return e >= start.getTime() && e <= end.getTime(); }).map((r: Json) => {
    const b = byRound[r.round] ? bestOf(byRound[r.round]) : null;
    const act = (b?.actual_results || []).map(toAbbr);
    const called = String(b?.top10?.[0]?.abbr || '').toUpperCase();
    return { name: r.name, round: r.round, score: b?.accuracy ?? null, baseline: b?.fallback === true, called: called || null, winner: act[0] || null };
  });

  const weekLog = (log || []).filter((l: Json) => inWeek(l.ts) || inWeek(l.resolved_ts));
  const fixed = weekLog.filter((l: Json) => l.kind === 'fixed' || (l.kind === 'found' && l.resolved && inWeek(l.resolved_ts)));
  const found = weekLog.filter((l: Json) => l.kind === 'found' && inWeek(l.ts));
  const openIssues = (log || []).filter((l: Json) => l.kind === 'found' && !l.resolved);
  const failedChecks = (scans || []).flatMap((s: Json) => (s.checks || []).filter((c: Json) => !c.ok).map((c: Json) => c.name));

  return {
    season, start: iso(start), end: iso(end),
    visitors: traffic?.visitors ?? 0, prevVisitors: traffic?.prev_visitors ?? null, views: traffic?.views ?? 0, installed: traffic?.installed ?? 0,
    countries: (traffic?.top?.countries || []).slice(0, 5), screens: (traffic?.top?.screens || []).slice(0, 5), events: traffic?.top?.events || [],
    perDay: (traffic?.per_day || []).slice(-7).map((d: Json) => ({ day: d.day, visitors: d.visitors || 0 })),
    errors: traffic?.errors ?? 0,
    subscribers: active.length, newSubs, push: (push || []).length,
    aiAttempts: traffic?.ai_attempts ?? 0, aiOk: traffic?.ai_ok ?? 0, aiErrors: (traffic?.ai_errors || []).slice(0, 1),
    calls: weekPreds.length, baselines: weekPreds.filter((p: Json) => p.fallback === true).length,
    weekRaces, seasonAvg, seasonRaces: scored.length,
    scans: (scans || []).length, scansOk: (scans || []).filter((s: Json) => s.ok).length, failedChecks: [...new Set(failedChecks)],
    fixed: fixed.map((l: Json) => ({ title: l.title, detail: l.detail, source: l.source })),
    found: found.map((l: Json) => ({ title: l.title, resolved: l.resolved })),
    open: openIssues.map((l: Json) => ({ title: l.title, detail: l.detail, since: l.ts })),
    sends: (sends || []).map((s: Json) => ({ round: s.round, sent: s.sent, kind: s.kind })),
  };
}

// The standard PDF fonts only cover Western European characters; swap or drop the rest.
const safe = (v: unknown) => String(v ?? '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
  .replace(/→/g, '->').replace(/[^\x20-\x7E -ÿ]/g, '');
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => { try { return c && c !== '?' ? d.of(c) || c : 'Unknown'; } catch { return c; } }; } catch { return (c: string) => c; } })();
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function buildPdf(w: Json) {
  const doc = await PDFDocument.create();
  doc.setTitle(`F1 Predictor weekly report ${w.start} to ${w.end}`);
  doc.setAuthor('F1 Predictor');
  const page = doc.addPage([595.28, 841.89]);  // A4
  const H = page.getHeight(), W = page.getWidth(), M = 40;
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const head = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const INK = rgb(0.07, 0.07, 0.07), MUTED = rgb(0.36, 0.36, 0.36), DIM = rgb(0.55, 0.55, 0.55), RULE = rgb(0.88, 0.88, 0.87);
  const RED = rgb(0.878, 0.118, 0.118), LAMP = rgb(1, 0.165, 0.165), NIGHT = rgb(0.027, 0.027, 0.031), CARD = rgb(0.96, 0.96, 0.955), GAIN = rgb(0.09, 0.5, 0.25);
  const text = (t: unknown, x: number, y: number, size = 10, font = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  const width = (t: unknown, size: number, font = reg) => font.widthOfTextAtSize(safe(t), size);
  const fit = (t: unknown, size: number, font: any, max: number) => { let s = safe(t); while (s.length > 3 && font.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2); return s.length < safe(t).length ? s.replace(/.$/, '...') : s; };

  // Header band with the start lights
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: NIGHT });
  for (let i = 0; i < 5; i++) page.drawCircle({ x: M + 6 + i * 16, y: H - 34, size: 5.5, color: i < 4 ? LAMP : rgb(0.17, 0.17, 0.18) });
  text('F1 PREDICTOR', M + 92, H - 38.5, 12, bold, rgb(1, 1, 1));
  text('WEEKLY REPORT', M, H - 70, 22, head, rgb(1, 1, 1));
  const range = `${fmtDay(w.start)} - ${fmtDay(w.end)} ${w.end.slice(0, 4)}`;
  text(range, W - M - width(range, 11, bold), H - 38.5, 11, bold, rgb(1, 1, 1));
  const made = `Made ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  text(made, W - M - width(made, 9), H - 68, 9, reg, rgb(0.7, 0.7, 0.7));

  let y = H - 120;
  // KPI boxes, two rows of four
  const box = (x: number, yTop: number, label: string, value: string, note: string, good?: boolean) => {
    const bw = (W - 2 * M - 3 * 10) / 4, bh = 62;
    page.drawRectangle({ x, y: yTop - bh, width: bw, height: bh, color: CARD });
    text(label, x + 10, yTop - 16, 8.5, reg, MUTED);
    text(fit(value, 20, head, bw - 20), x + 10, yTop - 40, 20, head, INK);
    text(fit(note, 8, reg, bw - 20), x + 10, yTop - 53, 8, reg, good === true ? GAIN : good === false ? RED : MUTED);
    return bw;
  };
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const dv = w.prevVisitors ? Math.round(((w.visitors - w.prevVisitors) / w.prevVisitors) * 100) : null;
  const bw = (W - 2 * M - 30) / 4;
  box(M, y, 'Visitors', String(w.visitors), dv == null ? 'first week counted' : `${dv >= 0 ? '+' : ''}${dv}% on last week`, dv == null ? undefined : dv >= 0);
  box(M + (bw + 10), y, 'Page views', String(w.views), w.visitors ? `${(w.views / w.visitors).toFixed(1)} per visitor` : '-');
  box(M + 2 * (bw + 10), y, 'Email subscribers', String(w.subscribers), w.newSubs ? `+${w.newSubs} this week` : 'no new ones', w.newSubs ? true : undefined);
  box(M + 3 * (bw + 10), y, 'Notifications on', String(w.push), 'devices');
  y -= 72;
  const aiRate = w.aiAttempts ? pct(w.aiOk, w.aiAttempts) : null;
  const wr = w.weekRaces[0];
  box(M, y, 'AI answered', aiRate == null ? '-' : `${aiRate}%`, w.aiAttempts ? `${w.aiOk} of ${w.aiAttempts} attempts` : 'no calls needed', aiRate == null ? undefined : aiRate >= 50);
  box(M + (bw + 10), y, 'Calls made', String(w.calls), !w.calls ? 'none needed' : w.baselines ? `${w.baselines} baseline${w.baselines === 1 ? '' : 's'} (AI busy)` : 'all by the AI', !w.calls ? undefined : w.baselines ? false : true);
  box(M + 2 * (bw + 10), y, wr ? `${wr.name.replace(' Grand Prix', '')} score` : 'Race this week', wr ? (wr.score == null ? 'not scored' : `${wr.score}%`) : 'no race', wr ? (wr.called && wr.winner ? `called ${wr.called}, ${wr.winner} won` : '') : '');
  box(M + 3 * (bw + 10), y, 'Season average', w.seasonAvg == null ? '-' : `${w.seasonAvg}%`, `${w.seasonRaces} races scored`);
  y -= 84;

  // Sections
  const section = (title: string) => { text(title.toUpperCase(), M, y, 11.5, head, INK); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.6, color: RULE }); y -= 22; };
  const line = (t: string, opts: { color?: any; bullet?: any } = {}) => {
    if (y < 92) return;
    page.drawCircle({ x: M + 3, y: y + 3.2, size: 2.4, color: opts.bullet || RED });
    text(fit(t, 9.5, reg, W - 2 * M - 14), M + 12, y, 9.5, reg, opts.color || INK);
    y -= 15;
  };

  section('Site health');
  line(!w.scans ? 'No daily scans ran this week.'
    : `${w.scans} of 7 daily scans ran: ${w.scansOk === w.scans ? 'all clean' : `${w.scans - w.scansOk} found a problem, ${w.scansOk} clean`}.`,
    { bullet: w.scans && w.scansOk === w.scans ? GAIN : RED });
  if (w.failedChecks.length) line(`Problems seen this week: ${w.failedChecks.join(', ')}.`);
  if (w.errors) line(`${w.errors} error${w.errors === 1 ? '' : 's'} in visitors' browsers this week.`);
  if (w.sends.length) w.sends.forEach((s: Json) => line(`Race report for round ${s.round} went to ${s.sent} subscriber${s.sent === 1 ? '' : 's'}${s.kind === 'auto' ? ', by itself' : ''}.`, { bullet: GAIN }));
  y -= 6;

  section('Fixed this week');
  if (w.fixed.length) w.fixed.slice(0, 6).forEach((f: Json) => line(`${f.title}${f.detail ? ` - ${f.detail}` : ''}${f.source === 'agent' ? ' (agent)' : ''}`, { bullet: GAIN }));
  else line('Nothing needed fixing.', { bullet: GAIN, color: MUTED });
  y -= 6;

  section('Needs fixing');
  if (w.open.length) w.open.slice(0, 6).forEach((o: Json) => line(`${o.title}${o.detail ? ` - ${o.detail}` : ''}`));
  else line('Nothing is open.', { bullet: GAIN, color: MUTED });
  if (w.aiAttempts && aiRate != null && aiRate < 50) line(`The free AI answered only ${aiRate}% of the time. A free Groq key would back it up.`);
  y -= 6;

  section('The AI this week');
  if (w.weekRaces.length) w.weekRaces.forEach((r: Json) => line(`${r.name}: ${r.score == null ? 'not scored yet' : `${r.score}%`}${r.baseline ? ' (baseline)' : ''}${r.called ? `, called ${r.called}` : ''}${r.winner ? `, ${r.winner} won` : ''}.`, { bullet: INK }));
  else line('No race this week.', { bullet: DIM, color: MUTED });
  line(!w.calls ? 'No calls were needed this week.' : `${w.calls} call${w.calls === 1 ? '' : 's'} saved, ${w.baselines ? `${w.baselines} of them baseline${w.baselines === 1 ? '' : 's'}` : 'all by the AI'}.`, { bullet: w.baselines ? RED : GAIN });
  (w.aiErrors || []).slice(0, 1).forEach((e: Json) => line(`Last AI failure: ${String(e.model || '')} ${String(e.error || '').slice(0, 80)}`, { bullet: DIM, color: MUTED }));
  y -= 6;

  // Two small lists side by side
  if (y > 150) {
    const colW = (W - 2 * M - 20) / 2;
    const list = (x: number, title: string, rows: Json[], label: (r: Json) => string) => {
      let yy = y;
      text(title.toUpperCase(), x, yy, 11.5, head, INK);
      page.drawLine({ start: { x, y: yy - 6 }, end: { x: x + colW, y: yy - 6 }, thickness: 0.6, color: RULE });
      yy -= 22;
      if (!rows.length) { text('Nothing yet', x, yy, 9.5, reg, MUTED); return yy - 15; }
      const max = Math.max(1, ...rows.map(r => r.value));
      rows.slice(0, 5).forEach(r => {
        if (yy < 80) return;
        text(fit(label(r), 9.5, reg, colW * 0.5), x, yy, 9.5, reg, INK);
        page.drawRectangle({ x: x + colW * 0.52, y: yy, width: Math.max(3, (colW * 0.36) * (r.value / max)), height: 6, color: rgb(0.62, 0.62, 0.62) });
        const v = String(r.value); text(v, x + colW - width(v, 9.5, bold), yy, 9.5, bold, INK);
        yy -= 15;
      });
      return yy;
    };
    const SCREEN: Json = { pred: 'Predict', comp: 'Reality', live: 'Live', arch: 'Archive', hist: 'Season', cal: 'Calendar', anlt: 'Analytics', pits: 'Pit stops', more: 'More' };
    const a = list(M, 'Top countries', w.countries, r => regionName(r.key));
    const b = list(M + colW + 20, 'Most used screens', w.screens, r => SCREEN[r.key] || String(r.key).replace('pred-', 'Predict: '));
    y = Math.min(a, b) - 14;
  }

  // Visitors per day, if there is room
  const days = w.perDay || [];
  if (days.length && y > 175) {
    y -= 96 + 8;
    const top = y + 96;
    text('VISITORS PER DAY', M, top, 11.5, head, INK);
    page.drawLine({ start: { x: M, y: top - 6 }, end: { x: W - M, y: top - 6 }, thickness: 0.6, color: RULE });
    const max = Math.max(1, ...days.map((d: Json) => d.visitors));
    const slot = (W - 2 * M) / days.length, barW = Math.min(46, slot - 14), base = y + 16, h = 52;
    days.forEach((d: Json, i: number) => {
      const bx = M + i * slot + (slot - barW) / 2, bh = Math.max(2, (d.visitors / max) * h);
      const sunday = new Date(`${d.day}T12:00:00Z`).getUTCDay() === 0;
      page.drawRectangle({ x: bx, y: base, width: barW, height: bh, color: sunday ? RED : rgb(0.25, 0.25, 0.25) });
      const v = String(d.visitors); text(v, bx + barW / 2 - width(v, 8.5, bold) / 2, base + bh + 4, 8.5, bold, INK);
      const lab = new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
      text(lab, bx + barW / 2 - width(lab, 8.5) / 2, base - 12, 8.5, reg, MUTED);
    });
  }

  // Footer
  page.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.6, color: RULE });
  text('Full numbers in the admin: f1-predictor-theta.vercel.app/admin', M, 36, 8.5, reg, MUTED);
  const r = 'Made automatically every Monday';
  text(r, W - M - width(r, 8.5), 36, 8.5, reg, MUTED);
  return new Uint8Array(await doc.save());  // a plain ArrayBuffer copy, accepted by Blob and fetch
}

function caption(w: Json) {
  const aiRate = w.aiAttempts ? Math.round((w.aiOk / w.aiAttempts) * 100) : null;
  const wr = w.weekRaces[0];
  return [
    `F1 Predictor, week of ${fmtDay(w.start)} - ${fmtDay(w.end)}`,
    `Visitors ${w.visitors} (${w.views} page views), subscribers ${w.subscribers}${w.newSubs ? ` (+${w.newSubs})` : ''}.`,
    `AI: ${aiRate == null ? 'no calls needed' : `answered ${aiRate}% of attempts`}, ${w.calls} calls saved, ${w.baselines} baseline${w.baselines === 1 ? '' : 's'}.`,
    wr ? `${wr.name}: the AI scored ${wr.score == null ? 'n/a' : `${wr.score}%`}.` : 'No race this week.',
    `Health: ${w.scansOk}/${w.scans} clean scans, ${w.fixed.length} fixed, ${w.open.length} open.`,
  ].join('\n');
}

async function upload(path: string, pdf: Uint8Array<ArrayBuffer>) {
  const r = await fetch(`${SB_URL}/storage/v1/object/reports/${path}`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf,
  });
  if (!r.ok) throw new Error(`Could not store the PDF: ${r.status} ${(await r.text()).slice(0, 120)}`);
}
async function signed(path: string, seconds: number) {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/reports/${path}`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Could not make a link to the PDF');
  return `${SB_URL}/storage/v1${j.signedURL}`;
}

async function weekly() {
  const w = await gather();
  const pdf = await buildPdf(w);
  const path = `weekly/${w.end}.pdf`;
  await upload(path, pdf);
  const s = await settings();
  const link = await signed(path, 30 * 24 * 3600);
  const results = Object.values(channels(s)).some(Boolean) ? await sendPdf(s, pdf, `F1-Predictor-week-${w.end}.pdf`, caption(w), link) : {};
  const delivered = { sent: Object.entries(results).filter(([, v]) => v === 'ok').map(([k]) => k), failed: Object.fromEntries(Object.entries(results).filter(([, v]) => v !== 'ok')) };
  const summary = { visitors: w.visitors, views: w.views, subscribers: w.subscribers, newSubs: w.newSubs, aiAttempts: w.aiAttempts, aiOk: w.aiOk, calls: w.calls, baselines: w.baselines,
    weekRaces: w.weekRaces, scans: w.scans, scansOk: w.scansOk, fixed: w.fixed.length, open: w.open.length };
  const row = await db('weekly_reports?on_conflict=week_end', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { week_start: w.start, week_end: w.end, path, summary, delivered, created_at: new Date().toISOString() } });
  return { ok: true, id: row?.[0]?.id, week: `${w.start}..${w.end}`, bytes: pdf.length, delivered: delivered.sent, failed: delivered.failed };
}

async function testDelivery() {
  const s = await settings();
  if (!Object.values(channels(s)).some(Boolean)) return { ok: false, results: {}, error: 'Nothing is set up yet' };
  const results = await sendText(s, 'F1 Predictor: test message. The weekly report will arrive here every Monday, and the daily scan writes here if something breaks.');
  return { ok: Object.values(results).some(v => v === 'ok'), results };
}

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) return reply({ error: 'Unauthorized' }, 401);
  const task = new URL(req.url).searchParams.get('task');
  try {
    if (task === 'scan') return reply(await scan());
    if (task === 'weekly') return reply(await weekly());
    if (task === 'test') return reply(await testDelivery());
    // A short message to the owner's channels (used by the join function for new applications).
    if (task === 'notify') {
      const body = await req.json().catch(() => ({}));
      const msg = String(body.text || '').slice(0, 900);
      if (!msg) return reply({ error: 'No text' }, 400);
      const s = await settings();
      return reply({ ok: true, results: Object.values(channels(s)).some(Boolean) ? await sendText(s, msg, typeof body.link === 'string' ? body.link.slice(0, 200) : undefined) : {} });
    }
    return reply({ error: 'Unknown task' }, 400);
  } catch (e) {
    console.error('[ops]', task, e);
    return reply({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
});

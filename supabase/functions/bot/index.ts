// Bot: the team's Telegram bot and Pit Wall's Assistant tab run the same commands here.
//   Telegram  POST /bot                 the bot's webhook (header X-Telegram-Bot-Api-Secret-Token)
//   Pit Wall  POST /bot {text, user_id}  Bearer CRON_SECRET, from api/admin.js (action=command)
//   Setup     POST /bot?setup=1         Bearer CRON_SECRET: points the bot saved in Pit Wall here
// Only Pit Wall admins can use it: each one links their own Telegram chat with a one-time code
// (t.me/<bot>?start=<code>, made in Pit Wall). Strangers get a short "private bot" reply.
import { loadSeason } from '../../../season.js';

const SITE = 'https://f1-predictor-theta.vercel.app';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OWNER_EMAIL = (Deno.env.get('ADMIN_EMAIL') || 'ahmoudy365@gmail.com').toLowerCase();
const TZ = 'Africa/Cairo';
const HOUR = 3600e3, DAY = 24 * HOUR;

type Json = Record<string, any>;
type Who = { id: string; owner: boolean; name: string };
type Out = { text: string; doc?: { url: string; name: string; caption: string }; ok?: boolean };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

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
async function settings(): Promise<Json> {
  const rows = await db('app_settings?select=key,value');
  return Object.fromEntries((rows || []).map((r: Json) => [r.key, r.value]));
}
const setSetting = (key: string, value: string) => db('app_settings?on_conflict=key', {
  method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ key, value, updated_at: new Date().toISOString() }],
});

/* ════════════════ who is asking ════════════════ */
// A Pit Wall admin who still has access (the same rule as api/admin.js).
function profile(u: Json): Who | null {
  const email = String(u?.email || '').toLowerCase();
  const owner = email === OWNER_EMAIL || u?.app_metadata?.role === 'owner';
  const banned = u?.banned_until && Date.parse(u.banned_until) > Date.now();
  if (banned || (!owner && u?.app_metadata?.role !== 'admin')) return null;
  const meta = u.user_metadata || {};
  return { id: u.id, owner, name: String(meta.full_name || (owner ? 'Ahmed Masoud' : email.split('@')[0])).slice(0, 60) };
}
async function member(userId: string): Promise<Who | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(8000) });
  return r.ok ? profile(await r.json()) : null;
}

/* ════════════════ formatting ════════════════ */
const when = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(ms);
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(Date.parse(`${iso}T12:00:00Z`));
function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 2 ? `${d} days` : `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
const ago = (iso: string) => { const ms = Date.now() - Date.parse(iso); return ms < 60e3 ? 'just now' : `${span(ms)} ago`; };
const STAGE: Json = { beforeSprintQ: 'Before sprint quali', afterSprintQ: 'After sprint quali', afterSprint: 'After the sprint', beforeQuali: 'Before quali', afterQuali: 'After quali' };
const win = (v: unknown) => (v == null || isNaN(+v!)) ? '' : +v! < 1 ? ' <1%' : ` ${Math.round(+v!)}%`;

/* ════════════════ the season ════════════════ */
// [name, date field, time field, minutes long]
const SESSIONS: [string, string, string, number][] = [
  ['Practice 1', 'fp1Date', 'fp1UTC', 60], ['Practice 2', 'fp2Date', 'fp2UTC', 60], ['Practice 3', 'fp3Date', 'fp3UTC', 60],
  ['Sprint qualifying', 'sprintQualiDate', 'sprintQualiUTC', 45], ['Sprint', 'sprintDate', 'sprintUTC', 60],
  ['Qualifying', 'qualiDate', 'qualiUTC', 60], ['Race', 'date', 'raceUTC', 120],
];
const sessionsOf = (r: Json) => SESSIONS.filter(([, d, t]) => r[d] && r[t])
  .map(([name, d, t, len]) => ({ race: r, name, start: Date.parse(`${r[d]}T${r[t]}:00Z`), len }))
  .sort((a, b) => a.start - b.start);
const raceEnd = (r: Json) => Date.parse(`${r.date}T${r.raceUTC || '23:59'}:00Z`) + 2 * HOUR;

/* ════════════════ commands ════════════════ */
// Checked in this order, against what was typed or the button pressed.
const COMMANDS: [string, RegExp][] = [
  ['help', /^(start|help|menu|commands|\?)$|\bhelp\b|what can you/],
  ['email', /race report|newsletter|e-?mail|subscriber/],
  ['report', /report|pdf|weekly/],
  ['retry', /retry|ask the ai|make (the|a) call|re-?run/],
  ['weekend', /weekend|\bcalls?\b|predict|top ?10/],
  ['visitors', /visitor|traffic|views|analytics|people|users/],
  ['status', /status|overview|summary|how('?s| is| are) (the |my )?(site|app|things|everything)/],
  ['scan', /scan|check|health/],
];
export function intent(text: string): string | null {
  const t = text.toLowerCase().replace(/@\w+/g, ' ').replace(/^\//, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [k, re] of COMMANDS) if (re.test(t)) return k;
  return null;
}
export const HELP = [
  'What I can do. Tap a button or just ask, like "send me a report now":',
  '• Scan now: check the whole site (about 30 seconds)',
  '• Weekly report: this week\'s one-page PDF',
  '• Status: the site at a glance',
  '• This weekend: the AI\'s calls for the next race',
  '• Visitors: the last 7 days',
  '• Retry the AI: make any call that is due now',
  '• Race report: the last race report email',
].join('\n');
const SLOW: Json = {
  scan: 'Running the scan, about 30 seconds…',
  report: 'Making this week\'s report, about 15 seconds…',
  retry: 'Asking the AI for any call that is due. This can take up to a minute…',
};
// Commands that do real work run at most once per this many minutes, whoever asks.
const COOLDOWN: Json = { scan: 2, retry: 5 };

async function ops(task: string, body: Json = {}) {
  const r = await fetch(`${SB_URL}/functions/v1/ops?task=${task}`, {
    method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(130000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `the ops job answered ${r.status}`);
  return j;
}

async function cmdScan(): Promise<Out> {
  const r = await ops('scan');
  const checks: Json[] = r.checks || [], bad = checks.filter(c => !c.ok);
  if (!bad.length) return { text: `Scan done: all ${checks.length} checks passed.` };
  return { text: [`Scan done: ${bad.length} of ${checks.length} checks need attention.`, ...bad.map(c => `✗ ${c.name}: ${c.detail}`), '', 'Everything else passed. Details: Pit Wall, Health and reports.'].join('\n') };
}

async function cmdReport(): Promise<Out> {
  const r = await ops('weekly', { deliver: false });
  const [a, b] = String(r.week || '').split('..');
  return { text: `This week's report (${a ? day(a) : ''} to ${b ? day(b) : ''}).`, doc: { url: r.link, name: r.name, caption: r.caption || '' } };
}

async function nextRace(races: Json[]) {
  const now = Date.now();
  return races.find(r => raceEnd(r) > now) || races[races.length - 1];
}

async function calls(r: Json) {
  const rows: Json[] = await db(`predictions?circuit_id=eq.${encodeURIComponent(r.circuitId)}&round=eq.${r.round}&pred_type=eq.race&stage=neq.final&or=(hidden.is.null,hidden.is.false)&select=stage,prediction,created_at&order=created_at.desc`) || [];
  const stages = r.sprint ? ['beforeSprintQ', 'afterSprintQ', 'afterSprint', 'afterQuali'] : ['beforeQuali', 'afterQuali'];
  return stages.map(st => {
    const mine = rows.filter(p => p.stage === st);
    const best = mine.find(p => !p.prediction?._fallback) || mine[0] || null;
    return { stage: st, best, ai: !!best && !best.prediction?._fallback };
  });
}

async function cmdStatus(): Promise<Out> {
  const now = Date.now();
  const [{ races }, scans, open, subs, push, traffic] = await Promise.all([
    loadSeason(),
    db('health_checks?select=ts,ok,failed&order=ts.desc&limit=1'),
    db('maintenance_log?kind=eq.found&resolved=eq.false&select=id'),
    db('subscribers?select=id&active=eq.true'),
    db('push_subscriptions?select=endpoint'),
    rpc('admin_overview', { days: 7 }).catch(() => null),
  ]);
  const sessions = (races as Json[]).flatMap(sessionsOf);
  const live = sessions.find(s => now >= s.start && now < s.start + s.len * 60e3);
  const next = sessions.find(s => s.start > now);
  const race = await nextRace(races);
  const c = await calls(race);
  const scan = scans?.[0];
  return { text: [
    'F1 Predictor right now',
    `Site scan: ${scan ? `${scan.ok ? 'all clear' : `${scan.failed} problem${scan.failed === 1 ? '' : 's'}`}, ${ago(scan.ts)}` : 'not run yet'}`,
    `Open problems: ${open?.length || 0}`,
    live ? `Live now: ${live.race.name}, ${live.name}` : next ? `Next: ${next.race.name}, ${next.name}, ${when(next.start)} Egypt time (in ${span(next.start - now)})` : 'No more sessions this season',
    `${race.name} calls: ${c.map(x => `${STAGE[x.stage]} ${x.best ? (x.ai ? 'AI' : 'baseline') : 'not yet'}`).join(' · ')}`,
    traffic ? `Visitors: ${traffic.visitors} in the last 7 days, ${traffic.live_now} on the site now` : '',
    `Subscribers: ${subs?.length || 0} by email, ${push?.length || 0} phone${push?.length === 1 ? '' : 's'} with notifications`,
  ].filter(Boolean).join('\n') };
}

async function cmdWeekend(): Promise<Out> {
  const { races } = await loadSeason();
  const race = await nextRace(races);
  const c = await calls(race);
  const lines = [`${race.name} (round ${race.round}): the AI's calls`];
  for (const x of c) {
    if (!x.best) { lines.push(`${STAGE[x.stage]}: not made yet`); continue; }
    const top = [...(x.best.prediction?.top10 || [])].sort((a: Json, b: Json) => (+a.pos || 99) - (+b.pos || 99)).slice(0, 3);
    lines.push(`${STAGE[x.stage]} (${x.ai ? 'AI' : 'baseline, not scored'}): ${top.map((d: Json, i: number) => `${i + 1} ${String(d.abbr || '').toUpperCase()}${win(d.winProb)}`).join(' · ')}`);
  }
  const next = sessionsOf(race).find(s => s.start > Date.now());
  if (next) lines.push('', `Next session: ${next.name}, ${when(next.start)} Egypt time`);
  return { text: lines.join('\n') };
}

async function cmdVisitors(): Promise<Out> {
  const t = await rpc('admin_overview', { days: 7 });
  const per: Json[] = (t?.per_day || []).slice(-7);
  return { text: [
    `Visitors in the last 7 days: ${t?.visitors ?? 0} people, ${t?.views ?? 0} page views. On the site now: ${t?.live_now ?? 0}.`,
    ...per.map(d => `${day(d.day)}: ${d.visitors} visitor${d.visitors === 1 ? '' : 's'}`),
  ].join('\n') };
}

async function cmdRetry(): Promise<Out> {
  let r: Json;
  try {
    const res = await fetch(`${SITE}/api/push-send?mode=predictions`, { headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(60000) });
    r = await res.json().catch(() => ({ working: true }));
  } catch { r = { working: true }; }
  if (r.autoGenerated?.length) return { text: `Made: ${r.autoGenerated.join(', ')}.` };
  if (r.working) return { text: 'The AI is busy. It keeps trying by itself every 15 minutes; check This weekend in a little while.' };
  return { text: 'Nothing is due right now: every call that should exist has been made.' };
}

async function cmdEmail(): Promise<Out> {
  const { season, races } = await loadSeason();
  const now = Date.now();
  const last = [...races].reverse().find((r: Json) => raceEnd(r) <= now);
  const subs = await db('subscribers?select=id&active=eq.true');
  if (!last) return { text: `No race has finished yet. ${subs?.length || 0} people get the race report.` };
  const sent = (await db(`newsletter_log?season=eq.${season}&round=eq.${last.round}&sent=gt.0&select=ts,sent&order=ts.desc&limit=1`))?.[0];
  const since = now - raceEnd(last);
  const line = sent ? `The race report for the ${last.name} went to ${sent.sent} subscriber${sent.sent === 1 ? '' : 's'}, ${ago(sent.ts)}.`
    : since < 10 * HOUR ? `The race report for the ${last.name} goes out by itself once the result is official, usually a few hours after the flag.`
    : `The race report for the ${last.name} has not been sent. Preview it in Pit Wall, Subscribers and email.`;
  return { text: `${line}\n${subs?.length || 0} people are on the race report list.` };
}

const RUN: Record<string, () => Promise<Out>> = {
  help: async () => ({ text: HELP }), scan: cmdScan, report: cmdReport, status: cmdStatus,
  weekend: cmdWeekend, visitors: cmdVisitors, retry: cmdRetry, email: cmdEmail,
};

// Why a command can't run again yet (it ran moments ago), or null.
async function blocked(cmd: string) {
  if (!COOLDOWN[cmd]) return null;
  const since = new Date(Date.now() - COOLDOWN[cmd] * 60e3).toISOString();
  const recent = (await db(`bot_log?command=eq.${cmd}&ok=is.true&ts=gte.${since}&select=ts&order=ts.desc&limit=1`))?.[0];
  return recent ? `That already ran ${ago(recent.ts)}. Try again in a couple of minutes.` : null;
}

// Runs one command for one admin, with the repeat guard and a log line.
export async function run(cmd: string, who: Who, via: 'telegram' | 'pitwall'): Promise<Out> {
  const stop = await blocked(cmd);
  if (stop) return { text: stop, ok: false };
  let out: Out;
  try { out = { ...(await RUN[cmd]()), ok: true }; }
  catch (e) { out = { text: `That didn't work: ${String((e as Error).message || e).slice(0, 200)}`, ok: false }; }
  await db('bot_log', { method: 'POST', prefer: 'return=minimal', body: { user_id: who.id, via, command: cmd, ok: out.ok } }).catch(() => {});
  return out;
}

/* ════════════════ Telegram ════════════════ */
async function tg(token: string, method: string, payload: Json | FormData) {
  const isForm = payload instanceof FormData;
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', ...(isForm ? { body: payload } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(30000),
  });
  return r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
}
const KEYBOARD = { keyboard: [[{ text: 'Scan now' }, { text: 'Weekly report' }], [{ text: 'Status' }, { text: 'This weekend' }],
  [{ text: 'Visitors' }, { text: 'Retry the AI' }], [{ text: 'Race report' }, { text: 'Help' }]], resize_keyboard: true, is_persistent: true };
const NO_KEYBOARD = { remove_keyboard: true };
const PRIVATE = 'This is the private bot of the F1 Predictor team. Team members connect it in Pit Wall: Assistant, then Connect Telegram.';

async function onTelegram(update: Json) {
  const msg = update.message;
  if (!msg?.chat || msg.chat.type !== 'private') return;
  const s = await settings();
  const token = s.telegram_token;
  if (!token) return;
  const chatId = msg.chat.id, text = String(msg.text || '').trim();
  const send = (t: string, markup: Json = KEYBOARD) => tg(token, 'sendMessage', { chat_id: chatId, text: t.slice(0, 4000), reply_markup: markup, disable_web_page_preview: true });

  // Linking: /start <code> from the link Pit Wall made.
  const m = text.match(/^\/start\s+([A-Za-z0-9_-]{8,64})$/);
  if (m) {
    const code = (await db(`telegram_codes?code=eq.${m[1]}&select=user_id,expires_at`))?.[0];
    if (!code || Date.parse(code.expires_at) < Date.now()) return send('That link has expired. Make a new one in Pit Wall: Assistant, then Connect Telegram.', NO_KEYBOARD);
    const who = await member(code.user_id);
    if (!who) return send('That Pit Wall account no longer has access.', NO_KEYBOARD);
    await db(`telegram_links?chat_id=eq.${chatId}`, { method: 'DELETE', prefer: 'return=minimal' });
    await db('telegram_links?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { user_id: who.id, chat_id: chatId, username: msg.from?.username || null, name: who.name, linked_at: new Date().toISOString() } });
    await db(`telegram_codes?code=eq.${m[1]}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (who.owner) await setSetting('telegram_chat', String(chatId));
    return send(`Hi ${who.name.split(/\s+/)[0]}, you're connected to Pit Wall.${who.owner ? ' The weekly report and scan alerts come here too.' : ''}\n\n${HELP}`);
  }

  const link = (await db(`telegram_links?chat_id=eq.${chatId}&select=user_id`))?.[0];
  if (!link) return send(PRIVATE, NO_KEYBOARD);
  const who = await member(link.user_id);
  if (!who) {
    await db(`telegram_links?chat_id=eq.${chatId}`, { method: 'DELETE', prefer: 'return=minimal' });
    return send('Your Pit Wall access has ended, so this bot no longer answers you.', NO_KEYBOARD);
  }
  const cmd = intent(text);
  if (!cmd) return send(`Sorry, I didn't get that.\n\n${HELP}`);
  const stop = await blocked(cmd);
  if (stop) return send(stop);
  if (SLOW[cmd]) await send(SLOW[cmd]);
  const out = await run(cmd, who, 'telegram');
  if (out.doc) {
    // Sent as a file with its own name; the link is the fallback.
    const pdf = await fetch(out.doc.url, { signal: AbortSignal.timeout(20000) }).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    if (pdf) {
      const f = new FormData();
      f.append('chat_id', String(chatId));
      f.append('caption', out.doc.caption.slice(0, 1000));
      f.append('document', new Blob([pdf], { type: 'application/pdf' }), out.doc.name);
      if ((await tg(token, 'sendDocument', f)).ok) return;
    }
    return send(`${out.text}\n${out.doc.url}`);
  }
  return send(out.text);
}

/* ════════════════ setup ════════════════ */
// Points the bot saved in Pit Wall at this function, with a secret only Telegram knows, and gives
// it its command menu. The owner's chat, if already known, becomes their link.
async function setup() {
  const s = await settings();
  const token = s.telegram_token;
  if (!token) return { ok: false, error: 'No bot token saved' };
  const me = await tg(token, 'getMe', {});
  if (!me.ok) return { ok: false, error: 'Telegram did not accept the bot token' };
  const secret = s.telegram_webhook_secret || `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await setSetting('telegram_webhook_secret', secret);
  await setSetting('telegram_bot', me.result.username);
  const wh = await tg(token, 'setWebhook', { url: `${SB_URL}/functions/v1/bot`, secret_token: secret, allowed_updates: ['message'] });
  await tg(token, 'setMyCommands', { commands: [
    { command: 'scan', description: 'Check the whole site now' }, { command: 'report', description: 'This week\'s one-page PDF' },
    { command: 'status', description: 'The site at a glance' }, { command: 'weekend', description: 'The AI\'s calls for the next race' },
    { command: 'visitors', description: 'Visitors in the last 7 days' }, { command: 'retry', description: 'Make any AI call that is due' },
    { command: 'email', description: 'The last race report email' }, { command: 'help', description: 'What the bot can do' },
  ] });
  if (s.telegram_chat) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=200`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const owner = ((await r.json().catch(() => ({})))?.users || []).find((u: Json) => String(u.email || '').toLowerCase() === OWNER_EMAIL);
    if (owner) {
      await db(`telegram_links?chat_id=eq.${Number(s.telegram_chat)}&user_id=neq.${owner.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      await db('telegram_links?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { user_id: owner.id, chat_id: Number(s.telegram_chat), name: profile(owner)?.name || 'Ahmed Masoud' } }).catch(() => {});
    }
  }
  return wh.ok ? { ok: true, bot: me.result.username } : { ok: false, bot: me.result.username, error: wh.description || 'Telegram refused the webhook' };
}

/* ════════════════ entry ════════════════ */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const tgSecret = req.headers.get('x-telegram-bot-api-secret-token');
  try {
    if (tgSecret) {
      const s = await settings();
      if (!s.telegram_webhook_secret || tgSecret !== s.telegram_webhook_secret) return reply({ error: 'Unauthorized' }, 401);
      const update = await req.json().catch(() => ({}));
      // Answer Telegram at once and do the work after, so a slow command is never sent twice.
      const work = onTelegram(update).catch(e => console.error('[bot] telegram', e));
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
      return reply({ ok: true });
    }
    if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) return reply({ error: 'Unauthorized' }, 401);
    if (url.searchParams.get('setup')) return reply(await setup());
    const body = await req.json().catch(() => ({}));
    const who = await member(String(body.user_id || ''));
    if (!who) return reply({ error: 'No access' }, 403);
    const cmd = intent(String(body.text || '').slice(0, 300));
    if (!cmd) return reply({ ok: true, command: null, text: `Sorry, I didn't get that.\n\n${HELP}` });
    const out = await run(cmd, who, 'pitwall');
    return reply({ ok: out.ok !== false, command: cmd, text: out.text, link: out.doc ? { url: out.doc.url, label: 'Open the PDF' } : null });
  } catch (e) {
    console.error('[bot]', e);
    return reply({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
}

Deno.serve(handle);

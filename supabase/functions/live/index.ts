// Live timing in the cloud: F1's live timing feed → the sessions table, with no computer on.
// pg_cron calls POST /live every minute on race weekends (Bearer CRON_SECRET). During a session,
// or while Pit Wall's "Start it now" lasts, one run connects to F1's SignalR feed over
// Server-Sent Events, saves positions every 5 seconds for about 50 seconds, and ends. The next
// minute's run picks up again from the full snapshot F1 sends on every connection.
// Saves exactly what live-bridge/live-bridge.js saves (source 'f1-signalr-live').
//   ?force=1      run even outside a session      ?dry=1   log instead of saving
//   ?wait=1       answer after the run (tests)    ?seconds=N  run length (5-55)
//   ?test=1       save to a throwaway row (circuit zz_test, year 2099) to check the write path
import { loadSeason } from '../../../season.js';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const F1 = 'https://livetiming.formula1.com/signalrcore';
const UA = 'BestHTTP';   // F1's own client; their firewall expects it
const RS = '\x1e';       // SignalR record separator
const FEEDS = ['TimingData', 'DriverList', 'SessionInfo', 'TrackStatus', 'LapCount', 'TimingAppData', 'SessionStatus'];
const FLUSH_MS = 5000;

type Json = Record<string, any>;
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

/* ════════════════ when to run ════════════════ */
// [date field, time field, minutes long, minutes to keep going after]
const WINDOWS: [string, string, number, number][] = [
  ['fp1Date', 'fp1UTC', 60, 20], ['fp2Date', 'fp2UTC', 60, 20], ['fp3Date', 'fp3UTC', 60, 20],
  ['sprintQualiDate', 'sprintQualiUTC', 45, 25], ['sprintDate', 'sprintUTC', 60, 25],
  ['qualiDate', 'qualiUTC', 60, 40], ['date', 'raceUTC', 120, 60],
];
export function inSession(races: Json[], now: number) {
  for (const r of races) for (const [d, t, len, after] of WINDOWS) {
    if (!r[d] || !r[t]) continue;
    const start = Date.parse(`${r[d]}T${r[t]}:00Z`);
    if (now >= start - 5 * 60e3 && now <= start + (len + after) * 60e3) return true;
  }
  return false;
}

/* ════════════════ F1's feed → our rows ════════════════ */
const LOC_TO_CIRCUIT: Json = {
  'Melbourne': 'albert_park', 'Shanghai': 'shanghai', 'Suzuka': 'suzuka', 'Sakhir': 'sakhir', 'Jeddah': 'jeddah', 'Miami': 'miami',
  'Imola': 'imola', 'Monte Carlo': 'monaco', 'Montreal': 'villeneuve', 'Montréal': 'villeneuve',
  'Barcelona': 'catalunya', 'Madrid': 'ifema_madrid', 'Spielberg': 'red_bull_ring', 'Silverstone': 'silverstone',
  'Spa-Francorchamps': 'spa', 'Budapest': 'hungaroring', 'Zandvoort': 'zandvoort', 'Monza': 'monza', 'Baku': 'baku',
  'Kuala Lumpur': 'sepang', 'Sepang': 'sepang', 'Miami Gardens': 'miami', 'Marina Bay': 'marina_bay', 'Singapore': 'marina_bay',
  'Austin': 'americas', 'Mexico City': 'rodriguez', 'São Paulo': 'interlagos', 'Sao Paulo': 'interlagos',
  'Las Vegas': 'las_vegas', 'Lusail': 'losail', 'Yas Marina': 'yas_marina',
};
const TYRE: Json = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };

export class Feed {
  drivers: Json = {}; timing: Json = {}; stints: Json = {}; track: Json | null = null; session: Json | null = null; status = '';
  seeded: Json = {};   // pit counts already saved for this session by an earlier run
  constructor(public rounds: Json) {}

  merge(feed: string, data: any) {
    if (data == null) return;
    if (feed === 'DriverList') {
      for (const [num, d] of Object.entries<any>(data)) if (d && typeof d === 'object') {
        const p = this.drivers[num] || {};
        this.drivers[num] = { tla: d.Tla || p.tla || '', team: d.TeamName || p.team || '' };
      }
    } else if (feed === 'TimingData') {
      for (const [num, t] of Object.entries<any>(data.Lines || data)) if (t && typeof t === 'object') {
        const p = this.timing[num] || {};
        const inPit = t.InPit !== undefined ? !!t.InPit : !!p.inPit;
        const lap = t.NumberOfLaps ?? p.lap ?? 0;
        let pits = p.pits || 0, lastPitLap = p.lastPitLap || 0;
        if (inPit && !p.inPit && p.seen) { pits += 1; lastPitLap = lap; }     // entered the pit lane while we watched
        if (typeof t.NumberOfPitStops === 'number' && t.NumberOfPitStops > pits) pits = t.NumberOfPitStops;
        this.timing[num] = {
          seen: true, pos: parseInt(t.Position, 10) || p.pos || 99, lap, inPit, pits, lastPitLap,
          gap: t.GapToLeader ?? p.gap ?? '', retired: !!(t.Retired || t.Stopped) || !!p.retired,
        };
      }
    } else if (feed === 'TimingAppData') {
      for (const [num, t] of Object.entries<any>(data.Lines || data)) if (t?.Stints) {
        const s = this.stints[num] || (this.stints[num] = []);
        const upd = Array.isArray(t.Stints) ? t.Stints.map((x: any, i: number) => [i, x]) : Object.entries(t.Stints).map(([i, x]) => [+i, x]);
        for (const [i, x] of upd as [number, any][]) if (x && typeof x === 'object') s[i] = { ...(s[i] || {}), ...x };
      }
    } else if (feed === 'TrackStatus') {
      this.track = { status: String(data.Status || this.track?.status || ''), message: String(data.Message || this.track?.message || '') };
    } else if (feed === 'SessionInfo') {
      const loc = data.Meeting?.Location || data.Meeting?.Country?.Name || '';
      const circuitId = LOC_TO_CIRCUIT[loc] || loc.toLowerCase().replace(/[\s'’`]+/g, '_');
      const both = `${data.Name || ''} ${data.Type || ''}`.toLowerCase();
      const name = both.includes('practice') ? String(data.Name || '').replace(/^Practice\s*(\d)$/i, 'Practice $1')
        : both.includes('sprint') && (both.includes('quali') || both.includes('shoot')) ? 'Sprint Qualifying'
        : both.includes('sprint') ? 'Sprint' : both.includes('quali') ? 'Qualifying' : 'Race';
      this.session = { circuitId, round: this.rounds[circuitId] || null, name, totalLaps: data.NumberOfLaps || this.session?.totalLaps || null, meeting: data.Meeting?.Name || '' };
    } else if (feed === 'LapCount') {
      if (this.session && data.TotalLaps) this.session.totalLaps = data.TotalLaps;
    } else if (feed === 'SessionStatus') {
      this.status = String(data.Status || this.status);
    }
  }

  // The row the site reads, or null while there is nothing to show.
  row() {
    const s = this.session;
    if (!s?.circuitId || !s.round || !/^(Practice [1-3]|Sprint Qualifying|Sprint|Qualifying|Race)$/.test(s.name)) return null;
    const grid = Object.entries<any>(this.timing).map(([num, t]) => {
      const abbr = String(this.drivers[num]?.tla || '').toUpperCase();
      const st = (this.stints[num] || []).filter(Boolean), last = st[st.length - 1];
      const seed = this.seeded[abbr] || {};
      const gap = typeof t.gap === 'string' && /^[+\d. :LAPSlaps]{1,12}$/.test(t.gap) ? t.gap : null;
      return {
        pos: t.pos, abbr, lap: t.lap, inPit: t.inPit,
        pitCount: Math.max(t.pits || 0, seed.pitCount || 0), lastPitLap: Math.max(t.lastPitLap || 0, seed.lastPitLap || 0),
        gap, tyre: TYRE[String(last?.Compound || '').toUpperCase()] || null, tyreAge: last?.TotalLaps ?? null,
        totalLaps: s.totalLaps || null, flag: /^[A-Za-z ]{1,20}$/.test(this.track?.message || '') ? this.track!.message : null,
      };
    }).filter(g => /^[A-Z]{3}$/.test(g.abbr) && g.pos > 0 && g.pos < 99).sort((a, b) => a.pos - b.pos)
      // Leave out empty values, like the Mac bridge's rows (saved through api/save.js).
      .map(g => Object.fromEntries(Object.entries(g).filter(([, v]) => v !== null && v !== undefined && v !== '')));
    if (!grid.length) return null;
    return { circuit_id: s.circuitId, round: s.round, year: new Date().getUTCFullYear(), session_name: s.name,
      grid_data: grid, source: 'f1-signalr-live', fetched_at: new Date().toISOString() };
  }
}

/* ════════════════ one run ════════════════ */
async function negotiate() {
  const r = await fetch(`${F1}/negotiate?negotiateVersion=1`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'text/plain;charset=UTF-8' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`F1 refused the connection (${r.status})`);
  const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const j = await r.json();
  if (!j.connectionToken) throw new Error('F1 gave no connection token');
  return { token: j.connectionToken as string, cookies };
}

export async function runOnce({ ms = 50000, dry = false, test = false, log = console.log }: { ms?: number; dry?: boolean; test?: boolean; log?: (...a: unknown[]) => void } = {}) {
  const t0 = Date.now();
  const { races } = await loadSeason();
  const feed = new Feed(Object.fromEntries((races as Json[]).map(r => [r.circuitId, r.round])));
  const out = { flushes: 0, snapshot: false, session: '', positions: 0, error: '' as string, sample: [] as Json[] };
  const { token, cookies } = await negotiate();
  const url = `${F1}?id=${encodeURIComponent(token)}`;
  const hdr: Json = { 'User-Agent': UA, ...(cookies ? { Cookie: cookies } : {}) };
  const send = (obj: Json) => fetch(url, { method: 'POST', headers: { ...hdr, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(obj) + RS, signal: AbortSignal.timeout(10000) })
    .then(r => r.body?.cancel()).catch(() => {});
  const ctrl = new AbortController();
  const stream = await fetch(url, { headers: { ...hdr, Accept: 'text/event-stream' }, signal: ctrl.signal });
  if (!stream.ok || !stream.body) throw new Error(`F1's live stream answered ${stream.status}`);
  await send({ protocol: 'json', version: 1 });

  let seededFor = '';
  const flush = async () => {
    const row = feed.row();
    if (!row) return;
    if (test) Object.assign(row, { circuit_id: 'zz_test', round: 30, year: 2099 });
    const key = `${row.circuit_id}|${row.round}|${row.session_name}`;
    if (seededFor !== key) {   // keep the pit counts an earlier run already saved
      seededFor = key;
      const prev = (await db(`sessions?circuit_id=eq.${row.circuit_id}&round=eq.${row.round}&year=eq.${row.year}&session_name=eq.${encodeURIComponent(row.session_name)}&select=grid_data,source`).catch(() => []))?.[0];
      if (prev?.source === 'f1-signalr-live') feed.seeded = Object.fromEntries((prev.grid_data || []).map((g: Json) => [g.abbr, { pitCount: g.pitCount || 0, lastPitLap: g.lastPitLap || 0 }]));
      return flush();
    }
    out.session = `${feed.session?.meeting} · ${row.session_name}`;
    out.positions = row.grid_data.length;
    out.sample = row.grid_data.slice(0, 3);
    if (dry) log('dry run, not saved:', out.session, row.grid_data.length, 'positions, leader', row.grid_data[0]?.abbr, 'lap', row.grid_data[0]?.lap);
    else await db('sessions?on_conflict=circuit_id,round,year,session_name', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: row });
    out.flushes++;
  };
  const ping = setInterval(() => send({ type: 6 }), 10000);
  const timer = setInterval(() => flush().catch(e => { out.error = String(e.message || e); }), FLUSH_MS);
  const stop = setTimeout(() => ctrl.abort(), ms);

  const handle = (m: Json) => {
    if (m.type === undefined && !m.error) {   // handshake answer: now subscribe
      send({ arguments: [FEEDS], invocationId: '0', target: 'Subscribe', type: 1 });
    } else if (m.type === 3 && m.result) {
      out.snapshot = true;
      for (const [f, d] of Object.entries(m.result)) feed.merge(f, d);
    } else if (m.type === 1 && m.target === 'feed' && Array.isArray(m.arguments)) {
      feed.merge(m.arguments[0], m.arguments[1]);
    } else if (m.type === 7) {
      ctrl.abort();
    }
  };
  try {
    const reader = stream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const event = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        for (const part of data.split(RS)) if (part.trim()) { try { handle(JSON.parse(part)); } catch { /* not JSON */ } }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') out.error = String((e as Error).message || e);
  } finally {
    clearInterval(ping); clearInterval(timer); clearTimeout(stop); ctrl.abort();
  }
  await flush().catch(e => { out.error = String(e.message || e); });
  return { ...out, ms: Date.now() - t0 };
}

/* ════════════════ entry ════════════════ */
async function record(res: Json) {
  await db('live_runs', { method: 'POST', prefer: 'return=minimal', body: { session: res.session || null, flushes: res.flushes || 0, ms: res.ms || 0, error: res.error || null } }).catch(() => {});
  if (new Date().getUTCMinutes() === 0) await db(`live_runs?ts=lt.${new Date(Date.now() - 14 * 86400e3).toISOString()}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
}

export async function handle(req: Request): Promise<Response> {
  if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) return reply({ error: 'Unauthorized' }, 401);
  const q = new URL(req.url).searchParams;
  const force = q.get('force') === '1', dry = q.get('dry') === '1', wait = q.get('wait') === '1', test = q.get('test') === '1';
  const ms = Math.min(Math.max(Number(q.get('seconds')) || 50, 5), 55) * 1000;
  // Outside a session (and without Pit Wall's "Start it now") there is nothing to do.
  if (!force) {
    const until = (await db('app_settings?key=eq.live_force_until&select=value').catch(() => []))?.[0]?.value;
    const { races } = await loadSeason();
    if (!(until && Date.parse(until) > Date.now()) && !inSession(races, Date.now())) return reply({ ok: true, idle: true });
  }
  const work = runOnce({ ms, dry, test }).catch(e => ({ flushes: 0, error: String((e as Error).message || e) } as Json)).then(async res => { if (!dry && !test) await record(res); return res; });
  if (wait) return reply({ ok: true, ...(await work) });
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
  return reply({ ok: true, started: true }, 202);
}

Deno.serve(handle);

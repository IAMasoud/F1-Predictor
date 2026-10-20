// ═══════════════════════════════════════════════════════════════════════
//   F1 LIVE BRIDGE
//   Connects to formula1.com's official SignalR live-timing feed,
//   parses positions in real-time, and saves them to the `sessions` table
//   through the site's /api/save endpoint (the database itself is read-only
//   to the public key). The PWA reads from Supabase and shows live data.
//
//   Usage:  node live-bridge.js
//   Setup:  copy .env.example → .env, fill in SITE_URL + BRIDGE_KEY
// ═══════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { loadSeason } from '../season.js';
import zlib from 'node:zlib';
import http from 'node:http';
import dotenv from 'dotenv';
dotenv.config();

const {
  SITE_URL = 'https://f1-predictor-theta.vercel.app',
  BRIDGE_KEY,
  FLUSH_INTERVAL_MS = 5000,
  LOCAL_HTTP_PORT = 3001,
  NEWSLETTER_TRIGGER_URL,
  NEWSLETTER_TRIGGER_KEY,
  DEBUG = 'false',
} = process.env;

const debug = DEBUG === 'true';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dbg = (...a) => { if (debug) log('🔍', ...a); };

if (!BRIDGE_KEY) {
  console.error('❌ Missing BRIDGE_KEY in .env (it is the CRON_SECRET value set in Vercel).');
  console.error('   Copy .env.example → .env and fill it in.');
  process.exit(1);
}

// ─── F1 SignalR CORE endpoints ──────────────────────────────────────────
// F1 migrated from the legacy ASP.NET SignalR (/signalr) to modern SignalR
// Core (/signalrcore) in 2026. The old /signalr/negotiate now returns 401;
// /signalrcore works anonymously (no token needed). This matches how OpenF1
// connects (via their br-g/fastf1-livetiming fork).
const F1_NEGOTIATE = 'https://livetiming.formula1.com/signalrcore/negotiate';
const F1_WS_CORE   = 'wss://livetiming.formula1.com/signalrcore';
const F1_UA        = 'BestHTTP'; // F1's official client UA — required by their WAF
const RS           = '\x1e';     // SignalR Core record separator (0x1e)
const SUB_FEEDS    = [
  'TimingData',         // positions, lap times, gaps
  'DriverList',         // driver number → TLA mapping
  'SessionInfo',        // race name, session type, total laps
  'TrackStatus',        // green/yellow/red/SC flags
  'LapCount',           // current lap / total laps
];

// ─── State ──────────────────────────────────────────────────────────────
const state = {
  drivers:  {},   // driverNumber → { tla, name, team }
  timing:   {},   // driverNumber → { position, lap, gap }
  session:  null, // { name, type, year, location, circuitId, round, totalLaps }
  lastFlush: 0,
  flushPending: false,
};

// Map F1 location → our circuit IDs (must match PWA's circuit_id values)
const LOC_TO_CIRCUIT = {
  'Melbourne': 'albert_park', 'Shanghai': 'shanghai', 'Suzuka': 'suzuka',
  'Sakhir': 'sakhir', 'Jeddah': 'jeddah', 'Miami': 'miami',
  'Imola': 'imola', 'Monte Carlo': 'monaco', 'Montreal': 'villeneuve',
  'Montréal': 'villeneuve',  // F1 uses both spellings
  'Barcelona': 'catalunya', 'Madrid': 'ifema_madrid', 'Spielberg': 'red_bull_ring',
  'Silverstone': 'silverstone', 'Spa-Francorchamps': 'spa', 'Budapest': 'hungaroring',
  'Zandvoort': 'zandvoort', 'Monza': 'monza', 'Baku': 'baku',
  'Kuala Lumpur': 'sepang', 'Sepang': 'sepang', 'Miami Gardens': 'miami',
  'Marina Bay': 'marina_bay', 'Singapore': 'marina_bay',
  'Austin': 'americas', 'Mexico City': 'rodriguez',
  'São Paulo': 'interlagos', 'Sao Paulo': 'interlagos',
  'Las Vegas': 'las_vegas', 'Lusail': 'losail', 'Yas Marina': 'yas_marina',
};

// circuit_id → round number, from the shared season calendar (../season.js reads the
// official schedule). Filled at start-up and refreshed when a new session begins.
let CIRCUIT_TO_ROUND = {};
async function refreshCalendar() {
  const { season, races, source } = await loadSeason();
  CIRCUIT_TO_ROUND = Object.fromEntries(races.map(r => [r.circuitId, r.round]));
  log(`📅 ${season} calendar: ${races.length} rounds (${source})`);
}

// ─── Step 1: SignalR Core Negotiate ─────────────────────────────────────
// Two-step like OpenF1: (1) OPTIONS preflight to grab the AWSALBCORS sticky
// cookie, (2) POST negotiate to get the connectionToken. No auth token needed.
async function negotiate() {
  log('📡 Negotiating with F1 SignalR Core...');

  // (1) OPTIONS → AWSALBCORS cookie (CloudFront/ALB session stickiness)
  let cookie = '';
  try {
    const optRes = await fetch(F1_NEGOTIATE, {
      method: 'OPTIONS',
      headers: { 'User-Agent': F1_UA },
    });
    const setCookie = optRes.headers.get('set-cookie') || '';
    const m = setCookie.match(/AWSALBCORS=[^;]+/);
    if (m) cookie = m[0];
  } catch (e) {
    dbg('OPTIONS preflight failed (continuing):', e.message);
  }

  // (2) POST negotiate
  const res = await fetch(`${F1_NEGOTIATE}?negotiateVersion=1`, {
    method: 'POST',
    headers: {
      'User-Agent': F1_UA,
      'Content-Type': 'text/plain;charset=UTF-8',
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
  });
  if (!res.ok) throw new Error(`Negotiate failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  dbg('Negotiate response:', data);
  if (!data.connectionToken) throw new Error('Negotiate returned no connectionToken');
  return { connectionToken: data.connectionToken, cookie };
}

// ─── Step 2: Connect via SignalR Core WebSocket ─────────────────────────
function connect(token, cookie) {
  const wsUrl = `${F1_WS_CORE}?id=${encodeURIComponent(token)}`;
  log('🔌 Opening WebSocket (signalrcore)...');
  const ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': F1_UA,
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
  });
  return ws;
}

// ─── Helper: decode zlib-compressed feed (.z suffix) ────────────────────
function decompressZ(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const decompressed = zlib.inflateRawSync(buf);
    return JSON.parse(decompressed.toString('utf8'));
  } catch (e) {
    dbg('decompress fail:', e.message);
    return null;
  }
}

// ─── Merge an incoming feed payload into state ──────────────────────────
function mergeFeed(feedName, data) {
  if (data == null) return;
  if (feedName === 'DriverList') {
    Object.entries(data).forEach(([num, drv]) => {
      if (typeof drv !== 'object') return;
      state.drivers[num] = {
        tla: drv.Tla || state.drivers[num]?.tla || '',
        name: drv.FullName || drv.BroadcastName || state.drivers[num]?.name || '',
        team: drv.TeamName || state.drivers[num]?.team || '',
      };
    });
  } else if (feedName === 'TimingData') {
    const lines = data.Lines || data;
    Object.entries(lines).forEach(([num, t]) => {
      if (typeof t !== 'object') return;
      const prev = state.timing[num] || {};
      const nowInPit = (t.InPit !== undefined) ? !!t.InPit : (prev.inPit || false);
      const lap = t.NumberOfLaps || prev.lap || 0;
      // Count a pit stop on the false→true transition (car ENTERS the pit lane).
      let pitCount  = prev.pitCount || 0;
      let lastPitLap = prev.lastPitLap || 0;
      if (nowInPit && !prev.inPit) { pitCount += 1; lastPitLap = lap; }
      state.timing[num] = {
        position: parseInt(t.Position, 10) || prev.position || 99,
        lap,
        gap:      t.GapToLeader || prev.gap || '',
        retired:  !!t.Retired || !!t.Stopped || prev.retired || false,
        inPit:    nowInPit,
        pitCount,
        lastPitLap,
      };
    });
  } else if (feedName === 'SessionInfo') {
    const loc = data.Meeting?.Location || data.Meeting?.Country?.Name || '';
    const circuitId = LOC_TO_CIRCUIT[loc] || loc.toLowerCase().replace(/[\s'’`]+/g, '_');
    // Use the calendar round, NOT F1's internal Meeting.Key (which is a different ID)
    const round = CIRCUIT_TO_ROUND[circuitId] || null;
    refreshCalendar().catch(() => {});
    state.session = {
      name:       data.Name || data.Type || 'Race',
      type:       data.Type || 'Race',
      year:       new Date().getUTCFullYear(),
      location:   loc,
      circuitId,
      round,
      totalLaps:  data.NumberOfLaps || data.TotalLaps || null,
      meetingName: data.Meeting?.Name || '',
    };
    log('🏁 Session:', state.session.meetingName, '·', state.session.name, '·', loc, '→ circuit:', circuitId, 'round:', round);
  } else if (feedName === 'LapCount') {
    if (state.session) state.session.totalLaps = data.TotalLaps || state.session.totalLaps;
  }
  scheduleFlush();
}

// ─── Flush positions to Supabase ────────────────────────────────────────
function scheduleFlush() {
  if (state.flushPending) return;
  state.flushPending = true;
  setTimeout(flushToSupabase, FLUSH_INTERVAL_MS);
}

let _newsletterFiredFor = null;  // remembers which session+circuit we already emailed
async function maybeTriggerNewsletter(grid) {
  if (!NEWSLETTER_TRIGGER_URL || !NEWSLETTER_TRIGGER_KEY) return;
  if (!state.session || state.session.type !== 'Race') return;
  const totalLaps = state.session.totalLaps;
  if (!totalLaps || !grid.length) return;

  // Race-end detection: leader has completed all laps AND has a "+0" gap (i.e. session finished)
  // Also accept: at least 75% of cars have completed total laps OR are retired
  const leader = grid[0];
  const leaderDone = leader.lap >= totalLaps;
  const settled = grid.filter(g => g.lap >= totalLaps || g.retired).length >= Math.ceil(grid.length * 0.75);
  if (!(leaderDone && settled)) return;

  const key = `${state.session.year}-${state.session.circuitId}-Race`;
  if (_newsletterFiredFor === key) return;  // already sent for this race
  _newsletterFiredFor = key;

  log('🏁 Race ended detected — triggering newsletter in 90s (settling time)');
  setTimeout(async () => {
    try {
      log('📧 Sending newsletter trigger…');
      const r = await fetch(NEWSLETTER_TRIGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: NEWSLETTER_TRIGGER_KEY, race: key }),
      });
      const result = await r.json().catch(() => ({}));
      if (r.ok) log('✅ Newsletter triggered:', result.sent || 0, 'emails sent');
      else log('❌ Newsletter trigger failed:', r.status, JSON.stringify(result));
    } catch (e) { log('❌ Newsletter trigger error:', e.message); }
  }, 90000);  // 90 second delay lets final positions settle
}

async function flushToSupabase() {
  state.flushPending = false;
  if (!state.session?.circuitId) {
    dbg('No session info yet, skipping flush');
    return;
  }
  // Build grid array sorted by position
  const grid = Object.entries(state.timing)
    .map(([num, t]) => ({
      pos: t.position,
      abbr: state.drivers[num]?.tla || '',
      lap: t.lap,
      gap: t.gap,
      retired: t.retired,
      inPit: t.inPit,
      pitCount: t.pitCount || 0,
      lastPitLap: t.lastPitLap || 0,
    }))
    .filter(g => g.abbr && g.pos > 0 && g.pos < 99)
    .sort((a, b) => a.pos - b.pos);

  if (!grid.length) {
    dbg('No grid data to flush');
    return;
  }

  // Map our session type to PWA's session_name format.
  // Check BOTH the session name and type — F1 sometimes sends Type='Qualifying' for sprint quali.
  const sn = (state.session.name || '').toLowerCase();
  const st = (state.session.type || '').toLowerCase();
  const combined = (sn + ' ' + st);
  let sessionName = 'Race';
  if (combined.includes('practice')) sessionName = state.session.name;     // "Practice 1/2/3"
  else if (combined.includes('sprint') && (combined.includes('quali') || combined.includes('shoot'))) sessionName = 'Sprint Qualifying';
  else if (combined.includes('sprint')) sessionName = 'Sprint';
  else if (combined.includes('quali')) sessionName = 'Qualifying';
  else sessionName = 'Race';

  const body = {
    circuit_id:   state.session.circuitId,
    round:        state.session.round ? Number(state.session.round) : null,
    year:         state.session.year,
    session_name: sessionName,
    // grid_data carries pit telemetry too (extra keys are ignored by older readers).
    // total laps is stashed on each row to avoid needing a new DB column.
    grid_data:    grid.map(g => ({
      pos: g.pos, abbr: g.abbr,
      lap: g.lap, inPit: g.inPit, pitCount: g.pitCount, lastPitLap: g.lastPitLap,
      totalLaps: state.session.totalLaps || null,
    })),
    source:       'f1-signalr-live',
    fetched_at:   new Date().toISOString(),
  };

  try {
    // Saved through the site's validated endpoint (upserts on circuit+round+year+session).
    const r = await fetch(`${SITE_URL}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-key': BRIDGE_KEY },
      body: JSON.stringify({ type: 'session', row: body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const txt = await r.text();
      log('❌ Save failed:', r.status, txt.slice(0, 200));
    } else {
      log('✅ Flushed', grid.length, 'positions →', sessionName,
        '· Leader:', grid[0]?.abbr, 'lap', grid[0]?.lap);
      maybeTriggerNewsletter(grid);
    }
  } catch (e) {
    log('❌ Save error:', e.message);
  }
}

// ─── Local HTTP server — lets the PWA fetch positions directly from localhost ─
// This skips the Supabase round-trip when the PWA is on the same machine as
// the bridge. CORS is fully open since this only listens on localhost.
let _localServerStarted = false;
function startLocalServer() {
  if (_localServerStarted) return; // start once — survives reconnect/retry loops
  _localServerStarted = true;
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.url === '/positions') {
      const grid = Object.entries(state.timing)
        .map(([num, t]) => ({
          pos: t.position,
          abbr: state.drivers[num]?.tla || '',
          name: state.drivers[num]?.name || '',
          team: state.drivers[num]?.team || '',
          lap: t.lap,
          gap: t.gap,
          retired: t.retired,
          inPit: t.inPit,
        }))
        .filter(g => g.abbr && g.pos > 0 && g.pos < 99)
        .sort((a, b) => a.pos - b.pos);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        session: state.session,
        grid,
        driverCount: Object.keys(state.drivers).length,
        timingCount: Object.keys(state.timing).length,
        timestamp: new Date().toISOString(),
        source: 'live-bridge-local',
      }));
    } else if (req.url === '/' || req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        bridge: 'f1-live-bridge',
        connected: !!state.session,
        session: state.session?.meetingName || null,
      }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found', try: '/positions' }));
    }
  });
  server.listen(LOCAL_HTTP_PORT, '127.0.0.1', () => {
    log(`🌐 Local API: http://localhost:${LOCAL_HTTP_PORT}/positions`);
  });
  server.on('error', e => {
    // EADDRINUSE just means the server is already running from a prior start —
    // not fatal, the existing one keeps serving. Only warn for other errors.
    if (e.code !== 'EADDRINUSE') log('⚠️  Local server error:', e.message);
  });
}

// ─── Main: connect and process messages ─────────────────────────────────
async function main() {
  log('🏎  F1 Live Bridge starting…');
  log('   Flush interval:', FLUSH_INTERVAL_MS, 'ms');
  log('   Target:', `${SITE_URL}/api/save`);
  startLocalServer();
  await refreshCalendar();

  const { connectionToken, cookie } = await negotiate();
  const ws = connect(connectionToken, cookie);

  ws.on('open', () => {
    log('✅ WebSocket connected');
    // SignalR Core handshake — declare the JSON protocol (terminated by 0x1e)
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
    // Subscribe shortly after, once the handshake ack is processed
    setTimeout(() => {
      ws.send(JSON.stringify({
        arguments: [SUB_FEEDS],
        invocationId: '0',
        target: 'Subscribe',
        type: 1,
      }) + RS);
      log('📨 Subscribed to:', SUB_FEEDS.join(', '));
    }, 500);
  });

  // Process one decoded SignalR Core message object.
  const handleCoreMsg = (m) => {
    // type 3 = completion (the subscription SNAPSHOT — all feeds at once)
    if (m.type === 3 && m.result) {
      log('📦 Initial snapshot received');
      Object.entries(m.result).forEach(([feed, data]) => {
        if (feed.endsWith('.z') && typeof data === 'string') mergeFeed(feed.slice(0, -2), decompressZ(data));
        else mergeFeed(feed, data);
      });
    }
    // type 1 = invocation (live "feed" DELTAS during the session)
    if (m.type === 1 && m.target === 'feed' && Array.isArray(m.arguments)) {
      const [feedName, payload] = m.arguments;
      if (!feedName) return;
      if (feedName.endsWith('.z') && typeof payload === 'string') mergeFeed(feedName.slice(0, -2), decompressZ(payload));
      else mergeFeed(feedName, payload);
    }
    // type 6 = keepalive ping from server — reply with a ping to stay alive
    if (m.type === 6) {
      try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch (e) {}
    }
  };

  ws.on('message', (raw) => {
    // SignalR Core frames multiple JSON objects separated by 0x1e
    raw.toString().split(RS).filter(Boolean).forEach((part) => {
      let m;
      try { m = JSON.parse(part); } catch (e) { return; }
      try { handleCoreMsg(m); } catch (e) { dbg('handleCoreMsg error:', e.message); }
    });
  });

  ws.on('close', (code, reason) => {
    log('🔌 WebSocket closed:', code, reason?.toString());
    log('   Reconnecting in 5 seconds…');
    setTimeout(main, 5000);
  });

  ws.on('error', (err) => {
    log('⚠️  WebSocket error:', err.message);
  });

  // Heartbeat ping every 10s to keep connection alive (SignalR Core expects
  // frequent keepalives). Clear any prior heartbeat so reconnects don't stack.
  if (state.heartbeat) clearInterval(state.heartbeat);
  state.heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch (e) {}
    }
  }, 10000);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  console.error('   Retrying in 10 seconds…');
  setTimeout(() => main().catch(e => console.error(e)), 10000);
});

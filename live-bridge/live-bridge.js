// ═══════════════════════════════════════════════════════════════════════
//   F1 LIVE BRIDGE
//   Connects to formula1.com's official SignalR live-timing feed,
//   parses positions in real-time, and writes them to your Supabase
//   `sessions` table. The PWA reads from Supabase and shows live data.
//
//   Usage:  node live-bridge.js
//   Setup:  copy .env.example → .env, fill in SUPABASE_URL + SUPABASE_KEY
// ═══════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import zlib from 'node:zlib';
import http from 'node:http';
import dotenv from 'dotenv';
dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  FLUSH_INTERVAL_MS = 5000,
  LOCAL_HTTP_PORT = 3001,
  NEWSLETTER_TRIGGER_URL,
  NEWSLETTER_TRIGGER_KEY,
  DEBUG = 'false',
} = process.env;

const debug = DEBUG === 'true';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dbg = (...a) => { if (debug) log('🔍', ...a); };

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  console.error('   Copy .env.example → .env and fill in your credentials.');
  process.exit(1);
}

// ─── F1 SignalR endpoints ───────────────────────────────────────────────
const F1_BASE      = 'https://livetiming.formula1.com/signalr';
const F1_WS_BASE   = 'wss://livetiming.formula1.com/signalr';
const HUB          = '[{"name":"Streaming"}]';
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
  'Marina Bay': 'marina_bay', 'Singapore': 'marina_bay',
  'Austin': 'americas', 'Mexico City': 'rodriguez',
  'São Paulo': 'interlagos', 'Sao Paulo': 'interlagos',
  'Las Vegas': 'las_vegas', 'Lusail': 'losail', 'Yas Marina': 'yas_marina',
};

// 2026 F1 calendar — circuit_id → round number (must match PWA's BASE_UPCOMING.round)
const CIRCUIT_TO_ROUND_2026 = {
  albert_park:1, shanghai:2, suzuka:3, miami:4,
  villeneuve:5, monaco:6, catalunya:7, red_bull_ring:8, silverstone:9,
  spa:10, hungaroring:11, zandvoort:12, monza:13, ifema_madrid:14,
  baku:15, marina_bay:16, americas:17, rodriguez:18, interlagos:19,
  las_vegas:20, losail:21, yas_marina:22,
};

// ─── Step 1: SignalR Negotiate ──────────────────────────────────────────
async function negotiate() {
  const url = `${F1_BASE}/negotiate?connectionData=${encodeURIComponent(HUB)}&clientProtocol=1.5`;
  log('📡 Negotiating with F1 SignalR...');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Negotiate failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  dbg('Negotiate response:', data);
  return {
    connectionToken: data.ConnectionToken,
    cookie: res.headers.get('set-cookie') || '',
  };
}

// ─── Step 2: Connect via WebSocket ──────────────────────────────────────
function connect(token, cookie) {
  const wsUrl = `${F1_WS_BASE}/connect?transport=webSockets&clientProtocol=1.5` +
    `&connectionToken=${encodeURIComponent(token)}` +
    `&connectionData=${encodeURIComponent(HUB)}`;
  log('🔌 Opening WebSocket...');
  const ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'Cookie': cookie,
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
    // Use our hardcoded calendar round, NOT F1's internal Meeting.Key (which is a different ID)
    const round = CIRCUIT_TO_ROUND_2026[circuitId] || null;
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
    // PostgREST UPSERT requires on_conflict in the URL + Prefer: resolution=merge-duplicates
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?on_conflict=circuit_id,round,year,session_name`, {
      method: 'POST',
      headers: {
        'apikey':         SUPABASE_KEY,
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'Content-Type':   'application/json',
        'Prefer':         'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text();
      log('❌ Supabase write failed:', r.status, txt.slice(0, 200));
    } else {
      log('✅ Flushed', grid.length, 'positions →', sessionName,
        '· Leader:', grid[0]?.abbr, 'lap', grid[0]?.lap);
      maybeTriggerNewsletter(grid);
    }
  } catch (e) {
    log('❌ Supabase fetch error:', e.message);
  }
}

// ─── Local HTTP server — lets the PWA fetch positions directly from localhost ─
// This skips the Supabase round-trip when the PWA is on the same machine as
// the bridge. CORS is fully open since this only listens on localhost.
function startLocalServer() {
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
  server.on('error', e => log('⚠️  Local server error:', e.message));
}

// ─── Main: connect and process messages ─────────────────────────────────
async function main() {
  log('🏎  F1 Live Bridge starting…');
  log('   Flush interval:', FLUSH_INTERVAL_MS, 'ms');
  log('   Target:', SUPABASE_URL);
  startLocalServer();

  const { connectionToken, cookie } = await negotiate();
  const ws = connect(connectionToken, cookie);

  ws.on('open', () => {
    log('✅ WebSocket connected');
    // Subscribe to feeds
    ws.send(JSON.stringify({
      H: 'Streaming',
      M: 'Subscribe',
      A: [SUB_FEEDS],
      I: 1,
    }));
    log('📨 Subscribed to:', SUB_FEEDS.join(', '));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    // "R" = initial state dump (all current values)
    if (msg.R) {
      log('📦 Initial state received');
      Object.entries(msg.R).forEach(([feed, data]) => {
        if (feed.endsWith('.z') && typeof data === 'string') {
          mergeFeed(feed.slice(0, -2), decompressZ(data));
        } else {
          mergeFeed(feed, data);
        }
      });
    }

    // "M" = incremental updates (array of {H, M, A})
    if (Array.isArray(msg.M)) {
      msg.M.forEach(m => {
        if (m.M !== 'feed') return;
        const [feedName, payload] = m.A || [];
        if (!feedName) return;
        if (feedName.endsWith('.z') && typeof payload === 'string') {
          mergeFeed(feedName.slice(0, -2), decompressZ(payload));
        } else {
          mergeFeed(feedName, payload);
        }
      });
    }
  });

  ws.on('close', (code, reason) => {
    log('🔌 WebSocket closed:', code, reason?.toString());
    log('   Reconnecting in 5 seconds…');
    setTimeout(main, 5000);
  });

  ws.on('error', (err) => {
    log('⚠️  WebSocket error:', err.message);
  });

  // Heartbeat ping every 30s to keep connection alive
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30000);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  console.error('   Retrying in 10 seconds…');
  setTimeout(() => main().catch(e => console.error(e)), 10000);
});

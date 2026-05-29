/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
import webpush from 'web-push';

/* ───────── 2026 RACE SCHEDULE ─────────
   Synced with frontend BASE_UPCOMING — includes
   circuit_id, round, circuit name (for prediction prompts),
   sprint flag, and UTC session times.
*/
const RACES = [
  // Sprint weekend
  { round:5, circuitId:'villeneuve', name:'Canadian Grand Prix',
    circuit:'Circuit Gilles Villeneuve', type:'semi-street', sprint:true,
    date:'2026-05-24', qualiDate:'2026-05-23',
    raceUTC:'18:00', qualiUTC:'20:00', lat:45.5048, lon:-73.5224,
    sprintQualiDate:'2026-05-22', sprintQualiUTC:'20:30',
    sprintDate:'2026-05-23', sprintUTC:'16:00' },
  { round:6, circuitId:'monaco', name:'Monaco Grand Prix',
    circuit:'Circuit de Monaco', type:'street',
    date:'2026-06-07', qualiDate:'2026-06-06',
    raceUTC:'13:00', qualiUTC:'14:00', lat:43.7347, lon:7.4206 },
  { round:7, circuitId:'catalunya', name:'Spanish Grand Prix',
    circuit:'Circuit de Barcelona-Catalunya', type:'balanced',
    date:'2026-06-14', qualiDate:'2026-06-13',
    raceUTC:'13:00', qualiUTC:'14:00', lat:41.5699, lon:2.2611 },
  { round:8, circuitId:'red_bull_ring', name:'Austrian Grand Prix',
    circuit:'Red Bull Ring', type:'power',
    date:'2026-06-28', qualiDate:'2026-06-27',
    raceUTC:'13:00', qualiUTC:'14:00', lat:47.2197, lon:14.7647 },
  // Sprint weekend
  { round:9, circuitId:'silverstone', name:'British Grand Prix',
    circuit:'Silverstone Circuit', type:'balanced', sprint:true,
    date:'2026-07-05', qualiDate:'2026-07-04',
    raceUTC:'14:00', qualiUTC:'14:00', lat:52.0786, lon:-1.0169,
    sprintQualiDate:'2026-07-03', sprintQualiUTC:'15:30',
    sprintDate:'2026-07-04', sprintUTC:'10:00' },
  { round:10, circuitId:'spa', name:'Belgian Grand Prix',
    circuit:'Circuit de Spa-Francorchamps', type:'power',
    date:'2026-07-19', qualiDate:'2026-07-18',
    raceUTC:'13:00', qualiUTC:'14:00', lat:50.4372, lon:5.9714 },
  { round:11, circuitId:'hungaroring', name:'Hungarian Grand Prix',
    circuit:'Hungaroring', type:'technical',
    date:'2026-07-26', qualiDate:'2026-07-25',
    raceUTC:'13:00', qualiUTC:'14:00', lat:47.5789, lon:19.2486 },
  // Sprint weekend
  { round:12, circuitId:'zandvoort', name:'Dutch Grand Prix',
    circuit:'Circuit Zandvoort', type:'technical', sprint:true,
    date:'2026-08-23', qualiDate:'2026-08-22',
    raceUTC:'13:00', qualiUTC:'13:00', lat:52.3888, lon:4.5409,
    sprintQualiDate:'2026-08-21', sprintQualiUTC:'14:30',
    sprintDate:'2026-08-22', sprintUTC:'10:00' },
  { round:13, circuitId:'monza', name:'Italian Grand Prix',
    circuit:'Autodromo Nazionale Monza', type:'power',
    date:'2026-09-06', qualiDate:'2026-09-05',
    raceUTC:'13:00', qualiUTC:'14:00', lat:45.6156, lon:9.2811 },
  { round:14, circuitId:'ifema_madrid', name:'Madrid Grand Prix',
    circuit:'IFEMA Madrid Street Circuit', type:'street',
    date:'2026-09-13', qualiDate:'2026-09-12',
    raceUTC:'13:00', qualiUTC:'14:00', lat:40.4641, lon:-3.6166 },
  { round:15, circuitId:'baku', name:'Azerbaijan Grand Prix',
    circuit:'Baku City Circuit', type:'street',
    date:'2026-09-26', qualiDate:'2026-09-25',
    raceUTC:'11:00', qualiUTC:'12:00', lat:40.3724, lon:49.8533 },
  // Sprint weekend
  { round:16, circuitId:'marina_bay', name:'Singapore Grand Prix',
    circuit:'Marina Bay Street Circuit', type:'street', sprint:true,
    date:'2026-10-11', qualiDate:'2026-10-10',
    raceUTC:'12:00', qualiUTC:'13:00', lat:1.2914, lon:103.8640,
    sprintQualiDate:'2026-10-09', sprintQualiUTC:'12:00',
    sprintDate:'2026-10-10', sprintUTC:'12:00' },
  { round:17, circuitId:'americas', name:'United States Grand Prix',
    circuit:'Circuit of the Americas', type:'balanced',
    date:'2026-10-25', qualiDate:'2026-10-24',
    raceUTC:'19:00', qualiUTC:'22:00', lat:30.1328, lon:-97.6411 },
  { round:18, circuitId:'rodriguez', name:'Mexico City Grand Prix',
    circuit:'Autodromo Hermanos Rodriguez', type:'technical',
    date:'2026-11-01', qualiDate:'2026-10-31',
    raceUTC:'20:00', qualiUTC:'21:00', lat:19.4042, lon:-99.0907 },
  { round:19, circuitId:'interlagos', name:'São Paulo Grand Prix',
    circuit:'Autodromo Jose Carlos Pace', type:'balanced',
    date:'2026-11-08', qualiDate:'2026-11-07',
    raceUTC:'17:00', qualiUTC:'18:00', lat:-23.7036, lon:-46.6997 },
  { round:20, circuitId:'las_vegas', name:'Las Vegas Grand Prix',
    circuit:'Las Vegas Strip Circuit', type:'power',
    date:'2026-11-21', qualiDate:'2026-11-20',
    raceUTC:'06:00', qualiUTC:'06:00', lat:36.1699, lon:-115.1398 },
  { round:21, circuitId:'losail', name:'Qatar Grand Prix',
    circuit:'Lusail International Circuit', type:'power',
    date:'2026-11-29', qualiDate:'2026-11-28',
    raceUTC:'17:00', qualiUTC:'18:00', lat:25.4900, lon:51.4542 },
  { round:22, circuitId:'yas_marina', name:'Abu Dhabi Grand Prix',
    circuit:'Yas Marina Circuit', type:'technical',
    date:'2026-12-06', qualiDate:'2026-12-05',
    raceUTC:'13:00', qualiUTC:'14:00', lat:24.4672, lon:54.6031 },
];

// Map our circuitId → OpenF1 location city name
const OF1_LOC = {
  villeneuve:'Montreal', monaco:'Monaco', catalunya:'Barcelona', red_bull_ring:'Spielberg',
  silverstone:'Silverstone', spa:'Spa-Francorchamps', hungaroring:'Budapest', zandvoort:'Zandvoort',
  monza:'Monza', ifema_madrid:'Madrid', baku:'Baku', marina_bay:'Singapore',
  americas:'Austin', rodriguez:'Mexico City', interlagos:'São Paulo', las_vegas:'Las Vegas',
  losail:'Lusail', yas_marina:'Abu Dhabi',
};

// Current driver standings + team mapping (kept in sync with frontend BASE_DRIVERS)
const DRIVERS = [
  {id:'antonelli',name:'Andrea Kimi Antonelli',abbr:'ANT',team:'Mercedes',pts:100},
  {id:'russell',name:'George Russell',abbr:'RUS',team:'Mercedes',pts:80},
  {id:'leclerc',name:'Charles Leclerc',abbr:'LEC',team:'Ferrari',pts:59},
  {id:'norris',name:'Lando Norris',abbr:'NOR',team:'McLaren',pts:51},
  {id:'hamilton',name:'Lewis Hamilton',abbr:'HAM',team:'Ferrari',pts:51},
  {id:'piastri',name:'Oscar Piastri',abbr:'PIA',team:'McLaren',pts:43},
  {id:'max_verstappen',name:'Max Verstappen',abbr:'VER',team:'Red Bull',pts:26},
  {id:'bearman',name:'Oliver Bearman',abbr:'BEA',team:'Haas',pts:17},
  {id:'gasly',name:'Pierre Gasly',abbr:'GAS',team:'Alpine',pts:16},
  {id:'lawson',name:'Liam Lawson',abbr:'LAW',team:'Racing Bulls',pts:10},
  {id:'colapinto',name:'Franco Colapinto',abbr:'COL',team:'Alpine',pts:7},
  {id:'lindblad',name:'Arvid Lindblad',abbr:'LIN',team:'Racing Bulls',pts:4},
  {id:'hadjar',name:'Isack Hadjar',abbr:'HAD',team:'Red Bull',pts:4},
  {id:'sainz',name:'Carlos Sainz',abbr:'SAI',team:'Williams',pts:4},
  {id:'bortoleto',name:'Gabriel Bortoleto',abbr:'BOR',team:'Audi',pts:2},
  {id:'ocon',name:'Esteban Ocon',abbr:'OCO',team:'Haas',pts:1},
  {id:'albon',name:'Alex Albon',abbr:'ALB',team:'Williams',pts:1},
  {id:'hulkenberg',name:'Nico Hülkenberg',abbr:'HUL',team:'Audi',pts:0},
  {id:'bottas',name:'Valtteri Bottas',abbr:'BOT',team:'Cadillac',pts:0},
  {id:'perez',name:'Sergio Pérez',abbr:'PER',team:'Cadillac',pts:0},
  {id:'alonso',name:'Fernando Alonso',abbr:'ALO',team:'Aston Martin',pts:0},
  {id:'stroll',name:'Lance Stroll',abbr:'STR',team:'Aston Martin',pts:0},
];

function todayUTC() { return new Date().toISOString().slice(0,10); }
function hourUTC()  { return new Date().getUTCHours(); }

function offsetDate(base, days) {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

/* ───────── Open-Meteo rain forecast ───────── */
async function getRainForecast(lat, lon, raceDate) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=precipitation_probability_max,weathercode&forecast_days=14&timezone=UTC`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const idx = data.daily?.time?.indexOf(raceDate);
    if (idx == null || idx === -1) return null;
    return { rainPct: data.daily.precipitation_probability_max[idx], code: data.daily.weathercode[idx] };
  } catch { return null; }
}

/* ───────── OpenF1: live race + recent practice ───────── */
async function getLiveRaceSession() {
  try {
    const r = await fetch('https://api.openf1.org/v1/sessions?session_type=Race&year=2026',
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const sessions = await r.json();
    if (!Array.isArray(sessions)) return null;
    const now = Date.now();
    return sessions.find(s => {
      const start = s.date_start ? new Date(s.date_start).getTime() : null;
      const end   = s.date_end   ? new Date(s.date_end).getTime()   : null;
      return start && start <= now && (!end || end >= now - 600000);
    }) || null;
  } catch { return null; }
}
async function getRecentPracticeSession() {
  try {
    const r = await fetch('https://api.openf1.org/v1/sessions?session_type=Practice&year=2026',
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const sessions = await r.json();
    if (!Array.isArray(sessions)) return null;
    const now = Date.now();
    return sessions.find(s => {
      if (!s.date_end) return false;
      const end = new Date(s.date_end).getTime();
      return end <= now && end >= now - 3 * 3600 * 1000;
    }) || null;
  } catch { return null; }
}

/* ───────── OpenF1: fetch session grid (for stage detection & prompt) ───────── */
async function fetchOf1Grid(race) {
  try {
    const loc = OF1_LOC[race.circuitId];
    if (!loc) return { sqGrid:[], qGrid:[], sprintDone:false, qDone:false, sqDone:false };
    const mr = await fetch(`https://api.openf1.org/v1/meetings?year=2026&location=${encodeURIComponent(loc)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!mr.ok) return { sqGrid:[], qGrid:[], sprintDone:false, qDone:false, sqDone:false };
    const meetings = await mr.json();
    const meeting = meetings?.[0];
    if (!meeting) return { sqGrid:[], qGrid:[], sprintDone:false, qDone:false, sqDone:false };

    const sr = await fetch(`https://api.openf1.org/v1/sessions?meeting_key=${meeting.meeting_key}&year=2026`,
      { signal: AbortSignal.timeout(8000) });
    const sessions = sr.ok ? await sr.json() : [];

    const now = Date.now();
    // Strict: a session is "done" ONLY when its date_end is in the past.
    // (Don't infer doneness from grid existence — OpenF1 sometimes publishes
    // preliminary positions before sessions officially end.)
    // Fallback: if no date_end but date_start was >3h ago, treat as done.
    const isDone = s => {
      if (!s) return false;
      if (s.date_end) return new Date(s.date_end).getTime() < now;
      if (s.date_start) return now - new Date(s.date_start).getTime() > 3 * 3600 * 1000;
      return false;
    };
    const sqSess = sessions.find(s => /sprint.*qual|sprint shootout/i.test(s.session_name||''));
    const qSess  = sessions.find(s => s.session_name==='Qualifying' || s.session_type==='Qualifying');
    const spSess = sessions.find(s => {
      const n = (s.session_name||'').toLowerCase();
      return n.includes('sprint') && !n.includes('quali') && !n.includes('shoot');
    });

    const sqGrid = (sqSess && isDone(sqSess)) ? await fetchGridForSession(sqSess.session_key, meeting.meeting_key) : [];
    const qGrid  = (qSess  && isDone(qSess))  ? await fetchGridForSession(qSess.session_key,  meeting.meeting_key) : [];

    return {
      sqGrid, qGrid,
      sqDone:     !!sqSess && isDone(sqSess),
      sprintDone: !!spSess && isDone(spSess),
      qDone:      !!qSess  && isDone(qSess),
    };
  } catch (e) {
    console.warn('[OpenF1 grid]', e.message);
    return { sqGrid:[], qGrid:[], sprintDone:false, qDone:false, sqDone:false };
  }
}
async function fetchGridForSession(sessionKey, meetingKey) {
  try {
    const [pr, dr] = await Promise.all([
      fetch(`https://api.openf1.org/v1/position?session_key=${sessionKey}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : []),
      fetch(`https://api.openf1.org/v1/drivers?session_key=${sessionKey}&meeting_key=${meetingKey}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : []),
    ]);
    const num2abbr = {};
    (dr||[]).forEach(d => { num2abbr[d.driver_number] = (d.name_acronym||'').toUpperCase(); });
    const latest = {};
    (pr||[]).forEach(p => { if (!latest[p.driver_number] || p.date > latest[p.driver_number].date) latest[p.driver_number] = p; });
    return Object.values(latest).sort((a,b) => a.position - b.position)
      .map(p => ({ abbr: num2abbr[p.driver_number] || String(p.driver_number), pos: p.position }));
  } catch { return []; }
}

/* ───────── Stage detection ─────────
   Pure schedule-based — doesn't depend on OpenF1 working.
   Looks at race's own session-time fields and compares against `now`. */
function sessionEndedMs(date, time, durMin) {
  if (!date || !time) return Infinity;
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCHours(h, (m || 0) + durMin, 0, 0);
  return d.getTime();
}
function getStage(race) {
  const now = Date.now();
  const isSprint = race.sprint === true;
  const sqEndMs     = sessionEndedMs(race.sprintQualiDate, race.sprintQualiUTC, 45);
  const sprintEndMs = sessionEndedMs(race.sprintDate,      race.sprintUTC,      60);
  const qEndMs      = sessionEndedMs(race.qualiDate,       race.qualiUTC,       60);
  const raceEndMs   = sessionEndedMs(race.date,            race.raceUTC,       120);

  if (now >= raceEndMs) return 'final';
  if (isSprint) {
    if (now >= qEndMs)      return 'afterQuali';
    if (now >= sprintEndMs) return 'afterSprint';
    if (now >= sqEndMs)     return 'afterSprintQ';
    return 'beforeSprintQ';
  }
  if (now >= qEndMs) return 'afterQuali';
  return 'beforeQuali';
}

/* ───────── PROMPT BUILDER (server-side, simpler than frontend) ───────── */
function buildPrompt(race, stage, predType, sqGrid, qGrid) {
  const isSprint = predType === 'sprint';
  const standings = DRIVERS.slice(0, 22).map((d,i) =>
    `${i+1}. ${d.name} (${d.abbr}) — ${d.team} — ${d.pts}pts`
  ).join('\n');

  let gridStr = '';
  if (isSprint && sqGrid.length) {
    gridStr = '\nSPRINT QUALIFYING GRID (this IS the sprint starting grid — weight 60%+):\n' +
      sqGrid.slice(0, 20).map(g => `P${g.pos}: ${g.abbr}`).join('\n');
  } else if (!isSprint && qGrid.length) {
    gridStr = '\nQUALIFYING GRID (final race starting grid — weight heavily, pole sitter wins ~40% of races):\n' +
      qGrid.slice(0, 20).map(g => `P${g.pos}: ${g.abbr}`).join('\n');
  } else if (!isSprint && sqGrid.length && stage === 'afterSprintQ') {
    gridStr = '\nSPRINT QUALIFYING GRID (qualifying for the main race has NOT happened yet — use this as a strong indicator):\n' +
      sqGrid.slice(0, 20).map(g => `P${g.pos}: ${g.abbr}`).join('\n');
  }

  return `You are an expert F1 race analyst. Predict the top 10 finishing order for the ${isSprint ? 'SPRINT RACE' : 'GRAND PRIX'} at ${race.name} (${race.circuit}, Round ${race.round}).

Current championship standings (after Miami GP):
${standings}

Stage of weekend: ${stage}${gridStr}

Circuit type: ${race.type}

Respond ONLY with valid JSON, no markdown:
{"top10":[{"pos":1,"driverId":"<id from standings>","name":"Full Name","abbr":"ABB","team":"Team","winProb":<number 0-100>,"reasoning":"specific short reason"},... 10 entries total],"overallAnalysis":"3-paragraph analysis: (1) circuit + team fit, (2) drivers to watch, (3) upset risk","keyFactor":"single most important factor","upsetAlert":"one driver who could outperform expectations and why"}`;
}

/* ───────── Call OpenRouter ───────── */
async function callOpenRouter(prompt) {
  const key = process.env.OPENROUTER_KEY;
  if (!key) throw new Error('OPENROUTER_KEY not configured');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://f1-predictor-theta.vercel.app',
      'X-Title': 'F1 Race Predictor (Auto)',
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: 'You are an expert F1 race analyst. Always respond with valid JSON only — no markdown, no preamble.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(28000),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in AI response');
  return JSON.parse(raw.slice(start, end + 1));
}

/* ───────── Supabase helpers ───────── */
async function sbFetch(SB_URL, SB_KEY, path, opts={}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  return r;
}

async function getStoredPrediction(SB_URL, SB_KEY, race, predType, stage) {
  const r = await sbFetch(SB_URL, SB_KEY,
    `predictions?circuit_id=eq.${race.circuitId}&round=eq.${race.round}&pred_type=eq.${predType}&stage=eq.${stage}&limit=1`);
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}

async function savePrediction(SB_URL, SB_KEY, race, prediction, predType, stage) {
  await sbFetch(SB_URL, SB_KEY, 'predictions?on_conflict=circuit_id,round,pred_type,stage', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      race_name: race.name,
      round: Number(race.round),
      circuit_id: race.circuitId,
      race_date: race.date,
      pred_type: predType,
      stage,
      prediction,
      actual_results: null,
      accuracy: null,
    }),
  });
}

/* ───────── Deterministic fallback prediction (no AI required) ─────────
   Used when OpenRouter is unavailable (no credits / network error).
   Orders the top 10 by:
     1. Live qualifying / sprint-quali grid (if OpenF1 returned data)
     2. Falls back to championship standings
   Always produces a valid snapshot so the archive sub-tab unlocks. */
function generateFallbackPrediction(race, stage, predType, sqGrid, qGrid) {
  const isSprintPred = predType === 'sprint';
  const teamSlug = t => (t || '').toLowerCase().replace(/\s+/g, '_');
  let order = [];

  // Prefer grid order if we have it
  const grid = isSprintPred ? sqGrid : (qGrid?.length ? qGrid : sqGrid);
  if (grid?.length) {
    grid.slice(0, 20).forEach(g => {
      const d = DRIVERS.find(x => x.abbr === g.abbr);
      if (d && !order.find(o => o.id === d.id)) order.push(d);
    });
  }
  // Pad with standings order
  DRIVERS.forEach(d => {
    if (order.length < 10 && !order.find(o => o.id === d.id)) order.push(d);
  });
  order = order.slice(0, 10);

  return {
    top10: order.map((d, i) => ({
      pos: i + 1,
      driverId: d.id,
      name: d.name,
      abbr: d.abbr,
      team: teamSlug(d.team),
      winProb: Math.max(2, Math.round(40 - i * 4)),
      reasoning: i === 0
        ? `Top of the championship table — ${d.pts} pts. Baseline pick.`
        : grid?.length
          ? `Grid position ${i+1} — baseline projection.`
          : `Championship standings — ${d.pts} pts.`,
    })),
    overallAnalysis: `Auto-generated baseline prediction for the ${race.name} (${stage}). AI service was unavailable when this snapshot was created, so this ordering uses the live ${grid?.length ? 'qualifying grid' : 'championship standings'} as the primary signal. Open the app and hit "Force Regenerate" once OpenRouter is funded to get the full AI analysis.`,
    keyFactor: grid?.length ? 'Grid position' : 'Championship standings',
    upsetAlert: 'No upsets projected — this is a deterministic baseline. Use Force Regenerate for AI insight.',
    _fallback: true,
  };
}

/* ───────── Auto-generate prediction for a (race, stage, type) if missing ───────── */
async function ensurePrediction(SB_URL, SB_KEY, race, stage, predType, sqGrid, qGrid) {
  const existing = await getStoredPrediction(SB_URL, SB_KEY, race, predType, stage);
  if (existing) return { generated: false, prediction: existing.prediction };
  try {
    const prompt = buildPrompt(race, stage, predType, sqGrid, qGrid);
    const prediction = await callOpenRouter(prompt);
    if (!prediction?.top10?.length) throw new Error('Empty prediction returned');
    await savePrediction(SB_URL, SB_KEY, race, prediction, predType, stage);
    return { generated: true, prediction, ai: true };
  } catch (e) {
    // AI failed — save a deterministic fallback so the sub-tab still unlocks
    console.warn(`[fallback ${race.name}/${stage}/${predType}]`, e.message);
    try {
      const fallback = generateFallbackPrediction(race, stage, predType, sqGrid, qGrid);
      await savePrediction(SB_URL, SB_KEY, race, fallback, predType, stage);
      return { generated: true, prediction: fallback, fallback: true };
    } catch (e2) {
      console.warn(`[fallback-save ${race.name}/${stage}/${predType}]`, e2.message);
      return { generated: false, error: e2.message };
    }
  }
}

/* ───────── Main handler ───────── */
export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SB_URL     = process.env.SB_URL;
  const SB_SERVICE = process.env.SB_SERVICE_KEY;
  const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
  if (!SB_URL || !SB_SERVICE || !VAPID_PUB || !VAPID_PRIV)
    return res.status(500).json({ error: 'Misconfigured' });

  webpush.setVapidDetails('mailto:ahmoudy365@gmail.com', VAPID_PUB, VAPID_PRIV);

  const today = todayUTC();
  const hour  = hourUTC();
  const notifications = [];
  const autoGenLog = [];

  const [liveRaceSession, recentPractice] = await Promise.all([
    getLiveRaceSession(),
    getRecentPracticeSession(),
  ]);

  for (const race of RACES) {
    const raceH  = parseInt(race.raceUTC);
    const qualiH = parseInt(race.qualiUTC);

    // ── EXISTING TIME-BASED PUSH NOTIFICATIONS ──
    const friday = offsetDate(race.date, -2);
    if (today === friday && hour >= 7 && hour <= 13) {
      notifications.push({ type:'raceWeekend', payload:{
        title:`🏁 ${race.name} Weekend`,
        body:'Race weekend starts today — generate your AI prediction now!',
        url:'/' }});
    }

    const thursday = offsetDate(race.date, -3);
    if (today === thursday && hour >= 9 && hour <= 12) {
      const wx = await getRainForecast(race.lat, race.lon, race.date);
      if (wx && wx.rainPct >= 50) {
        notifications.push({ type:'rainAlert', payload:{
          title:`🌧 Rain forecast — ${race.name}`,
          body:`${wx.rainPct}% rain chance on Sunday. Strategy chaos incoming!`,
          url:'/' }});
      }
    }

    if (race.sprintQualiDate && today === race.sprintQualiDate) {
      const sqH = parseInt(race.sprintQualiUTC);
      if (hour >= sqH + 1 && hour <= sqH + 5) {
        notifications.push({ type:'sprint', payload:{
          title:`⚡ Sprint grid set — ${race.name}`,
          body:'Sprint qualifying done — sprint race tomorrow. Update your prediction!',
          url:'/' }});
      }
    }

    if (today === race.qualiDate && hour >= qualiH - 1 && hour <= qualiH + 4) {
      notifications.push({ type:'qualifying', payload:{
        title:`📋 Qualifying done — ${race.name}`,
        body:'Grid is set. Generate your final race prediction now!',
        url:'/' }});
    }

    if (today === race.date && hour >= raceH - 3 && hour <= raceH - 1) {
      const hoursLeft = raceH - hour;
      notifications.push({ type:'countdown', payload:{
        title:`⏱ ${race.name} in ~${hoursLeft}h`,
        body:`Lights out at ~${race.raceUTC} UTC. Don't miss it — check your prediction!`,
        url:'/' }});
    }

    if (liveRaceSession && today === race.date) {
      notifications.push({ type:'liveLights', payload:{
        title:`🔴 ${race.name} is LIVE`,
        body:'The race has started! Follow along live.', url:'/' }});
    }

    if (today === race.date && hour >= raceH + 2 && hour <= raceH + 8) {
      notifications.push({ type:'results', payload:{
        title:`🏆 ${race.name} — Results ready`,
        body:'Official results are in. See how accurate your AI prediction was!',
        url:'/' }});
    }

    // ── AUTO-GENERATE PREDICTIONS WHEN INSIDE RACE WEEKEND WINDOW ──
    // Window: from Thursday (race-3) through race day, generate any missing stage snapshots.
    const inWindow = today >= offsetDate(race.date, -3) && today <= race.date;
    if (inWindow) {
      const of1 = await fetchOf1Grid(race);
      const stage = getStage(race);

      if (race.sprint) {
        // Sprint weekend: cover beforeSprintQ (race+sprint) and afterSprintQ (race+sprint), afterSprint, afterQuali
        if (stage === 'beforeSprintQ' || stage === 'afterSprintQ' || stage === 'afterSprint' || stage === 'afterQuali') {
          // Generate race prediction for current stage
          const raceRes = await ensurePrediction(SB_URL, SB_SERVICE, race, stage, 'race', of1.sqGrid, of1.qGrid);
          if (raceRes.generated) {
            autoGenLog.push(`${race.name}/${stage}/race`);
            notifications.push({ type:'predictionReady', payload:{
              title:`🤖 AI prediction ready — ${race.name}`,
              body:`Updated race prediction for "${stageLabel(stage)}" is available now.`,
              url:'/' }});
          }
          // Sprint prediction only exists for beforeSprintQ + afterSprintQ
          if (stage === 'beforeSprintQ' || stage === 'afterSprintQ') {
            const sprintRes = await ensurePrediction(SB_URL, SB_SERVICE, race, stage, 'sprint', of1.sqGrid, of1.qGrid);
            if (sprintRes.generated) {
              autoGenLog.push(`${race.name}/${stage}/sprint`);
              notifications.push({ type:'predictionReady', payload:{
                title:`🤖 Sprint prediction ready — ${race.name}`,
                body:`Updated sprint prediction for "${stageLabel(stage)}" is available now.`,
                url:'/' }});
            }
          }
        }
      } else {
        // Normal weekend: beforeQuali + afterQuali (race only)
        if (stage === 'beforeQuali' || stage === 'afterQuali') {
          const raceRes = await ensurePrediction(SB_URL, SB_SERVICE, race, stage, 'race', of1.sqGrid, of1.qGrid);
          if (raceRes.generated) {
            autoGenLog.push(`${race.name}/${stage}/race`);
            notifications.push({ type:'predictionReady', payload:{
              title:`🤖 AI prediction ready — ${race.name}`,
              body:`Updated race prediction for "${stageLabel(stage)}" is available now.`,
              url:'/' }});
          }
        }
      }
    }
  }

  if (recentPractice) {
    notifications.push({ type:'dataFetched', payload:{
      title:`🤖 F1 session data available`,
      body:`${recentPractice.session_name || 'Practice'} data is now on OpenF1 — open the app to auto-load it!`,
      url:'/' }});
  }

  if (!notifications.length && !autoGenLog.length)
    return res.status(200).json({ message:'Nothing to send today', today, hour });

  // ── Fetch all subscribers ──
  const subsR = await sbFetch(SB_URL, SB_SERVICE,
    'push_subscriptions?select=endpoint,p256dh,auth,preferences');
  const subs = subsR.ok ? await subsR.json() : [];
  if (!Array.isArray(subs) || !subs.length)
    return res.status(200).json({ message:'No subscribers', autoGenerated: autoGenLog, types: notifications.map(n=>n.type) });

  // ── Send each notification, respecting per-user preferences ──
  let sent = 0, skipped = 0;
  for (const notif of notifications) {
    for (const sub of subs) {
      const prefs   = sub.preferences || {};
      const enabled = prefs[notif.type] !== false;
      if (!enabled) { skipped++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...notif.payload, icon: '/icons/icon-192.png' })
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410) {
          await sbFetch(SB_URL, SB_SERVICE,
            `push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(()=>{});
        }
      }
    }
  }

  res.status(200).json({
    sent, skipped,
    autoGenerated: autoGenLog,
    types: notifications.map(n => n.type),
    today, hour,
  });
}

function stageLabel(stage) {
  return ({
    beforeSprintQ:'Before Sprint Qualifying',
    afterSprintQ:'After Sprint Qualifying',
    afterSprint:'After Sprint Race',
    beforeQuali:'Before Qualifying',
    afterQuali:'After Qualifying',
    final:'Final',
  })[stage] || stage;
}

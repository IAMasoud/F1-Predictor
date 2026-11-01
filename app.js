/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
/* ── AI Thinking Steps ── */
const AI_STEPS = [
  'Loading race & circuit data',
  'Analysing tyre degradation patterns',
  'Evaluating track history & driver records',
  'Comparing team upgrades & car performance',
  'Calculating win probabilities per driver',
  'Generating prediction & reasoning'
];

/* ── AI proxied via /api/predict (Gemini free tier; key lives server-side) ── */

/* ── Supabase — cloud prediction storage ── */
const SB_URL = 'https://zeqxzyisqwemqsvspbyj.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXh6eWlzcXdlbXFzdnNwYnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODM0MjUsImV4cCI6MjA5MzU1OTQyNX0.uDzYrylvgomvGiSH886LJ2zIO14VZpR-f12vWRzW2M0';
const SB_HEADERS = { 'apikey': SB_KEY, 'Authorization': 'Bearer '+SB_KEY, 'Content-Type': 'application/json' };

// In-memory cache so buildPrompt (sync) can read past predictions
let cachedPredictions = [];
let predictionsLoaded = false;  // true once the first cloud fetch has answered (or failed)

/* Escape text before it goes into innerHTML: data from the database, the AI or
   other sites must never be able to add markup or scripts to the page.
   driverId values end up inside onclick="…('id')" so they're limited to [A-Za-z0-9_]. */
function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escDeep(v, key){
  if(typeof v === 'string') return key === 'driverId' ? (/^[A-Za-z0-9_]+$/.test(v) ? v : '') : esc(v);
  if(Array.isArray(v)) return v.map(x => escDeep(x, key));
  if(v && typeof v === 'object'){ const o = {}; for(const k in v) o[k] = escDeep(v[k], k); return o; }
  return v;
}

/* Reads use the public key (read-only). Everything read is escaped once here. */
async function sbGet(path){
  try{
    const r = await fetch(SB_URL+'/rest/v1/'+path, {headers: SB_HEADERS, signal: AbortSignal.timeout(6000)});
    return r.ok ? escDeep(await r.json()) : [];
  }catch(e){ console.warn('Supabase read:', e.message); return []; }
}
/* Writes go through /api/save, which validates rows and writes with the server key. */
async function saveRow(type, row){
  try{
    const r = await fetch('/api/save', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type, row}), signal:AbortSignal.timeout(8000)});
    if(!r.ok) console.warn('Save failed:', type, r.status, (await r.text().catch(()=>'')).slice(0,120));
    return r.ok;
  }catch(e){ console.warn('Save failed:', type, e.message); return false; }
}
async function refreshPredictionsCache(){
  // Pull up to 200 snapshots — enough to cover full season × stages × race/sprint variants
  // Post-race ('final') snapshots were made after the result was known, so they never count.
  cachedPredictions = (await sbGet('predictions?select=*&stage=neq.final&order=created_at.desc&limit=200')) || [];
  predictionsLoaded = true;
  if(cachedPredictions && cachedPredictions.length > 0){
    if(typeof unlockArchTab === 'function') unlockArchTab();
  }
  if(typeof renderLightsOut === 'function') renderLightsOut();
}
/* ═══════════════════════════════════════════════
   BASELINE DATA — Real 2026 season
   ═══════════════════════════════════════════════ */
/* ── Official 2026 standings verified from F1 app after Round 4 Miami GP ── */
const BASE_DRIVERS = [
  {driverId:'antonelli',      name:'Andrea Kimi Antonelli', abbr:'ANT', team:'mercedes',     pts:100, pos:1},
  {driverId:'russell',        name:'George Russell',         abbr:'RUS', team:'mercedes',     pts:80,  pos:2},
  {driverId:'leclerc',        name:'Charles Leclerc',        abbr:'LEC', team:'ferrari',      pts:59,  pos:3},
  {driverId:'norris',         name:'Lando Norris',           abbr:'NOR', team:'mclaren',      pts:51,  pos:4},
  {driverId:'hamilton',       name:'Lewis Hamilton',         abbr:'HAM', team:'ferrari',      pts:51,  pos:5},
  {driverId:'piastri',        name:'Oscar Piastri',          abbr:'PIA', team:'mclaren',      pts:43,  pos:6},
  {driverId:'max_verstappen', name:'Max Verstappen',         abbr:'VER', team:'red_bull',     pts:26,  pos:7},
  {driverId:'bearman',        name:'Oliver Bearman',         abbr:'BEA', team:'haas',         pts:17,  pos:8},
  {driverId:'gasly',          name:'Pierre Gasly',           abbr:'GAS', team:'alpine',       pts:16,  pos:9},
  {driverId:'lawson',         name:'Liam Lawson',            abbr:'LAW', team:'racing_bulls', pts:10,  pos:10},
  {driverId:'colapinto',      name:'Franco Colapinto',       abbr:'COL', team:'alpine',       pts:7,   pos:11},
  {driverId:'lindblad',       name:'Arvid Lindblad',         abbr:'LIN', team:'racing_bulls', pts:4,   pos:12},
  {driverId:'hadjar',         name:'Isack Hadjar',           abbr:'HAD', team:'red_bull',     pts:4,   pos:13},
  {driverId:'sainz',          name:'Carlos Sainz',           abbr:'SAI', team:'williams',     pts:4,   pos:14},
  {driverId:'bortoleto',      name:'Gabriel Bortoleto',      abbr:'BOR', team:'audi',         pts:2,   pos:15},
  {driverId:'ocon',           name:'Esteban Ocon',           abbr:'OCO', team:'haas',         pts:1,   pos:16},
  {driverId:'albon',          name:'Alex Albon',             abbr:'ALB', team:'williams',     pts:1,   pos:17},
  {driverId:'hulkenberg',     name:'Nico Hülkenberg',        abbr:'HUL', team:'audi',         pts:0,   pos:18},
  {driverId:'bottas',         name:'Valtteri Bottas',        abbr:'BOT', team:'cadillac',     pts:0,   pos:19},
  {driverId:'perez',          name:'Sergio Pérez',           abbr:'PER', team:'cadillac',     pts:0,   pos:20},
  {driverId:'alonso',         name:'Fernando Alonso',        abbr:'ALO', team:'aston_martin', pts:0,   pos:21},
  {driverId:'stroll',         name:'Lance Stroll',           abbr:'STR', team:'aston_martin', pts:0,   pos:22},
];

/* ── Official 2026 constructor standings after Round 4 Miami GP ── */
const BASE_CONSTRUCTORS = [
  {name:'Mercedes',    pts:180},
  {name:'Ferrari',     pts:110},
  {name:'McLaren',     pts:94},
  {name:'Red Bull',    pts:30},
  {name:'Alpine',      pts:23},
  {name:'Haas',        pts:18},
  {name:'Racing Bulls',pts:14},
  {name:'Williams',    pts:5},
  {name:'Audi',        pts:2},
  {name:'Aston Martin',pts:0},
  {name:'Cadillac',    pts:0},
];

/* ── Real 2026 race results (verified from F1.com & official standings)
   NOTE: Bahrain (R4) & Saudi Arabia (R5) were CANCELLED — Miami became Round 4.
   Chinese GP was a sprint weekend. All points verified against official standings. ── */
const BASE_RESULTS = [
  {round:'1',  raceName:'Australian Grand Prix',    circuitId:'albert_park', date:'2026-03-08',
   results:['russell','antonelli','leclerc','hamilton','norris','max_verstappen','bearman','lindblad','bortoleto','gasly']},
  {round:'2S', raceName:'Chinese Grand Prix Sprint', circuitId:'shanghai',    date:'2026-03-14',
   results:['russell','leclerc','hamilton','norris','antonelli','piastri','lawson','bearman','max_verstappen','ocon']},
  {round:'2',  raceName:'Chinese Grand Prix',        circuitId:'shanghai',    date:'2026-03-15',
   results:['antonelli','russell','hamilton','leclerc','bearman','gasly','lawson','hadjar','sainz','colapinto']},
  {round:'3',  raceName:'Japanese Grand Prix',       circuitId:'suzuka',      date:'2026-03-29',
   results:['antonelli','piastri','leclerc','russell','norris','hamilton','gasly','max_verstappen','lawson','ocon']},
  {round:'4S', raceName:'Miami Grand Prix Sprint',   circuitId:'miami',       date:'2026-05-03',
   results:['norris','piastri','leclerc','russell','max_verstappen','antonelli','hamilton','gasly','hadjar','colapinto']},
  {round:'4',  raceName:'Miami Grand Prix',          circuitId:'miami',       date:'2026-05-04',
   results:['antonelli','norris','piastri','russell','max_verstappen','hamilton','colapinto','leclerc','sainz','albon']},
  // Canada Sprint — bridge wasn't running for this session; results verified
  // from the scored sprint prediction's actual_results (Jolpica). Full races
  // from Canada onward are merged from Supabase at load (mergeSupabaseRaceResults).
  {round:'5S', raceName:'Canadian Grand Prix Sprint', circuitId:'villeneuve', date:'2026-05-23',
   results:['russell','norris','antonelli','piastri','leclerc','hamilton','max_verstappen','lindblad','colapinto','sainz']},
];

/* ── The season. SEASON, BASE_UPCOMING, RACE_TIMES, SPRINT_CIRCUITS and OF1_LOC start as the
   2026 values below and are replaced at start-up from the shared /season.js, which reads the
   official schedule — so a new season is picked up without code changes (see initSeason). ── */
let SEASON = 2026;
let SEASON_RACES = {};   // circuitId → the season calendar's race (all session times)

/* ── Full 2026 calendar — 23 races (Saudi Arabia cancelled; Bahrain GP moved to Sepang, Malaysia, Oct 2–4) ── */
const BASE_UPCOMING = [
  {round:5, name:'Canadian Grand Prix',       circuitId:'villeneuve',   country:'Canada',      date:'2026-05-24', circuit:'Circuit Gilles Villeneuve',        type:'semi-street', sprint:true},
  {round:6, name:'Monaco Grand Prix',         circuitId:'monaco',       country:'Monaco',      date:'2026-06-07', circuit:'Circuit de Monaco',                type:'street'},
  {round:7, name:'Barcelona Grand Prix',      circuitId:'catalunya',    country:'Spain',       date:'2026-06-14', circuit:'Circuit de Barcelona-Catalunya',    type:'balanced'},
  {round:8, name:'Austrian Grand Prix',       circuitId:'red_bull_ring',country:'Austria',     date:'2026-06-28', circuit:'Red Bull Ring',                    type:'power'},
  {round:9, name:'British Grand Prix',        circuitId:'silverstone',  country:'UK',          date:'2026-07-05', circuit:'Silverstone Circuit',              type:'balanced', sprint:true},
  {round:10,name:'Belgian Grand Prix',        circuitId:'spa',          country:'Belgium',     date:'2026-07-19', circuit:'Circuit de Spa-Francorchamps',     type:'power'},
  {round:11,name:'Hungarian Grand Prix',      circuitId:'hungaroring',  country:'Hungary',     date:'2026-07-26', circuit:'Hungaroring',                      type:'technical'},
  {round:12,name:'Dutch Grand Prix',          circuitId:'zandvoort',    country:'Netherlands', date:'2026-08-23', circuit:'Circuit Zandvoort',                type:'technical', sprint:true},
  {round:13,name:'Italian Grand Prix',        circuitId:'monza',        country:'Italy',       date:'2026-09-06', circuit:'Autodromo Nazionale Monza',        type:'power'},
  {round:14,name:'Spanish Grand Prix',        circuitId:'ifema_madrid', country:'Spain',       date:'2026-09-13', circuit:'Madring',                          type:'street'},
  {round:15,name:'Azerbaijan Grand Prix',     circuitId:'baku',         country:'Azerbaijan',  date:'2026-09-26', circuit:'Baku City Circuit',                type:'street'},
  {round:16,name:'Bahrain Grand Prix (Malaysia)', circuitId:'sepang',     country:'Malaysia',    date:'2026-10-04', circuit:'Sepang International Circuit',     type:'power'},
  {round:17,name:'Singapore Grand Prix',      circuitId:'marina_bay',   country:'Singapore',   date:'2026-10-11', circuit:'Marina Bay Street Circuit',        type:'street', sprint:true},
  {round:18,name:'United States Grand Prix',  circuitId:'americas',     country:'USA',         date:'2026-10-25', circuit:'Circuit of the Americas',          type:'balanced'},
  {round:19,name:'Mexico City Grand Prix',    circuitId:'rodriguez',    country:'Mexico',      date:'2026-11-01', circuit:'Autodromo Hermanos Rodriguez',      type:'technical'},
  {round:20,name:'São Paulo Grand Prix',      circuitId:'interlagos',   country:'Brazil',      date:'2026-11-08', circuit:'Autodromo Jose Carlos Pace',       type:'balanced'},
  {round:21,name:'Las Vegas Grand Prix',      circuitId:'las_vegas',    country:'USA',         date:'2026-11-22', circuit:'Las Vegas Strip Circuit',          type:'power'},
  {round:22,name:'Qatar Grand Prix',          circuitId:'losail',       country:'Qatar',       date:'2026-11-29', circuit:'Lusail International Circuit',     type:'power'},
  {round:23,name:'Abu Dhabi Grand Prix',      circuitId:'yas_marina',   country:'UAE',         date:'2026-12-06', circuit:'Yas Marina Circuit',               type:'technical'},
];

/* ── 2026 race weekend session schedule (UTC) ──
   The source of truth for "has this session ended?"
   Doesn't depend on OpenF1, the AI, or Supabase. Pure date check. */
const RACE_TIMES = {
  villeneuve:     { raceUTC:'20:00', qualiDate:'2026-05-23', qualiUTC:'20:00',
                    sprintQualiDate:'2026-05-22', sprintQualiUTC:'20:30',
                    sprintDate:'2026-05-23', sprintUTC:'16:00' },
  monaco:         { raceUTC:'13:00', qualiDate:'2026-06-06', qualiUTC:'14:00' },
  catalunya:      { raceUTC:'13:00', qualiDate:'2026-06-13', qualiUTC:'14:00' },
  red_bull_ring:  { raceUTC:'13:00', qualiDate:'2026-06-27', qualiUTC:'14:00' },
  silverstone:    { raceUTC:'14:00', qualiDate:'2026-07-04', qualiUTC:'15:00',
                    sprintQualiDate:'2026-07-03', sprintQualiUTC:'15:30',
                    sprintDate:'2026-07-04', sprintUTC:'11:00' },
  spa:            { raceUTC:'13:00', qualiDate:'2026-07-18', qualiUTC:'14:00' },
  hungaroring:    { raceUTC:'13:00', qualiDate:'2026-07-25', qualiUTC:'14:00' },
  zandvoort:      { raceUTC:'13:00', qualiDate:'2026-08-22', qualiUTC:'14:00',
                    sprintQualiDate:'2026-08-21', sprintQualiUTC:'14:30',
                    sprintDate:'2026-08-22', sprintUTC:'10:00' },
  monza:          { raceUTC:'13:00', qualiDate:'2026-09-05', qualiUTC:'14:00' },
  ifema_madrid:   { raceUTC:'13:00', qualiDate:'2026-09-12', qualiUTC:'14:00' },
  baku:           { raceUTC:'11:00', qualiDate:'2026-09-25', qualiUTC:'12:00' },
  sepang:         { raceUTC:'07:00', qualiDate:'2026-10-03', qualiUTC:'08:00' },
  marina_bay:     { raceUTC:'12:00', qualiDate:'2026-10-10', qualiUTC:'13:00',
                    sprintQualiDate:'2026-10-09', sprintQualiUTC:'12:30',
                    sprintDate:'2026-10-10', sprintUTC:'09:00' },
  americas:       { raceUTC:'20:00', qualiDate:'2026-10-24', qualiUTC:'21:00' },
  rodriguez:      { raceUTC:'20:00', qualiDate:'2026-10-31', qualiUTC:'21:00' },
  interlagos:     { raceUTC:'17:00', qualiDate:'2026-11-07', qualiUTC:'18:00' },
  las_vegas:      { raceUTC:'04:00', qualiDate:'2026-11-21', qualiUTC:'04:00' },
  losail:         { raceUTC:'16:00', qualiDate:'2026-11-28', qualiUTC:'18:00' },
  yas_marina:     { raceUTC:'13:00', qualiDate:'2026-12-05', qualiUTC:'14:00' },
};

/* Load the current season from the shared calendar and refill the season tables in place.
   Runs once per page (season.js caches it); the 2026 tables above stay if it can't load. */
let _seasonReady = null;
function initSeason(){
  if(_seasonReady) return _seasonReady;
  _seasonReady = (async () => {
    try{
      const { loadSeason } = await import('/season.js');
      const { season, races, source } = await loadSeason({ timeoutMs: 5000 });
      if(!races?.length) return;
      if(season !== SEASON){
        BASE_RESULTS.length = 0;                // last season's results don't belong to this one
        BASE_DRIVERS.forEach(d => { d.pts = 0; });
      }
      SEASON = season;
      SEASON_RACES = Object.fromEntries(races.map(r => [r.circuitId, r]));
      const baseDone = new Set(BASE_RESULTS.filter(r => !String(r.round).endsWith('S')).map(r => +r.round));
      BASE_UPCOMING.splice(0, BASE_UPCOMING.length, ...races.filter(r => !baseDone.has(r.round)).map(r => ({
        round:r.round, name:r.name, circuitId:r.circuitId, country:r.country, date:r.date,
        circuit:r.circuit, type:r.type, ...(r.sprint ? { sprint:true } : {}),
      })));
      Object.keys(RACE_TIMES).forEach(k => delete RACE_TIMES[k]);
      races.forEach(r => { RACE_TIMES[r.circuitId] = {
        raceUTC:r.raceUTC, qualiDate:r.qualiDate, qualiUTC:r.qualiUTC,
        ...(r.sprint ? { sprintQualiDate:r.sprintQualiDate, sprintQualiUTC:r.sprintQualiUTC, sprintDate:r.sprintDate, sprintUTC:r.sprintUTC } : {}),
      }; });
      SPRINT_CIRCUITS.clear(); races.filter(r => r.sprint).forEach(r => SPRINT_CIRCUITS.add(r.circuitId));
      races.forEach(r => { if(r.of1) OF1_LOC[r.circuitId] = r.of1; });
      upcomingRaces = [...BASE_UPCOMING];
      document.querySelectorAll('[data-season]').forEach(el => { el.textContent = SEASON; });
      document.title = `F1 AI Race Predictor ${SEASON}`;
      if(source !== 'jolpica') console.warn('[season] official schedule unavailable — using the built-in calendar');
      window.scrOnData?.();
    }catch(e){ console.warn('[season] using the built-in calendar:', e.message); }
  })();
  return _seasonReady;
}

/* Returns the JavaScript Date for when a session ENDED, or null if no schedule. */
function getSessionEndTime(race, kind){
  if(!race?.circuitId) return null;
  const sched = RACE_TIMES[race.circuitId];
  if(!sched) return null;
  // session-kind → schedule fields + typical duration
  const map = {
    sprintQuali: { d: sched.sprintQualiDate, t: sched.sprintQualiUTC, dur: 45 },
    sprint:      { d: sched.sprintDate,      t: sched.sprintUTC,      dur: 60 },
    quali:       { d: sched.qualiDate,       t: sched.qualiUTC,       dur: 60 },
    race:        { d: race.date,             t: sched.raceUTC,        dur: 120 },
  };
  const entry = map[kind];
  if(!entry?.d || !entry?.t) return null;
  const [h, m] = entry.t.split(':').map(Number);
  const dt = new Date(entry.d + 'T00:00:00Z');
  dt.setUTCHours(h, (m||0) + entry.dur, 0, 0);
  return dt;
}

/* Has this session already ended? Pure UTC clock check. */
function isSessionEnded(race, kind){
  const t = getSessionEndTime(race, kind);
  return t ? Date.now() >= t.getTime() : false;
}

/* Is this session currently in progress? (started but not yet ended) */
function isSessionInProgress(race, kind){
  const end = getSessionEndTime(race, kind);
  if(!end) return false;
  const now = Date.now();
  const durs = { sprintQuali: 45, sprint: 60, quali: 60, race: 120 };
  const start = end.getTime() - (durs[kind] || 60) * 60000;
  return now >= start && now < end.getTime();
}

/* Which session is currently live based purely on schedule? Returns label or null. */
function getLiveSessionLabel(race){
  if(!race) return null;
  const isSprint = !!race.sprint || SPRINT_CIRCUITS.has(race.circuitId);
  if(isSessionInProgress(race, 'race'))        return 'Grand Prix';
  if(isSprint && isSessionInProgress(race, 'sprint'))      return 'Sprint Race';
  if(isSprint && isSessionInProgress(race, 'sprintQuali')) return 'Sprint Qualifying';
  if(isSessionInProgress(race, 'quali'))       return 'Qualifying';
  return null;
}

const TC = {mercedes:'#27F4D2',ferrari:'#E8002D',mclaren:'#FF8000',red_bull:'#3671C6',williams:'#64C4FF',aston_martin:'#229971',alpine:'#FF87BC',racing_bulls:'#6692FF',audi:'#C8B820',haas:'#B6BABD',cadillac:'#CC0033'};
const TN = {mercedes:'Mercedes',ferrari:'Ferrari',mclaren:'McLaren',red_bull:'Red Bull',williams:'Williams',aston_martin:'Aston Martin',alpine:'Alpine',racing_bulls:'Racing Bulls',audi:'Audi',haas:'Haas',cadillac:'Cadillac'};
const F1P = [25,18,15,12,10,8,6,4,2,1];
const SPRINT_P = [8,7,6,5,4,3,2,1]; // sprint race points (top 8)

/* Compute driver + constructor standings from completedRaces results.
   Only used when the official Jolpica standings are missing or older than the
   latest race we have results for (see fetchLiveData).
   Sprint rounds (round ending in 'S') use SPRINT_P; full races use F1P. */
function computeStandings(){
  if(!Array.isArray(completedRaces) || !completedRaces.length) return;
  // Seed name/team/abbr from BASE_DRIVERS; points recomputed from scratch.
  const byId = {};
  BASE_DRIVERS.forEach(d => { byId[d.driverId] = { ...d, pts: 0 }; });

  completedRaces.forEach(race => {
    const isSprint = String(race.round).endsWith('S');
    const table = isSprint ? SPRINT_P : F1P;
    (race.results || []).forEach((driverId, i) => {
      if(!byId[driverId]) byId[driverId] = {
        driverId, name: driverId, abbr: driverId.slice(0,3).toUpperCase(),
        team: 'unknown', pts: 0, pos: 99,
      };
      byId[driverId].pts += (table[i] || 0);
    });
  });

  // Rank drivers by points → assign positions
  const ranked = Object.values(byId).sort((a,b) => b.pts - a.pts || a.name.localeCompare(b.name));
  ranked.forEach((d,i) => d.pos = i+1);
  drivers = ranked;

  // Constructors = sum of their drivers' points
  const teamPts = {};
  ranked.forEach(d => { teamPts[d.team] = (teamPts[d.team] || 0) + d.pts; });
  constructors = Object.entries(teamPts)
    .filter(([t]) => t && t !== 'unknown')
    .map(([t,pts]) => ({ name: teamName(t), pts }))
    .sort((a,b) => b.pts - a.pts);
}

/* Pull finished-race results from Supabase (captured by the bridge / cron) and
   fold them into completedRaces so standings include races beyond BASE_RESULTS
   (e.g. Canada, Monaco, Spain). Idempotent: replaces any existing entry for the
   same round. Converts driver abbreviations → driverIds. */
async function mergeSupabaseRaceResults(){
  try {
    const rows = await sbGet('sessions?session_name=in.(Race,Sprint)&select=circuit_id,session_name,grid_data,fetched_at&order=fetched_at.desc');
    if(!rows?.length) return;
    const abbrToId = {};
    BASE_DRIVERS.forEach(d => abbrToId[d.abbr] = d.driverId);

    // newest-first; take the first (freshest) complete grid per circuit+session
    const seen = new Set();
    for(const row of rows){
      const isSprint = row.session_name === 'Sprint';
      const key = `${row.circuit_id}|${row.session_name}`;
      if(seen.has(key)) continue;
      const g = (row.grid_data || []).filter(x => x.abbr && x.pos);
      if(g.length < 10) continue;                 // ignore partial grids
      // A row saved before the session's scheduled start can't be its result (stale feed data).
      const sr = SEASON_RACES[row.circuit_id] || {};
      const startMs = Date.parse(isSprint ? `${sr.sprintDate}T${sr.sprintUTC}:00Z` : `${sr.date}T${sr.raceUTC}:00Z`);
      if(startMs && Date.parse(row.fetched_at) < startMs) continue;
      seen.add(key);

      const meta = BASE_UPCOMING.find(u => u.circuitId === row.circuit_id);
      if(!meta) continue;                          // unknown circuit → skip
      const results = g.slice().sort((a,b)=>a.pos-b.pos)
        .map(x => abbrToId[x.abbr] || x.abbr.toLowerCase());

      const roundKey = isSprint ? `${meta.round}S` : String(meta.round);
      const entry = {
        round: roundKey,
        raceName: meta.name + (isSprint ? ' Sprint' : ''),
        circuitId: row.circuit_id, date: meta.date, results,
      };
      // Official (Jolpica) results win; Supabase only fills rounds not published yet.
      const idx = completedRaces.findIndex(r => String(r.round) === roundKey);
      if(idx >= 0 && completedRaces[idx]._official) continue;
      if(idx >= 0) completedRaces[idx] = entry;
      else completedRaces.push(entry);
    }
    // keep chronological-ish order (sprint 'nS' sorts just before race n via +0.5 offset)
    const ord = r => parseFloat(String(r.round).replace('S','')) + (String(r.round).endsWith('S') ? -0.5 : 0);
    completedRaces.sort((a,b) => ord(a) - ord(b));
  } catch(e){ console.warn('mergeSupabaseRaceResults:', e.message); }
}

// Normalise any team name string → TC key
const TEAM_ALIAS = {
  'mercedes':'mercedes','amg':'mercedes','mercedes-amg':'mercedes',
  'ferrari':'ferrari','scuderia ferrari':'ferrari',
  'mclaren':'mclaren','mclaren f1':'mclaren','mclaren formula 1':'mclaren',
  'red bull':'red_bull','red_bull':'red_bull','red bull racing':'red_bull','redbull':'red_bull',
  'williams':'williams','williams racing':'williams',
  'aston martin':'aston_martin','aston_martin':'aston_martin','aston martin aramco':'aston_martin',
  'alpine':'alpine','alpine f1':'alpine','alpine f1 team':'alpine',
  'racing bulls':'racing_bulls','racing_bulls':'racing_bulls','rb':'racing_bulls','visa cash app rb':'racing_bulls','alphatauri':'racing_bulls','alpha tauri':'racing_bulls','rb f1':'racing_bulls',
  'audi':'audi','sauber':'audi','kick sauber':'audi',
  'haas':'haas','haas f1':'haas','haas f1 team':'haas','moneygram haas':'haas',
  'cadillac':'cadillac','andretti cadillac':'cadillac','andretti':'cadillac','twilio cadillac':'cadillac',
};
function teamCol(t){
  if(!t) return '#888';
  const k = TEAM_ALIAS[t.toLowerCase().trim()] || t.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
  return TC[k] || TC[t.toLowerCase().replace(/ /g,'_')] || '#888';
}
function teamName(t){
  if(!t) return t;
  const k = TEAM_ALIAS[t.toLowerCase().trim()] || t.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_');
  return TN[k] || TN[t.toLowerCase().replace(/ /g,'_')] || t;
}

/* ═══════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════ */
let mode = 'pre';
let selectedIdx = 0;
let drivers = [...BASE_DRIVERS];
let constructors = [...BASE_CONSTRUCTORS];
let completedRaces = [...BASE_RESULTS];
let upcomingRaces = [...BASE_UPCOMING];
let qualifyingGrid = [];    // main race grid
let sprintQualiGrid = [];   // sprint qualifying grid

// App version shown in the header pill. Bump alongside the sw.js CACHE version
// so the visible label never goes stale (it was hardcoded "1.47" before).
const APP_VERSION = 'BETA 1.83';

/* ═══════════════════════════════════════════════
   USAGE COUNTS — anonymous, no cookies, nothing stored on the device.
   Events are queued and sent in small batches to /api/track. Visitors whose
   browser asks not to be tracked (Do Not Track / Global Privacy Control) are skipped.
   ═══════════════════════════════════════════════ */
const TRACK = { q: [], timer: null, errors: 0,
  off: navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true || /localhost|127\.0\.0\.1/.test(location.hostname) };
function trackEvent(name, extra = {}){
  if(TRACK.off) return;
  TRACK.q.push({ name, v: APP_VERSION, lang: navigator.language, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, ...extra });
  if(TRACK.q.length >= 10) trackFlush();
  else if(!TRACK.timer) TRACK.timer = setTimeout(trackFlush, 8000);
}
function trackFlush(){
  clearTimeout(TRACK.timer); TRACK.timer = null;
  if(!TRACK.q.length) return;
  const body = JSON.stringify({ events: TRACK.q.splice(0, 20) });
  try{
    if(navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
  }catch(e){}
  fetch('/api/track', { method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true }).catch(()=>{});
}
addEventListener('pagehide', trackFlush);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') trackFlush(); });
addEventListener('appinstalled', () => trackEvent('install'));
addEventListener('error', e => { if(TRACK.errors++ < 3) trackEvent('error', { detail: String(e.message || 'error').slice(0, 150) }); });

// 2026 race distance (total laps) per circuit — used to auto-fill the live
// prediction so the user never has to type it. Falls back to live feed if present.
const CIRCUIT_TOTAL_LAPS = {
  albert_park:58, shanghai:56, suzuka:53, miami:57, villeneuve:70, monaco:78,
  catalunya:66, red_bull_ring:71, silverstone:52, spa:44, hungaroring:70,
  zandvoort:72, monza:53, ifema_madrid:57, baku:51, sepang:56, marina_bay:62,
  americas:56, rodriguez:71, interlagos:71, las_vegas:50, losail:57, yas_marina:58,
};

/* Pick the best Supabase session row for a given session_name.
   Rule: prefer the NEWEST row that is also COMPLETE, so a partial/half-written
   bridge burst (e.g. bridge opened for <5 min) can never overwrite a full,
   official result. Falls back to newest-overall if none are "complete" yet
   (e.g. early in a live session when only partial data exists).
   `rows` must be ordered fetched_at.desc (newest first). */
const GRID_COMPLETE_MIN = 18; // a full F1 grid is ~20; 18+ counts as complete
function pickBestSessionRow(rows, sessionName){
  const matches = (rows||[]).filter(r => r.session_name === sessionName && r.grid_data?.length);
  if(!matches.length) return null;
  // rows are newest-first; first complete one wins
  const complete = matches.find(r => r.grid_data.length >= GRID_COMPLETE_MIN);
  return complete || matches[0]; // fall back to newest-overall if nothing complete yet
}
let sprintResult = [];      // sprint race result
let currentSessions = [];   // latest OpenF1 sessions for the selected race (for chip taps)
let lastPrediction = null;
let predictionMode = 'race'; // 'sprint' or 'race'
let countdownTimer     = null;
let currentRaceSessKey = null;
let currentMeetingKey  = null;
let qualifyingTimes    = [];
let qualiSessionLive   = false;
let qualiSessKey       = null;
let liveRaceInterval   = null;
let liveRaceSessKey    = null;
let driverHeadshots    = {};
let raceWeatherData    = null; // {rain, hi, lo, icon} for race day

/* ═══════════════════════════════════════════════
   CIRCUIT LAYOUTS — simplified SVG path outlines
   ViewBox: 0 0 200 120  stroke only, no fill
   ═══════════════════════════════════════════════ */
const CIRCUIT_LAYOUTS = {
  albert_park: "M40,55 Q36,18 76,10 L128,10 Q162,10 165,44 Q168,78 134,90 L68,90 Q34,82 40,55Z",
  shanghai:    "M160,20 Q184,22 184,52 Q184,85 154,100 Q120,114 80,112 Q42,108 22,82 Q5,55 20,30 Q38,8 78,8 L84,8 Q104,8 104,28 Q104,48 87,50 Q71,52 68,38 Q65,22 82,14",
  suzuka:      "M40,55 Q18,57 14,70 Q10,84 29,91 L77,91 Q99,91 104,77 Q109,62 93,56 L93,42 Q110,37 115,23 Q119,8 99,5 L57,5 Q33,5 33,20 Q33,36 50,40 L50,57Z",
  miami:       "M28,55 Q26,27 57,17 L142,17 Q172,17 175,45 Q178,72 150,82 L50,82 Q24,76 28,55Z",
  villeneuve:  "M15,42 Q13,16 46,8 L157,8 Q186,8 188,40 Q190,68 164,80 L147,83 Q129,85 125,70 Q121,55 135,48 Q149,42 156,55 Q161,66 152,74 L53,72 Q15,68 15,42Z",
  monaco:      "M28,32 Q27,10 57,7 L130,7 Q161,7 166,32 Q172,57 154,72 L107,80 Q85,84 79,70 Q73,53 87,46 Q101,40 110,52 Q116,62 108,72 L55,73 Q24,68 28,32Z",
  catalunya:   "M18,40 Q15,14 54,8 L145,8 Q178,8 182,40 Q186,68 160,82 L54,85 Q21,80 18,58Z",
  red_bull_ring:"M62,10 L160,10 Q182,10 182,42 Q182,72 157,84 Q129,95 100,90 Q70,84 52,68 Q32,50 40,27 Q48,11 62,10Z",
  silverstone: "M12,48 Q10,14 52,8 L108,8 Q150,8 168,30 Q180,52 159,74 Q139,92 105,90 L50,90 Q15,86 12,66Z",
  hungaroring: "M33,38 Q30,15 54,8 L90,8 Q118,8 125,26 Q130,42 120,55 Q110,68 96,63 L76,57 Q62,53 60,66 Q58,80 72,86 L118,86 Q148,86 155,70 Q160,53 148,42 Q138,32 122,36 Q109,40 108,54",
  zandvoort:   "M30,52 Q28,22 60,12 L108,12 Q140,12 145,42 Q150,70 122,82 L60,82 Q28,76 30,52Z",
  monza:       "M26,44 Q24,14 80,7 Q136,7 168,22 Q190,38 184,63 Q177,88 146,98 Q110,108 74,104 Q37,97 23,76 Q14,62 26,44Z",
  ifema_madrid:"M18,36 Q16,12 48,8 L158,8 Q184,8 186,36 Q188,62 165,78 L48,80 Q18,76 18,55Z",
  baku:        "M12,56 Q10,24 30,14 L162,14 Q187,14 188,36 L188,60 Q188,78 168,84 Q147,89 138,74 Q130,61 142,51 Q154,42 168,50 L168,20 L34,20 Q15,20 12,38Z",
  marina_bay:  "M35,20 Q33,8 58,6 L148,6 Q170,6 173,25 Q178,46 162,62 L144,76 Q124,86 109,80 Q95,72 97,57 Q98,43 112,40 Q126,36 130,50 L55,52 Q35,52 33,38Z",
  americas:    "M15,56 Q12,24 45,12 L140,12 Q167,12 172,34 Q177,56 157,72 Q143,82 127,77 Q114,70 117,56 Q120,42 135,40 Q149,39 152,54 L57,57 Q26,60 16,74Z",
  rodriguez:   "M28,42 Q26,15 62,8 L120,8 Q158,8 162,32 Q167,55 155,74 Q140,90 115,92 L62,92 Q28,88 26,65Z",
  interlagos:  "M32,40 Q30,15 58,8 L105,8 Q132,8 138,26 Q142,40 130,50 Q118,60 104,54 L73,53 Q60,53 56,66 Q52,80 66,87 L124,87 Q152,87 157,70 Q162,52 148,40 Q136,30 122,34",
  las_vegas:   "M16,36 Q14,14 38,10 L165,10 Q188,10 190,33 Q192,56 174,70 Q159,80 144,76 Q131,70 129,57 Q127,44 141,40 L42,38 Q20,38 16,55Z",
  losail:      "M22,40 Q20,12 62,8 L132,8 Q168,8 172,38 Q176,68 148,84 Q118,96 80,92 Q42,88 26,72 Q16,58 22,40Z",
  yas_marina:  "M25,44 Q22,18 52,10 L135,10 Q165,10 170,36 Q175,60 156,74 L131,84 Q111,92 95,83 Q81,74 83,60 Q85,46 100,43 Q114,40 119,55 L50,58 Q24,62 25,44Z",
  spa:         "M16,70 Q14,50 30,36 Q48,20 70,18 Q88,16 96,28 Q104,40 92,52 Q80,62 68,56 Q55,48 60,34 Q66,18 85,12 L140,12 Q168,12 172,38 Q176,62 156,78 Q134,92 100,94 Q62,96 38,84 Q18,76 16,70Z",
};

function getCircuitLayoutSvg(circuitId){
  const path = CIRCUIT_LAYOUTS[circuitId];
  if(!path) return '';
  return `<svg viewBox="0 0 200 120" width="96" height="58"
    style="display:block;filter:drop-shadow(0 0 5px rgba(225,6,0,.35))">
    <path d="${path}" fill="none" stroke="rgba(255,255,255,0.55)"
      stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const COUNTRY_FLAGS = {
  'Canada':'🇨🇦','Monaco':'🇲🇨','Spain':'🇪🇸','Austria':'🇦🇹','UK':'🇬🇧',
  'Hungary':'🇭🇺','Netherlands':'🇳🇱','Italy':'🇮🇹','Azerbaijan':'🇦🇿',
  'Singapore':'🇸🇬','USA':'🇺🇸','Mexico':'🇲🇽','Brazil':'🇧🇷','Qatar':'🇶🇦',
  'UAE':'🇦🇪','Australia':'🇦🇺','China':'🇨🇳','Japan':'🇯🇵','Belgium':'🇧🇪',
};

const $ = id => document.getElementById(id);
const htm = (id,h) => $(id).innerHTML = h;
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const fmtD = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';

function setStatus(t,c){ $('statusTxt').textContent=t; $('dot').className='dot '+(c||''); }
function setProgress(p){ $('prog').style.width=p+'%'; }
function spin(m){ /* spinner disabled */ }
function unspin(){ /* spinner disabled */ }
function showErr(m){ const b=$('errBox'); b.style.display=''; b.innerHTML=m; }
function hideErr(){ $('errBox').style.display='none'; }

/* ═══════════════════════════════════════════════
   JOLPICA API — lightweight fetch, 4 calls max
   ═══════════════════════════════════════════════ */
const JOLPI = 'https://api.jolpi.ca/ergast/f1';
const CACHE_TTL = 30*60*1000;

function getCached(k){ try{ const r=sessionStorage.getItem('f1_'+k); if(!r) return null; const {ts,d}=JSON.parse(r); return Date.now()-ts>CACHE_TTL?null:d; }catch(e){return null;} }
function setCache(k,d){ try{ sessionStorage.setItem('f1_'+k,JSON.stringify({ts:Date.now(),d})); }catch(e){} }
async function jolpi(path,key){
  const c=getCached(key); if(c) return c;
  const r=await fetch(JOLPI+path,{signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(r.status);
  const d=await r.json(); setCache(key,d); return d;
}
async function tryJolpi(path,key){ try{ return await jolpi(path,key); }catch(e){ console.warn('Jolpica fail:',path); return null; } }

/* ═══════════════════════════════════════════════
   MULTI-SOURCE SESSION GRID FETCH
   Strategy: try OpenF1 → fall back to Jolpica → schedule retry if both fail.
   When data is found, mirror it to the Supabase `sessions` table so future
   visits from any device load instantly without re-hitting any API.
   ═══════════════════════════════════════════════ */

/* Fetch a session grid from Jolpica/Ergast (free, no live lock, ~1h-1d lag). */
async function fetchJolpicaSessionGrid(race, kind){
  if(!race?.round) return null;
  const round = race.round;
  // Map our kind → Ergast endpoint + JSON property
  const map = {
    sprintQuali: { ep: 'sprint',     prop: 'SprintResults'     }, // Sprint Q grid = Sprint starting grid
    sprint:      { ep: 'sprint',     prop: 'SprintResults'     },
    quali:       { ep: 'qualifying', prop: 'QualifyingResults' },
    race:        { ep: 'results',    prop: 'Results'           },
  };
  const m = map[kind];
  if(!m) return null;
  try {
    const data = await jolpi(`/${SEASON}/${round}/${m.ep}.json`, `jolpi_${SEASON}_${kind}_${round}`);
    const races = data?.MRData?.RaceTable?.Races || [];
    if(!races.length) return null;
    const results = races[0][m.prop] || [];
    if(!results.length) return null;
    // For sprintQuali, we need the grid (starting positions of sprint), not finishing positions.
    // Jolpica provides Sprint results with `grid` field for starting position.
    const usesGrid = kind === 'sprintQuali';
    return results.map(r => {
      const abbr = r.Driver?.code?.toUpperCase();
      const drv = drivers.find(x => x.abbr === abbr);
      const pos = usesGrid ? parseInt(r.grid, 10) : parseInt(r.position, 10);
      return {
        driverId: drv?.driverId || abbr,
        pos: isNaN(pos) ? 99 : pos,
        abbr,
      };
    }).filter(g => g.pos < 99).sort((a,b) => a.pos - b.pos);
  } catch(e) {
    console.warn('Jolpica session grid fetch failed:', kind, e.message);
    return null;
  }
}

/* Persist a session grid to Supabase so other devices/visits load instantly. */
async function saveSessionGridToSupabase(race, sessionName, gridData, source){
  if(!race?.circuitId || !race?.round || !gridData?.length) return;
  try {
    await saveRow('session', {
      circuit_id:   race.circuitId,
      round:        Number(race.round),
      year:         SEASON,
      session_name: sessionName,
      grid_data:    gridData.map(g => ({ pos: g.pos, abbr: g.abbr })),
      source:       source || 'unknown',
    });
  } catch(e) {
    console.warn('Supabase session save failed:', e.message);
  }
}

/* Track in-flight retry timers so we don't double-schedule for the same race. */
const _sessionRetryTimers = {};

/* Schedule background polling for session data when sources are unavailable.
   Polls every 3 min for up to 30 min total. Auto-clears once data is found. */
function scheduleSessionDataRetry(race){
  if(!race?.circuitId) return;
  const key = race.circuitId + '_' + race.round;
  if(_sessionRetryTimers[key]) return; // already retrying for this race
  let attempts = 0;
  const MAX_ATTEMPTS = 10; // 10 × 3min = 30 min total
  console.log('[retry] scheduling background poll for', race.name);
  const timer = setInterval(async () => {
    attempts++;
    console.log(`[retry] attempt ${attempts}/${MAX_ATTEMPTS} for ${race.name}`);
    of1LiveLocked = false; of1RateLimited = false;
    // Clear cache so the retry actually hits the network
    Object.keys(of1Cache).forEach(k => { if(k.includes('openf1.org')) delete of1Cache[k]; });
    try {
      const meeting = await getOf1Meeting(race);
      if(meeting && !of1LiveLocked){
        console.log('[retry] OpenF1 unlocked! Auto-fetching data for', race.name);
        clearInterval(timer);
        delete _sessionRetryTimers[key];
        showToast('📡 OpenF1 unlocked — loading session data', 'info', 4000);
        // Re-run the full auto-fetch
        if(typeof autoFetchSessions === 'function') autoFetchSessions();
        return;
      }
    } catch(e) { /* keep retrying */ }
    if(attempts >= MAX_ATTEMPTS){
      console.log('[retry] giving up after', MAX_ATTEMPTS, 'attempts');
      clearInterval(timer);
      delete _sessionRetryTimers[key];
    }
  }, 3 * 60 * 1000); // 3 minutes
  _sessionRetryTimers[key] = timer;
}

function hardRefresh(){
  // Clear sessionStorage Jolpica cache
  try{ Object.keys(sessionStorage).filter(k=>k.startsWith('f1_')).forEach(k=>sessionStorage.removeItem(k)); }catch(e){}
  // Clear in-memory OpenF1 cache so every endpoint re-fetches fresh data
  Object.keys(of1Cache).forEach(k => delete of1Cache[k]);
  lastPrediction=null;
  $('podiumWrap').style.display='none';
  loadData();
}

/* ═══════════════════════════════════════════════
   LOAD — render baseline instantly, then fetch
   live data in background and re-render
   ═══════════════════════════════════════════════ */
function loadData(){
  // Step 1: render hardcoded baseline immediately so app is usable right away
  computeStandings(); // derive current standings from results before first render
  buildSelector();
  renderMetrics();
  renderHistory();
  renderCalendar();
  setStatus('Loading live data...', 'loading');
  setProgress(20);

  // Step 2: load the season calendar, then fetch live data + OpenF1 season insights in background
  initSeason().then(() => {
    buildSelector();
    renderCalendar();
    fetchLiveData();
    fetchOf1SeasonInsights();
  });
}

/* Jolpica ids that differ from the ids this site uses. */
const JOLPICA_DRIVER_ALIAS  = { arvid_lindblad: 'lindblad' };
const JOLPICA_CIRCUIT_ALIAS = { madring: 'ifema_madrid', vegas: 'las_vegas' };
const siteDriverId  = id => JOLPICA_DRIVER_ALIAS[id]  || id;
const siteCircuitId = id => JOLPICA_CIRCUIT_ALIAS[id] || id;

/* Jolpica returns at most 100 result rows per request, so page through all of
   them and regroup by round (one race can be split across two pages).
   kind: 'results' (Grands Prix) or 'sprint'. */
async function fetchAllJolpicaRaces(kind){
  const prop = kind === 'sprint' ? 'SprintResults' : 'Results';
  const byRound = {};
  let offset = 0, total = Infinity;
  for(let page = 0; offset < total && page < 10; page++){
    const d = await jolpi(`/${SEASON}/${kind}.json?limit=100&offset=${offset}`, `${kind}${SEASON}_${offset}`);
    const M = d?.MRData; if(!M) break;
    total = +M.total || 0;
    for(const r of (M.RaceTable?.Races || [])){
      const e = byRound[r.round] || (byRound[r.round] = { round:r.round, raceName:r.raceName, circuitId:siteCircuitId(r.Circuit.circuitId), date:r.date, rows:[] });
      e.rows.push(...(r[prop] || []));
    }
    offset += +M.limit || 100;
  }
  return Object.values(byRound)
    .filter(e => e.rows.length >= 15)   // a page that failed mid-way can leave a race incomplete
    .map(e => ({
      round:    kind === 'sprint' ? e.round + 'S' : String(e.round),
      raceName: kind === 'sprint' ? e.raceName + ' Sprint' : e.raceName,
      circuitId: e.circuitId, date: e.date,
      results:  e.rows.sort((a,b)=>+a.position-+b.position).map(x => siteDriverId(x.Driver.driverId)),
    }));
}

async function fetchLiveData(){
  // Hard 8-second timeout — if API doesn't respond, use baseline silently
  const timeout = setTimeout(()=>{
    setStatus(`${SEASON} season · live data still loading…`, 'loading');
    setProgress(100);
  }, 8000);

  try {
    const [apiRaces, apiSprints, drvData, conData] = await Promise.all([
      fetchAllJolpicaRaces('results').catch(e => { console.warn('Jolpica results:', e.message); return []; }),
      fetchAllJolpicaRaces('sprint').catch(e => { console.warn('Jolpica sprints:', e.message); return []; }),
      tryJolpi(`/${SEASON}/driverStandings.json?limit=40`, `ds${SEASON}`),
      tryJolpi(`/${SEASON}/constructorStandings.json?limit=30`, `cs${SEASON}`),
    ]);

    clearTimeout(timeout);
    const gotLive = apiRaces.length > 0;

    // Official results replace the hardcoded baseline round by round.
    const byKey = {};
    BASE_RESULTS.forEach(r => byKey[String(r.round)] = r);
    [...apiSprints, ...apiRaces].forEach(r => byKey[String(r.round)] = { ...r, _official: true });
    const ord = r => parseFloat(String(r.round).replace('S','')) + (String(r.round).endsWith('S') ? -0.5 : 0);
    completedRaces = Object.values(byKey).sort((a,b) => ord(a) - ord(b));
    if(gotLive){
      const doneRounds = new Set(apiRaces.map(r => +r.round));
      upcomingRaces = BASE_UPCOMING.filter(u => !doneRounds.has(u.round));
    }

    // Official driver standings (Jolpica).
    let officialRound = 0;
    const dList = drvData?.MRData?.StandingsTable?.StandingsLists?.[0];
    if(dList?.DriverStandings?.length){
      officialRound = +dList.round || 0;
      drivers = dList.DriverStandings.map(e => {
        const id = siteDriverId(e.Driver.driverId);
        const base = BASE_DRIVERS.find(d => d.driverId === id);
        return {
          driverId: id,
          name:     e.Driver.givenName + ' ' + e.Driver.familyName,
          abbr:     e.Driver.code || base?.abbr || e.Driver.familyName.slice(0,3).toUpperCase(),
          team:     e.Constructors[0]?.constructorId || base?.team || 'unknown',
          pts:      +e.points || 0,
          pos:      +e.position || 99,
        };
      });
    }
    const cList = conData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings;
    if(cList?.length){
      constructors = cList.map(e => ({ name: e.Constructor.name, pts: +e.points || 0 }));
    }

    // Races Jolpica hasn't published yet (e.g. a race that just finished) come from
    // Supabase. Only when that adds a race newer than the official standings do we
    // compute the table ourselves from the full results.
    await mergeSupabaseRaceResults();
    const lastRaceRound = Math.max(0, ...completedRaces.filter(r => !String(r.round).endsWith('S')).map(r => +r.round));
    if(!officialRound || lastRaceRound > officialRound) computeStandings();

    // Re-render with live data
    buildSelector();
    renderMetrics();
    renderHistory();
    renderCalendar();
    setProgress(100);
    // Auto-match stored predictions with actual results now that we have live race data
    checkStoredPredictions();
    window.scrOnData?.();

    const lastRace = completedRaces.filter(r=>!String(r.round).endsWith('S')).slice(-1)[0]?.raceName||'—';
    setStatus(gotLive
      ? `Live · ${completedRaces.length} sessions done · last: ${lastRace.replace(' Grand Prix','')}`
      : `${SEASON} season · baseline data · API unavailable`, gotLive ? 'live' : 'warn');

  } catch(e) {
    clearTimeout(timeout);
    console.warn('Live fetch failed:', e.message);
    setStatus(`${SEASON} season · baseline data · live data unavailable`, 'warn');
    setProgress(100);
  }
}

/* ═══════════════════════════════════════════════
   SELECTOR
   ═══════════════════════════════════════════════ */
/* Unified race list — upcoming first (default lands on next race),
   then completed races (most-recent first) so users can revisit history.
   Built every time buildSelector runs to stay in sync with API data. */
let displayRaces = [];

/* A race weekend becomes "active" (selectable, default-selected) 3 days before
   the Sunday race date — i.e. roughly when the Friday FP1 happens.
   This keeps the dropdown predictable: past + current selectable, far-future locked. */
const WEEKEND_LEAD_DAYS = 3;

function buildDisplayRaces(){
  const completedRoundSet = new Set(
    completedRaces
      .filter(r => !String(r.round).endsWith('S'))
      .map(r => +r.round)
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const DAY_MS = 86400000;

  const allRaces = BASE_UPCOMING.map(u => {
    const raceDate    = u.date ? new Date(u.date) : null;
    const raceMs      = raceDate ? raceDate.getTime() : null;
    const hasResults  = completedRoundSet.has(+u.round);
    const datePast    = raceMs !== null && raceMs < todayMs;
    const isDone      = hasResults || datePast;
    // Selectable 3 days before the race up through forever after
    const selectableFrom = raceMs !== null ? raceMs - WEEKEND_LEAD_DAYS * DAY_MS : null;
    const isSelectable   = isDone || (selectableFrom !== null && todayMs >= selectableFrom);
    // Active weekend = today is between Fri-of-race-week and the race day (inclusive +1 day buffer)
    const isCurrent = raceMs !== null
      && todayMs >= (raceMs - WEEKEND_LEAD_DAYS * DAY_MS)
      && todayMs <= (raceMs + DAY_MS);
    return { ...u, _isDone: isDone, _isSelectable: isSelectable, _isCurrent: isCurrent };
  });

  // Sort: upcoming-selectable first (closest first) → upcoming-locked → done (newest first)
  const upcomingActive = allRaces.filter(r => !r._isDone && r._isSelectable).sort((a,b) => a.round - b.round);
  const upcomingLocked = allRaces.filter(r => !r._isDone && !r._isSelectable).sort((a,b) => a.round - b.round);
  const doneRaces      = allRaces.filter(r =>  r._isDone).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  displayRaces = [...upcomingActive, ...doneRaces, ...upcomingLocked];
}

/* Returns the index of the race that should be auto-selected on load.
   Priority: active weekend → most recent finished race → first upcoming locked. */
function findDefaultSelectedIdx(){
  if(!displayRaces.length) return 0;
  // 1. Current weekend in progress
  const curIdx = displayRaces.findIndex(r => r._isCurrent);
  if(curIdx >= 0) return curIdx;
  // 2. Most recent done race (first one in the done section)
  const recentDoneIdx = displayRaces.findIndex(r => r._isDone);
  if(recentDoneIdx >= 0) return recentDoneIdx;
  // 3. Fallback: first race in list
  return 0;
}

function buildSelector(){
  buildDisplayRaces();
  $('raceSelect').innerHTML = displayRaces.map((r,i) =>
    `<option value="${i}"${r._isSelectable ? '' : ' disabled'}>${r._isCurrent ? '🔴 ' : r._isDone ? '✓ ' : !r._isSelectable ? '🔒 ' : '· '}R${r.round}: ${r.name} — ${fmtD(r.date)}${!r._isSelectable ? ' (opens 3 days before)' : ''}</option>`
  ).join('');
  // Auto-select the current weekend → most recent done → first upcoming
  selectedIdx = findDefaultSelectedIdx();
  $('raceSelect').value = String(selectedIdx);
  updateBanner();
  buildH2HSelectors();
  const defaultRace = displayRaces[selectedIdx];
  if(defaultRace) fetchWeatherForecast(defaultRace.circuitId, defaultRace.date);
  checkPostRaceBanner();
  autoFetchSessions();
}

function onRaceChange(){
  const reqIdx = parseInt($('raceSelect').value) || 0;
  const reqRace = displayRaces[reqIdx];
  // Guard: if user tried to pick a locked future race, snap back to current default
  if(reqRace && !reqRace._isSelectable){
    showToast('🔒 That race opens 3 days before it starts','warn',4000);
    selectedIdx = findDefaultSelectedIdx();
    $('raceSelect').value = String(selectedIdx);
    return;
  }
  selectedIdx = reqIdx;
  lastPrediction=null;
  $('podiumWrap').style.display='none';
  const _ps = $('predEmptyState'); if(_ps) _ps.style.display='';
  $('sessionsWrap').innerHTML='<span class="sess pending">Loading sessions…</span>';
  $('fetchStatus').style.color='var(--muted)';
  $('fetchStatus').textContent='Fetching session data…';
  const sc=$('scheduleCard'); if(sc) sc.style.display='none';
  const pc=$('practiceCard'); if(pc) pc.style.display='none';
  updateBanner();
  raceWeatherData = null;
  updateWeatherAlert();
  const race = (displayRaces.length ? displayRaces : ((displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING))))[selectedIdx] || null;
  if(race) fetchWeatherForecast(race.circuitId, race.date);
  checkPostRaceBanner();
  autoFetchSessions();
  // If the user picked an already-completed race, switch them straight to AI vs Reality
  if(race && race._isDone){
    setTab('comp');
    showToast(`Showing AI vs Reality for ${race.name}`, 'info', 3500);
  }
}

function updateBanner(){
  renderLightsOut();
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  if(!race){ $('raceBanner').style.display='none'; return; }
  $('raceBanner').style.display='';
  $('bName').textContent=race.name;
  $('bMeta').textContent=`${race.circuit||race.circuitId} · ${race.country} · ${fmtD(race.date)}`;
  $('bRound').textContent=race.round;
  // Circuit flag
  $('bFlag').textContent = COUNTRY_FLAGS[race.country] || '';
  // Circuit layout SVG
  const layoutEl = $('bLayout');
  if(layoutEl) layoutEl.innerHTML = getCircuitLayoutSvg(race.circuitId);
  // Race weekend animation + badge
  const raceDay=new Date(race.date);
  const nowBanner=new Date();
  const diffDaysBanner=(raceDay-nowBanner)/(1000*60*60*24);
  const isWeekend=diffDaysBanner>=-2&&diffDaysBanner<=4;
  $('raceBanner').classList.toggle('race-weekend',isWeekend);
  const wb=$('weekendBadge');
  if(wb) wb.style.display=isWeekend?'':'none';
  // Always show countdown to race day (autoFetchSessions will refine to exact session)
  if(race.date) setCountdownFromSessions([], race.date);
  const hasQ=qualifyingGrid.length>0;
  const tags=[];
  tags.push(hasQ?'<span class="tag green">✓ Qualifying done</span>':'<span class="tag yellow">Qualifying pending</span>');
  if(mode==='post'&&hasQ) tags.push('<span class="tag blue">Post-Qualifying mode</span>');
  if(mode==='post'&&!hasQ) tags.push('<span class="tag red">⚠ No qualifying data</span>');
  if(race.sprint) tags.push('<span class="tag yellow">⚡ Sprint Weekend</span>');
  tags.push(`<span class="tag purple">${race.type||'balanced'} circuit</span>`);
  htm('bTags',tags.join(''));
  // Show sprint button only for sprint weekends
  const sb=$('sprintBtn');
  if(sb) sb.style.display=race.sprint?'':'none';
}

function setMode(m){
  mode=m;
  $('btnPre').classList.toggle('active',m==='pre');
  $('btnPost').classList.toggle('active',m==='post');
  if(m==='post' && qualifyingGrid.length===0 && !qualiSessionLive){
    showToast('⚠ No qualifying data yet — auto-fetches after qualifying ends','warn',5000);
  }
  lastPrediction=null;
  $('podiumWrap').style.display='none';
  updateBanner();
  renderQualifyingTimes();
}

/* Lock/unlock the Predictions Archive tab.
   Locked until a prediction exists for any race. Once unlocked, it stays open
   for the session — re-renderPrediction calls it idempotently. */
function unlockArchTab(){
  const t = $('tArch');
  if(t) t.classList.remove('tab-locked');
}
function tryOpenArchTab(){
  const t = $('tArch');
  if(t && t.classList.contains('tab-locked')){
    showToast('Generate a prediction first to unlock the Predictions Archive', 'warn', 4000);
    return;
  }
  setTab('arch');
}

/* Desktop "More" dropdown — secondary tabs accessible without pressing Predict */
function toggleDesktopMore(ev){
  ev?.stopPropagation();
  const menu = $('desktopMoreMenu');
  const btn  = $('tMoreBtn');
  if(!menu || !btn) return;
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true':'false');
  menu.setAttribute('aria-hidden', isOpen ? 'false':'true');
}
function closeDesktopMore(){
  const menu = $('desktopMoreMenu');
  const btn  = $('tMoreBtn');
  if(menu) { menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); }
  if(btn)  { btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
}
// Click outside the dropdown closes it
document.addEventListener('click', (e) => {
  const menu = document.getElementById('desktopMoreMenu');
  const btn  = document.getElementById('tMoreBtn');
  if(!menu || !btn) return;
  if(!menu.classList.contains('open')) return;
  if(menu.contains(e.target) || btn.contains(e.target)) return;
  closeDesktopMore();
});

function syncDesktopMoreActive(tab){
  // Light up the More button when an "inside More" section is active
  const moreBtn = $('tMoreBtn');
  if(!moreBtn) return;
  const inMore = ['comp','pits','hist','cal','anlt','live'].includes(tab);
  moreBtn.classList.toggle('active', inMore);
}

/* Mobile-only: when viewing a "More" section (anything other than 'pred'),
   add a body class that hides all the home-page content (race selector,
   weather, generate buttons) and shows a section title + back button so the
   section takes over the screen. */
const MOBILE_SECTION_TITLES = {
  arch: 'Predictions archive',
  comp: 'AI vs Reality',
  pits: 'Pit stops',
  hist: 'Season history',
  cal:  'Calendar',
  anlt: 'Analytics',
  live: 'Live race',
};
function syncMobileMoreView(tab){
  const inMore = Object.prototype.hasOwnProperty.call(MOBILE_SECTION_TITLES, tab);
  document.body.classList.toggle('mobile-more-view', inMore);
  if(inMore){
    const titleEl = document.getElementById('mobileSectionTitle');
    if(titleEl) titleEl.textContent = MOBILE_SECTION_TITLES[tab];
  }
}

function setTab(t){
  if(typeof trackEvent === 'function' && t !== setTab._last){ setTab._last = t; trackEvent('screen', { screen: t }); }
  ['pred','arch','comp','pits','hist','cal','anlt','live'].forEach(tab=>{
    $('p'+cap(tab))?.classList.toggle('active',tab===t);
    $('t'+cap(tab))?.classList.toggle('active',tab===t);
  });
  // Clear live race refresh interval when switching away
  if(t!=='live' && liveRaceRefreshInterval){
    clearInterval(liveRaceRefreshInterval);
    liveRaceRefreshInterval = null;
  }
  // Clear pit auto-refresh when switching away from the Pits tab
  if(t!=='pits' && pitRefreshInterval){
    clearInterval(pitRefreshInterval);
    pitRefreshInterval = null;
  }
  if(t==='pred'){
    const _races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
    syncForceFreshBtn(_races[selectedIdx] || _races[0]);
  }
  if(t==='arch') openArchTab();
  if(t==='comp'){
    autoShowComparison();
    if(currentRaceSessKey && currentMeetingKey)
      renderLapChart(currentRaceSessKey, currentMeetingKey);
  }
  if(t==='pits'){
    fetchAndRenderPitStops(currentRaceSessKey, currentMeetingKey);
    // Auto-refresh every 30s so live pit counts update while a race runs
    if(pitRefreshInterval) clearInterval(pitRefreshInterval);
    pitRefreshInterval = setInterval(() => fetchAndRenderPitStops(currentRaceSessKey, currentMeetingKey), 30000);
  }
  if(t==='hist'){ renderAccuracyOverview(); renderAIReportCard(); }
  if(t==='anlt'){
    renderConfidenceTrend();
    buildH2HSelectors();
    renderTeamForm();
    renderReliability();
    renderChampionshipProjection();
    renderPenalties();
  }
  if(t==='live'){
    // Check schedule first — if a session is live right now, show the locked state
    // immediately without waiting for OpenF1 (which will be locked anyway)
    const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
    const race  = races[selectedIdx] || races[0];
    const liveLabel = getLiveSessionLabel(race);
    if(liveLabel && !liveRaceSessKey){
      // Session is live per schedule but we have no OpenF1 session key yet
      renderLiveLocked(liveLabel);
      // Pull bridge positions IMMEDIATELY so _latestRaceGrid is fresh for a
      // live prediction right away (don't wait for the 30s interval tick).
      refreshLivePositions();
    } else {
      fetchLiveRace();
    }
    // Auto-refresh every 30 seconds
    if(liveRaceRefreshInterval) clearInterval(liveRaceRefreshInterval);
    liveRaceRefreshInterval = setInterval(() => {
      const r2 = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING))[selectedIdx];
      const ll = getLiveSessionLabel(r2);
      if(ll && !liveRaceSessKey) { renderLiveLocked(ll); refreshLivePositions(); }
      else fetchLiveRace();
    }, 30000);
  }
  syncMobileBottomNav(t);
  syncMobileMoreView(t);
  syncDesktopMoreActive(t);
  closeDesktopMore(); // collapse the dropdown when a section opens
}

/* ═══════════════════════════════════════════════
   MOBILE BOTTOM-NAV ROUTING
   Maps the 4 nav buttons to internal tab names:
     pred  → pred (default)
     comp  → comp (AI vs Reality)
     race  → live during race, else cal (Calendar)
     more  → opens slide-up sheet (not a tab)
   When inside More-only screens (arch, hist, anlt, pits, live),
   the "More" nav button shows as active.
   ═══════════════════════════════════════════════ */
function mobileNav(target){
  closeMoreSheet();
  // Smart "Race" routing — show Live if race is happening, otherwise Calendar.
  if(target === 'race'){
    const liveBanner = $('liveRaceBanner');
    const bannerVisible = liveBanner && getComputedStyle(liveBanner).display !== 'none';
    // Also check schedule-based detection — session in progress even if OpenF1 is locked
    const races2 = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
    const race2  = races2[selectedIdx] || races2[0];
    const isLive = bannerVisible || !!getLiveSessionLabel(race2);
    target = isLive ? 'live' : 'cal';
  }
  setTab(target);
  // Smooth scroll back to top so user always sees the top of the new screen
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncMobileBottomNav(tab){
  const map = {
    pred:'pred', comp:'comp', live:'live',
    // Everything else lights up "More"
    cal:'more', arch:'more', hist:'more', anlt:'more', pits:'more',
  };
  const navKey = map[tab] || 'pred';
  document.querySelectorAll('#mobileBottomNav .mnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === navKey);
  });
}

function openMoreSheet(){
  const sheet = $('moreSheet');
  if(!sheet) return;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  // Light up the "More" nav button immediately
  document.querySelectorAll('#mobileBottomNav .mnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.nav === 'more');
  });
}
function closeMoreSheet(){
  const sheet = $('moreSheet');
  if(!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
}

/* ═══════════════════════════════════════════════
   METRICS
   ═══════════════════════════════════════════════ */
function renderMetrics(){
  const sorted=[...drivers].sort((a,b)=>b.pts-a.pts);
  const leader=sorted[0], second=sorted[1];
  const gap=leader&&second?leader.pts-second.pts:'—';
  // Grands Prix only: sprints are neither "races done" nor race wins.
  const gps=completedRaces.filter(r=>!String(r.round).endsWith('S'));
  const wins={};
  gps.forEach(r=>{ if(r.results[0]) wins[r.results[0]]=(wins[r.results[0]]||0)+1; });
  const topW=Object.entries(wins).sort((a,b)=>b[1]-a[1])[0];
  const wa=topW?(drivers.find(d=>d.driverId===topW[0])?.abbr||topW[0]):'—';
  htm('metrics',`
    <div class="metric"><div class="mv red">${gps.length}</div><div class="ml">Races Done</div></div>
    <div class="metric"><div class="mv">${(upcomingRaces.length||BASE_UPCOMING.length)}</div><div class="ml">Remaining</div></div>
    <div class="metric"><div class="mv gold">${leader?.abbr||'—'}</div><div class="ml">WDC Leader</div></div>
    <div class="metric"><div class="mv red">${leader?.pts||'—'}</div><div class="ml">Leader Pts</div></div>
    <div class="metric"><div class="mv">${gap}</div><div class="ml">Pts Gap</div></div>
    <div class="metric"><div class="mv green">${wa}</div><div class="ml">Most Wins</div></div>
  `);
}

/* ═══════════════════════════════════════════════
   CIRCUIT DATA — fed directly into the AI prompt
   ═══════════════════════════════════════════════ */
const CIRCUIT_DATA = {
  miami:{difficulty:'Medium-high. Semi-street layout with fast sections. Significant tyre degradation on abrasive surface. Track position key — overtaking possible on long straight but limited.',trackNotes:'Miami International Autodrome (2022-present). Fast flowing sections mixed with tight hairpins. Overheating brakes common. DRS zones reward qualifying pace.',teamHistory:'Red Bull dominated 2022-2023. Ferrari and Mercedes more competitive from 2024. McLaren has shown strong race pace. Street-circuit setups from Ferrari tend to translate well.',driverHistory:'Verstappen won 2022 and 2023. Leclerc strong in qualifying. Norris won 2024 in a major upset. Hamilton has underperformed relative to expectations here.',circuitBias:'Favours low-rake cars with strong straight-line speed. Tyre management is a significant differentiator. Hurts high-downforce setups that sacrifice top speed.'},
  villeneuve:{difficulty:'High. Semi-street with walls everywhere. The Wall of Champions at the chicane claims many drivers. Highest brake wear of the season. Safety car probability very high.',trackNotes:'Circuit Gilles Villeneuve, Montreal. Slow chicanes and one very long straight. Heavy braking. Safety car near guaranteed.',teamHistory:'Red Bull and Ferrari dominant recently. Mercedes very strong here historically. McLaren historically struggled. Aston Martin competitive in 2023.',driverHistory:'Hamilton has 7 wins — unmatched at this circuit. Alonso always performs well in Montreal. Verstappen dominant recent years. Leclerc has had bad luck. Sainz solid.',circuitBias:'Favours efficient braking, strong straight-line speed, good traction out of chicanes. Safety car strategy and pit timing is critical. Reliability risk is elevated.'},
  monaco:{difficulty:'Extreme. Narrowest circuit on the calendar. Zero margin for error. Overtaking nearly impossible. Qualifying is everything — grid position almost always = finishing position.',trackNotes:'Circuit de Monaco. Street circuit through Monte Carlo. Armco barriers centimetres from the car. Tunnel, hairpin, swimming pool complex. Slowest average speed of the year.',teamHistory:'Ferrari historically very strong — their philosophy suits slow-speed circuits. Red Bull dominant 2021-2023. Mercedes have underperformed here. McLaren had breakthrough win.',driverHistory:'Leclerc has multiple poles but bad luck in races. Verstappen won 2021 and 2023. Alonso two-time Monaco winner — exceptional here. Hamilton won 2008 and 2019. Perez won 2022.',circuitBias:'Favours maximum downforce, smooth trail-braking drivers, street circuit experience. Starting position almost determines finishing position. Safety car timing with pits is decisive.'},
  catalunya:{difficulty:'Medium. Extensively tested by all teams due to pre-season sessions here. High-speed corners test aero efficiency. Significant rear tyre degradation.',trackNotes:'Circuit de Barcelona-Catalunya. Teams know this better than any track. Long high-speed Turn 3 complex is critical. Strong headwinds on back straight common.',teamHistory:'Red Bull and Mercedes have historically dominated. Ferrari competitive. McLaren fast in recent seasons. True test of car development.',driverHistory:'Hamilton 6 wins — dominant here historically. Verstappen very strong. Alonso crowd favourite — won here for Renault. Leclerc and Norris good recent pace.',circuitBias:'Favours aerodynamically efficient well-rounded cars. Strong tyre management key. Overtaking possible at T1 and final chicane. DRS effective.'},
  red_bull_ring:{difficulty:'Medium-low. Short lap but very demanding on tyres. High-speed elevation changes. Multiple DRS zones make overtaking relatively easy.',trackNotes:'Red Bull Ring, Spielberg. Short 4.3km lap. Heavy braking followed by long throttle. Altitude affects cooling. Alpine weather unpredictable.',teamHistory:'Red Bull have dominated their home race — won almost every year 2018-2024. This is historically Red Bulls strongest venue. McLaren strong in 2024.',driverHistory:'Verstappen has 4 wins here. Hamilton competitive. Leclerc qualified on pole multiple times. Norris had near-win in 2024. Bottas and Sainz have podiumed.',circuitBias:'Favours Red Bull car characteristics historically — low drag, good traction. High tyre deg makes strategy important. Reliability more at risk due to heat.'},
  silverstone:{difficulty:'High. Ultra-fast corners demand exceptional aerodynamic downforce and driver bravery. Copse, Maggotts-Becketts-Chapel is among most challenging sequences on calendar.',trackNotes:'Silverstone, UK. Extremely fast layout. Weather unpredictable — rain likely. High-energy corners batter tyres. Long race with multiple strategies viable.',teamHistory:'Mercedes extremely strong — high-speed emphasis suits their car. Ferrari competitive. McLaren has home crowd advantage and performed well. Red Bull solid but not dominant here.',driverHistory:'Hamilton has 8 wins — absolute master of Silverstone. Norris won 2024 dramatically — home hero. Verstappen quick but not dominant here. Leclerc podium contender. Sainz won 2022.',circuitBias:'Favours high-downforce cars with strong aero balance. Rain completely reshuffles grid. Tyre deg high on left-front. Hamilton/high-downforce cars historically lethal here.'},
  hungaroring:{difficulty:'High. Very slow twisty circuit with almost no straight. Huge downforce required. Overtaking nearly impossible — qualifying vital. Called Monaco without the barriers.',trackNotes:'Hungaroring, Budapest. Very low average speed. High downforce. Multiple direction changes. Hot dusty conditions in August. Tyre strategy and pit stops decisive.',teamHistory:'Mercedes dominant historically. McLaren has been excellent at Hungaroring. Ferrari competitive. Red Bull has underperformed relative to usual level here.',driverHistory:'Hamilton 8 wins — unmatched dominance. Verstappen won 2022. Piastri won 2024 — McLaren pace advantage. Norris podium contender. Alonso has 2 wins here.',circuitBias:'Favours maximum downforce, efficient slow-corner cars, good traction. Grid position very important. Undercut strategy at pit stops can work. Rain is biggest upset factor.'},
  zandvoort:{difficulty:'High. Banked corners unique challenges. High-speed flowing layout. Very narrow — overtaking nearly impossible. Qualifying critical.',trackNotes:'Circuit Zandvoort, Netherlands. Unique banked Hugenholtz and final banking corners. Tight and narrow. Coastal weather variable. Enormous Dutch crowd.',teamHistory:'Red Bull completely dominated 2021-2023. McLaren competitive in 2024. Mercedes improving. Ferrari historically struggled with setup requirements here.',driverHistory:'Verstappen has won every Dutch GP since return — home hero. Russell won 2024. Norris competitive. Hamilton has not won here. Leclerc qualifying threat.',circuitBias:'Favours Red Bull historically but 2026 regs change this. High downforce critical. Track position once lost is nearly impossible to recover. Weather is biggest variable.'},
  monza:{difficulty:'Medium-low. Full throttle 75% of lap. Minimal downforce. Braking from 350kph into chicanes. Slipstream racing in qualifying and race.',trackNotes:'Autodromo Nazionale Monza, Italy. Fastest race of year. Minimal downforce setup. Two chicanes and Parabolica. Tifosi create electric Ferrari atmosphere.',teamHistory:'Ferrari have incredible Monza history. Mercedes dominant hybrid era. McLaren won 2021 (Ricciardo). Red Bull competitive but not as strong as high-downforce tracks.',driverHistory:'Hamilton 5 wins. Leclerc emotional 2019 win — crowd favourite here. Ricciardo 2021. Verstappen won 2022. Ferrari drivers always extra motivated at home. Sainz podium regular.',circuitBias:'Favours powerful engines, low-drag setups, brave braking. Slipstreaming in race makes predictions difficult. Safety car near guaranteed. Ferrari always dangerous at Monza.'},
  sepang:{difficulty:'Medium-high. Two very long straights joined by a slow hairpin, plus fast sweeping corners. Heavy tyre wear in the heat.',trackNotes:'Sepang International Circuit, Malaysia — hosting the 2026 Bahrain Grand Prix (Oct 2–4). First F1 race here since 2017. Hot and humid, with afternoon thunderstorms common; rain can change the race quickly.',teamHistory:'No data for current cars — F1 last raced here in 2017. Cars with strong straight-line speed and good tyre management in heat should suit it.',driverHistory:'Few current drivers have raced F1 here; most of the grid has no F1 experience at Sepang.',circuitBias:'Power + tyre management; rain risk'},
  ifema_madrid:{difficulty:'Unknown — brand new circuit for 2026. Street circuit through IFEMA convention area of Madrid. Expected to be high difficulty.',trackNotes:'Madring, a street circuit around IFEMA Madrid — 2026 debut. No historical data. Expected tight street layout with smooth asphalt and technical sections.',teamHistory:'No historical data. Teams with strong street circuit packages expected to excel. Ferrari and Mercedes prepared most extensively.',driverHistory:'No data. Drivers with strong street circuit records (Leclerc, Verstappen, Alonso) expected to adapt quickly. Rookies disadvantaged on unknown track.',circuitBias:'Favour teams with best street circuit development and simulator preparation. First race = significantly higher uncertainty and upset probability.'},
  baku:{difficulty:'Extreme. 2.2km straight combined with incredibly narrow old city section (7.6m wide). Highest crash probability on calendar. Mechanical failures from kerb strikes common.',trackNotes:'Baku City Circuit, Azerbaijan. Ultra-high-speed straight plus medieval city section. Heavy braking. Safety car probability near 100%.',teamHistory:'Red Bull dominant 2018-2023. Ferrari very competitive — power unit excels on long straight. Mercedes struggled with instability here. McLaren improving.',driverHistory:'Leclerc has pole multiple times — exceptionally fast in Baku qualifying. Perez won multiple times — his best circuit. Verstappen won 2021. Safety cars create dramatic result changes. Sainz podium regular.',circuitBias:'Favours strong power units, brave qualifying drivers, street circuit specialists. Safety cars guaranteed — tyre strategy around VSC/SC decisive. Mechanical failures common.'},
  marina_bay:{difficulty:'Extreme. Night race, humidity and heat punishing drivers physically. Long slow street circuit with zero overtaking. Fastest lap irrelevant — track position is everything.',trackNotes:'Marina Bay Street Circuit, Singapore. Night race with 1000+ LED lights. Longest race duration — often near 2-hour limit. Extreme heat and humidity. Very high physical demand.',teamHistory:'Ferrari and Red Bull dominated. Mercedes strong 2014-2018. McLaren has struggled here. Setup compromise between high downforce and thermal management is critical.',driverHistory:'Hamilton 4 wins but not dominant recently. Verstappen won 2023. Sainz won 2023. Alonso excellent physical fitness helps in heat. Leclerc strong qualifier.',circuitBias:'Favours high downforce, physically fit drivers, teams with reliable cars in high temps. Safety cars guaranteed. Grid position = finishing position in most races.'},
  americas:{difficulty:'High. Long lap with all corner types. Famous Turn 1 uphill into fast esses. Very different circuit requiring unique rhythm. Weather variable.',trackNotes:'Circuit of the Americas, Austin Texas. Most varied lap on calendar — slow hairpins, fast sweepers, elevation changes, long back straight.',teamHistory:'Red Bull dominant 2021-2023. Mercedes strong historically. Ferrari competitive. McLaren improved significantly 2024. Track suits adaptable cars.',driverHistory:'Hamilton 6 wins — loves this circuit. Verstappen dominant recently. Leclerc fast but occasional errors. Sainz podium contender. Norris strong 2024 pace.',circuitBias:'Favours well-rounded cars with good mechanical grip. Overtaking possible at T1 and T12. Long race means tyre management crucial.'},
  rodriguez:{difficulty:'High. Altitude 2200m drastically reduces engine power and aero efficiency. Unique aerodynamic behaviour. Cool night temperatures. Crowd is massive.',trackNotes:'Autodromo Hermanos Rodriguez, Mexico City. Altitude reduces air density — affects engines, aero, and brakes. Long stadium straight section. Cool nights.',teamHistory:'Red Bull dominant — engine and aero package suited altitude. Mercedes struggled with overheating. Ferrari improved. Perez is crowd hero with massive support.',driverHistory:'Verstappen won 2022 and 2023. Perez won 2021 — emotional home win. Hamilton won 2016 and 2019. Altitude suits certain power units. Leclerc struggles here.',circuitBias:'Favours power units with best high-altitude performance, efficient aerodynamics. Overheating major risk. Mexican crowd motivation for Perez could be decisive.'},
  interlagos:{difficulty:'High. Anti-clockwise unusual for neck muscles. Unpredictable weather — rain almost guaranteed. Long straight but tight infield.',trackNotes:'Autodromo Jose Carlos Pace, Sao Paulo. Iconic anti-clockwise circuit. Famous for dramatic weather. Senna S legendary corner sequence. Passionate Brazilian crowd.',teamHistory:'Ferrari and Mercedes historically strong. Red Bull dominant in dry. McLaren has won here. Weather randomiser means wet weather preparation matters enormously.',driverHistory:'Hamilton 5 wins — supernatural in wet conditions here, especially 2008 and 2021. Verstappen won 2022. Alonso iconic 2012 performance. Brazilian drivers always extra motivated.',circuitBias:'Favours rain specialists and versatile cars. Weather is ultimate variable — Hamilton probability increases dramatically if it rains. Safety car near certain.'},
  las_vegas:{difficulty:'Medium. Long strip straight at 340kph. Tight casino section. Cold night temperatures cause tyre temperature issues. Extreme tyre behaviour in cold.',trackNotes:'Las Vegas Strip Circuit. November night race — very cold track temps. Long main straight on the Strip. Tyre warm-up critical in cold conditions.',teamHistory:'Red Bull dominated 2023. Ferrari very fast 2024 (Leclerc win). Mercedes competitive on long straights. McLaren struggled with cold tyre temps initially.',driverHistory:'Leclerc won 2024 — excellent pace management in cold. Verstappen won 2023 in slow race. Russell and Hamilton competitive here. Cold weather specialist advantage.',circuitBias:'Favours cars generating tyre heat quickly, strong straight-line speed, power unit efficiency. Cold temperatures make opening laps chaotic. Safety car probability high.'},
  losail:{difficulty:'High. Flowing high-speed circuit with minimal run-off. Extreme tyre degradation — one of highest deg tracks on calendar. Night race in desert heat.',trackNotes:'Lusail International Circuit, Qatar. Fast flowing layout. Minimal overtaking opportunities. Very high tyre degradation — particularly rear wear. Night race.',teamHistory:'Red Bull dominant when Qatar joined calendar. Mercedes competitive in 2023. Ferrari improving. McLaren showed good race pace in 2024.',driverHistory:'Verstappen won 2021 and 2023. Hamilton fast here. Leclerc improving. Norris won Sprint in 2023. Tyre management ability is the most valued skill here.',circuitBias:'Favours efficient tyre management, smooth driving styles. Multiple pit stops common. Tyre deg so extreme that strategy almost always determines winner.'},
  yas_marina:{difficulty:'Medium. Season finale psychological pressure. Smooth track with good grip. Mix of slow and fast sections. Tyre deg manageable. Overtaking possible.',trackNotes:'Yas Marina Circuit, Abu Dhabi. Season finale venue. 2021 layout revision opened more overtaking. Smooth surface. Twilight race as sun sets.',teamHistory:'Red Bull dominant recent years. Mercedes won many times. Ferrari competitive. Generally representative circuit — best team/driver combination prevails.',driverHistory:'Verstappen won 2021 (title decider), 2022, 2023. Hamilton dominant 2014-2019. Leclerc competitive. Championship leaders tend to be conservative managing risks.',circuitBias:'Favours well-rounded cars. Overtaking possible into T6 and T9. Championship context can override performance — leaders manage race risks carefully.'},
  suzuka:{difficulty:'Extreme. Figure-8 layout. 130R one of most iconic corners in motorsport. S-curves require perfect rhythm. Weather extremely variable — typhoon risk.',trackNotes:'Suzuka Circuit, Japan. Technical masterpiece. S-curves, Spoon curve, and 130R demand bravery. Passionate Japanese fans. Weather very unpredictable.',teamHistory:'Red Bull dominated 2022-2024. Mercedes very strong historically. Ferrari competitive. True test of complete car performance — no weaknesses tolerated.',driverHistory:'Verstappen loves Suzuka — won 2022 and 2023. Hamilton won 2015. Leclerc fast but errors under pressure. Alonso exceptional here. Japanese fans passionate.',circuitBias:'Favours aerodynamically efficient cars, precise setups, brave drivers. Best drivers on the grid shine here. Rain makes it exceptionally dangerous.'},
  albert_park:{difficulty:'Medium. Street-style park circuit but more open. Season opener means new cars not fully understood — maximum uncertainty.',trackNotes:'Albert Park Circuit, Melbourne. Anti-clockwise semi-street through a public park. Smooth surface. Season opener chaos common — teams pushing new cars.',teamHistory:'Red Bull dominated 2022-2024 season openers. Ferrari competitive. Mercedes difficult patch here. McLaren showed excellent 2024 season opener pace.',driverHistory:'Verstappen wins Australia regularly. Hamilton won multiple times. Leclerc took 2022 dramatically. Season openers unpredictable — DNFs common.',circuitBias:'Favours reliable cars over pure pace — DNFs common. Track evolves rapidly as rubber goes down. Reliability and strategy more important than raw speed.'},
  shanghai:{difficulty:'Medium-high. Long back straight enables overtaking. Technical sector 2. Tyre degradation significant. Cold grey spring conditions often.',trackNotes:'Shanghai International Circuit, China. Long back straight with DRS. Complex T6-7 hairpin. Spring conditions often cold and slippery.',teamHistory:'Red Bull dominant 2022-2024. Ferrari competitive. Mercedes strong historically. McLaren improved dramatically 2024.',driverHistory:'Verstappen dominant recently. Hamilton 6 wins — historically exceptional. Alonso 2 wins. Leclerc looking for first China win. Norris showed strong 2024 pace.',circuitBias:'Favours qualifying pace for track position and strong tyre management for strategy. Overtaking on back straight possible. Sprint weekends add extra complexity.'},
  spa:{difficulty:'Extreme. One of the longest and most demanding circuits — 7.004km. Famously unpredictable weather, often raining in one sector while dry in another. Eau Rouge/Raidillon is one of the most iconic sequences in motorsport.',trackNotes:'Circuit de Spa-Francorchamps, Belgium. Legendary Ardennes forest circuit. Eau Rouge flat out in a modern F1 car. Kemmel Straight DRS zone. Massive elevation changes. Pouhon corner ultra-fast. Weather completely unpredictable — intermediate tyres essential.',teamHistory:'Red Bull strong in recent years. Ferrari very competitive at Spa historically. Mercedes dominated the hybrid era. McLaren has been fast in 2024-2026. Aston Martin surprised at Spa in 2023.',driverHistory:'Hamilton 6 wins at Spa — absolute master in the wet. Verstappen won 2022 and 2023. Leclerc nearly won 2019. Alonso incredibly experienced here — 2 wins. Norris showed great Spa pace in 2024.',circuitBias:'Favours high-power engines, aerodynamically efficient cars, and rain specialists. Wet conditions completely reshuffle the order. Long straights reward top speed. Safety car probability very high.'},
};

/* ═══════════════════════════════════════════════
   BUILD PROMPT FOR AI MODEL
   ═══════════════════════════════════════════════ */
function buildPrompt(race, useQualy, predType){
  const sorted=[...drivers].sort((a,b)=>b.pts-a.pts);
  const cData = CIRCUIT_DATA[race.circuitId] || {};

  const finH={};
  completedRaces.forEach(r=>{
    r.results.forEach((dId,i)=>{ if(!finH[dId]) finH[dId]=[]; finH[dId].push(i+1); });
  });

  const driverLines = sorted.slice(0,15).map(d=>{
    const fins=finH[d.driverId]||[];
    const avg=fins.length?(fins.reduce((a,b)=>a+b,0)/fins.length).toFixed(1):'N/A';
    const last3=fins.slice(-3).join(',') || 'N/A';
    const wins=fins.filter(p=>p===1).length;
    let grid='';
    if(useQualy){ const g=qualifyingGrid.find(q=>q.driverId===d.driverId); grid=g?' Grid:P'+g.pos:''; }
    return `${d.name}(${d.abbr}) ${teamName(d.team)} ${d.pts}pts avg:P${avg} last3:[${last3}] wins:${wins}${grid}`;
  }).join('\n');

  const results=completedRaces.map(r=>{
    const top3=r.results.slice(0,3).map((id,i)=>{const d=drivers.find(x=>x.driverId===id);return 'P'+(i+1)+':'+(d?.abbr||id);}).join(' ');
    return 'R'+r.round+' '+r.raceName+': '+top3;
  }).join('\n');

  // Season story, worked out from the results so it never goes stale.
  const abbrOf = id => drivers.find(x=>x.driverId===id)?.abbr || id;
  const gps = completedRaces.filter(r=>!String(r.round).endsWith('S') && r.results?.length);
  const winTally = {};
  gps.forEach(r=>{ const w=abbrOf(r.results[0]); winTally[w]=(winTally[w]||0)+1; });
  const teamWins = {};
  gps.forEach(r=>{ const t=teamName(drivers.find(x=>x.driverId===r.results[0])?.team||''); if(t) teamWins[t]=(teamWins[t]||0)+1; });
  const storyNotes = [
    sorted.length>1 ? `- Championship: ${sorted[0].abbr} leads on ${sorted[0].pts} pts, ${sorted[0].pts-sorted[1].pts} ahead of ${sorted[1].abbr}.` : '',
    gps.length ? `- Race wins this season: ${Object.entries(winTally).sort((a,b)=>b[1]-a[1]).map(([a,n])=>a+' '+n).join(', ')}.` : '- No races completed yet this season.',
    gps.length ? `- Wins by team: ${Object.entries(teamWins).sort((a,b)=>b[1]-a[1]).map(([t,n])=>t+' '+n).join(', ')}.` : '',
    gps.length ? `- Last ${Math.min(5,gps.length)} race winners (oldest first): ${gps.slice(-5).map(r=>'R'+r.round+' '+abbrOf(r.results[0])).join(', ')}.` : '',
  ].filter(Boolean).join('\n');

  let qualyStr = 'No qualifying yet.';

  if (predType === 'race') {
    qualyStr = useQualy && qualifyingGrid.length
      ? 'QUALIFYING:\n' + qualifyingGrid.slice(0,10).map(q=>{
          const d=drivers.find(x=>x.driverId===q.driverId);
          return 'P'+q.pos+': '+(d?.name||q.driverId);
        }).join('\n')
      : 'No qualifying yet.';
  } else if (predType === 'sprint') {
    qualyStr = sprintQualiGrid.length
      ? 'SPRINT QUALIFYING (THIS IS THE STARTING GRID FOR THE SPRINT RACE - VERY IMPORTANT):\n' + sprintQualiGrid.slice(0,10).map(q=>{
          const d=drivers.find(x=>x.driverId===q.driverId);
          return 'P'+q.pos+': '+(d?.name||q.driverId);
        }).join('\n')
      : 'No sprint qualifying data.';
  }

  // ── ML LAYER 1: Driver form trend (improving vs declining) ──
  const raceOnly = completedRaces.filter(r => !String(r.round).includes('S'));
  const drvFormMap = {};
  raceOnly.forEach(r => {
    r.results.forEach((dId, i) => {
      if (!drvFormMap[dId]) drvFormMap[dId] = [];
      drvFormMap[dId].push(i + 1);
    });
  });
  const formTrendLines = sorted.slice(0, 16).map(d => {
    const fins = drvFormMap[d.driverId] || [];
    if (!fins.length) return `${d.abbr}: no finishes yet`;
    const last = fins.slice(-3);
    const avg  = (last.reduce((a,b)=>a+b,0)/last.length).toFixed(1);
    const diff = last.length >= 2 ? last[last.length-1] - last[0] : 0;
    const arrow = diff <= -2 ? '↑SURGING' : diff >= 2 ? '↓FADING' : '→STABLE';
    return `${d.abbr}: [${last.map(p=>'P'+p).join(',')}] avg:P${avg} ${arrow}`;
  }).join('\n');

  // ── ML LAYER 2: Circuit-specific AI correction (learn from past errors here) ──
  const circuitPreds = cachedPredictions.filter(p =>
    p.circuit_id === race.circuitId && p.accuracy !== null && p.actual_results?.length && !p.prediction?._fallback
  );
  let circuitLearning = '';
  if (circuitPreds.length) {
    circuitLearning = '\n\n🔄 AI SELF-CORRECTION — YOUR PREVIOUS PREDICTIONS AT THIS EXACT CIRCUIT:\n';
    circuitPreds.slice(-3).forEach(p => {
      const pred5  = (p.prediction?.top10 || []).slice(0, 5);
      const act5   = (p.actual_results || []).slice(0, 5);
      const errors = pred5.map(predD => {
        const actualIdx = (p.actual_results || []).map(driverAbbr).indexOf(driverAbbr(predD));
        if (actualIdx === -1 || Math.abs(predD.pos - (actualIdx+1)) < 3) return null;
        const d = drivers.find(x => x.driverId === predD.driverId);
        return `${d?.abbr||predD.abbr} pred P${predD.pos} → actual P${actualIdx+1}`;
      }).filter(Boolean);
      const p5s = pred5.map((x,i)=>`P${i+1}:${x.abbr}`).join(' ');
      const a5s = act5.map((id,i)=>{const d=drivers.find(x=>x.driverId===id);return `P${i+1}:${d?.abbr||id}`;}).join(' ');
      circuitLearning += `• ${p.race_name} [${p.pred_type}] → ${p.accuracy}% accurate\n`;
      circuitLearning += `  Predicted: ${p5s}\n  Actual:    ${a5s}\n`;
      if (errors.length) circuitLearning += `  ❌ Errors: ${errors.slice(0,4).join(' | ')}\n`;
    });
    circuitLearning += 'MANDATORY: Use these errors to CORRECT your prediction. Do NOT repeat the same mistakes.';
  }

  // ── ML LAYER 3: Systematic bias detection across ALL predictions ──
  const recentScored = cachedPredictions.filter(p => p.accuracy !== null && p.actual_results?.length && !p.prediction?._fallback).slice(-12);
  const biasMap = {}; // abbr → {totalDiff, count}
  recentScored.forEach(p => {
    (p.prediction?.top10||[]).forEach(predD => {
      const abbr = driverAbbr(predD);
      const actualIdx = (p.actual_results||[]).map(driverAbbr).indexOf(abbr);
      if (actualIdx === -1) return;
      const diff = predD.pos - (actualIdx + 1); // + means AI ranked too low, - means too high
      if (!biasMap[abbr]) biasMap[abbr] = {total:0, count:0};
      biasMap[abbr].total += diff;
      biasMap[abbr].count++;
    });
  });
  const biasLines = Object.entries(biasMap)
    .filter(([,v]) => v.count >= 2 && Math.abs(v.total/v.count) >= 1.5)
    .map(([abbr, v]) => {
      const avg = (v.total / v.count).toFixed(1);
      return avg > 0
        ? `${abbr}: AI consistently ranks TOO LOW (avg ${avg} places below actual finish)`
        : `${abbr}: AI consistently ranks TOO HIGH (avg ${Math.abs(avg)} places above actual finish)`;
    });

  // ── ML LAYER 4: Recent accuracy summary ──
  const avgAcc = recentScored.length
    ? Math.round(recentScored.reduce((a,p)=>a+p.accuracy,0)/recentScored.length)
    : null;
  const mlSummary = avgAcc !== null
    ? `\n\n📊 AI PERFORMANCE SUMMARY (last ${recentScored.length} predictions): avg accuracy ${avgAcc}%${biasLines.length?'\nSYSTEMATIC BIASES TO CORRECT:\n'+biasLines.map(b=>'  • '+b).join('\n'):''}`
    : '';

  return `You are a neutral, data-driven F1 race analyst with self-learning capabilities.${mlSummary}${circuitLearning}${of1Insights} Your only job is to predict the top 10 finishing order for ${predType === 'sprint' ? 'the SPRINT RACE' : 'the GRAND PRIX'} at ${race.name} (${race.circuit}, Round ${race.round}).

CIRCUIT PROFILE:
- Type: ${race.type}
- Difficulty: ${cData.difficulty||'Standard'}
- Team history here: ${cData.teamHistory||'N/A'}
- Driver history here: ${cData.driverHistory||'N/A'}
- Circuit bias: ${cData.circuitBias||'N/A'}

${SEASON} COMPLETED RACE RESULTS:
${results}
KEY ${SEASON} STORY NOTES (from the official results):
${storyNotes}

DRIVER STANDINGS & FORM (name, team, pts, avg finish this season, last 3 finishes):
${driverLines}

DRIVER FORM TREND (last 3 races — surging/fading/stable):
${formTrendLines}

CONSTRUCTOR STANDINGS: ${constructors.sort((a,b)=>b.pts-a.pts).map(c=>c.name+':'+c.pts).join(', ')}

SESSION DATA FOR THIS RACE:
${qualyStr}

RACE DAY WEATHER FORECAST:
${raceWeatherData
  ? `${raceWeatherData.icon} Temperature: ${raceWeatherData.hi}°C high / ${raceWeatherData.lo}°C low | Rain probability: ${raceWeatherData.rain}%${raceWeatherData.rain>=40?' — WET CONDITIONS LIKELY, significantly increases probability of safety cars, upsets and rain specialists (Hamilton, Alonso, Verstappen)':raceWeatherData.rain>=20?' — some rain risk, consider wet weather specialists':' — dry conditions expected'}`
  : 'Weather data unavailable.'}
${raceWeatherChange ? `WEATHER CHANGE SINCE EARLIER: ${raceWeatherChange}. Factor in this SHIFT, not just the current value — a worsening forecast raises upset/safety-car risk; an improving one favours the established order.` : ''}

CRITICAL RULES FOR YOUR PREDICTION:
1. DO NOT default to the championship leader winning every race. Assess on circuit merits and recent form.
2. If qualifying/grid data is provided, it MUST heavily influence your prediction. Pole sitter wins ~40% of races. Do NOT drop a pole sitter more than 2 positions without a specific reason.
3. For SPRINT RACES: sprint qualifying grid = starting grid. Weight it 60%+ in your prediction. Drivers rarely move more than 3-4 places.
4. Consider each driver's SPECIFIC history at this circuit. A driver who has won at Monaco multiple times ranks higher there regardless of championship position.
5. FORM MATTERS: Drivers marked ↑SURGING rank higher than their standing suggests. Drivers marked ↓FADING rank lower.
6. RECENT RACES MATTER MOST: the last five results show the current pecking order better than early-season results, because cars develop through the year.
7. Use the story notes and form data above for who is winning now; do not rely on what you remember about earlier seasons.
8. Distribute win probabilities realistically — top 10 must sum to exactly 100%.
9. BE BOLD. Do not copy the championship order. Let circuit characteristics, form, and history guide you.
10. If SYSTEMATIC BIASES appear above, actively correct them.

Respond ONLY with this exact JSON structure. Fill in ALL 10 positions based purely on your analysis. Do NOT copy the example names — replace them with your actual prediction:
{"top10":[{"pos":1,"driverId":"FILL_BASED_ON_DATA","name":"FULL NAME","abbr":"ABB","team":"Team Name","winProb":XX.X,"reasoning":"specific reason referencing grid position, circuit history, or current form"},{"pos":2,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":3,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":4,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":5,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":6,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":7,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":8,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":9,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":10,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."}],"overallAnalysis":"Paragraph 1: How this specific circuit suits the current ${SEASON} car hierarchy — which teams are favoured and why. Paragraph 2: Key drivers to watch based on their history at this track and current form. Paragraph 3: What could cause an upset or surprise result.","keyFactor":"The single most important factor that will decide this race","upsetAlert":"Name one driver who could significantly outperform expectations and the specific reason why"}`;}
/* ═══════════════════════════════════════════════
   MID-RACE LIVE PREDICTION
   Works without OpenF1 — user manually inputs current positions from
   what they're watching, AI re-predicts the final result.
   ═══════════════════════════════════════════════ */
// Maps our circuitId → F1.com URL slug (used by f1live.js scraper)
const F1COM_SLUG = {
  albert_park:'australia', shanghai:'china', suzuka:'japan',
  miami:'miami', villeneuve:'canada', monaco:'monaco',
  catalunya:'spain', red_bull_ring:'austria', silverstone:'great-britain',
  hungaroring:'hungary', zandvoort:'netherlands', monza:'italy',
  ifema_madrid:'spain', baku:'azerbaijan', sepang:'bahrain', marina_bay:'singapore',
  americas:'united-states', rodriguez:'mexico', interlagos:'brazil',
  las_vegas:'las-vegas', losail:'qatar', yas_marina:'abu-dhabi',
  spa:'belgium', sakhir:'bahrain', jeddah:'saudi-arabia',
};

/* Try to auto-fetch current race result from F1.com.
   F1.com publishes ~30 min after the session ends. Returns the parsed
   positions if available, or null if F1.com hasn't published yet. */
async function tryFetchFromF1Com(race, kind){
  if(!race?.circuitId) return null;
  const slug = F1COM_SLUG[race.circuitId];
  if(!slug) return null;
  try {
    const url = `/api/f1live?year=${SEASON}&slug=${slug}&kind=${kind}`;
    const r = await fetch(url, {signal: AbortSignal.timeout(15000)});
    const data = await r.json();
    if(!data?.ok || !data?.published) return null;
    return data.results ? escDeep(data.results) : null;
  } catch(e) {
    console.warn('F1.com scrape failed:', e.message);
    return null;
  }
}

/* Fetch and render current positions in the Live tab from all available sources.
   Order: F1.com (post-session) → Supabase cache → OpenF1 (when unlocked).
   During an active live race, all sources are typically empty — that's expected. */
async function refreshLivePositions(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  const btn   = $('livePosRefreshBtn');
  const grid  = $('livePosGrid');
  const status = $('livePosStatus');
  if(!race){
    status.innerHTML = '<span style="color:var(--red)">Select a race first.</span>';
    return;
  }
  btn.disabled = true;
  btn.textContent = '⏳ Fetching...';
  status.innerHTML = '<span style="color:var(--muted)">Checking F1.com → Supabase → OpenF1…</span>';

  let positions = null;
  let source = '';

  // 0. Supabase first — the live bridge writes here every 5 seconds during races
  try {
    const sbSessions = await sbGet(`sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&order=fetched_at.desc&limit=10`);
    if(sbSessions?.length){
      // Prefer Race grid if available, else most recent
      const raceRow = sbSessions.find(s => s.session_name === 'Race') || sbSessions[0];
      if(raceRow?.grid_data?.length){
        positions = raceRow.grid_data.map(g => ({ pos: g.pos, abbr: g.abbr, team: '', retired: false }));
        const age = Math.round((Date.now() - new Date(raceRow.fetched_at).getTime()) / 1000);
        source = `Supabase live (${raceRow.session_name}, ${raceRow.source || 'cached'}, ${age}s ago)`;
      }
    }
  } catch(e) { /* keep trying */ }

  // 1. F1.com (fastest post-session)
  if(!positions){
    try {
      const f1Results = await tryFetchFromF1Com(race, 'race');
      if(f1Results?.length){
        positions = f1Results.map(r => ({ pos: r.position, abbr: r.tla, team: r.team, retired: false }));
        source = 'F1.com (race result)';
      }
    } catch(e) { /* keep trying */ }
  }

  // 2. Sprint (if race is sprint weekend and main race hasn't published)
  if(!positions){
    try {
      const sprintRes = await tryFetchFromF1Com(race, 'sprint');
      if(sprintRes?.length){
        positions = sprintRes.map(r => ({ pos: r.position, abbr: r.tla, team: r.team, retired: false }));
        source = 'F1.com (sprint result)';
      }
    } catch(e) {}
  }

  // 3. Qualifying (most recent published session)
  if(!positions){
    try {
      const qRes = await tryFetchFromF1Com(race, 'quali');
      if(qRes?.length){
        positions = qRes.map(r => ({ pos: r.position, abbr: r.tla, team: r.team, retired: false }));
        source = 'F1.com (qualifying)';
      }
    } catch(e) {}
  }


  btn.disabled = false;
  btn.textContent = '🔄 Refresh';

  if(!positions?.length){
    const liveLabel = getLiveSessionLabel(race);
    if(liveLabel){
      status.innerHTML = `<span style="color:var(--gold)">🔴 ${liveLabel} in progress — F1.com publishes positions after the session ends. <a href="https://www.formula1.com/en/live" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Watch on F1.com →</a></span>`;
    } else {
      status.innerHTML = '<span style="color:var(--gold)">⚠ No positions available yet for this race. F1.com typically publishes ~30 min after each session ends.</span>';
    }
    grid.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:12px;text-align:center;background:rgba(0,0,0,.2);border-radius:8px">No data — enter positions manually in the Mid-Race AI card below.</div>';
    return;
  }

  status.innerHTML = `<span style="color:#3fc07a">✓ ${positions.length} positions loaded from ${source}</span>`;

  grid.innerHTML = positions.map(p => {
    const d = drivers.find(x => x.abbr === p.abbr);
    const col = teamCol(d?.team || 'unknown');
    return `<div style="display:grid;grid-template-columns:36px 1fr 1fr;gap:10px;padding:9px 12px;background:rgba(0,0,0,.3);border-left:3px solid ${col};border-radius:6px;margin-bottom:4px;align-items:center">
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${col}">P${p.pos}</div>
      <div style="font-weight:700">${p.abbr}</div>
      <div style="font-size:11px;color:var(--dim);text-align:right">${d ? (d.name || '') : (p.team || '')}</div>
    </div>`;
  }).join('');

  // Auto-fill the mid-race input too so the AI prediction uses fresh data
  if(positions.length >= 5){
    $('midRacePositions').value = positions.slice(0, 10).map(p => p.abbr).join(', ');
  }
}

/* Auto-fill the mid-race positions input from F1.com if available. */
async function autoFetchMidRaceFromF1(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  if(!race){
    $('midRaceStatus').innerHTML = '<span style="color:var(--red)">Select a race first.</span>';
    return;
  }
  $('midRaceStatus').innerHTML = '<span style="color:var(--muted)">🌐 Trying to fetch from F1.com…</span>';
  const results = await tryFetchFromF1Com(race, 'race');
  if(!results?.length){
    $('midRaceStatus').innerHTML = `<span style="color:var(--gold)">⚠ F1.com hasn't published live positions yet — they only publish after the session ends. Enter manually from F1 TV / broadcast.</span>`;
    return;
  }
  // Top 10
  const top10 = results.slice(0, 10).map(r => r.tla).join(', ');
  $('midRacePositions').value = top10;
  // F1.com gives final lap count for the leader
  const leaderLaps = results[0]?.laps || 0;
  if(leaderLaps && !$('midRaceLap').value) $('midRaceLap').value = leaderLaps;
  $('midRaceStatus').innerHTML = `<span style="color:#3fc07a">✓ Loaded ${results.length} positions from F1.com — review & set total laps, then Generate</span>`;
}

async function runMidRacePrediction(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  if(!race){
    $('midRaceStatus').innerHTML = '<span style="color:var(--red)">Select a race first.</span>';
    return;
  }
  // ── Always pull the FRESHEST live-bridge positions from Supabase ──
  // Every tap re-fetches and overwrites the input with the current live grid,
  // so a mid-race prediction always reflects the latest running order — unless
  // the user manually typed a custom order (tracked via data-manual flag).
  await ensureFreshDataFromSupabase(race);
  const posEl = $('midRacePositions');
  const userEdited = posEl?.dataset?.manual === '1' && posEl.value.trim();
  if(window._latestRaceGrid?.length && !userEdited){
    posEl.value = window._latestRaceGrid.filter(g => g.abbr && g.pos).sort((a, b) => a.pos - b.pos).map(g => g.abbr).join(', ');
    const ds = window._lastDataSources?.['Race'];
    const ageTxt = ds ? ` (${ds.age_sec}s old)` : '';
    $('midRaceStatus').innerHTML = `<span style="color:#3fc07a">✓ Loaded latest live positions${ageTxt}</span>`;
  }
  const posInput = ($('midRacePositions').value || '').trim();

  // ── Auto-derive CURRENT LAP from the live grid (leader's lap), with manual override ──
  // Re-read on every tap (F1's own lap counter when the feed has it) unless typed in by hand.
  let curLap = $('midRaceLap').dataset.manual === '1' ? parseInt($('midRaceLap').value || '0', 10) : 0;
  if(!curLap && window._latestRaceGrid?.length){
    curLap = +(window._latestRaceGrid.find(g => g.curLap)?.curLap) || Math.max(...window._latestRaceGrid.map(g => g.lap || 0), 0);
    if(curLap) $('midRaceLap').value = curLap;
  }
  // ── Auto-derive TOTAL LAPS: live feed → circuit map → manual ──
  let totalLaps = parseInt($('midRaceTotalLaps').value || '0', 10);
  if(!totalLaps){
    const feedTotal = window._latestRaceGrid?.find(g => g.totalLaps)?.totalLaps;
    totalLaps = feedTotal || CIRCUIT_TOTAL_LAPS[race.circuitId] || 0;
    if(totalLaps) $('midRaceTotalLaps').value = totalLaps;
  }

  if(!posInput){
    $('midRaceStatus').innerHTML = '<span style="color:var(--red)">No live positions yet — make sure the race is running and the bridge is on.</span>';
    return;
  }
  if(!curLap || !totalLaps || curLap > totalLaps){
    $('midRaceStatus').innerHTML = '<span style="color:var(--red)">Could not auto-detect laps. Tap "manual lap entry" below to set them.</span>';
    return;
  }

  // Parse driver codes — accept comma/space separated, normalize case
  const codes = posInput.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  if(codes.length < 5){
    $('midRaceStatus').innerHTML = '<span style="color:var(--red)">Enter at least 5 positions.</span>';
    return;
  }

  // Resolve abbreviations to driver objects
  const currentOrder = codes.map((abbr, i) => {
    const d = drivers.find(x => x.abbr === abbr);
    return { pos: i+1, abbr, name: d?.name || abbr, team: d?.team || 'unknown' };
  });

  const btn = $('midRaceBtn');
  btn.disabled = true;
  btn.textContent = '⏳ AI thinking…';
  $('midRaceStatus').innerHTML = '<span style="color:var(--muted)">Analyzing race state, tyre wear, gaps, undercut/overcut windows…</span>';
  $('midRaceResult').innerHTML = '';

  const lapsLeft = totalLaps - curLap;
  const racePct  = Math.round((curLap / totalLaps) * 100);

  // Build the set of drivers ACTIVE in the race (those in user's input)
  const activeAbbrs = new Set(currentOrder.map(o => o.abbr));
  // Anyone in the championship NOT in the input = DNF / retired / out of race
  const dnfDrivers = drivers
    .filter(d => !activeAbbrs.has(d.abbr))
    .map(d => d.abbr)
    .slice(0, 20);

  // What the live timing knows about each car: gap, tyre and its age, stops.
  const TYRE_NAME = { S: 'Soft', M: 'Medium', H: 'Hard', I: 'Intermediate', W: 'Wet' };
  const liveBy = Object.fromEntries((window._latestRaceGrid || []).map(g => [String(g.abbr || '').toUpperCase(), g]));
  const currentPosLines = currentOrder.map(o => {
    const g = liveBy[o.abbr], bits = [];
    if(g){
      bits.push(o.pos === 1 ? 'leader' : g.gap ? `${g.gap} behind the leader` : '');
      if(g.tyre) bits.push(`${TYRE_NAME[g.tyre] || g.tyre} tyres${g.tyreAge != null ? `, ${g.tyreAge} laps old` : ''}`);
      if(g.pitCount != null) bits.push(`${g.pitCount} pit stop${g.pitCount === 1 ? '' : 's'} so far`);
      if(g.inPit) bits.push('in the pit lane now');
    }
    return `P${o.pos}: ${o.abbr} (${teamName(o.team)})${bits.filter(Boolean).length ? ' · ' + bits.filter(Boolean).join(' · ') : ''}`;
  }).join('\n');
  const FLAG_TEXT = { AllClear: 'green flag', Yellow: 'yellow flag', SCDeployed: 'safety car out', VSCDeployed: 'virtual safety car', VSCEnding: 'virtual safety car ending', Red: 'red flag' };
  const trackNow = FLAG_TEXT[(window._latestRaceGrid || []).find(g => g.flag)?.flag] || '';

  // Pace context — only for ACTIVE drivers
  const activePaceLines = currentOrder.map(o => {
    const d = drivers.find(x => x.abbr === o.abbr);
    return d ? `${o.abbr} ${d.name} (${teamName(d.team)}) ${d.pts}pts season` : `${o.abbr}`;
  }).join('\n');

  const priorPredBlock = lastPrediction?.top10?.length
    ? `\n═══ PRE-RACE AI PREDICTION (generated before lights out) ═══\n${lastPrediction.top10.map((a,i)=>`P${i+1}: ${a}`).join('\n')}${lastPrediction.reasoning ? `\nOriginal reasoning: ${lastPrediction.reasoning}` : ''}\n\nIn your response, explicitly note which positions have changed vs this pre-race prediction and the key reasons why.\n`
    : '';

  const prompt = `You are an expert F1 race strategist. The ${race.name} is LIVE right now.

═══ RACE STATE ═══
Circuit: ${race.circuit}
Lap: ${curLap} of ${totalLaps} (${racePct}% complete, ${lapsLeft} laps remaining)${trackNow ? `\nTrack: ${trackNow}` : ''}
${lapsLeft < 10 ? '⚠ LATE-RACE PHASE — positions are largely set unless major incidents.' : lapsLeft < 25 ? 'MID-LATE PHASE — final pit stops likely done, watch for tyre cliff.' : 'EARLY-MID PHASE — pit strategies still in flux, undercuts/overcuts critical.'}
${priorPredBlock}
═══ CURRENT ON-TRACK POSITIONS (these are the ONLY drivers still racing) ═══
${currentPosLines}

═══ DRIVERS NO LONGER IN THE RACE (DNF / RETIRED / NOT RUNNING) — DO NOT INCLUDE THESE IN YOUR PREDICTION ═══
${dnfDrivers.join(', ')}

═══ ACTIVE DRIVER PACE CONTEXT (championship points for context only) ═══
${activePaceLines}
${raceWeatherData ? `\n═══ WEATHER ═══\n${raceWeatherData.icon} ${raceWeatherData.hi}°C / rain ${raceWeatherData.rain}%${raceWeatherData.rain>=40?' — WET: expect safety cars, pit-strategy swings, and rain specialists climbing':raceWeatherData.rain>=20?' — intermittent rain risk':' — dry'}${raceWeatherChange ? `\nWEATHER CHANGE: ${raceWeatherChange}. Weigh the SHIFT — worsening conditions raise upset/SC risk.` : ''}\n` : ''}
═══ CRITICAL RULES ═══
🚫 NEVER include any driver from the "DNF / RETIRED" list in your top10 — they are out of the race
🚫 NEVER pick a driver who is not in the "CURRENT ON-TRACK POSITIONS" list above
✅ Your top10 must be drawn EXCLUSIVELY from the ${currentOrder.length} drivers currently on track
✅ If fewer than 10 drivers are on track, predict only as many positions as there are active drivers

═══ YOUR TASK ═══
Predict the FINAL finishing order for ONLY the drivers currently on track, based on:
1. Current track position (biggest factor — track position is everything in F1)
2. Tyre strategy implications (drivers who may need to pit again)
3. Pace deltas between teams in ${SEASON}
4. Typical race dynamics (DRS trains, late-race attacks)
5. Whether ${lapsLeft} laps is enough for overtakes from lower positions

Be DATA-DRIVEN. Don't just copy the current order — reason about who is likely to gain/lose positions in the remaining ${lapsLeft} laps, using the gaps, tyre compounds, tyre ages and stops above.
"winChance" is the realistic chance (0-100) that YOUR predicted P1 wins from here. Keep it honest: with many laps left and small gaps it should be moderate (a leader 2-3 s ahead with 40+ laps to go is rarely above 55).

Return JSON ONLY in this exact format (use ONLY abbreviations from the on-track list above):
{
  "top10": ["VER", "NOR", "HAM", "..."],
  "reasoning": "2-3 sentences covering key factors AND (if a pre-race prediction was provided) what changed vs that prediction and why.",
  "confidence": 75,
  "winChance": 45,
  "keyMovers": [
    {"abbr": "HAM", "movement": "+2", "reason": "Fresh tyres after late stop"},
    {"abbr": "LEC", "movement": "-1", "reason": "Old tyres, DRS train behind"}
  ]
}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, race: (typeof race !== 'undefined' && race?.circuitId) || null, stage: 'live' }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if(!response.ok){
      const txt = await response.text().catch(()=>'');
      throw new Error('AI API error: ' + response.status + ' — ' + txt.slice(0,100));
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    // Strip markdown fences if AI included them
    content = content.replace(/^```json\s*|\s*```$/g, '').trim();
    let parsed = JSON.parse(content);

    if(!parsed.top10 || !Array.isArray(parsed.top10)){
      throw new Error('Invalid AI response — no top10 array');
    }

    // POST-HOC VALIDATION: strip any driver not in the user's input (in case AI ignored the rule)
    const validAbbrs = new Set(currentOrder.map(o => o.abbr));
    const filtered = parsed.top10.filter(abbr => validAbbrs.has(abbr));
    const removed = parsed.top10.filter(abbr => !validAbbrs.has(abbr));
    if(removed.length){
      console.warn('AI included DNF drivers — removed:', removed);
    }
    parsed.top10 = filtered;
    // Also clean keyMovers
    if(parsed.keyMovers){
      parsed.keyMovers = parsed.keyMovers.filter(m => validAbbrs.has(m.abbr));
    }

    // Render result (escaped — this text comes from the AI)
    parsed = escDeep(parsed);
    const movers = (parsed.keyMovers || []).map(m => {
      const dir = m.movement?.startsWith('+') ? '#3fc07a' : '#ff5252';
      return `<div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:6px;margin-bottom:4px;font-size:12px">
        <span style="font-weight:700">${m.abbr} <span style="color:${dir}">${m.movement}</span></span>
        <span style="color:var(--dim);text-align:right;flex:1;margin-left:10px">${m.reason}</span>
      </div>`;
    }).join('');

    $('midRaceResult').innerHTML = `
      <div style="background:rgba(0,0,0,.3);border-radius:10px;padding:14px;border:1px solid var(--border2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;letter-spacing:1.5px;text-transform:uppercase">🏁 Predicted Final Order</div>
          <div style="font-size:11px;color:var(--gold);font-weight:700">Confidence: ${parsed.confidence || 70}%</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-bottom:12px">
          ${parsed.top10.map((abbr, i) => {
            const d = drivers.find(x => x.abbr === abbr);
            const col = teamCol(d?.team || 'unknown');
            return `<div style="background:rgba(0,0,0,.4);border-left:3px solid ${col};padding:8px 6px;border-radius:6px;text-align:center">
              <div style="font-size:10px;color:var(--dim)">P${i+1}</div>
              <div style="font-weight:700;color:${col}">${abbr}</div>
            </div>`;
          }).join('')}
        </div>
        ${parsed.reasoning ? `<div style="font-size:12px;color:var(--muted);line-height:1.6;padding:10px;background:rgba(255,255,255,.03);border-radius:6px;margin-bottom:${movers ? '10px' : '0'}">💭 ${parsed.reasoning}</div>` : ''}
        ${movers ? `<div><div style="font-size:11px;color:var(--dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Key Movers</div>${movers}</div>` : ''}
      </div>`;

    $('midRaceStatus').innerHTML = `<span style="color:#3fc07a">✓ Live prediction generated · Lap ${curLap}/${totalLaps}</span>`;
    const winChance = Number.isFinite(+parsed.winChance) ? Math.max(1, Math.min(99, Math.round(+parsed.winChance))) : null;
    window._lastLiveAI = { circuitId: race.circuitId, top: parsed.top10[0], top10: parsed.top10, confidence: parsed.confidence || null, winChance, lap: curLap, totalLaps, at: Date.now() };
    window.scrOnLiveAI?.();
    showToast(`🔄 New prediction made — based on current positions (Lap ${curLap}${totalLaps?'/'+totalLaps:''})`, 'success', 4500);
  } catch(e) {
    console.error('Mid-race prediction error:', e);
    $('midRaceStatus').innerHTML = `<span style="color:var(--red)">✗ ${e.message || 'Failed to generate prediction'}</span>`;
    $('midRaceResult').innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔮 Generate Live Prediction';
  }
}

/* Pulls the latest session grids from Supabase BEFORE generating a prediction.
   Loose match: circuit_id + year only (NOT round) — that way bridge-written rows
   are caught even if the bridge wrote round=null for an unknown calendar slot.
   Tracks the data sources so we can show the user what was used. */
window._lastDataSources = {}; // sessionName → { source, fetched_at, age_sec }

/* Try the local bridge HTTP server first — it's on the same MacBook,
   skips Supabase round-trip, and has data within ~5s of the live broadcast.
   Returns null if not running (most users won't have it). */
async function tryLocalBridge(){
  try {
    const r = await fetch('http://localhost:3001/positions', {
      signal: AbortSignal.timeout(800),
      cache: 'no-store',
    });
    if(!r.ok) return null;
    const data = escDeep(await r.json());
    if(!data?.grid?.length) return null;
    return data;
  } catch(e) { return null; }
}

async function ensureFreshDataFromSupabase(race){
  if(!race?.circuitId) return;

  // ── LOCAL BRIDGE FIRST ────────────────────────────────────────────
  // If the bridge is running on this machine, get data straight from it.
  const local = await tryLocalBridge();
  if(local?.grid?.length && local.session){
    const matchesCircuit = local.session.circuitId === race.circuitId;
    if(matchesCircuit){
      console.log('[fresh] ✅ Using LOCAL BRIDGE data:', local.session.name, '· grid:', local.grid.length);
      const sessName = local.session.name;
      const grid = local.grid.map(g => ({
        driverId: drivers.find(x=>x.abbr===g.abbr)?.driverId || g.abbr,
        pos: g.pos,
      }));
      const ageInfo = { source: 'live-bridge-local', age_sec: 0 };
      if(sessName === 'Sprint Qualifying' || /sprint.*quali/i.test(sessName)){
        sprintQualiGrid = grid;
        const inp = $('sprintQualiInput'); if(inp) inp.value = local.grid.map(g=>g.abbr).join(', ');
        window._lastDataSources = window._lastDataSources || {};
        window._lastDataSources['Sprint Qualifying'] = ageInfo;
      } else if(sessName === 'Qualifying' || /^qualifying$/i.test(sessName)){
        qualifyingGrid = grid;
        const inp = $('qualyInput'); if(inp) inp.value = local.grid.map(g=>g.abbr).join(', ');
        window._lastDataSources = window._lastDataSources || {};
        window._lastDataSources['Qualifying'] = ageInfo;
      } else if(/^sprint$/i.test(sessName)){
        sprintResult = grid;
        window._lastDataSources = window._lastDataSources || {};
        window._lastDataSources['Sprint'] = ageInfo;
      } else if(sessName === 'Race' || /^race$/i.test(sessName)){
        window._latestRaceGrid = local.grid;
        window._lastDataSources = window._lastDataSources || {};
        window._lastDataSources['Race'] = ageInfo;
      }
    } else {
      console.log('[fresh] Local bridge has different circuit:', local.session.circuitId, 'vs selected', race.circuitId);
    }
  } else {
    console.log('[fresh] Local bridge unavailable — using Supabase');
  }

  try {
    // Match circuit + year only — round may differ between bridge/cron/manual writes
    const sb = await sbGet(
      `sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&order=fetched_at.desc&limit=50`
    );
    console.log('[fresh] Supabase returned', sb?.length || 0, 'rows for', race.circuitId);
    if(!sb?.length) return;

    // For each session, take the NEWEST COMPLETE grid (partial bridge bursts
    // can't beat a full result). sb is already ordered fetched_at.desc.
    const seen = {};
    ['Sprint Qualifying','Qualifying','Sprint','Race'].forEach(name => {
      const row = pickBestSessionRow(sb, name);
      if(row) seen[name] = row;
    });
    window._lastDataSources = {};
    const ageSec = (ts) => Math.round((Date.now() - new Date(ts).getTime()) / 1000);

    const sqRow = seen['Sprint Qualifying'];
    if(sqRow){
      sprintQualiGrid = sqRow.grid_data.map((g,i) => ({
        driverId: drivers.find(x=>x.abbr===g.abbr)?.driverId || g.abbr, pos: g.pos ?? i+1,
      }));
      const inp = $('sprintQualiInput'); if(inp) inp.value = sqRow.grid_data.map(g=>g.abbr).join(', ');
      window._lastDataSources['Sprint Qualifying'] = { source: sqRow.source||'?', age_sec: ageSec(sqRow.fetched_at) };
    }
    const qRow = seen['Qualifying'];
    if(qRow){
      qualifyingGrid = qRow.grid_data.map((g,i) => ({
        driverId: drivers.find(x=>x.abbr===g.abbr)?.driverId || g.abbr, pos: g.pos ?? i+1,
      }));
      const inp = $('qualyInput'); if(inp) inp.value = qRow.grid_data.map(g=>g.abbr).join(', ');
      window._lastDataSources['Qualifying'] = { source: qRow.source||'?', age_sec: ageSec(qRow.fetched_at) };
    }
    const spRow = seen['Sprint'];
    if(spRow){
      sprintResult = spRow.grid_data.map((g,i) => ({
        driverId: drivers.find(x=>x.abbr===g.abbr)?.driverId || g.abbr, pos: g.pos ?? i+1,
      }));
      window._lastDataSources['Sprint'] = { source: spRow.source||'?', age_sec: ageSec(spRow.fetched_at) };
    }
    const raceRow = seen['Race'];
    if(raceRow?.grid_data?.length){
      window._latestRaceGrid = raceRow.grid_data;
      window._lastDataSources['Race'] = { source: raceRow.source||'?', age_sec: ageSec(raceRow.fetched_at) };
      // Auto-trigger AI vs Reality if this is the FINAL race result and we have an unscored prediction
      try {
        const actualIds = raceRow.grid_data.map(g => drivers.find(x=>x.abbr===g.abbr)?.driverId || g.abbr);
        const stored = await getStoredPrediction(race, 'race');
        if(stored && stored.accuracy === null && actualIds.length >= 10){
          const acc = calcAccuracy(stored.prediction.top10, actualIds);
          await requestServerScoring();
          console.log('[fresh] Auto-scored AI vs Reality:', acc + '%');
          const tab = $('tComp');
          if(tab) tab.innerHTML = `⚖️ AI vs Reality <span class="auto-badge" style="font-size:8px">${acc}%</span>`;
        }
      } catch(e){ console.warn('Auto-score from bridge data failed:', e.message); }
    }

    console.log('[fresh] Applied Supabase snapshots:', JSON.stringify(window._lastDataSources, null, 2));
  } catch(e){ console.warn('ensureFreshDataFromSupabase:', e.message); }
}

/* Tiny helper: format the data-sources for visible display */
function dataSourcesSummary(){
  const s = window._lastDataSources || {};
  const parts = Object.entries(s).map(([name, info]) =>
    `${name}: ${info.source} (${info.age_sec}s ago)`
  );
  return parts.length ? parts.join(' · ') : 'No live data — using championship standings';
}

async function runAIPrediction(type){
  trackEvent('generate', { screen: 'pred', detail: type || 'race' });
  predictionMode = type || 'race';
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  if(!race) return;
  // Pull latest live-bridge / cron data from Supabase before building the prompt
  await ensureFreshDataFromSupabase(race);
  const hasQ = qualifyingGrid.length > 0;
  let useQ = false;

  if (predictionMode === 'race') {
    // Post-qualifying mode: use qualifying data when available, fall back to standings if not.
    // No popup spam — the prediction status line shows what data was used.
    useQ = mode==='post' && hasQ;
  } else if (predictionMode === 'sprint') {
    useQ = sprintQualiGrid.length > 0;
  }

  hideErr();
  $('predictBtn').disabled=true;
  const sb=$('sprintBtn'); if(sb) sb.disabled=true;
  $('podiumWrap').style.display='none';

  // ── STAGE-AWARE CACHING ──
  // Same prediction in the same session-stage stays stable. New stage = fresh AI call.
  // User can hold Shift while clicking to force-regenerate.
  const currentStage = getCurrentStage(race);
  const forceFresh = window._forceFreshPrediction === true;
  // A stored baseline (non-AI) snapshot is not reused: ask the AI, and only fall back to it if the AI fails.
  let baselineSnap = null;
  // After the race, show the AI's last pre-race call (the one that gets scored) instead of a new one.
  if(currentStage === 'final' && !forceFresh){
    const pre = await getBestPreRaceSnapshot(race, predictionMode);
    if(pre?.prediction?.top10?.length){
      lastPrediction = pre.prediction;
      renderPrediction(pre.prediction, race, useQ);
      $('predictBtn').disabled = false;
      if(sb) sb.disabled = false;
      setStatus(`✓ Race finished — the AI's last call before the race (${stageLabel(pre.stage)})`, 'live');
      return;
    }
  }
  if(!forceFresh && currentStage !== 'final'){
    const cached = await getStoredPrediction(race, predictionMode, currentStage);
    if(cached?.prediction?._fallback) baselineSnap = cached;
    else if(cached && cached.prediction?.top10?.length){
      lastPrediction = cached.prediction;
      renderPrediction(cached.prediction, race, useQ);
      $('predictBtn').disabled = false;
      if(sb) sb.disabled = false;
      setStatus(`✓ Cached prediction — ${stageLabel(currentStage)} · Shift+click to regenerate`, 'live');
      const info = $('dataSourceInfo');
      if(info) info.textContent = '📌 Cached (' + stageLabel(currentStage) + ') · ' + dataSourcesSummary();
      return;
    }
  }
  window._forceFreshPrediction = false;

  // Show AI thinking UI
  const thinking=$('aiThinking');
  thinking.classList.add('visible');
  const isSprint = predictionMode==='sprint';
  $('aiThinkingTitle').textContent = isSprint ? '⚡ Analysing sprint race' : 'AI is analysing the race';
  $('aiThinkingSub').textContent=`Analysing ${race.name}${isSprint?' Sprint':''}...`;

  const aiProg=$('aiProgressFill');
  if(aiProg) aiProg.style.width='0%';

  htm('aiSteps', AI_STEPS.map((s,i)=>`
    <div class="ai-step" id="step_${i}">
      <div class="ai-step-dot"></div>
      <span>${s}</span>
    </div>`).join(''));

  let stepInterval = 0;
  let stopped = false;
  const stepTimer = setInterval(()=>{
    if (stopped) return;
    if(stepInterval>0) document.getElementById(`step_${stepInterval-1}`)?.classList.replace('active','done');
    if(stepInterval<AI_STEPS.length){
      document.getElementById(`step_${stepInterval}`)?.classList.add('active');
      if(aiProg) aiProg.style.width=Math.round((stepInterval+1)/AI_STEPS.length*88)+'%';
      stepInterval++;
    }
  }, 900);

  setStatus('AI is analysing the race','ai');

  try {
    if (!navigator.onLine) {
      clearInterval(stepTimer);
      thinking.classList.remove('visible');
      $('predictBtn').disabled=false;
      showErr('No internet connection.');
      return;
    }
    const prompt = buildPrompt(race, useQ, predictionMode);

    // ⛔ Add timeout to prevent infinite hanging.
    // AI calls typically take 10–25s; allow 45s for slow mobile networks.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, race: race?.circuitId || null, stage: currentStage }),
      signal: controller.signal
    });
    if (!response) throw new Error('No response from AI');
    clearTimeout(timeoutId);

    stopped = true;
    clearInterval(stepTimer);
    AI_STEPS.forEach((_,i)=>document.getElementById(`step_${i}`)?.classList.add('done'));
    if(aiProg) aiProg.style.width='100%';

    if(!response.ok){
      const errText = await response.text().catch(()=>'');
      let errMsg = 'HTTP ' + response.status;
      try{ const j=JSON.parse(errText); errMsg=j.error?.message||errMsg; }catch(ex){}
      console.error('AI API error:', errText);
      throw new Error(errMsg + ' (status ' + response.status + ')');
    }

    const data = await response.json();
    console.log('Gemini response received');

    // /api/predict returns { choices:[{ message:{ content } }] }
    const raw = data?.choices?.[0]?.message?.content || '';
    if(!raw) throw new Error('The AI returned an empty response. Try again.');

     // Bulletproof JSON extraction — finds { } regardless of markdown wrapping
    let parsed;
    try {
      // Strategy 1: find the first { and last } and extract everything between
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if(jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found in response');
      const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
      parsed = JSON.parse(jsonStr);
    } catch(parseErr) {
      console.error('JSON parse failed. Raw:', raw);
      throw new Error('Could not parse AI response. Raw: ' + raw.slice(0, 200));
    }


    lastPrediction = parsed;

    // 🔧 Enforce sprint grid weighting (prevents unrealistic drops like P1 -> P4)
    if (predictionMode === 'sprint' && sprintQualiGrid.length) {
      const gridMap = {};
      sprintQualiGrid.forEach(d => {
        gridMap[d.driverId] = d.pos;
      });

      parsed.top10 = parsed.top10
        .map(d => {
          const gridPos = gridMap[d.driverId] || 20;
          const aiPos = d.pos;
          // Lower score = better position
          const score = (gridPos * 0.6) + (aiPos * 0.4);
          return { ...d, _score: score };
        })
        .sort((a, b) => a._score - b._score)
        .map((d, i) => ({
          ...d,
          pos: i + 1
        }));
    }
    thinking.classList.remove('visible');
    savePrediction(race, parsed, predictionMode, currentStage);
    lastPrediction = escDeep(parsed);
    renderPrediction(lastPrediction, race, useQ);
    setStatus('AI prediction complete — ' + race.name + (predictionMode==='sprint'?' Sprint':''), 'live');
    const info = $('dataSourceInfo');
    if(info) info.textContent = '🆕 Fresh AI · ' + dataSourcesSummary();
    showToast(`✓ Prediction ready — ${race.name}${predictionMode==='sprint'?' Sprint':''}`, 'success');
    const sb=$('sprintBtn'); if(sb) sb.disabled=false;

  } catch(e) {
    stopped = true;
    clearInterval(stepTimer);
    thinking.classList.remove('visible');
    $('predictBtn').disabled=false;
    const sb=$('sprintBtn'); if(sb) sb.disabled=false;
    console.error('AI prediction error:', e);

    if (baselineSnap?.prediction?.top10?.length) {
      lastPrediction = baselineSnap.prediction;
      renderPrediction(baselineSnap.prediction, race, useQ);
      showErr('<strong>AI unavailable right now</strong> (' + (e.name === 'AbortError' ? 'timed out' : e.message) + '). Showing the baseline order (grid / standings) — this is not an AI prediction.');
      setStatus('AI unavailable — showing baseline (not AI)','warn');
    } else if (e.name === 'AbortError') {
      showErr('<strong>AI timeout:</strong> The request took too long. Try again.');
      setStatus('AI timeout — try again','warn');
    } else {
      showErr('<strong>AI error:</strong> ' + e.message + '<br><br>Open DevTools (Cmd+Option+I → Console) to see the full error.');
      setStatus('AI prediction failed — see error above','error');
    }
  }
  // $('predictBtn').disabled=false;
}

/* ═══════════════════════════════════════════════
   RENDER AI PREDICTION
   ═══════════════════════════════════════════════ */
function renderPrediction(parsed, race, useQ){
  const top10 = parsed.top10||[];
  if(!top10.length){ showErr('AI returned no prediction data. Try again.'); return; }
  syncForceFreshBtn(race);

  $('podiumWrap').style.display='';
  const ps = $('predEmptyState'); if(ps) ps.style.display='none';
  unlockArchTab(); // a prediction now exists — enable the Predictions Archive tab
  setTab('pred');
  // Reassure the user a fresh prediction was generated, and on what basis
  if(!parsed._fallback) showToast(useQ ? '✅ New prediction made — based on the latest qualifying grid'
                 : '✅ New prediction made — based on current standings & form', 'success', 4500);

  // Podium
  const podiumOrder=[1,0,2];
  htm('podium', podiumOrder.map(idx=>{
    const d=top10[idx]; if(!d) return '';
    const cls=['p1','p2','p3'][idx];
    const col=teamCol(d.team);
    const pts=F1P[idx]||0;
    const confCls=d.winProb>=25?'conf-high':d.winProb>=12?'conf-med':'conf-low';
    const confLbl=d.winProb>=25?'High confidence':d.winProb>=12?'Moderate':'Possible upset';
    const reasons=(d.reasoning||'').split(/[.;]/).map(s=>s.trim()).filter(s=>s.length>8).slice(0,2);
    const bulletsHtml=reasons.length?`<div class="why-bullets">${reasons.map(r=>`<div class="why-bullet">${r}</div>`).join('')}</div>`:'';
    return `<div class="pcard ${cls}" onclick="openDriverCard('${d.driverId}')" style="cursor:pointer">
      <div class="drv-avatar" style="background:${col}22;border-color:${col};color:${col}">${d.abbr.slice(0,3)}</div>
      <div class="ppos">${idx+1}</div>
      <div class="pabbr" style="color:${col}">${d.abbr}</div>
      <div class="pfull">${d.name}</div>
      <div class="pteam"><span class="tdot" style="background:${col}"></span>${d.team}</div>
      <div class="pprob">${d.winProb}%</div>
      <div class="conf-bar-wrap"><div class="conf-bar-bg"><div class="conf-bar-fill" style="width:${Math.min(d.winProb*2.5,100)}%;background:${col}"></div></div></div>
      <span class="conf-badge ${confCls}">${confLbl}</span>
      <div class="ppts">+${pts} pts projected</div>
      ${bulletsHtml}
    </div>`;
  }).join(''));

  // AI Reasoning card
  const analysis = (parsed.overallAnalysis||'').replace(/\n/g,'<br>');
  $('aiReasoningBody').innerHTML = `
    ${parsed._fallback ? '<div style="padding:8px 10px;margin-bottom:10px;border-radius:6px;background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.4);color:var(--gold);font-weight:600">⚠ Baseline order — not an AI prediction. The AI was unavailable when this was saved.</div>' : ''}
    ${analysis}
    ${parsed.keyFactor?`<br><br><strong>🔑 Key Factor:</strong> ${parsed.keyFactor}`:''}
    ${parsed.upsetAlert?`<br><strong>⚡ Upset Alert:</strong> ${parsed.upsetAlert}`:''}
  `;

  // Rank table
  const maxP=Math.max(...top10.map(d=>d.winProb),1);
  htm('rankBody', top10.map((d,i)=>{
    const cls=i<3?'p'+(i+1):'';
    const col=teamCol(d.team);
    const pts=F1P[i]||0;
    const curPts=(drivers.find(x=>x.driverId===d.driverId)?.pts||0);
    const confCls=d.winProb>=25?'conf-high':d.winProb>=12?'conf-med':'conf-low';
    const reasons=(d.reasoning||'').split(/[.;]/).map(s=>s.trim()).filter(s=>s.length>8).slice(0,2);
    const bulletsHtml=reasons.map(r=>`<div class="why-bullet">${r}</div>`).join('');
    const hasReasoning = reasons.length > 0;
    return `<tr style="animation-delay:${i*0.04}s">
      <td><div class="pnum ${cls}">${d.pos}</div></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <div class="drv-avatar-sm" style="background:${col}22;border-color:${col};color:${col};flex-shrink:0">${d.abbr.slice(0,3)}</div>
          <div style="min-width:0;flex:1">
            <div class="dn" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <span class="clickable-driver" onclick="openDriverCard('${d.driverId}')">${d.name}</span>
              ${hasReasoning?`<button class="expand-toggle" onclick="this.closest('tr').classList.toggle('row-expanded');this.textContent=this.closest('tr').classList.contains('row-expanded')?'▴':'▾'">▾</button>`:''}
            </div>
            <div class="why-bullets" style="margin-top:3px">${bulletsHtml}</div>
          </div>
        </div>
      </td>
      <td style="white-space:nowrap"><span class="tdot" style="background:${col};margin-right:6px"></span>${d.team}</td>
      <td>
        <div class="bwrap">
          <div class="bbg"><div class="bfill" style="width:${Math.round(d.winProb/maxP*100)}%;background:${col}"></div></div>
          <span class="bval ${confCls}">${d.winProb}%</span>
        </div>
      </td>
      <td><span class="proj">${curPts+pts}</span> <span class="curr">(+${pts})</span></td>
    </tr>`;
  }).join(''));
}

/* ═══════════════════════════════════════════════
   HISTORY TAB
   ═══════════════════════════════════════════════ */
function renderHistory(){
  if(!completedRaces.length){
    htm('histGrid','<div style="color:var(--muted);padding:20px">No completed races yet.</div>');
    htm('standBody',''); return;
  }
  const topD=[...drivers].sort((a,b)=>b.pts-a.pts).slice(0,12);
  const lookup={};
  topD.forEach(d=>{ lookup[d.driverId]=[]; });
  completedRaces.forEach(r=>{
    topD.forEach(d=>{
      const pos=r.results.indexOf(d.driverId);
      lookup[d.driverId].push(pos>=0?pos+1:null);
    });
  });
  const hdrs=completedRaces.map(r=>`<th title="${r.raceName}">${(r.circuitId||r.raceName).slice(0,4).toUpperCase()}</th>`).join('');
  const rows=topD.map(d=>{
    const col=teamCol(d.team);
    const cells=lookup[d.driverId].map(pos=>{
      if(!pos) return `<td><span class="rc dnf">DNF</span></td>`;
      const cls=pos===1?'win':pos===2?'r2':pos===3?'r3':'pts';
      return `<td><span class="rc ${cls}">${pos}</span></td>`;
    }).join('');
    return `<tr><td class="dc"><div style="display:flex;align-items:center;gap:7px">
      <span class="tdot" style="background:${col}"></span>
      <span class="clickable-driver" onclick="openDriverCard('${d.driverId}')" style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px">${d.abbr}</span>
      <span style="font-size:11px;color:var(--muted)">${teamName(d.team)}</span>
    </div></td>${cells}</tr>`;
  }).join('');
  htm('histGrid',`<table class="hgrid"><thead><tr><th class="dc">Driver</th>${hdrs}</tr></thead><tbody>${rows}</tbody></table>`);

  const maxP=Math.max(...drivers.map(d=>d.pts),1);
  const wm={},pm={};
  completedRaces.forEach(r=>{
    r.results.forEach((dId,i)=>{
      if(i===0) wm[dId]=(wm[dId]||0)+1;
      if(i<3)   pm[dId]=(pm[dId]||0)+1;
    });
  });
  htm('standBody',[...drivers].sort((a,b)=>b.pts-a.pts).map((d,i)=>{
    const pos=i+1; const cls=pos<=3?'p'+pos:'';
    const col=teamCol(d.team);
    const pct=Math.round(d.pts/maxP*100);
    const w=wm[d.driverId]||0, p=pm[d.driverId]||0;
    const arrow=formArrow(d.driverId);
    return `<tr>
      <td><div class="pnum ${cls}">${pos}</div></td>
      <td><div class="dn"><span class="clickable-driver" onclick="openDriverCard('${d.driverId}')">${d.name}</span>${arrow}</div><div class="ds">${d.abbr}</div></td>
      <td style="white-space:nowrap"><span class="tdot" style="background:${col};margin-right:6px"></span>${teamName(d.team)}</td>
      <td><div class="spwrap"><div class="spbg"><div class="spfill" style="width:${pct}%;background:${col}"></div></div><span class="spval">${d.pts}</span></div></td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;color:${w?'var(--gold)':'var(--dim)'};font-weight:700">${w}</span></td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;color:${p?'var(--text)':'var(--dim)'}">${p}</span></td>
    </tr>`;
  }).join(''));
}

/* ═══════════════════════════════════════════════
   CALENDAR TAB
   ═══════════════════════════════════════════════ */
function renderCalendar(){
  const cs=`style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim)"`;
  const td=`style="padding:9px 10px;border-bottom:1px solid var(--border)"`;
  const da=id=>{ const d=drivers.find(x=>x.driverId===id); return d?`<span style="font-family:'Barlow Condensed',sans-serif;font-weight:700">${d.abbr}</span><span style="font-size:11px;color:var(--muted);margin-left:5px">${teamName(d.team)}</span>`:'—'; };
  $('completedList').innerHTML=completedRaces.length?`<table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr>${['Rd','Race','Date','P1','P2','P3'].map(h=>`<th ${cs}>${h}</th>`).join('')}</tr></thead>
    <tbody>${completedRaces.map(r=>`<tr>
      <td ${td}><span style="font-family:'Barlow Condensed',sans-serif;color:var(--red);font-weight:700">R${r.round}</span></td>
      <td ${td} style="padding:9px 10px;border-bottom:1px solid var(--border);font-weight:600">${r.raceName}</td>
      <td ${td} style="padding:9px 10px;border-bottom:1px solid var(--border);color:var(--muted);font-size:12px">${fmtD(r.date)}</td>
      <td ${td}>${da(r.results[0])}</td><td ${td}>${da(r.results[1])}</td><td ${td}>${da(r.results[2])}</td>
    </tr>`).join('')}</tbody></table>`:'<div style="color:var(--muted);padding:10px">No completed races.</div>';

  const upcoming=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  htm('upcomingList',upcoming.map((r,i)=>`
    <div class="urow${i===0?' next':''}">
      <div class="urnd">R${r.round}</div>
      <div><div class="uname">${r.name}</div><div class="udate">${r.circuit} · ${r.country} · ${fmtD(r.date)}</div></div>
      <div>${i===0?'<span class="tag red">Next Race</span>':''}</div>
    </div>`).join(''));
}

/* ── Qualifying input helpers ── */
function applyQualifying(){
  const raw = $('qualyInput').value;
  const abbrs = raw.split(/[,\n]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
  if(!abbrs.length){ $('qualyStatus').textContent='No drivers entered.'; return; }
  qualifyingGrid = [];
  const notFound = [];
  abbrs.forEach((abbr, i)=>{
    const d = drivers.find(x=>x.abbr===abbr || x.abbr===abbr.toUpperCase());
    if(d){
      qualifyingGrid.push({driverId: d.driverId, pos: i+1});
    } else {
      notFound.push(abbr);
    }
  });
  if(notFound.length) $('qualyStatus').textContent = 'Applied ' + qualifyingGrid.length + ' drivers. Not found: ' + notFound.join(', ');
  else $('qualyStatus').textContent = '✓ Grid set — ' + qualifyingGrid.length + ' drivers loaded. Click Generate AI Prediction.';
  $('qualyStatus').style.color = notFound.length ? 'orange' : '#3fc07a';
  updateBanner();
}

function clearQualifying(){
  qualifyingGrid = [];
  $('qualyInput').value = '';
  $('qualyStatus').textContent = 'Grid cleared.';
  updateBanner();
}

function clearAllSessions(){
  qualifyingGrid = [];
  sprintQualiGrid = [];
  sprintResult = [];
  $('qualyInput').value = '';
  $('sprintQualiInput').value = '';
  $('qualyStatus').textContent = '';
  $('sprintQualiStatus').textContent = '';
  $('sessionApplyStatus').textContent = 'All sessions cleared.';
  $('sessionApplyStatus').style.color = 'var(--muted)';
  updateBanner();
}

function applyAllSessions(){
  // Sprint Qualifying
  const sqRaw = $('sprintQualiInput').value;
  const sqAbbrs = sqRaw.split(/[,\n]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
  sprintQualiGrid = [];
  sqAbbrs.forEach((abbr,i)=>{
    const d=drivers.find(x=>x.abbr===abbr);
    if(d) sprintQualiGrid.push({driverId:d.driverId,pos:i+1});
  });
  // Main Qualifying
  applyQualifying();
  const parts=[];
  if(qualifyingGrid.length) parts.push(qualifyingGrid.length+' quali drivers');
  if(sprintQualiGrid.length) parts.push(sprintQualiGrid.length+' sprint quali drivers');
  $('sessionApplyStatus').textContent = parts.length ? '✓ Applied: '+parts.join(' · ') : 'Nothing entered.';
  $('sessionApplyStatus').style.color = parts.length ? '#3fc07a' : 'var(--muted)';
}

/* ═══════════════════════════════════════════════
   OPENF1 — Auto session fetching
   Free API, no key needed, updates ~30min after
   each session ends (FP1/FP2/FP3/SQ/Sprint/Q/Race)
   ═══════════════════════════════════════════════ */
const OPENF1 = 'https://api.openf1.org/v1';
// Route OpenF1 calls through our server proxy to avoid mobile IP rate-limits (429)
const OF1_PROXY = '/api/of1?url=';

// Map our circuitId → OpenF1 location city name
const OF1_LOC = {
  // exact OpenF1 "location" values for 2026
  albert_park:'Melbourne', shanghai:'Shanghai', suzuka:'Suzuka',
  miami:'Miami Gardens', villeneuve:'Montréal', monaco:'Monte Carlo',
  catalunya:'Barcelona', red_bull_ring:'Spielberg', silverstone:'Silverstone',
  spa:'Spa-Francorchamps', hungaroring:'Budapest', zandvoort:'Zandvoort', monza:'Monza',
  ifema_madrid:'Madrid', baku:'Baku', sepang:'Kuala Lumpur', marina_bay:'Marina Bay',
  americas:'Austin', rodriguez:'Mexico City', interlagos:'São Paulo',
  las_vegas:'Las Vegas', losail:'Lusail', yas_marina:'Yas Marina',
};

// Simple in-memory cache so we don't hammer the API on every tab switch
const of1Cache = {};
let of1LiveLocked = false;   // true while OpenF1 is in live-session lockout mode
let of1RateLimited = false;  // true if OpenF1 is rate-limiting us

// Identical requests made while one is still in flight share it (several screens ask at once)
const of1Pending = {};
function of1Fetch(url){
  if(of1Cache[url]) return Promise.resolve(of1Cache[url]);
  if(!of1Pending[url]) of1Pending[url] = of1FetchOnce(url).finally(() => { delete of1Pending[url]; });
  return of1Pending[url];
}
async function of1FetchOnce(url){
  // Use server-side proxy to avoid 429 rate-limits on mobile IPs
  const proxyUrl = OF1_PROXY + encodeURIComponent(url);
  let r, isLiveLock = false, isRateLimit = false;
  try {
    r = await fetch(proxyUrl, {signal: AbortSignal.timeout(20000)});
    // Read lock/rate-limit signals from proxy headers
    isLiveLock  = r.headers.get('X-OF1-Live-Lock')    === '1';
    isRateLimit = r.headers.get('X-OF1-Rate-Limited') === '1';
    if(isLiveLock)  of1LiveLocked  = true;
    if(isRateLimit) of1RateLimited = true;
    // If proxy itself errored (502), fall back to direct call
    if(r.status === 502) {
      r = await fetch(url, {signal: AbortSignal.timeout(12000)});
      isLiveLock = false; isRateLimit = false;
    }
  } catch(proxyErr) {
    try {
      r = await fetch(url, {signal: AbortSignal.timeout(12000)});
    } catch(directErr) {
      throw new Error('OpenF1 unreachable');
    }
  }
  if(r.status === 404) return [];
  if(!r.ok) throw new Error('OpenF1 '+r.status);
  const d = await r.json();
  // Never cache live-lock or rate-limit empty responses — real data arrives after lock lifts
  if(!isLiveLock && !isRateLimit) of1Cache[url] = d;
  return d;
}

// Get the OpenF1 meeting_key for a race
async function getOf1Meeting(race){
  const loc = OF1_LOC[race.circuitId];
  if(!loc) return null;
  const year = new Date(race.date).getFullYear() || SEASON;
  const data = await of1Fetch(`${OPENF1}/meetings?year=${year}&location=${encodeURIComponent(loc)}`);
  return data?.[0] ?? null;
}

// Get all sessions for a meeting, annotated with status
async function getOf1Sessions(meetingKey){
  const data = await of1Fetch(`${OPENF1}/sessions?meeting_key=${meetingKey}&year=${SEASON}`);
  return data ?? [];
}

// Get final grid order from a session (qualifying/sprint qualifying)
// Uses position endpoint — takes last recorded position per driver
async function getOf1Grid(sessionKey, meetingKey){
  const [positions, driversList] = await Promise.all([
    of1Fetch(`${OPENF1}/position?session_key=${sessionKey}`),
    of1Fetch(`${OPENF1}/drivers?session_key=${sessionKey}&meeting_key=${meetingKey}`),
  ]);

  // Build driver_number → acronym map
  const numToAbbr = {};
  const numToId   = {};
  (driversList||[]).forEach(d=>{
    const abbr = d.name_acronym?.toUpperCase();
    numToAbbr[d.driver_number] = abbr;
    // Try to match to our driver list by abbreviation
    const drv = drivers.find(x=>x.abbr===abbr);
    if(drv) numToId[d.driver_number] = drv.driverId;
  });

  // Find latest position entry per driver
  const latest = {};
  (positions||[]).forEach(p=>{
    const prev = latest[p.driver_number];
    if(!prev || p.date > prev.date) latest[p.driver_number] = p;
  });

  // Sort by final position
  return Object.values(latest)
    .sort((a,b)=>a.position - b.position)
    .map(p=>({
      driverId: numToId[p.driver_number] || numToAbbr[p.driver_number] || String(p.driver_number),
      abbr:     numToAbbr[p.driver_number] || String(p.driver_number),
      pos:      p.position,
    }));
}

/* ═══════════════════════════════════════════════
   OPENF1 SEASON INSIGHTS
   Fetches tyre stints + practice performance for
   all completed 2026 races → fed into AI prompt
   ═══════════════════════════════════════════════ */
let of1Insights = ''; // populated async, read by buildPrompt

async function fetchOf1SeasonInsights(){
  try {
    setStatus(`Loading ${SEASON} season insights from OpenF1…`,'loading');

    // Get all 2026 meetings
    const meetings = await of1Fetch(`${OPENF1}/meetings?year=${SEASON}`);
    if(!meetings?.length){
      // Cross-check live-lock against our schedule — OpenF1 sometimes stays
      // locked for hours after a session ends, so don't mislead the user.
      const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
      const selRace = races[selectedIdx] || races[0];
      const actuallyLive = selRace ? !!getLiveSessionLabel(selRace) : false;
      if(of1LiveLocked && actuallyLive){
        setStatus('🔴 ' + getLiveSessionLabel(selRace) + ' in progress — OpenF1 will unlock when it ends', 'warn');
      } else if(of1LiveLocked){
        setStatus('⏳ OpenF1 still locked from a recent session — usually opens within 1h', 'warn');
      } else if(of1RateLimited){
        setStatus('⏳ OpenF1 rate-limited — retry shortly', 'warn');
      } else {
        setStatus(`${SEASON} season · baseline data`, 'live');
      }
      return;
    }

    const tyreMap  = {}; // abbr → {SOFT, MEDIUM, HARD, INTERMEDIATE, WET} laps
    const fp1Map   = {}; // location → [{abbr, pos}]
    const stintMap = {}; // abbr → [{circuit, stint_laps, compound}]  (for tyre management)

    // Process each meeting in parallel (capped at 8 to avoid rate limit)
    await Promise.all(meetings.slice(0, 8).map(async mtg => {
      const sessions = await of1Fetch(`${OPENF1}/sessions?meeting_key=${mtg.meeting_key}&year=${SEASON}`);
      if(!sessions?.length) return;

      // Helper: build driver_number→abbr map for a session
      const driverMap = async (sessKey) => {
        const drvs = await of1Fetch(`${OPENF1}/drivers?session_key=${sessKey}`);
        const m = {};
        drvs?.forEach(d => { m[d.driver_number] = d.name_acronym?.toUpperCase(); });
        return m;
      };

      // ── Race stints → tyre compound laps ──
      const raceSess = sessions.find(s => (s.session_name==='Race'||s.session_type==='Race') && sessionDone(s));
      if(raceSess){
        const [stints, numMap] = await Promise.all([
          of1Fetch(`${OPENF1}/stints?session_key=${raceSess.session_key}`),
          driverMap(raceSess.session_key),
        ]);
        stints?.forEach(s => {
          const abbr = numMap[s.driver_number]; if(!abbr) return;
          if(!tyreMap[abbr]) tyreMap[abbr] = {SOFT:0,MEDIUM:0,HARD:0,INTERMEDIATE:0,WET:0};
          const compound = s.compound?.toUpperCase().replace('ULTRASOFT','SOFT').replace('SUPERSOFT','SOFT').replace('HYPERSOFT','SOFT') || 'UNKNOWN';
          const laps = Math.max(0, (s.lap_end||0) - (s.lap_start||0) + 1);
          if(tyreMap[abbr][compound] !== undefined) tyreMap[abbr][compound] += laps;
          // Track stints for tyre management insight
          if(!stintMap[abbr]) stintMap[abbr] = [];
          stintMap[abbr].push({ circuit: mtg.location, laps, compound });
        });
      }

      // ── Sprint race stints ──
      const sprintSess = sessions.find(s => s.session_name==='Sprint' && sessionDone(s));
      if(sprintSess){
        const [stints, numMap] = await Promise.all([
          of1Fetch(`${OPENF1}/stints?session_key=${sprintSess.session_key}`),
          driverMap(sprintSess.session_key),
        ]);
        stints?.forEach(s => {
          const abbr = numMap[s.driver_number]; if(!abbr) return;
          if(!tyreMap[abbr]) tyreMap[abbr] = {SOFT:0,MEDIUM:0,HARD:0,INTERMEDIATE:0,WET:0};
          const compound = s.compound?.toUpperCase() || 'UNKNOWN';
          const laps = Math.max(0, (s.lap_end||0) - (s.lap_start||0) + 1);
          if(tyreMap[abbr][compound] !== undefined) tyreMap[abbr][compound] += laps;
        });
      }

      // ── FP1 final positions ──
      const fp1Sess = sessions.find(s => s.session_name==='Practice 1' && sessionDone(s));
      if(fp1Sess){
        const [pos, numMap] = await Promise.all([
          of1Fetch(`${OPENF1}/position?session_key=${fp1Sess.session_key}`),
          driverMap(fp1Sess.session_key),
        ]);
        const latest = {};
        pos?.forEach(p => {
          if(!latest[p.driver_number] || p.date > latest[p.driver_number].date)
            latest[p.driver_number] = p;
        });
        fp1Map[mtg.location] = Object.values(latest)
          .sort((a,b) => a.position - b.position)
          .slice(0, 10)
          .map(p => ({ abbr: numMap[p.driver_number] || String(p.driver_number), pos: p.position }));
      }
    }));

    // ── Build tyre management score ──
    // Drivers who run longer stints on harder compounds are better tyre managers
    const tyreScore = {}; // abbr → score (higher = better management)
    Object.entries(stintMap).forEach(([abbr, stints]) => {
      const score = stints.reduce((acc, s) => {
        const weight = s.compound==='HARD'?3 : s.compound==='MEDIUM'?2 : s.compound==='SOFT'?1 : 1.5;
        return acc + (s.laps * weight);
      }, 0);
      tyreScore[abbr] = score;
    });
    const maxTS = Math.max(...Object.values(tyreScore), 1);
    const tyreRanking = Object.entries(tyreScore)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 10)
      .map(([abbr, s]) => `${abbr}(${Math.round(s/maxTS*10)}/10)`)
      .join(', ');

    // ── Build insights string ──
    let insight = `\n\n═══ REAL ${SEASON} OPENF1 SEASON DATA ═══`;

    // Tyre usage
    const tyreEntries = Object.entries(tyreMap).filter(([,c]) => Object.values(c).some(v=>v>0));
    if(tyreEntries.length){
      insight += `\n\nTYRE COMPOUNDS USED PER DRIVER (${SEASON} season laps):`;
      tyreEntries.sort(([a],[b])=>a.localeCompare(b)).forEach(([abbr, counts]) => {
        const parts = Object.entries(counts).filter(([,v])=>v>0).map(([c,v])=>`${c[0]}:${v}`).join(' ');
        if(parts) insight += `\n  ${abbr}: ${parts}`;
      });
    }

    // Tyre management ranking
    if(tyreRanking) insight += `\n\nTYRE MANAGEMENT RANKING (based on stint strategy): ${tyreRanking}`;

    // FP1 performance
    if(Object.keys(fp1Map).length){
      insight += '\n\nFP1 PERFORMANCE BY CIRCUIT (P1→P10):';
      Object.entries(fp1Map).forEach(([loc, arr]) => {
        insight += `\n  ${loc}: ${arr.map(d=>`${d.abbr}`).join(' > ')}`;
      });
    }

    insight += '\n═══════════════════════════════════════';
    of1Insights = insight;
    setStatus(`✓ OpenF1 ${SEASON} season data loaded — `+tyreEntries.length+' drivers', 'live');

  } catch(e){
    console.warn('OpenF1 season insights failed:', e.message);
    of1Insights = '';
  }
}

// Check if a session has finished. Primary signal: date_end in the past.
// Fallback: if no date_end but date_start was >3h ago, treat as done — OpenF1
// sometimes lags publishing date_end timestamps.
function sessionDone(sess){
  if(!sess) return false;
  if(sess.date_end){
    return new Date(sess.date_end) < new Date();
  }
  if(sess.date_start){
    const startMs = new Date(sess.date_start).getTime();
    return Date.now() - startMs > 3 * 3600 * 1000;
  }
  return false;
}
function sessionLive(sess){
  if(!sess.date_start||!sess.date_end) return false;
  const now = new Date();
  return new Date(sess.date_start) <= now && now <= new Date(sess.date_end);
}

// Render session badges in the UI
// Sprint weekend circuit IDs (refilled from the season calendar) — fallback in case
// race.sprint flag is lost or OpenF1 hasn't published sprint sessions yet.
const SPRINT_CIRCUITS = new Set(['villeneuve','silverstone','zandvoort','marina_bay']);

function renderSessionBadges(sessions, isSprint){
  // Cache the sessions for chip click handlers
  currentSessions = sessions || [];

  // Cross-check against the currently selected race's circuitId
  const races = (displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const selectedRace = races[selectedIdx] || races[0];

  // Sprint layout if ANY of these are true:
  //   1) race.sprint flag is truthy
  //   2) the circuit is a known 2026 sprint circuit
  //   3) OpenF1 data already contains a session with "Sprint" in name or type
  const sprintLayout =
    !!isSprint ||
    SPRINT_CIRCUITS.has(selectedRace?.circuitId) ||
    (Array.isArray(sessions) && sessions.some(s =>
      /sprint/i.test(s?.session_name || '') || /sprint/i.test(s?.session_type || '')
    ));

  console.log('[chips] race:', selectedRace?.name, 'circuitId:', selectedRace?.circuitId,
    'race.sprint:', selectedRace?.sprint, 'isSprint arg:', isSprint,
    'sprintLayout final:', sprintLayout,
    'sessions:', (sessions||[]).map(s=>s.session_name));

  // 2026 sprint weekend format: FP1 → SQ → Sprint → Quali → Race (no FP2/FP3)
  // Non-sprint weekend: FP1 → FP2 → FP3 → Quali → Race
  const ORDER = sprintLayout
    ? ['Practice 1','Sprint Qualifying','Sprint','Qualifying','Race']
    : ['Practice 1','Practice 2','Practice 3','Qualifying','Race'];

  const LABELS = {
    'Practice 1':'FP1','Practice 2':'FP2','Practice 3':'FP3',
    'Sprint Qualifying':'SQ','Sprint':'Sprint','Qualifying':'Quali','Race':'Race',
  };

  const html = ORDER.map(name=>{
    // Broader match for sprint variants ("Sprint Shootout" → matches Sprint Qualifying slot)
    const sess = sessions.find(s => {
      if(s.session_name === name || s.session_type === name) return true;
      const n = (s.session_name||'').toLowerCase();
      if(name === 'Sprint Qualifying') return n.includes('sprint') && (n.includes('quali') || n.includes('shoot'));
      if(name === 'Sprint') return n.includes('sprint') && !n.includes('quali') && !n.includes('shoot');
      return false;
    });
    // Map this badge name → our schedule's session kind so we can fall back when
    // no OpenF1 session record exists (which happens when OpenF1 is locked).
    const KIND_MAP = {
      'Sprint Qualifying':'sprintQuali','Sprint':'sprint',
      'Qualifying':'quali','Race':'race',
    };
    const scheduleKind = KIND_MAP[name];
    const schedDone = scheduleKind && selectedRace ? isSessionEnded(selectedRace, scheduleKind) : false;
    const schedLive = scheduleKind && selectedRace ? isSessionInProgress(selectedRace, scheduleKind) : false;
    if(!sess){
      if(name==='Practice 3' && sprintLayout) return '';
      // No OpenF1 data — fall back to schedule. If the time says it's over, mark done.
      const cls  = schedLive ? 'live' : schedDone ? 'done' : 'pending';
      const icon = schedDone ? '✓ ' : schedLive ? '● ' : '';
      return `<button type="button" class="sess ${cls} sess-tappable" data-sess="${name}" onclick="onSessionChip('${name}')">${icon}${LABELS[name]||name}</button>`;
    }
    // OpenF1 data is present — but our schedule may know it ended even if OpenF1's date_end lags
    const live = sessionLive(sess) || schedLive;
    const done = sessionDone(sess) || schedDone;
    const sprintCls = (name==='Sprint Qualifying'||name==='Sprint') ? ' sprint' : '';
    const cls = live ? 'live' : done ? 'done' : 'pending';
    const icon = done ? '✓ ' : live ? '● ' : '';
    return `<button type="button" class="sess ${cls}${sprintCls} sess-tappable" data-sess="${name}" onclick="onSessionChip('${name}')">${icon}${LABELS[name]||name}</button>`;
  }).join('');

  $('sessionsWrap').innerHTML = html || '<span class="sess pending">No session data yet</span>';
  // Ensure the inline details panel exists (created lazily once)
  ensureSessionDetailsPanel();
}

/* Create the inline session-details panel (once) right after #sessionsWrap */
function ensureSessionDetailsPanel(){
  if($('sessionDetailsPanel')) return;
  const wrap = $('sessionsWrap');
  if(!wrap || !wrap.parentNode) return;
  const panel = document.createElement('div');
  panel.id = 'sessionDetailsPanel';
  panel.style.display = 'none';
  wrap.parentNode.insertBefore(panel, wrap.nextSibling);
}

/* Called when a session chip is tapped. Branches based on session state. */
let _sessionDetailsOpenFor = null;
function onSessionChip(name){
  const panel = $('sessionDetailsPanel');
  if(!panel) return;

  // Tapping the already-open one closes it (toggle behavior)
  if(_sessionDetailsOpenFor === name){
    panel.style.display = 'none';
    _sessionDetailsOpenFor = null;
    return;
  }

  const sess = currentSessions.find(s => s.session_name === name || s.session_type === name);
  const live = sess ? sessionLive(sess) : false;
  const done = sess ? sessionDone(sess) : false;

  // Live → jump straight to Live Race tab
  if(live){
    setTab('live');
    return;
  }

  // Build content depending on state
  let html = '';
  const LABEL_FULL = {
    'Practice 1':'Practice 1','Practice 2':'Practice 2','Practice 3':'Practice 3',
    'Sprint Qualifying':'Sprint Qualifying','Sprint':'Sprint Race',
    'Qualifying':'Qualifying','Race':'Race',
  };
  const title = LABEL_FULL[name] || name;

  if(!sess || (!done && !live)){
    // Pending — show scheduled time + countdown
    if(sess?.date_start){
      const t = new Date(sess.date_start);
      const diff = t.getTime() - Date.now();
      const cd = formatCountdownDiff(diff);
      const when = t.toLocaleString('en-GB', {weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      html = `<div class="sess-det-hdr"><span>⏱ ${title}</span></div>
        <div class="sess-det-row"><span class="sess-det-lbl">Starts in</span><span class="sess-det-val" style="color:#64a0ff">${cd}</span></div>
        <div class="sess-det-row"><span class="sess-det-lbl">Scheduled</span><span class="sess-det-val">${when}</span></div>`;
    } else {
      html = `<div class="sess-det-hdr"><span>⏱ ${title}</span></div>
        <div class="sess-det-msg">Schedule not loaded yet. Tap <strong>Auto-fetch from OpenF1</strong> above.</div>`;
    }
  } else if(done){
    // Done — show grid / result based on session type
    if(name === 'Qualifying' && qualifyingGrid.length){
      html = `<div class="sess-det-hdr"><span>🏁 ${title} — Grid</span></div>` + renderGridList(qualifyingGrid);
    } else if(name === 'Sprint Qualifying' && sprintQualiGrid.length){
      html = `<div class="sess-det-hdr"><span>⚡ ${title} — Sprint Grid</span></div>` + renderGridList(sprintQualiGrid);
    } else if(name === 'Race'){
      const races = (displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
      const race = races[selectedIdx];
      const result = completedRaces.find(r => r.circuitId === race?.circuitId && !String(r.round).endsWith('S'));
      if(result?.results?.length){
        html = `<div class="sess-det-hdr"><span>🏆 ${title} — Result</span></div>` + renderResultList(result.results);
      } else {
        html = `<div class="sess-det-hdr"><span>🏆 ${title} — Result</span></div>
          <div class="sess-det-msg">Tap <strong>Auto-fetch</strong> above to load the race result.</div>`;
      }
    } else if(name === 'Sprint'){
      const races = (displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
      const race = races[selectedIdx];
      const sprintRow = completedRaces.find(r => r.circuitId === race?.circuitId && String(r.round).endsWith('S'));
      if(sprintRow?.results?.length){
        html = `<div class="sess-det-hdr"><span>⚡ ${title} — Result</span></div>` + renderResultList(sprintRow.results);
      } else {
        html = `<div class="sess-det-hdr"><span>⚡ ${title} — Result</span></div>
          <div class="sess-det-msg">Sprint result not loaded. Tap <strong>Auto-fetch</strong>.</div>`;
      }
    } else {
      // Practice
      html = `<div class="sess-det-hdr"><span>✓ ${title} — Complete</span></div>
        <div class="sess-det-msg">Practice classification is fetched in the background. Open the <strong>Practice Session Results</strong> card below for the top times.</div>`;
    }
  }

  panel.innerHTML = html;
  panel.style.display = 'block';
  _sessionDetailsOpenFor = name;
}

function renderGridList(grid){
  return '<ol class="sess-det-grid">' + grid.slice(0,20).map((g,i) => {
    const d = drivers.find(x => x.driverId === g.driverId || x.abbr === g.abbr);
    const teamKey = d?.team || 'mercedes';
    const teamColor = TC[teamKey] || '#999';
    return `<li><span class="sdg-pos">${g.pos ?? i+1}</span>
      <span class="sdg-abbr" style="color:${teamColor}">${d?.abbr || g.abbr || '?'}</span>
      <span class="sdg-name">${d?.name || ''}</span></li>`;
  }).join('') + '</ol>';
}
function renderResultList(driverIds){
  return '<ol class="sess-det-grid">' + driverIds.slice(0,10).map((id, i) => {
    const d = drivers.find(x => x.driverId === id);
    const teamKey = d?.team || 'mercedes';
    const teamColor = TC[teamKey] || '#999';
    return `<li><span class="sdg-pos">${i+1}</span>
      <span class="sdg-abbr" style="color:${teamColor}">${d?.abbr || id}</span>
      <span class="sdg-name">${d?.name || ''}</span></li>`;
  }).join('') + '</ol>';
}

/* Format a millisecond diff as "2d 4h" / "3h 14m" / "12m" / "Live now" */
function formatCountdownDiff(ms){
  if(ms <= 0) return 'Now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if(d > 0) return `${d}d ${h}h`;
  if(h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Main function — called by the Auto-fetch button and on race change
// Priority: Supabase sessions table (Edge Function cache) → direct OpenF1 API
async function autoFetchSessions(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  if(!race){ $('fetchStatus').textContent='No race selected.'; return; }

  // Clear cached meeting/session/position data for this race so we get fresh results.
  // Season-level data (tyre stints, FP1 maps) is left in cache to avoid unnecessary calls.
  Object.keys(of1Cache).filter(k =>
    k.includes('/meetings?') || k.includes('/sessions?') ||
    k.includes('/position?') || k.includes('/drivers?') ||
    k.includes('/stints?')   || k.includes('/race_control?')
  ).forEach(k => delete of1Cache[k]);

  // ── IMMEDIATE PRE-RENDER ──
  // Render chips with the correct sprint/non-sprint layout RIGHT NOW based on the race's
  // metadata, before any API call. That way if OpenF1 is rate-limited or unavailable,
  // the chips still show the right session lineup (just all as pending).
  const initialSprintFlag = !!race?.sprint || SPRINT_CIRCUITS.has(race?.circuitId);
  renderSessionBadges([], initialSprintFlag);

  const btn = $('autoFetchBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching...';
  $('fetchStatus').style.color = 'var(--muted)';
  $('fetchStatus').textContent = 'Checking cloud cache…';

  try {
    // ── Step 1: Check Supabase sessions table (synced every 30 min by Edge Function) ──
    const sbSessions = await sbGet(
      `sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&order=fetched_at.desc&limit=50`
    );

    if(sbSessions && sbSessions.length > 0){
      // Build pseudo-sessions array for renderSessionBadges (mark all as done)
      const now = new Date();
      const fakeSess = sbSessions.map(s => ({
        session_key:  s.session_key,
        session_name: s.session_name,
        session_type: s.session_name === 'Race' ? 'Race' : 'Practice',
        date_start:   new Date(now.getTime() - 7200000).toISOString(),
        date_end:     new Date(now.getTime() -   60000).toISOString(),
      }));
      renderSessionBadges(fakeSess, !!race?.sprint);

      const fetched = [];

      // Qualifying grid — newest COMPLETE grid wins (ignores partial bridge bursts)
      const sbQ = pickBestSessionRow(sbSessions, 'Qualifying');
      if(sbQ?.grid_data?.length){
        qualifyingGrid = sbQ.grid_data.map((g, i) => ({
          driverId: drivers.find(x => x.abbr === g.abbr)?.driverId || g.abbr,
          pos: g.pos ?? i + 1,
        }));
        $('qualyInput').value = sbQ.grid_data.map(g => g.abbr).join(', ');
        $('qualyStatus').textContent = '✓ Cloud sync — ' + qualifyingGrid.length + ' drivers';
        $('qualyStatus').style.color = '#3fc07a';
        fetched.push('Qualifying');
        setMode('post');
      }

      // Sprint Qualifying grid — newest COMPLETE grid wins
      const sbSQ = pickBestSessionRow(sbSessions, 'Sprint Qualifying') || pickBestSessionRow(sbSessions, 'Sprint Shootout');
      if(sbSQ?.grid_data?.length){
        sprintQualiGrid = sbSQ.grid_data.map((g, i) => ({
          driverId: drivers.find(x => x.abbr === g.abbr)?.driverId || g.abbr,
          pos: g.pos ?? i + 1,
        }));
        $('sprintQualiInput').value = sbSQ.grid_data.map(g => g.abbr).join(', ');
        $('sprintQualiStatus').textContent = '✓ Cloud sync — ' + sprintQualiGrid.length + ' drivers';
        $('sprintQualiStatus').style.color = '#3fc07a';
        fetched.push('Sprint Qualifying');
      }

      // Race result → auto-score AI vs Reality — newest COMPLETE grid wins
      const sbR = pickBestSessionRow(sbSessions, 'Race');
      if(sbR?.grid_data?.length){
        const actualIds = sbR.grid_data.map(g =>
          drivers.find(x => x.abbr === g.abbr)?.driverId || g.abbr
        );
        const stored = await getStoredPrediction(race, 'race');
        if(stored && stored.accuracy === null){
          const acc = calcAccuracy(stored.prediction.top10, actualIds);
          await requestServerScoring();
          const tab = $('tComp');
          if(tab) tab.innerHTML = `⚖️ AI vs Reality <span class="auto-badge" style="font-size:8px">${acc}%</span>`;
        }
        fetched.push('Race result');
      }

      // Always set countdown from race date when using Supabase path
      setCountdownFromSessions([], race.date);
      // Try to get live weather from the latest session key stored in Supabase
      const latestSbSess = sbSessions.filter(s=>s.session_key).slice(-1)[0];
      if(latestSbSess?.session_key) fetchWeatherLive(latestSbSess.session_key);

      if(fetched.length){
        $('fetchStatus').innerHTML = `<span style="color:#3fc07a">☁ Loaded from cloud: ${fetched.join(' · ')}</span>`;
        $('sessionApplyStatus').textContent = '✓ Session data loaded from Supabase cloud';
        $('sessionApplyStatus').style.color = '#3fc07a';
        updateBanner();
        showToastOnce(`cloud:${race?.circuitId}:${fetched.join(',')}`, '☁ Session data loaded from cloud', 'success');
        notifyDataFetched(race?.name || 'Race');
        btn.disabled = false;
        btn.textContent = '🔄 Auto-fetch from OpenF1';
        return;
      }
      // Sessions exist in Supabase but no grid data yet — fall through to direct OpenF1
    }

    // ── Step 2: Fall back to direct OpenF1 API call ──
    of1LiveLocked = false;
    of1RateLimited = false;
    $('fetchStatus').textContent = 'Connecting to OpenF1…';
    const meeting = await getOf1Meeting(race);
    if(!meeting){
      if(of1LiveLocked){
        const liveLabel = getLiveSessionLabel(race);
        $('fetchStatus').innerHTML = `<span style="color:var(--gold)">🔴 ${liveLabel||'Session'} in progress — OpenF1 restricts access during live sessions. <a href="https://www.formula1.com/en/live" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Watch on F1.com →</a></span>`;
        renderLiveLocked(liveLabel);
      } else if(of1RateLimited){
        $('fetchStatus').innerHTML = '<span style="color:var(--gold)">⏳ OpenF1 rate-limited — please wait a minute and try again.</span>';
      } else {
        $('fetchStatus').innerHTML = '<span style="color:var(--gold)">⚠ No OpenF1 data for this race yet — available ~30 min after each session.</span>';
      }

      // ── FALLBACK: Try Jolpica/Ergast for any sessions that have ended ──
      // Free, no live-lock, but typically lags 1h–1d behind sessions.
      const jolpicaFetched = [];
      const tryJolpicaFor = async (kind, sessionName, applyFn) => {
        if(!isSessionEnded(race, kind)) return;
        $('fetchStatus').innerHTML += ' · Trying Jolpica fallback…';
        const grid = await fetchJolpicaSessionGrid(race, kind);
        if(grid?.length){
          applyFn(grid);
          await saveSessionGridToSupabase(race, sessionName, grid, 'jolpica');
          jolpicaFetched.push(sessionName);
        }
      };

      // ── F1.com scrape — try BEFORE Jolpica since it publishes faster post-session ──
      const tryF1ComFor = async (kind, sessionName, applyFn) => {
        if(!isSessionEnded(race, kind)) return false;
        const results = await tryFetchFromF1Com(race, kind);
        if(!results?.length) return false;
        // Normalize: F1.com returns {position, tla, ...} — convert to our grid format
        const grid = results.map(r => {
          const drv = drivers.find(x => x.abbr === r.tla);
          return { driverId: drv?.driverId || r.tla, pos: r.position, abbr: r.tla };
        }).filter(g => g.pos > 0).sort((a,b) => a.pos - b.pos);
        if(!grid.length) return false;
        applyFn(grid);
        await saveSessionGridToSupabase(race, sessionName, grid, 'formula1.com');
        jolpicaFetched.push(sessionName + ' (F1.com)');
        return true;
      };

      const isSprint = !!race?.sprint || SPRINT_CIRCUITS.has(race?.circuitId);
      if(isSprint){
        const sqOk = await tryF1ComFor('sprintQuali', 'Sprint Qualifying', g => {
          sprintQualiGrid = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
          $('sprintQualiInput').value = g.map(x => x.abbr).join(', ');
          $('sprintQualiStatus').textContent = '✓ F1.com — ' + g.length + ' drivers';
          $('sprintQualiStatus').style.color = '#3fc07a';
        });
        if(!sqOk) await tryJolpicaFor('sprintQuali', 'Sprint Qualifying', g => {
          sprintQualiGrid = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
          $('sprintQualiInput').value = g.map(x => x.abbr).join(', ');
          $('sprintQualiStatus').textContent = '✓ Jolpica fallback — ' + g.length + ' drivers';
          $('sprintQualiStatus').style.color = '#3fc07a';
        });

        const spOk = await tryF1ComFor('sprint', 'Sprint', g => {
          sprintResult = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
        });
        if(!spOk) await tryJolpicaFor('sprint', 'Sprint', g => {
          sprintResult = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
        });
      }
      const qOk = await tryF1ComFor('quali', 'Qualifying', g => {
        qualifyingGrid = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
        $('qualyInput').value = g.map(x => x.abbr).join(', ');
        $('qualyStatus').textContent = '✓ F1.com — ' + g.length + ' drivers';
        $('qualyStatus').style.color = '#3fc07a';
        setMode('post');
      });
      if(!qOk) await tryJolpicaFor('quali', 'Qualifying', g => {
        qualifyingGrid = g.map(x => ({ driverId: x.driverId, pos: x.pos }));
        $('qualyInput').value = g.map(x => x.abbr).join(', ');
        $('qualyStatus').textContent = '✓ Jolpica fallback — ' + g.length + ' drivers';
        $('qualyStatus').style.color = '#3fc07a';
        setMode('post');
      });

      const rOk = await tryF1ComFor('race', 'Race', async g => {
        const actualIds = g.map(x => x.driverId);
        const stored = await getStoredPrediction(race, 'race');
        if(stored && stored.accuracy === null){
          const acc = calcAccuracy(stored.prediction.top10, actualIds);
          await requestServerScoring();
        }
      });
      if(!rOk) await tryJolpicaFor('race', 'Race', async g => {
        const actualIds = g.map(x => x.driverId);
        const stored = await getStoredPrediction(race, 'race');
        if(stored && stored.accuracy === null){
          const acc = calcAccuracy(stored.prediction.top10, actualIds);
          await requestServerScoring();
        }
      });

      if(jolpicaFetched.length){
        $('fetchStatus').innerHTML = `<span style="color:#3fc07a">✓ Loaded from Jolpica fallback: ${jolpicaFetched.join(' · ')}</span>`;
        unlockArchTab();
        updateBanner();
        showToastOnce(`jolpica:${race?.circuitId}:${jolpicaFetched.join(',')}`, '✓ Session data loaded from Jolpica', 'success');
      } else if(of1LiveLocked || of1RateLimited){
        // Both sources failed — schedule background retry for when OpenF1 unlocks
        scheduleSessionDataRetry(race);
        $('fetchStatus').innerHTML += ' <span style="color:var(--dim);font-size:11px">· Background retry every 3 min</span>';
      }

      setCountdownFromSessions([], race.date);
      btn.disabled=false; btn.textContent='🔄 Auto-fetch from OpenF1'; return;
    }

    currentMeetingKey = meeting.meeting_key;
    fetchDriverHeadshots(meeting.meeting_key); // load headshots in background
    fetchPracticeResults(meeting.meeting_key); // load practice results in background
    const sessions = await getOf1Sessions(meeting.meeting_key);
    const isSprint = !!race?.sprint;
    console.log('[OpenF1] race:', race?.name, 'sprint:', isSprint, 'sessions:', sessions.map(s=>s.session_name));
    renderSessionBadges(sessions, isSprint);
    renderRaceSchedule(sessions, race); // show session schedule card
    // Set countdown to next upcoming session
    setCountdownFromSessions(sessions, race.date);
    // Fetch live weather from most recent completed session
    const latestDone=[...sessions].filter(s=>sessionDone(s)).sort((a,b)=>new Date(b.date_end)-new Date(a.date_end))[0];
    if(latestDone) fetchWeatherLive(latestDone.session_key);

    const fetched = [];

    // Qualifying → main race grid
    const qualiSess = sessions.find(s=>s.session_name==='Qualifying'||s.session_type==='Qualifying');
    if(qualiSess && sessionLive(qualiSess)){
      // Qualifying is currently happening — show in-progress message
      qualiSessionLive = true;
      setMode('post');
    } else if(qualiSess && sessionDone(qualiSess)){
      qualiSessionLive = false;
      const grid = await getOf1Grid(qualiSess.session_key, meeting.meeting_key);
      if(grid.length){
        qualifyingGrid = grid.map(g=>({driverId:g.driverId, pos:g.pos}));
        $('qualyInput').value = grid.map(g=>g.abbr).join(', ');
        $('qualyStatus').textContent = '✓ Auto-fetched — '+grid.length+' drivers';
        $('qualyStatus').style.color  = '#3fc07a';
        fetched.push('Qualifying grid');
        setMode('post');
        fetchQualifyingTimes(qualiSess.session_key, meeting.meeting_key);
        saveSessionGridToSupabase(race, 'Qualifying', grid, 'openf1');
      }
    }

    // Sprint Qualifying → sprint race grid
    // Catch ANY session name containing "sprint" + qualifying/shootout indicator.
    const sqSess = sessions.find(s => {
      const n = (s.session_name || '').toLowerCase();
      const t = (s.session_type || '').toLowerCase();
      return (n.includes('sprint') && (n.includes('quali') || n.includes('shoot'))) ||
             (t === 'qualifying' && n.includes('sprint'));
    });
    if(sqSess){
      console.log('[OpenF1] Sprint Quali session found:', sqSess);
      // Try to fetch grid even if date_end check is borderline — OpenF1 sometimes
      // has results before its own date_end timestamp updates.
      const grid = await getOf1Grid(sqSess.session_key, meeting.meeting_key);
      console.log('[OpenF1] Sprint Quali grid drivers:', grid.length);
      if(grid.length){
        sprintQualiGrid = grid.map(g=>({driverId:g.driverId, pos:g.pos}));
        $('sprintQualiInput').value = grid.map(g=>g.abbr).join(', ');
        $('sprintQualiStatus').textContent = '✓ Auto-fetched — '+grid.length+' drivers';
        $('sprintQualiStatus').style.color  = '#3fc07a';
        fetched.push('Sprint qualifying grid');
        saveSessionGridToSupabase(race, 'Sprint Qualifying', grid, 'openf1');
      } else if(!sessionDone(sqSess)){
        $('sprintQualiStatus').textContent = '⏳ Sprint qualifying still in progress — data not finalised yet.';
        $('sprintQualiStatus').style.color  = 'var(--gold)';
      } else {
        $('sprintQualiStatus').textContent = '⚠ Sprint qualifying ended but OpenF1 hasn\'t published positions yet (usually ~30 min lag).';
        $('sprintQualiStatus').style.color  = 'var(--gold)';
      }
    } else {
      console.log('[OpenF1] No Sprint Quali session found in', sessions.map(s=>s.session_name));
    }

    // Sprint Race — live polling while sprint is in progress
    const sprintSessLive = sessions.find(s => {
      const n = (s.session_name || '').toLowerCase();
      return n.includes('sprint') && !n.includes('quali') && !n.includes('shoot');
    });
    if(sprintSessLive && sessionLive(sprintSessLive)){
      startLivePolling(sprintSessLive.session_key, 'Sprint Race');
    }

    // Race result → auto-trigger AI vs Reality (+ live polling if race is happening now)
    const raceSess = sessions.find(s=>s.session_name==='Race') || sessions.find(s=>s.session_type==='Race' && !/sprint/i.test(s.session_name||''));
    if(raceSess && sessionLive(raceSess)){
      startLivePolling(raceSess.session_key, 'Race');
    } else if(raceSess && sessionDone(raceSess)){
      stopLivePolling();
      currentRaceSessKey = raceSess.session_key;
      const grid = await getOf1Grid(raceSess.session_key, meeting.meeting_key);
      if(grid.length){
        const actualIds = grid.map(g=>g.driverId);
        const races2 = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
        const r2 = races2[selectedIdx]||races2[0];
        if(r2){
          const stored = await getStoredPrediction(r2,'race');
          if(stored && stored.accuracy===null){
            const acc = calcAccuracy(stored.prediction.top10, actualIds);
            await requestServerScoring();
            const tab=$('tComp');
            if(tab) tab.innerHTML=`⚖️ AI vs Reality <span class="auto-badge" style="font-size:8px">${acc}%</span>`;
            showToast(`Race result loaded — ${acc}% accuracy!`, 'success');
          }
        }
        fetched.push('Race result (AI vs Reality updated)');
        saveSessionGridToSupabase(race, 'Race', grid, 'openf1');
      }
    }

    // Sprint result — any session with "sprint" in the name that's NOT a quali/shootout
    const sprintSess = sessions.find(s => {
      const n = (s.session_name || '').toLowerCase();
      return n.includes('sprint') && !n.includes('quali') && !n.includes('shoot');
    });
    if(sprintSess && sessionDone(sprintSess)){
      const grid = await getOf1Grid(sprintSess.session_key, meeting.meeting_key);
      if(grid.length){
        sprintResult = grid.map(g => ({ driverId: g.driverId, pos: g.pos }));
        fetched.push('Sprint result');
        unlockArchTab();
        saveSessionGridToSupabase(race, 'Sprint', grid, 'openf1');
      }
    }

    if(fetched.length){
      $('fetchStatus').innerHTML = `<span style="color:#3fc07a">✓ Auto-fetched: ${fetched.join(' · ')}</span>`;
      $('sessionApplyStatus').textContent = '✓ Session data applied automatically';
      $('sessionApplyStatus').style.color = '#3fc07a';
      updateBanner();
      showToastOnce(`of1:${race?.circuitId}:${fetched.join(',')}`, '✓ Session data loaded from OpenF1', 'success');
      notifyDataFetched(race?.name || 'Race');
    } else {
      $('fetchStatus').innerHTML = '<span style="color:var(--gold)">⚠ Sessions found but none have finished yet — check back after each session ends.</span>';
    }

  } catch(e){
    console.warn('OpenF1 error:', e);
    $('fetchStatus').innerHTML = `<span style="color:var(--red)">✗ OpenF1 unavailable: ${e.message} — use manual input below.</span>`;
  }

  btn.disabled=false;
  btn.textContent='🔄 Auto-fetch from OpenF1';
}

/* ═══════════════════════════════════════════════
   PREDICTION STORAGE — Supabase cloud
   Nothing stored on device. Data lives in the cloud
   and syncs across all devices automatically.
   ═══════════════════════════════════════════════ */
/* ── Session-stage detection ─────────────────────────────
   Each race weekend has discrete "stages". A prediction is
   stable within a stage and updates when the stage advances.
   - Sprint weekend: beforeSprintQ → afterSprintQ → afterSprint → afterQuali → final
   - Normal weekend: beforeQuali → afterQuali → final
*/
function getCurrentStage(race){
  // Pure time-based — same source of truth as _archStageIsUnlocked.
  if(!race) return 'beforeQuali';
  const isSprint = !!race?.sprint || SPRINT_CIRCUITS.has(race?.circuitId);
  if(isSessionEnded(race, 'race'))         return 'final';
  if(isSprint){
    if(isSessionEnded(race, 'quali'))       return 'afterQuali';
    if(isSessionEnded(race, 'sprint'))      return 'afterSprint';
    if(isSessionEnded(race, 'sprintQuali')) return 'afterSprintQ';
    return 'beforeSprintQ';
  }
  if(isSessionEnded(race, 'quali')) return 'afterQuali';
  return 'beforeQuali';
}

/* Human-readable label for a stage */
function stageLabel(stage){
  return ({
    beforeSprintQ:'Before Sprint Qualifying',
    afterSprintQ:'After Sprint Qualifying',
    afterSprint:'After Sprint Race',
    beforeQuali:'Before Qualifying',
    afterQuali:'After Qualifying',
    final:'Final / Post-race',
  })[stage] || stage;
}

/* Ordered list of stages for a given race weekend */
function stagesForRace(race){
  const isSprint = !!race?.sprint || SPRINT_CIRCUITS.has(race?.circuitId);
  return isSprint
    ? ['beforeSprintQ','afterSprintQ','afterSprint','afterQuali']
    : ['beforeQuali','afterQuali'];
}

async function savePrediction(race, prediction, predType, stage){
  const finalStage = stage || getCurrentStage(race);
  // Once the race is over a "prediction" would be made with the result known: show it, never store it.
  if(finalStage === 'final' || getCurrentStage(race) === 'final') return false;
  await saveRow('prediction', {
    race_name:race.name, round:Number(race.round), circuit_id:race.circuitId,
    race_date:race.date, pred_type:predType||'race', stage: finalStage, prediction });
  await refreshPredictionsCache();
}

/* The prediction AI vs Reality should judge: the last one made before the race
   (afterQuali → afterSprint → afterSprintQ → before…), preferring a real AI prediction
   over a baseline. Post-race ('final') and mid-race predictions never count. */
const PRE_RACE_STAGE_ORDER = ['afterQuali','afterSprint','afterSprintQ','beforeQuali','beforeSprintQ'];
async function getBestPreRaceSnapshot(race, predType){
  const rows = await sbGet(`predictions?circuit_id=eq.${race.circuitId}&round=eq.${race.round}&pred_type=eq.${predType||'race'}&stage=neq.final&order=created_at.desc`);
  if(!rows?.length) return null;
  const rank = r => (r.prediction?._fallback ? 100 : 0) + (PRE_RACE_STAGE_ORDER.indexOf(r.stage) + 1 || 50);
  return rows.slice().sort((a,b) => rank(a) - rank(b))[0];
}

async function getStoredPrediction(race, predType, stage){
  let q = `predictions?circuit_id=eq.${race.circuitId}&round=eq.${race.round}&pred_type=eq.${predType||'race'}`;
  if(stage) q += `&stage=eq.${stage}`;
  q += '&order=created_at.desc&limit=1';
  const rows = await sbGet(q);
  return rows[0] ?? null;
}

/* ═══════════════════════════════════════════════
   PREDICTIONS ARCHIVE TAB
   Shows all prediction snapshots saved across this
   weekend's session stages — with sub-tabs and a
   Sprint/Race switch on the relevant stages.
   ═══════════════════════════════════════════════ */
let _archState = { stage:null, type:'race' };

function _archStageHasTypeSwitch(stage){
  // Only the two pre-/post-sprint-qualifying stages have BOTH race and sprint predictions
  return stage === 'beforeSprintQ' || stage === 'afterSprintQ';
}

function _archStageIsUnlocked(race, stage){
  // 'Before' stages are always available — the user can generate a pre-session prediction.
  if(stage === 'beforeSprintQ' || stage === 'beforeQuali') return true;
  if(!race) return false;

  // Otherwise: unlock ONLY when we have actual data for the session that ended.
  // Data sources (any one is enough):
  //   1. Local session-grid loaded from OpenF1 (this tab)
  //   2. A prediction snapshot already exists in Supabase for this stage
  //      (created by the server cron, which uses schedule-based stage detection)
  //   3. The race is already in completedRaces (Jolpica/Ergast results loaded)
  const hasLocalData = (() => {
    switch(stage){
      case 'afterSprintQ': return sprintQualiGrid?.length > 0;
      case 'afterSprint':  return sprintResult?.length    > 0;
      case 'afterQuali':   return qualifyingGrid?.length  > 0;
      case 'final':        return (completedRaces||[]).some(r =>
        r.circuitId === race.circuitId && !String(r.round).endsWith('S')
      );
    }
    return false;
  })();
  if(hasLocalData) return true;

  const hasSnapshot = cachedPredictions?.some(p =>
    p.circuit_id === race.circuitId &&
    String(p.round) === String(race.round) &&
    p.stage === stage
  );
  return !!hasSnapshot;
}

async function openArchTab(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  if(!race){ $('archContent').innerHTML = '<div class="arch-empty">No race selected.</div>'; return; }

  // Pull fresh snapshots from Supabase so server-auto-generated stages unlock immediately
  await refreshPredictionsCache();

  const isSprintRace = !!race?.sprint || SPRINT_CIRCUITS.has(race?.circuitId);
  $('archRaceLabel').innerHTML = `<strong style="color:var(--text)">${race.name}</strong> — Round ${race.round} · ${race.circuit}${isSprintRace?' <span style="color:var(--gold)">⚡ Sprint Weekend</span>':''}`;

  // Default to current stage on first open
  const current = getCurrentStage(race);
  if(!_archState.stage || !stagesForRace(race).includes(_archState.stage)){
    // After the race there is no 'final' stage to show: open on the last pre-race one.
    _archState.stage = stagesForRace(race).includes(current) ? current : stagesForRace(race).slice(-1)[0];
  }
  // Default to Race on type switch
  if(!_archState.type) _archState.type = 'race';

  // Render sub-tabs
  const stages = stagesForRace(race);
  $('archSubTabs').innerHTML = stages.map(s => {
    const unlocked = _archStageIsUnlocked(race, s);
    const lockCls  = unlocked ? '' : ' locked';
    const activeCls= s === _archState.stage ? ' active' : '';
    const shortLabel = ({
      beforeSprintQ:'Before Sprint Q',
      afterSprintQ:'After Sprint Q',
      afterSprint:'After Sprint',
      beforeQuali:'Before Quali',
      afterQuali:'After Quali',
    })[s] || s;
    return `<button class="arch-subtab${activeCls}${lockCls}" onclick="selectArchStage('${s}')" ${unlocked?'':'disabled'}>${unlocked?'':'🔒 '}${shortLabel}</button>`;
  }).join('');

  await renderArchPane();
}

function selectArchStage(stage){
  _archState.stage = stage;
  openArchTab();
}

async function renderArchPane(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  const race  = races[selectedIdx] || races[0];
  if(!race) return;

  const stage = _archState.stage;
  // Capture dropdown value if user just changed it
  const sel = $('archTypeSel');
  if(sel) _archState.type = sel.value;

  // Show/hide Sprint/Race switch
  const switchEl = $('archTypeSwitch');
  if(_archStageHasTypeSwitch(stage) && race.sprint){
    switchEl.style.display = 'block';
    if(sel) sel.value = _archState.type || 'race';
  } else {
    switchEl.style.display = 'none';
    // Non-switch stages always show race prediction
    _archState.type = 'race';
  }

  const predType = _archState.type;
  const unlocked = _archStageIsUnlocked(race, stage);

  if(!unlocked){
    $('archContent').innerHTML = `
      <div class="arch-empty">
        <div style="font-size:32px;margin-bottom:10px">🔒</div>
        <div style="font-weight:700;color:var(--text);margin-bottom:4px;font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;text-transform:uppercase">${stageLabel(stage)}</div>
        <div>This stage hasn't started yet. Predictions become available once the corresponding session ends.</div>
      </div>`;
    return;
  }

  const stored = await getStoredPrediction(race, predType, stage);
  if(!stored || !stored.prediction?.top10?.length){
    $('archContent').innerHTML = `
      <div class="arch-empty">
        <div style="font-size:32px;margin-bottom:10px">📭</div>
        <div style="font-weight:700;color:var(--text);margin-bottom:4px;font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;text-transform:uppercase">No saved prediction</div>
        <div>You haven't generated a ${predType==='sprint'?'sprint':'race'} prediction for "${stageLabel(stage)}" yet.<br>Go to the AI Prediction tab and click Generate.</div>
      </div>`;
    return;
  }

  // Render the saved snapshot
  const created = stored.created_at ? new Date(stored.created_at).toLocaleString() : '';
  const acc = stored.accuracy !== null && stored.accuracy !== undefined
    ? ` · <strong style="color:#3fc07a">${stored.accuracy}% accurate</strong>`
    : '';
  const meta = `
    <div class="arch-meta">
      <span>📌 ${stageLabel(stage)} · ${predType==='sprint'?'⚡ Sprint':'🏆 Race'}</span>
      <span style="color:var(--muted);margin-left:auto">Generated ${created}${acc}</span>
    </div>`;

  $('archContent').innerHTML = meta + '<div id="archPodWrap"></div><div id="archTblWrap"></div>';
  renderArchSnapshot(stored.prediction, race);
}

function renderArchSnapshot(parsed, race){
  // Reuse the existing podium + table render logic by piping into temp containers
  const podiumWrap = $('archPodWrap');
  const tableWrap  = $('archTblWrap');
  const top10 = parsed.top10 || [];
  if(!top10.length){ podiumWrap.innerHTML='<div class="arch-empty">Empty prediction.</div>'; return; }

  // Podium (top 3)
  const pod = top10.slice(0,3).map((d,i) => {
    const order = [1,0,2][i]; // for visual P2-P1-P3 layout
    const drv = top10[order];
    if(!drv) return '';
    const driverObj = drivers.find(x => x.driverId === drv.driverId || x.abbr === drv.abbr);
    const teamKey   = driverObj?.team || 'mercedes';
    const teamColor = TC[teamKey] || '#999';
    const pos = drv.pos;
    const hClass = pos===1?'first':pos===2?'second':'third';
    return `
      <div class="podium-spot ${hClass}">
        <div class="podium-pos">${pos===1?'🥇':pos===2?'🥈':'🥉'}</div>
        <div class="podium-driver" style="border-color:${teamColor}">
          <div class="podium-abbr" style="color:${teamColor}">${drv.abbr || driverObj?.abbr || '?'}</div>
          <div class="podium-name">${drv.name || driverObj?.name || ''}</div>
          <div class="podium-team" style="color:${teamColor}">${drv.team || TN[teamKey] || ''}</div>
        </div>
      </div>`;
  }).join('');
  podiumWrap.innerHTML = `<div class="podium">${pod}</div>`;

  // Full table
  const rows = top10.map(d => {
    const driverObj = drivers.find(x => x.driverId === d.driverId || x.abbr === d.abbr);
    const teamKey   = driverObj?.team || 'mercedes';
    const teamColor = TC[teamKey] || '#999';
    const pts = F1P[d.pos - 1] || 0;
    const winProb = typeof d.winProb === 'number' ? d.winProb.toFixed(1) + '%' : (d.winProb || '—');
    return `
      <tr>
        <td><strong>${d.pos}</strong></td>
        <td style="border-left:3px solid ${teamColor};padding-left:8px"><strong>${d.abbr || driverObj?.abbr || '?'}</strong> <span style="color:var(--muted);font-size:11px;margin-left:4px">${d.name || driverObj?.name || ''}</span></td>
        <td><span style="color:${teamColor}">${d.team || TN[teamKey] || ''}</span></td>
        <td><span class="bwrap"><span class="bval">${winProb}</span></span></td>
        <td>${pts}</td>
      </tr>`;
  }).join('');

  tableWrap.innerHTML = `
    <div class="stitle">Full Top 10</div>
    <div style="overflow-x:hidden;width:100%">
      <table style="table-layout:fixed;width:100%">
        <colgroup>
          <col style="width:38px"/><col style="width:auto"/>
          <col style="width:120px"/><col style="width:110px"/><col style="width:90px"/>
        </colgroup>
        <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Win Prob</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${parsed.overallAnalysis ? `<div class="stitle">AI Reasoning</div><div class="ai-reasoning"><div class="ai-reasoning-body">${parsed.overallAnalysis}</div></div>`:''}
  `;
}

/* Triggered by the visible Force Fresh button on the Predict tab.
   Bypasses cache, pulls latest from Supabase, regenerates AI prediction. */
function syncForceFreshBtn(race){
  const btn = $('forceFreshBtn');
  if(!btn) return;
  // Hide during a live race — Force Regenerate overwrites the pre-race snapshot
  // with a cold prompt that has no live positions. Mid-race updates belong in the Live tab.
  btn.style.display = (race && getLiveSessionLabel(race) === 'Grand Prix') ? 'none' : '';
}

function forceFreshPrediction(){
  window._forceFreshPrediction = true;
  const mode = (predictionMode === 'sprint') ? 'sprint' : 'race';
  console.log('[force-fresh] Bypassing cache, fetching latest Supabase data, mode:', mode);
  runAIPrediction(mode);
}

/* Triggered by the "↻ Force regenerate" button — sets a one-shot flag,
   switches to the prediction tab, and runs a fresh AI prediction. */
function forceFreshPredictionFromArch(){
  if(!confirm('Force a fresh AI prediction for the current stage?\n\nThis will overwrite the saved snapshot for this session-stage.')) return;
  window._forceFreshPrediction = true;
  setTab('pred');
  const mode = (_archState.type === 'sprint') ? 'sprint' : 'race';
  runAIPrediction(mode);
}

/* Driver → 3-letter code, whatever shape it arrives in (object, driverId or code). */
function driverAbbr(x){
  if(!x) return '';
  if(typeof x === 'object') return String(x.abbr || driverAbbr(x.driverId)).toUpperCase();
  const d = drivers.find(v => v.driverId === x) || BASE_DRIVERS.find(v => v.driverId === x);
  return String(d?.abbr || x).toUpperCase();
}

/* Accuracy of a predicted top 10 against the full finishing order.
   Exact position = 1 point, within ±2 places = 0.5 point, as a % of the maximum.
   The server scoring job (supabase/functions/auto-results) uses the same formula. */
function calcAccuracy(top10, actualIds){
  if(!top10?.length || !actualIds?.length) return null;
  const pred = top10.map(driverAbbr), act = actualIds.map(driverAbbr);
  const n = Math.min(pred.length, act.length, 10);
  let exact = 0, close = 0;
  for(let i = 0; i < n; i++){
    if(pred[i] === act[i]){ exact++; continue; }
    const j = act.indexOf(pred[i]);
    if(j >= 0 && Math.abs(j - i) <= 2) close++;
  }
  return Math.round(((exact + close * 0.5) / n) * 100);
}

/* Scores are written only by the server job, so every snapshot is scored on its
   own with one formula against the official classification. The page just asks
   the job to run now (at most every 5 minutes per visitor). */
let _scoringRequestedAt = 0;
async function requestServerScoring(){
  if(Date.now() - _scoringRequestedAt < 5 * 60 * 1000) return;
  _scoringRequestedAt = Date.now();
  try {
    await fetch(SB_URL + '/functions/v1/auto-results', { method: 'POST', mode: 'no-cors', signal: AbortSignal.timeout(60000) });
    await refreshPredictionsCache();
  } catch(e){ console.warn('Scoring request:', e.message); }
}

/* Auto-update accuracy for any stored predictions that now have API results */
async function checkStoredPredictions(){
  await refreshPredictionsCache();
  for(const entry of cachedPredictions){
    if(entry.accuracy !== null) continue;
    const actual = completedRaces.find(r=>
      r.circuitId===entry.circuit_id && String(r.round)===String(entry.round) && entry.pred_type==='race'
    ) || completedRaces.find(r=>
      r.circuitId===entry.circuit_id && String(r.round)===String(entry.round)+'S' && entry.pred_type==='sprint'
    );
    if(!actual) continue;
    await requestServerScoring();   // results exist for an unscored snapshot
    break;
  }
  await refreshPredictionsCache();
  // Badge the AI vs Reality tab if current race has a scored prediction
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  if(race){
    const stored = cachedPredictions.find(p=>
      p.circuit_id===race.circuitId && String(p.round)===String(race.round) && p.accuracy!==null
    );
    if(stored){
      const tab=$('tComp');
      if(tab) tab.innerHTML=`⚖️ AI vs Reality <span class="auto-badge" style="font-size:8px">${stored.accuracy}%</span>`;
    }
  }
}

/* Called when user switches to the AI vs Reality tab — fully automatic */
async function autoShowComparison(){
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  const stateEl=$('compState'), resultEl=$('compResult');

  function showState(icon,title,sub,color='var(--muted)'){
    if(stateEl) stateEl.innerHTML=`<div class="comp-state">
      <div class="comp-state-icon">${icon}</div>
      <div class="comp-state-title" style="color:${color}">${title}</div>
      <div class="comp-state-sub">${sub}</div>
    </div>`;
    if(resultEl) resultEl.style.display='none';
  }

  if(!race){ showState('🏁','No Race Selected','Select a race from the dropdown.'); return; }

  // Check if the race has passed
  const raceDay = new Date(race.date);
  const now = new Date();
  const racePassed = raceDay < now;

  // Try to load stored prediction
  const stored = await getBestPreRaceSnapshot(race,'race') ?? await getBestPreRaceSnapshot(race,'sprint');

  if(!stored){
    if(!racePassed){
      showState('🤖','Prediction Not Generated Yet',
        `Generate an AI prediction for ${race.name} first. The comparison will appear automatically after the race weekend.`);
    } else {
      showState('📭','No Prediction Found',
        `No AI prediction was generated for ${race.name} before the race. Generate one now to compare against the actual result.`);
    }
    return;
  }

  if(stored.actual_results && stored.accuracy!==null){
    // We have everything — show comparison
    if(stateEl) stateEl.innerHTML='';
    showComparisonResult(stored.prediction.top10, stored.actual_results, true, !!stored.prediction._fallback, stored.stage);
    // Badge the tab
    const tab=$('tComp');
    if(tab) tab.innerHTML=`⚖️ AI vs Reality <span class="auto-badge" style="font-size:8px">${stored.accuracy}%</span>`;
    return;
  }

  // Prediction exists but no race result yet
  if(!racePassed){
    // Race is in the future
    const daysLeft = Math.ceil((raceDay-now)/(1000*60*60*24));
    showState('⏳','Race Not Completed Yet',
      `${race.name} is in ${daysLeft} day${daysLeft!==1?'s':''}. The AI prediction has been saved — come back after the race and the comparison will appear automatically.`,
      'var(--gold)');
  } else {
    // Race passed but results not in yet — show refresh button
    if(stateEl) stateEl.innerHTML=`<div class="comp-state">
      <div class="comp-state-icon">🏁</div>
      <div class="comp-state-title" style="color:#64a0ff">Race Finished — Fetch Results</div>
      <div class="comp-state-sub">${race.name} has passed. Tap below to pull the official results and score your prediction.</div>
      <button class="btn" style="margin-top:16px;border-color:#64a0ff;color:#64a0ff;font-size:13px;padding:10px 24px"
        onclick="refreshAndScore(this)">↻ Fetch Race Results</button>
    </div>`;
    if(resultEl) resultEl.style.display='none';
  }
}

async function refreshAndScore(btn){
  if(btn){ btn.disabled=true; btn.textContent='Fetching…'; }
  await fetchLiveData();
  await checkStoredPredictions();
  await autoShowComparison();
}

function showComparisonResult(top10, actualIds, isAuto, isBaseline, stage){
  const n=Math.min(top10.length,actualIds.length,10);
  const actAbbrs=actualIds.map(driverAbbr);
  let exact=0,close=0;
  const rows=[];
  for(let i=0;i<n;i++){
    const pred=top10[i];
    const predAbbr=driverAbbr(pred);
    const actualDriver=drivers.find(x=>x.driverId===actualIds[i]||x.abbr===actAbbrs[i]);
    const isMatch=predAbbr===actAbbrs[i];
    const predActualPos=actAbbrs.indexOf(predAbbr);
    const diff=predActualPos>=0?Math.abs(predActualPos-i):null;
    if(isMatch) exact++;
    else if(diff!==null&&diff<=2) close++;
    const cls=isMatch?'match':diff!==null&&diff<=2?'close':'miss';
    const pcol=teamCol(pred.team);
    const acol=teamCol(actualDriver?.team);
    const diffCol=isMatch?'#3fc07a':diff===null||diff>4?'var(--red)':'var(--gold)';
    const diffTxt=isMatch?'✓':diff!==null?'±'+diff:'✗';
    rows.push(`<div class="cmp-row ${cls}" style="animation:slideUp .35s ${i*0.05}s ease both;opacity:0;animation-fill-mode:both">
      <div class="cmp-pos">${i+1}</div>
      <div class="cmp-side"><div class="cmp-label">${isBaseline?'📋 Baseline':'🤖 AI Predicted'}</div><div class="cmp-name" style="color:${pcol}">${esc(pred.name||predAbbr)}</div><div style="font-size:10px;color:var(--dim)">${Number(pred.winProb)||0}% confidence</div></div>
      <div class="cmp-side"><div class="cmp-label">🏁 Actual</div><div class="cmp-name" style="color:${acol}">${esc(actualDriver?.name||actualIds[i])}</div></div>
      <div class="cmp-diff" style="color:${diffCol}">${diffTxt}</div>
    </div>`);
  }
  const score=Math.round(((exact+close*0.5)/n)*100);
  const scoreCol=score>=70?'#3fc07a':score>=40?'var(--gold)':'var(--red)';
  const scoreLbl=score>=80?'Excellent':score>=60?'Good':score>=40?'Fair':'Poor';
  const basis=isBaseline?' · ⚠ baseline, not AI (AI was unavailable)':(stage?` · ${stageLabel(stage)} prediction`:'');
  $('accuracyCard').innerHTML=`
    <div class="accuracy-big" style="color:${scoreCol}">${score}%</div>
    <div class="accuracy-lbl">${scoreLbl} ${isBaseline?'baseline':'AI'} accuracy${basis}${isAuto?' · Auto-updated':''}</div>
    <div class="accuracy-breakdown">
      <div class="acc-stat"><div class="acc-stat-val" style="color:#3fc07a">${exact}</div><div class="acc-stat-lbl">Exact hits</div></div>
      <div class="acc-stat"><div class="acc-stat-val" style="color:var(--gold)">${close}</div><div class="acc-stat-lbl">Within ±2</div></div>
      <div class="acc-stat"><div class="acc-stat-val" style="color:var(--muted)">${n-exact-close}</div><div class="acc-stat-lbl">Missed</div></div>
    </div>`;
  $('compRows').innerHTML=rows.join('');
  $('compResult').style.display='';
  $('compState').style.display='none';
}

// runComparison / clearComparison removed — comparison is now fully automatic

/* ═══════════════════════════════════════════════
   CIRCUIT COORDINATES — for OpenMeteo weather
   ═══════════════════════════════════════════════ */
const CIRCUIT_COORDS = {
  villeneuve:   {lat:45.50, lon:-73.52},
  monaco:       {lat:43.73, lon:7.42},
  catalunya:    {lat:41.57, lon:2.26},
  red_bull_ring:{lat:47.22, lon:14.76},
  silverstone:  {lat:52.08, lon:-1.02},
  hungaroring:  {lat:47.58, lon:19.25},
  zandvoort:    {lat:52.39, lon:4.54},
  monza:        {lat:45.62, lon:9.28},
  ifema_madrid: {lat:40.47, lon:-3.60},
  baku:         {lat:40.37, lon:49.85},
  sepang:       {lat:2.76,  lon:101.74},
  marina_bay:   {lat:1.29,  lon:103.86},
  americas:     {lat:30.13, lon:-97.64},
  rodriguez:    {lat:19.40, lon:-99.09},
  interlagos:   {lat:-23.70,lon:-46.70},
  las_vegas:    {lat:36.11, lon:-115.17},
  losail:       {lat:25.49, lon:51.45},
  yas_marina:   {lat:24.47, lon:54.60},
  albert_park:  {lat:-37.85,lon:144.97},
  shanghai:     {lat:31.34, lon:121.22},
  suzuka:       {lat:34.84, lon:136.54},
  miami:        {lat:25.96, lon:-80.24},
  spa:          {lat:50.44, lon:5.97},
};

/* ═══════════════════════════════════════════════
   WEATHER FORECAST — OpenMeteo (free, no key)
   ═══════════════════════════════════════════════ */
const WX_CODES = {
  0:'☀',1:'🌤',2:'⛅',3:'☁',
  45:'🌫',48:'🌫',51:'🌦',53:'🌧',55:'🌧',
  61:'🌧',63:'🌧',65:'🌧',71:'❄',73:'❄',75:'❄',
  80:'🌦',81:'🌧',82:'⛈',95:'⛈',96:'⛈',99:'⛈',
};

/* Compares the current race-day forecast against a stored earlier reading and
   builds a human-readable description of HOW the weather shifted (not just the
   new value). Baseline is held ~6h so the delta stays meaningful across the
   weekend. Result goes into both the pre-race and mid-race AI prompts. */
let raceWeatherChange = null;
function computeWeatherChange(circuitId, cur){
  raceWeatherChange = null;
  if(!circuitId || !cur) return;
  try{
    const key = 'wx_prev_' + circuitId;
    const raw = localStorage.getItem(key);
    const now = Date.now();
    if(raw){
      const prev = JSON.parse(raw);
      const dRain = (cur.rain ?? 0) - (prev.rain ?? 0);
      const dHi   = (cur.hi   ?? 0) - (prev.hi   ?? 0);
      const hrs   = Math.max(1, Math.round((now - prev.ts) / 3600000));
      const parts = [];
      if(Math.abs(dRain) >= 15){
        const dir   = dRain > 0 ? 'rose' : 'fell';
        const trend = cur.rain >= 40 ? 'now WET LIKELY — boosts safety-car odds, upsets & rain specialists'
                    : cur.rain >= 20 ? 'now some rain risk'
                    : 'now trending dry';
        parts.push(`Rain probability ${dir} ${prev.rain}% → ${cur.rain}% (${dRain>0?'+':''}${dRain}pts over ~${hrs}h) — ${trend}`);
      }
      if(Math.abs(dHi) >= 4){
        parts.push(`Track-day high ${dHi>0?'up':'down'} ${prev.hi}°C → ${cur.hi}°C (affects tyre deg)`);
      }
      raceWeatherChange = parts.length ? parts.join('; ') : null;
    }
    // Refresh the baseline only when missing or stale (>6h) so deltas stay meaningful.
    if(!raw || (now - JSON.parse(raw).ts) > 6 * 3600000){
      localStorage.setItem(key, JSON.stringify({ rain: cur.rain, hi: cur.hi, lo: cur.lo, ts: now }));
    }
  }catch(e){ /* non-fatal */ }
}

async function fetchWeatherForecast(circuitId, raceDate){
  const coords = CIRCUIT_COORDS[circuitId];
  const card = $('weatherCard');
  if(!coords || !raceDate){ if(card) card.style.display='none'; return; }

  try{
    const rd = new Date(raceDate);
    // Show 5 days ending on race day
    const start = new Date(rd); start.setDate(start.getDate()-4);
    const fmt = d => d.toISOString().slice(0,10);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}`+
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum`+
      `&timezone=auto&start_date=${fmt(start)}&end_date=${fmt(rd)}`;

    const res = await fetch(url, {signal:AbortSignal.timeout(6000)});
    if(!res.ok) throw new Error('weather '+res.status);
    const data = await res.json();
    const d = data.daily;
    if(!d?.time?.length) throw new Error('no data');

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const rdStr = fmt(rd);

    let html = '';
    d.time.forEach((date,i)=>{
      const isRaceDay = date === rdStr;
      const dow = dayNames[new Date(date+'T12:00:00').getDay()];
      const icon = WX_CODES[d.weathercode[i]] || '🌡';
      const hi = Math.round(d.temperature_2m_max[i]);
      const lo = Math.round(d.temperature_2m_min[i]);
      const rain = d.precipitation_probability_max[i]||0;
      const rainCol = rain>=60?'var(--red)':rain>=30?'var(--gold)':'#64a0ff';
      if(isRaceDay){ raceWeatherData = {rain, hi, lo, icon}; computeWeatherChange(circuitId, raceWeatherData); }
      html += `<div class="wx-day-cell${isRaceDay?' race-day':''}">
        <div class="wx-day-lbl">${isRaceDay?'🏁 RACE':dow}</div>
        <div class="wx-day-icon">${icon}</div>
        <div class="wx-day-temp">${hi}° <span style="color:var(--dim);font-size:11px">${lo}°</span></div>
        <div class="wx-day-rain" style="color:${rainCol}">${rain}% 🌧</div>
      </div>`;
    });
    updateWeatherAlert();
    window._wxDays = d.time.map((date, i) => ({ date, raceDate: rdStr, race: date === rdStr,
      dow: dayNames[new Date(date + 'T12:00:00').getDay()], hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] || 0, code: d.weathercode[i] })).slice(-3);
    window.scrOnWeather?.();

    htm('wxDays', html);
    $('wxSrc').textContent = 'OpenMeteo · 5-day forecast';
    if(card) card.style.display='';
  }catch(e){
    console.warn('Weather forecast:', e.message);
    if(card) card.style.display='none';
  }
}

function updateWeatherAlert(){
  const el = $('weatherAlert');
  if(!el) return;
  if(!raceWeatherData){ el.style.display='none'; return; }

  const {rain, hi, lo, icon} = raceWeatherData;
  const col = rain>=60?'#E10600':rain>=30?'var(--gold)':'#64a0ff';
  const severity = rain>=60?'High rain risk':rain>=30?'Rain possible':'Dry conditions';
  const impact = rain>=60?'⚠ Upsets likely — wet weather specialists favoured':
                 rain>=30?'Rain chance — safety car probability elevated':
                 `${hi}°C — strategy and tyre mgmt key factor`;

  el.style.display='flex';
  el.style.borderColor = rain>=60?'rgba(225,6,0,.3)':rain>=30?'rgba(255,193,7,.3)':'rgba(100,160,255,.2)';
  el.style.background  = rain>=60?'rgba(225,6,0,.06)':rain>=30?'rgba(255,193,7,.06)':'rgba(100,160,255,.05)';

  const iconEl=$('weatherAlertIcon'), title=$('weatherAlertTitle'), sub=$('weatherAlertSub'), impactEl=$('weatherAlertImpact');
  if(iconEl) iconEl.textContent=icon;
  if(title){ title.textContent=`${severity} · ${rain}% rain`; title.style.color=col; }
  if(sub) sub.textContent=` · ${hi}° / ${lo}°C`;
  if(impactEl) impactEl.textContent=impact;
}

async function checkPostRaceBanner(){
  const banner=$('postRaceBanner');
  if(!banner) return;
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  if(!race){ banner.style.display='none'; return; }

  // Only show if race date is in the past
  const raceDate=new Date(race.date+'T23:59:59Z');
  if(new Date()<raceDate){ banner.style.display='none'; return; }

  // Check if we already have results stored
  try{
    const stored=await getBestPreRaceSnapshot(race,'race');
    if(stored?.actual_results?.length){ banner.style.display='none'; return; }
    // Race is over and no results yet — show banner
    const title=$('postRaceTitle'), sub=$('postRaceSub');
    if(title) title.textContent=`🏁 ${race.name} has ended`;
    if(sub) sub.textContent='Tap to load official results and see your prediction accuracy';
    banner.style.display='flex';
  }catch(e){ banner.style.display='none'; }
}

async function loadPostRaceResults(){
  const banner=$('postRaceBanner');
  const btn=banner?.querySelector('button');
  if(btn){ btn.textContent='Loading…'; btn.disabled=true; }
  await autoFetchSessions();
  if(btn){ btn.textContent='Load Results'; btn.disabled=false; }
  checkPostRaceBanner();
}

/* ═══════════════════════════════════════════════
   RACE SCHEDULE — from OpenF1 sessions
   ═══════════════════════════════════════════════ */
function renderRaceSchedule(sessions, race){
  const card = $('scheduleCard');
  if(!sessions?.length){ if(card) card.style.display='none'; return; }

  const ORDER = ['Practice 1','Practice 2','Practice 3','Sprint Qualifying','Sprint','Qualifying','Race'];
  const LABELS = {
    'Practice 1':'FP1','Practice 2':'FP2','Practice 3':'FP3',
    'Sprint Qualifying':'Sprint Quali','Sprint':'Sprint Race',
    'Qualifying':'Qualifying','Race':'Race Day'
  };
  const now = new Date();
  let foundNext = false;

  const rows = ORDER.map(name=>{
    const sess = sessions.find(s=>s.session_name===name);
    if(!sess) return '';
    const start = sess.date_start ? new Date(sess.date_start) : null;
    const done  = sessionDone(sess);
    const live  = sessionLive(sess);
    const isNext = !done && !live && !foundNext && start && start > now;
    if(isNext) foundNext = true;

    const rowCls = live?'sch-live':done?'sch-done':isNext?'sch-next':'';
    const badge  = live
      ? '<span class="sch-badge live">● Live</span>'
      : done
        ? '<span class="sch-badge done">✓ Done</span>'
        : isNext
          ? `<span class="sch-badge next">Next</span><span class="sch-cd" data-cd-ts="${start.getTime()}">${formatCountdownDiff(start.getTime() - Date.now())}</span>`
          : '<span class="sch-badge pending">Upcoming</span>';

    let dtStr = '—';
    if(start){
      dtStr = start.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})
              + ' · ' + start.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    }

    return `<div class="sch-row ${rowCls}">
      <div class="sch-sess" style="color:${live?'var(--red)':isNext?'#64a0ff':'var(--text)'}">${LABELS[name]||name}</div>
      <div class="sch-dt">${dtStr}</div>
      ${badge}
    </div>`;
  }).join('');

  htm('scheduleRows', rows);
  if(card) card.style.display='';

  // Kick off the live tick that updates any `.sch-cd[data-cd-ts]` element every 30s
  startScheduleCountdownTick();
}

/* Auto-updating countdown badges. Runs every 30s; rerendered when schedule changes. */
let _scheduleCountdownInterval = null;
function startScheduleCountdownTick(){
  if(_scheduleCountdownInterval) return; // already running
  const tick = () => {
    const nowMs = Date.now();
    document.querySelectorAll('.sch-cd[data-cd-ts]').forEach(el => {
      const ts = parseInt(el.getAttribute('data-cd-ts') || '0', 10);
      const diff = ts - nowMs;
      el.textContent = formatCountdownDiff(diff);
      if(diff <= 0) el.style.color = '#E10600';
    });
  };
  tick();
  _scheduleCountdownInterval = setInterval(tick, 30000);
}

/* ═══════════════════════════════════════════════
   PIT STOPS — OpenF1 /pit + /stints
   ═══════════════════════════════════════════════ */
const COMPOUND_COL = {SOFT:'#E10600',MEDIUM:'#FFD700',HARD:'#e8e8e8',INTERMEDIATE:'#3fc07a',WET:'#64a0ff',UNKNOWN:'#888'};
const COMPOUND_LBL = {SOFT:'S',MEDIUM:'M',HARD:'H',INTERMEDIATE:'I',WET:'W',UNKNOWN:'?'};

/* LIVE pit view from the bridge's Supabase data.
   Shows all drivers: pit count + estimated next pit lap.
   Returns true if it rendered (live data present), false to fall back to OpenF1. */
async function renderLivePitStops(){
  const el = $('pitsContent');
  if(!el) return false;
  const races = displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING);
  const race = races[selectedIdx] || races[0];
  if(!race) return false;
  let rows;
  try{
    const sb = await sbGet(`sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&order=fetched_at.desc&limit=10`);
    rows = (sb||[]).find(s => s.session_name === 'Race') || (sb||[])[0];
  }catch(e){ return false; }
  // Only treat as "live pit data" if the bridge populated pit fields.
  const grid = rows?.grid_data;
  if(!grid?.length || !grid.some(g => g.pitCount !== undefined && g.lap !== undefined)) return false;

  const ageSec = Math.round((Date.now() - new Date(rows.fetched_at).getTime())/1000);
  const totalLaps = grid.find(g=>g.totalLaps)?.totalLaps || 0;
  const curLap = Math.max(...grid.map(g=>g.lap||0), 0);
  const isLive = ageSec < 600; // fresh within 10 min = treat as live

  // Estimate next pit: typical stint length ~ (totalLaps / (stops+1)).
  // Next pit ≈ lastPitLap + typicalStint, clamped. If no pits yet, use ~40% race distance.
  const sorted = grid.slice().filter(g=>g.abbr && g.pos>0).sort((a,b)=>a.pos-b.pos);
  const estStint = totalLaps ? Math.round(totalLaps / 2.4) : 22; // ~2-stop baseline

  const ribbon = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
    <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:1px;font-size:13px;color:${isLive?'#ff4136':'var(--muted)'}">
      ${isLive?'🔴 LIVE':'⏸ LAST KNOWN'} · Lap ${curLap}${totalLaps?'/'+totalLaps:''}</span>
    <span style="font-size:11px;color:var(--dim)">bridge data ${ageSec}s ago</span>
  </div>`;

  const rowsHtml = sorted.map(g=>{
    const drv = drivers.find(x=>x.abbr===g.abbr);
    const col = drv ? teamCol(drv.team) : '#888';
    const stops = g.pitCount || 0;
    const lastPit = g.lastPitLap || 0;
    let nextEst;
    if(g.retired){ nextEst = '—'; }
    else if(g.inPit){ nextEst = '<span style="color:var(--gold)">IN PIT</span>'; }
    else {
      const base = lastPit > 0 ? lastPit + estStint : Math.round((totalLaps||60)*0.38);
      const next = Math.max(base, curLap+1);
      nextEst = (totalLaps && next >= totalLaps) ? '<span style="color:#3fc07a">no more stops</span>' : ('~L'+next);
    }
    const dots = stops>0 ? '🔧'.repeat(Math.min(stops,4)) : '<span style="color:var(--dim)">—</span>';
    return `<tr style="${g.retired?'opacity:.45':''}">
      <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--dim)">P${g.pos}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border)"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${col}">${g.abbr}</span>${g.retired?' <span style="font-size:9px;color:var(--red)">DNF</span>':''}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:center">${dots} <span style="color:var(--dim);font-size:11px">${stops}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:center;color:var(--dim);font-size:12px">${lastPit?('L'+lastPit):'—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700">${nextEst}</td>
    </tr>`;
  }).join('');

  el.innerHTML = ribbon + `<div class="pit-table-wrap">
    <div class="pit-table-header">Live Pit Tracker — all drivers</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr>
        ${['Pos','Driver','Pits','Last','Next (est)'].map((h,i)=>`<th style="padding:7px 12px;text-align:${i>=2?(i===4?'right':'center'):(i===0?'center':'left')};font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">${h}</th>`).join('')}
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="font-size:10px;color:var(--dim);padding:8px 12px">Next-pit is an estimate from stint length (~${estStint} laps) and last stop — not an official figure.</div>
  </div>`;
  return true;
}

async function fetchAndRenderPitStops(sessKey, meetingKey){
  const el = $('pitsContent');
  if(!el) return;
  // Try LIVE bridge data first (works DURING a race; OpenF1 /pit is locked live).
  try{ if(await renderLivePitStops()) return; }catch(e){ /* fall through */ }
  if(!sessKey){
    el.innerHTML=`<div class="pit-empty"><div style="font-size:36px;margin-bottom:10px">🏁</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;margin-bottom:6px">No Race Data Yet</div><div style="color:var(--dim)">Live pit tracking appears here when the bridge is running during a race. Full post-race detail loads after the session ends.</div></div>`;
    return;
  }
  el.innerHTML=`<div class="pit-empty">⏳ Loading pit stop data…</div>`;
  try{
    const [pits, stints, driversList] = await Promise.all([
      of1Fetch(`${OPENF1}/pit?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/stints?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/drivers?session_key=${sessKey}&meeting_key=${meetingKey}`),
    ]);

    if(!pits?.length && !stints?.length){
      el.innerHTML=`<div class="pit-empty"><div style="font-size:36px;margin-bottom:10px">⏳</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;margin-bottom:6px">Not Available Yet</div><div style="color:var(--dim)">Pit stop data appears shortly after the race ends. Check back after the race weekend.</div></div>`;
      return;
    }

    // Build number maps
    const numToAbbr={}, numToId={};
    (driversList||[]).forEach(d=>{
      const abbr=d.name_acronym?.toUpperCase();
      numToAbbr[d.driver_number]=abbr;
      const drv=drivers.find(x=>x.abbr===abbr);
      if(drv) numToId[d.driver_number]=drv.driverId;
    });

    // Group stints by driver
    const stintsByDriver={};
    (stints||[]).forEach(s=>{
      if(!stintsByDriver[s.driver_number]) stintsByDriver[s.driver_number]=[];
      stintsByDriver[s.driver_number].push(s);
    });

    // Group pits by driver
    const pitsByDriver={};
    (pits||[]).forEach(p=>{
      if(!pitsByDriver[p.driver_number]) pitsByDriver[p.driver_number]=[];
      pitsByDriver[p.driver_number].push(p);
    });

    // Total laps estimate
    const allLapEnds = (stints||[]).map(s=>s.lap_end||0);
    const totalLaps = Math.max(...allLapEnds, 1);

    // Get final positions to sort drivers
    const posData = await of1Fetch(`${OPENF1}/position?session_key=${sessKey}`);
    const finalPos={};
    (posData||[]).forEach(p=>{
      if(!finalPos[p.driver_number]||p.date>finalPos[p.driver_number].date) finalPos[p.driver_number]=p;
    });
    const sortedDriverNums = Object.keys(stintsByDriver)
      .map(n=>+n)
      .sort((a,b)=>(finalPos[a]?.position||99)-(finalPos[b]?.position||99))
      .slice(0,10);

    // Fastest pit stop
    const allPits = (pits||[]).filter(p=>p.pit_duration>1.5 && p.pit_duration<60);
    allPits.sort((a,b)=>a.pit_duration-b.pit_duration);
    const fastest = allPits[0];
    const fastestAbbr = fastest ? (numToAbbr[fastest.driver_number]||'#'+fastest.driver_number) : null;

    // Stats
    const totalStops = allPits.length;
    const avgDur = allPits.length ? (allPits.reduce((s,p)=>s+p.pit_duration,0)/allPits.length).toFixed(1) : '—';
    const oneStop = Object.values(pitsByDriver).filter(p=>p.length===1).length;
    const twoStop = Object.values(pitsByDriver).filter(p=>p.length===2).length;

    // Build HTML
    let html = '';

    // Fastest stop card
    html += `<div class="pit-fastest-card">
      <div class="pit-fastest-title">⚡ Race Stats</div>
      <div class="pit-fastest-grid">
        ${fastestAbbr ? `<div class="pit-fast-card">
          <div class="pit-fast-val" style="color:#3fc07a">${fastest.pit_duration.toFixed(1)}s</div>
          <div class="pit-fast-lbl">Fastest Pit · ${fastestAbbr}</div>
        </div>` : ''}
        <div class="pit-fast-card">
          <div class="pit-fast-val">${avgDur}s</div>
          <div class="pit-fast-lbl">Avg Pit Stop</div>
        </div>
        <div class="pit-fast-card">
          <div class="pit-fast-val">${totalStops}</div>
          <div class="pit-fast-lbl">Total Stops</div>
        </div>
        <div class="pit-fast-card">
          <div class="pit-fast-val" style="color:var(--gold)">${oneStop}</div>
          <div class="pit-fast-lbl">1-Stop Drivers</div>
        </div>
        <div class="pit-fast-card">
          <div class="pit-fast-val" style="color:var(--ai)">${twoStop}</div>
          <div class="pit-fast-lbl">2-Stop Drivers</div>
        </div>
      </div>
    </div>`;

    // Strategy strips
    html += `<div class="pit-strategy-title">Race Strategy — Tyre Compounds Per Stint</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:var(--muted)">
      ${Object.entries(COMPOUND_COL).filter(([k])=>k!=='UNKNOWN').map(([k,c])=>
        `<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${c};display:inline-block"></span>${k[0]+k.slice(1).toLowerCase()}</span>`
      ).join('')}
    </div>
    <div class="pit-strategy-wrap">`;

    sortedDriverNums.forEach(num=>{
      const abbr = numToAbbr[num]||'#'+num;
      const drvId = numToId[num];
      const col = drvId ? (teamCol(drivers.find(x=>x.driverId===drvId)?.team)) : '#888';
      const dStints = (stintsByDriver[num]||[]).sort((a,b)=>a.stint_number-b.stint_number);
      const dPits = (pitsByDriver[num]||[]).filter(p=>p.pit_duration>1.5);
      const stops = dPits.length;

      // Build strip segments
      let stripHtml = '';
      dStints.forEach(s=>{
        const laps = Math.max((s.lap_end||totalLaps)-(s.lap_start||1)+1, 1);
        const pct = Math.max((laps/totalLaps)*100, 2);
        const compound = (s.compound||'UNKNOWN').toUpperCase().replace('ULTRASOFT','SOFT').replace('SUPERSOFT','SOFT');
        const cc = COMPOUND_COL[compound]||COMPOUND_COL.UNKNOWN;
        const lbl = COMPOUND_LBL[compound]||'?';
        stripHtml += `<div class="pit-stint" style="width:${pct}%;background:${cc}" title="${compound} · ${laps} laps">${laps>5?lbl:''}</div>`;
      });

      // Pit lap markers
      const pitInfo = dPits.map(p=>`L${p.lap_number} (${p.pit_duration?.toFixed(1)}s)`).join(', ');

      html += `<div class="pit-driver-row" title="${pitInfo}">
        <div class="pit-abbr" style="color:${col}">${abbr}</div>
        <div>
          <div class="pit-strip">${stripHtml||'<div style="flex:1;background:var(--sec)"></div>'}</div>
          ${dPits.length?`<div style="font-size:9px;color:var(--dim);margin-top:3px">${pitInfo}</div>`:''}
        </div>
        <div class="pit-stops-lbl">${stops} stop${stops!==1?'s':''}</div>
      </div>`;
    });
    html += '</div>';

    // Detailed pit stop table
    if(allPits.length){
      html += `<div class="pit-table-wrap">
        <div class="pit-table-header">All Pit Stops — Lap & Duration</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="padding:7px 14px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Driver</th>
            <th style="padding:7px 14px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Stop</th>
            <th style="padding:7px 14px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Lap</th>
            <th style="padding:7px 14px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Duration</th>
          </tr></thead>
          <tbody>${allPits.slice(0,30).sort((a,b)=>a.lap_number-b.lap_number).map(p=>{
            const abbr=numToAbbr[p.driver_number]||'#'+p.driver_number;
            const drvId=numToId[p.driver_number];
            const col=drvId?(teamCol(drivers.find(x=>x.driverId===drvId)?.team)):'#888';
            const isFastest=fastest&&p.driver_number===fastest.driver_number&&p.lap_number===fastest.lap_number;
            return `<tr style="${isFastest?'background:rgba(63,192,122,.05)':''}">
              <td style="padding:9px 14px;border-bottom:1px solid var(--border)"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${col}">${abbr}</span></td>
              <td style="padding:9px 14px;border-bottom:1px solid var(--border);text-align:center;color:var(--dim)">Stop ${p.stop_number||'—'}</td>
              <td style="padding:9px 14px;border-bottom:1px solid var(--border);text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700">L${p.lap_number}</td>
              <td style="padding:9px 14px;border-bottom:1px solid var(--border);text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${isFastest?'#3fc07a':'var(--text)'}">${p.pit_duration?.toFixed(3)}s ${isFastest?'⚡':''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    }

    el.innerHTML = html;
  }catch(e){
    console.warn('Pit stops:', e.message);
    el.innerHTML=`<div class="pit-empty">⚠ Could not load pit stop data: ${e.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════
   DARK / LIGHT MODE
   ═══════════════════════════════════════════════ */
const THEME_ICON = { moon:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>', sun:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' };
function toggleTheme(){
  const isLight = document.body.classList.toggle('light');
  $('themeBtn').innerHTML = isLight ? THEME_ICON.sun : THEME_ICON.moon;
  try{ localStorage.setItem('f1_theme', isLight?'light':'dark'); }catch(e){}
}
function initTheme(){
  try{
    const saved = localStorage.getItem('f1_theme');
    if(saved==='light'){ document.body.classList.add('light'); $('themeBtn').innerHTML = THEME_ICON.sun; }
  }catch(e){}
}

/* ═══════════════════════════════════════════════
   DRIVER HEADSHOTS — from OpenF1
   ═══════════════════════════════════════════════ */
async function fetchDriverHeadshots(meetingKey){
  if(!meetingKey) return;
  try{
    const data = await of1Fetch(`${OPENF1}/drivers?meeting_key=${meetingKey}`);
    (data||[]).forEach(d=>{
      if(d.name_acronym && d.headshot_url)
        driverHeadshots[d.name_acronym.toUpperCase()] = d.headshot_url;
    });
  }catch(e){ console.warn('Headshots:', e.message); }
}

/* ═══════════════════════════════════════════════
   DRIVER PROFILE CARD
   ═══════════════════════════════════════════════ */
function openDriverCard(driverId){
  const drv = drivers.find(x=>x.driverId===driverId);
  if(!drv) return;
  const col = teamCol(drv.team);
  const photo = driverHeadshots[drv.abbr];
  const photoHtml = photo
    ? `<img class="drv-photo" src="${photo}" style="border-color:${col}" onerror="this.outerHTML='<div class=drv-photo-av style=background:${col}22;border-color:${col};color:${col}>${drv.abbr}</div>'">`
    : `<div class="drv-photo-av" style="background:${col}22;border-color:${col};color:${col}">${drv.abbr}</div>`;

  // Season stats
  const fins = [];
  completedRaces.filter(r=>!String(r.round).endsWith('S')).forEach(r=>{
    const p=r.results.indexOf(driverId); if(p>=0) fins.push(p+1);
  });
  const wins    = fins.filter(p=>p===1).length;
  const podiums = fins.filter(p=>p<=3).length;
  const avg     = fins.length ? (fins.reduce((a,b)=>a+b,0)/fins.length).toFixed(1) : '—';

  // Form chips (last 5 races)
  const last5 = fins.slice(-5);
  const formHtml = last5.map(p=>{
    const bg = p===1?'rgba(255,215,0,.2)':p<=3?'rgba(192,192,192,.15)':p<=10?'rgba(255,255,255,.07)':'rgba(225,6,0,.1)';
    const fc = p===1?'var(--gold)':p<=3?'var(--silver)':p<=10?'var(--muted)':'rgba(225,6,0,.7)';
    return `<div class="drv-fc" style="background:${bg};color:${fc}">P${p}</div>`;
  }).join('') || '<span style="color:var(--dim);font-size:12px">No races yet</span>';

  // AI prediction accuracy for this driver
  const predRows = cachedPredictions.filter(p=>p.accuracy!==null && !p.prediction?._fallback).map(p=>{
    const t = p.prediction?.top10||[];
    const predicted = t.find(x=>x.driverId===driverId);
    return predicted ? { race: p.race_name?.replace(' Grand Prix',''), pos: predicted.pos } : null;
  }).filter(Boolean).slice(-4);

  const predHtml = predRows.length
    ? predRows.map(r=>`<span style="font-size:11px;background:var(--sec);border-radius:4px;padding:3px 8px;color:var(--muted)">${r.race}: <strong style="color:var(--text)">P${r.pos}</strong></span>`).join(' ')
    : '<span style="color:var(--dim);font-size:12px">No predictions yet</span>';

  // Champ pos
  const pos = [...drivers].sort((a,b)=>b.pts-a.pts).findIndex(x=>x.driverId===driverId)+1;

  $('driverModalCard').innerHTML = `
    <div class="drv-modal-head" style="--team-col:${col}">
      <div class="drv-modal-head::before" style="background:${col}"></div>
      <style>#driverModalCard .drv-modal-head::before{background:${col}}</style>
      <button class="drv-modal-close" onclick="closeDriverCard()">✕</button>
      <div class="drv-modal-top">
        ${photoHtml}
        <div>
          <div class="drv-modal-nm" style="color:${col}">${drv.abbr}</div>
          <div style="font-size:16px;font-weight:600;color:var(--text);margin-top:2px">${drv.name}</div>
          <div class="drv-modal-tm"><span class="tdot" style="background:${col}"></span>${teamName(drv.team)}</div>
        </div>
      </div>
    </div>
    <div class="drv-modal-body">
      <div class="drv-stats">
        <div class="drv-stat">
          <div class="drv-stat-v" style="color:var(--red)">P${pos}</div>
          <div class="drv-stat-l">Standing</div>
        </div>
        <div class="drv-stat">
          <div class="drv-stat-v" style="color:var(--gold)">${wins}</div>
          <div class="drv-stat-l">Wins</div>
        </div>
        <div class="drv-stat">
          <div class="drv-stat-v">${podiums}</div>
          <div class="drv-stat-l">Podiums</div>
        </div>
        <div class="drv-stat">
          <div class="drv-stat-v" style="color:var(--ai)">${drv.pts}</div>
          <div class="drv-stat-l">Points</div>
        </div>
        <div class="drv-stat">
          <div class="drv-stat-v">${avg}</div>
          <div class="drv-stat-l">Avg Finish</div>
        </div>
        <div class="drv-stat">
          <div class="drv-stat-v">${fins.length}</div>
          <div class="drv-stat-l">Races</div>
        </div>
      </div>
      <div class="drv-slbl">Recent Form (last ${last5.length} races)</div>
      <div class="drv-form">${formHtml}</div>
      <div class="drv-slbl">AI Predicted Positions</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${predHtml}</div>
    </div>
  `;
  $('driverModal').style.display='block';
  document.body.style.overflow='hidden';
}
function closeDriverCard(){
  $('driverModal').style.display='none';
  document.body.style.overflow='';
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDriverCard(); });

/* ═══════════════════════════════════════════════
   LIVE RACE POLLING
   ═══════════════════════════════════════════════ */
async function pollLiveRace(){
  if(!liveRaceSessKey) return;
  try{
    const positions = await of1Fetch(`${OPENF1}/position?session_key=${liveRaceSessKey}`);
    if(!positions?.length) return;
    // Get latest position per driver
    const latest={};
    positions.forEach(p=>{
      if(!latest[p.driver_number]||p.date>latest[p.driver_number].date) latest[p.driver_number]=p;
    });
    const sorted = Object.values(latest).sort((a,b)=>a.position-b.position).slice(0,10);
    const el=$('livePositions');
    if(!el) return;
    // Need driver number → abbr — use existing meeting key
    const driversList = await of1Fetch(`${OPENF1}/drivers?session_key=${liveRaceSessKey}&meeting_key=${currentMeetingKey}`);
    const numToAbbr={}, numToTeam={};
    (driversList||[]).forEach(d=>{
      const abbr=d.name_acronym?.toUpperCase();
      numToAbbr[d.driver_number]=abbr;
      const drv=drivers.find(x=>x.abbr===abbr);
      numToTeam[d.driver_number]=drv?.team||'unknown';
    });
    el.innerHTML=sorted.map(p=>{
      const abbr=numToAbbr[p.driver_number]||'#'+p.driver_number;
      const col=teamCol(numToTeam[p.driver_number]);
      return `<div class="live-chip" style="border-color:${col}33">
        <span class="live-chip-pos">${p.position}</span>
        <span style="color:${col}">${abbr}</span>
      </div>`;
    }).join('');
    const ts=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const lu=$('liveLastUpdate'); if(lu) lu.textContent=`Updated ${ts}`;
    of1Cache[`${OPENF1}/position?session_key=${liveRaceSessKey}`]=null; // clear cache so next poll is fresh
  }catch(e){ console.warn('Live poll:', e.message); }
}
function startLivePolling(sessKey, label){
  // IDEMPOTENT: autoFetchSessions calls this every 30s. If we're already polling
  // this same session, do nothing — don't reset the interval or re-toast (spam).
  const alreadyPolling = (liveRaceSessKey === sessKey && liveRaceInterval);
  liveRaceSessKey=sessKey;
  const banner=$('liveRaceBanner');
  if(banner){
    banner.style.display='';
    const lbl=banner.querySelector('#liveBannerLabel');
    if(lbl) lbl.textContent = (label||'Race') + ' is LIVE';
  }
  if(alreadyPolling) return; // already running — skip re-init + toast
  pollLiveRace();
  if(liveRaceInterval) clearInterval(liveRaceInterval);
  liveRaceInterval=setInterval(pollLiveRace, 90000);
  showToast(`🔴 ${label||'Race'} is LIVE — positions updating every 90s. Tap Race tab to view.`,'info',5000);
}
function stopLivePolling(){
  if(liveRaceInterval){ clearInterval(liveRaceInterval); liveRaceInterval=null; }
  $('liveRaceBanner').style.display='none';
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Confidence Trend
   ═══════════════════════════════════════════════ */
function renderConfidenceTrend(){
  const el=$('confidenceTrend'); if(!el) return;
  // Dedupe: keep only the newest snapshot per race so multiple stage snapshots
  // of the same race aren't plotted multiple times. cachedPredictions is ordered
  // created_at.desc, so the first one seen for each race is the most recent.
  const seen=new Set();
  const scored=cachedPredictions.filter(p=>{
      if(p.accuracy===null||p.pred_type!=='race'||p.prediction?._fallback) return false;
      const k=`${p.circuit_id}|${p.round}`;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a,b)=>a.round-b.round);
  if(!scored.length){
    el.innerHTML='<div style="color:var(--dim);font-size:13px;padding:8px 0">No scored predictions yet — accuracy data appears after race weekends.</div>';
    return;
  }
  const W=640,H=180,PL=36,PR=20,PT=16,PB=28;
  const iW=W-PL-PR, iH=H-PT-PB;
  const n=scored.length;
  const xS=i=>PL+i/(Math.max(n-1,1))*iW;
  const yS=v=>PT+(1-v/100)*iH;
  // Grid lines
  let grid='';
  [0,25,50,75,100].forEach(v=>{
    const y=yS(v);
    grid+=`<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    grid+=`<text x="${PL-4}" y="${y+4}" font-size="9" fill="#555" text-anchor="end">${v}%</text>`;
  });
  // Avg line
  const avg=Math.round(scored.reduce((s,p)=>s+p.accuracy,0)/scored.length);
  const avgY=yS(avg);
  grid+=`<line x1="${PL}" y1="${avgY}" x2="${W-PR}" y2="${avgY}" stroke="rgba(255,215,0,.3)" stroke-width="1" stroke-dasharray="4,4"/>`;
  grid+=`<text x="${W-PR+2}" y="${avgY+4}" font-size="9" fill="rgba(255,215,0,.7)">avg</text>`;
  // Path
  let path='', dots='', labels='';
  scored.forEach((p,i)=>{
    const x=xS(i), y=yS(p.accuracy);
    const col=p.accuracy>=70?'#3fc07a':p.accuracy>=40?'var(--gold)':'var(--red)';
    path+=i===0?`M${x},${y}`:`L${x},${y}`;
    dots+=`<circle cx="${x}" cy="${y}" r="4" fill="${col}" stroke="var(--card)" stroke-width="2"/>`;
    dots+=`<text x="${x}" y="${y-8}" font-size="9" fill="${col}" text-anchor="middle" font-weight="700">${p.accuracy}%</text>`;
    const short=(p.race_name||'').replace(' Grand Prix','').slice(0,3).toUpperCase();
    labels+=`<text x="${x}" y="${H-PB+14}" font-size="9" fill="#555" text-anchor="middle">${short}</text>`;
  });
  el.innerHTML=`<svg width="100%" viewBox="0 0 ${W} ${H}" style="min-width:320px;display:block">
    ${grid}
    <path d="${path}" stroke="var(--ai)" stroke-width="2" fill="none" opacity="0.7"/>
    ${dots}${labels}
  </svg>
  <div style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">
    Overall average: <strong style="color:${avg>=70?'#3fc07a':avg>=40?'var(--gold)':'var(--red)'}">${avg}%</strong> across ${scored.length} scored prediction${scored.length>1?'s':''}
  </div>`;
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Head to Head
   ═══════════════════════════════════════════════ */
function buildH2HSelectors(){
  const opts=drivers.map(d=>`<option value="${d.driverId}">${d.name} (${d.abbr})</option>`).join('');
  const d1=$('h2hD1'), d2=$('h2hD2');
  if(!d1||!d2) return;
  const v1=d1.value, v2=d2.value;
  d1.innerHTML='<option value="">Driver 1</option>'+opts;
  d2.innerHTML='<option value="">Driver 2</option>'+opts;
  if(v1) d1.value=v1;
  if(v2) d2.value=v2;
}
function renderH2H(){
  const el=$('h2hResult'); if(!el) return;
  const id1=$('h2hD1')?.value, id2=$('h2hD2')?.value;
  if(!id1||!id2||id1===id2){
    el.innerHTML='<div style="color:var(--dim);font-size:13px;padding:6px 0">Select two different drivers.</div>';
    return;
  }
  const d1=drivers.find(x=>x.driverId===id1), d2=drivers.find(x=>x.driverId===id2);
  if(!d1||!d2) return;
  const races=completedRaces.filter(r=>!String(r.round).endsWith('S'));
  // Stats
  let wins1=0,wins2=0,pod1=0,pod2=0,pts1=d1.pts,pts2=d2.pts,ahead1=0,ahead2=0;
  const rows=[];
  races.forEach(r=>{
    const p1=r.results.indexOf(id1), p2=r.results.indexOf(id2);
    const pos1=p1>=0?p1+1:null, pos2=p2>=0?p2+1:null;
    if(pos1===1) wins1++; if(pos2===1) wins2++;
    if(pos1&&pos1<=3) pod1++; if(pos2&&pos2<=3) pod2++;
    if(pos1&&pos2){ if(pos1<pos2) ahead1++; else if(pos2<pos1) ahead2++; }
    const c1=teamCol(d1.team), c2=teamCol(d2.team);
    const w1=pos1&&pos2&&pos1<pos2, w2=pos1&&pos2&&pos2<pos1;
    rows.push(`<tr>
      <td style="padding:7px 10px;font-size:12px;color:${w1?c1:'var(--muted)'};font-weight:${w1?'700':'400'}">${pos1?'P'+pos1:'—'}</td>
      <td style="padding:7px 10px;font-size:11px;color:var(--dim);text-align:center">${r.raceName.replace(' Grand Prix','')}</td>
      <td style="padding:7px 10px;font-size:12px;color:${w2?c2:'var(--muted)'};font-weight:${w2?'700':'400'};text-align:right">${pos2?'P'+pos2:'—'}</td>
    </tr>`);
  });
  const col1=teamCol(d1.team), col2=teamCol(d2.team);
  const w=(v1,v2)=>v1>v2?'h2h-win':'';
  el.innerHTML=`
    <div class="h2h-grid">
      <div class="h2h-l" style="background:${col1}11"><div class="h2h-val" style="color:${col1}">${d1.abbr}</div><div class="h2h-lbl">${TN[d1.team]||d1.team}</div></div>
      <div class="h2h-m">VS</div>
      <div class="h2h-r" style="background:${col2}11"><div class="h2h-val" style="color:${col2}">${d2.abbr}</div><div class="h2h-lbl">${TN[d2.team]||d2.team}</div></div>

      <div class="h2h-l"><div class="h2h-val ${w(pts1,pts2)}">${pts1}</div><div class="h2h-lbl">Points</div></div>
      <div class="h2h-m" style="font-size:9px">PTS</div>
      <div class="h2h-r"><div class="h2h-val ${w(pts2,pts1)}">${pts2}</div><div class="h2h-lbl">Points</div></div>

      <div class="h2h-l"><div class="h2h-val ${w(wins1,wins2)}">${wins1}</div><div class="h2h-lbl">Wins</div></div>
      <div class="h2h-m" style="font-size:9px">WINS</div>
      <div class="h2h-r"><div class="h2h-val ${w(wins2,wins1)}">${wins2}</div><div class="h2h-lbl">Wins</div></div>

      <div class="h2h-l"><div class="h2h-val ${w(pod1,pod2)}">${pod1}</div><div class="h2h-lbl">Podiums</div></div>
      <div class="h2h-m" style="font-size:9px">POD</div>
      <div class="h2h-r"><div class="h2h-val ${w(pod2,pod1)}">${pod2}</div><div class="h2h-lbl">Podiums</div></div>

      <div class="h2h-l"><div class="h2h-val ${w(ahead1,ahead2)}">${ahead1}</div><div class="h2h-lbl">Head to Head</div></div>
      <div class="h2h-m" style="font-size:9px">H2H</div>
      <div class="h2h-r"><div class="h2h-val ${w(ahead2,ahead1)}">${ahead2}</div><div class="h2h-lbl">Head to Head</div></div>
    </div>
    ${rows.length?`<table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>${rows.join('')}</tbody></table>`:'<div style="color:var(--dim);font-size:12px;padding:8px">No completed races yet.</div>'}
  `;
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Team Form Tracker
   ═══════════════════════════════════════════════ */
function renderTeamForm(){
  const el=$('teamFormWrap'); if(!el) return;
  const races=completedRaces.filter(r=>!String(r.round).endsWith('S'));
  if(!races.length){ el.innerHTML='<div style="color:var(--dim);font-size:13px">No completed races yet.</div>'; return; }
  // Points per team per race
  const teams=[...new Set(drivers.map(d=>d.team))];
  const teamPts={};
  teams.forEach(t=>{ teamPts[t]=races.map(()=>0); });
  races.forEach((r,ri)=>{
    r.results.slice(0,10).forEach((dId,pos)=>{
      const drv=drivers.find(x=>x.driverId===dId);
      if(drv&&teamPts[drv.team]) teamPts[drv.team][ri]+=(F1P[pos]||0);
    });
  });
  // Trend = last 2 races avg vs first 2 races avg
  const cards=Object.entries(teamPts).map(([team,pts])=>{
    const col=teamCol(team);
    const total=pts.reduce((a,b)=>a+b,0);
    if(!total) return null;
    const first2=pts.slice(0,2).reduce((a,b)=>a+b,0)/Math.max(pts.slice(0,2).length,1);
    const last2=pts.slice(-2).reduce((a,b)=>a+b,0)/Math.max(pts.slice(-2).length,1);
    const trend=last2-first2;
    const trendTxt=trend>5?'↑ Improving':trend<-5?'↓ Dropping':'→ Stable';
    const trendCol=trend>5?'#3fc07a':trend<-5?'var(--red)':'var(--muted)';
    const maxPts=Math.max(...pts,1);
    const bars=pts.map(p=>`<div class="tf-bar" style="height:${Math.round(p/maxPts*28)+4}px;background:${col}${p>0?'cc':'33'}"></div>`).join('');
    return `<div class="tf-card">
      <div class="tf-name">
        <span class="tdot" style="background:${col}"></span>${teamName(team)}
        <span class="tf-trend" style="color:${trendCol}">${trendTxt}</span>
      </div>
      <div class="tf-bars">${bars}</div>
      <div class="tf-pts" style="color:var(--dim)">${pts.map((p,i)=>`R${races[i].round}:<strong style="color:var(--text)">${p}</strong>`).join(' ')}</div>
    </div>`;
  }).filter(Boolean);
  el.innerHTML=`<div class="tf-grid">${cards.join('')}</div>`;
}

/* ═══════════════════════════════════════════════
   QUALIFYING TIMES
   ═══════════════════════════════════════════════ */
function fmtLapTime(sec){
  if(!sec||sec<=0) return '—';
  const m=Math.floor(sec/60);
  const s=(sec%60).toFixed(3).padStart(6,'0');
  return `${m}:${s}`;
}

async function fetchQualifyingTimes(sessionKey, meetingKey){
  if(!sessionKey) return;
  qualiSessKey = sessionKey;
  try{
    const [laps, driversList] = await Promise.all([
      of1Fetch(`${OPENF1}/laps?session_key=${sessionKey}`),
      of1Fetch(`${OPENF1}/drivers?session_key=${sessionKey}&meeting_key=${meetingKey}`),
    ]);
    if(!laps?.length){ renderQualifyingTimes(); return; }

    // Build driver number → abbr / driverId maps
    const numToAbbr={}, numToId={};
    (driversList||[]).forEach(d=>{
      const abbr=d.name_acronym?.toUpperCase();
      numToAbbr[d.driver_number]=abbr;
      const drv=drivers.find(x=>x.abbr===abbr);
      if(drv) numToId[d.driver_number]=drv.driverId;
    });

    // Best lap per driver (exclude pit-out laps and invalid laps)
    const best={};
    laps.forEach(lap=>{
      if(!lap.lap_duration||lap.lap_duration<=0||lap.is_pit_out_lap) return;
      const n=lap.driver_number;
      if(!best[n]||lap.lap_duration<best[n]) best[n]=lap.lap_duration;
    });

    // Build list sorted by qualifying grid position
    qualifyingTimes = qualifyingGrid.map((g,i)=>{
      const drvNum=Object.entries(numToId).find(([,id])=>id===g.driverId)?.[0];
      const abbr=numToAbbr[drvNum]||drivers.find(x=>x.driverId===g.driverId)?.abbr||g.driverId;
      const drv=drivers.find(x=>x.driverId===g.driverId);
      const lapTime=drvNum?best[+drvNum]:null;
      return { pos:i+1, driverId:g.driverId, abbr, name:drv?.name||g.driverId, team:drv?.team||'unknown', lapTime, lapTimeFmt:fmtLapTime(lapTime) };
    });

    renderQualifyingTimes();
  }catch(e){ console.warn('Qualifying times:',e.message); }
}

function renderQualifyingTimes(){
  const el=$('qualiTimesWrap');
  if(!el) return;

  // Only show in post-qualifying mode
  if(mode!=='post'){ el.style.display='none'; return; }

  // Qualifying in progress
  if(qualiSessionLive){
    el.style.display='';
    el.innerHTML=`<div class="quali-times-card">
      <div class="quali-times-header">
        <div class="quali-times-title">🏁 Qualifying Times</div>
        <span class="quali-times-badge live">● Live</span>
      </div>
      <div class="quali-in-progress">
        <div style="font-size:22px;margin-bottom:8px">⏱</div>
        Qualifying session is currently in progress.<br>
        <span style="color:var(--dim);font-size:12px">Times will appear automatically when the session ends.</span>
      </div>
    </div>`;
    return;
  }

  // No data
  if(!qualifyingTimes.length){ el.style.display='none'; return; }

  // Find pole time for gap calculation
  const poleTime = qualifyingTimes[0]?.lapTime || null;

  const rows = qualifyingTimes.slice(0,10).map((d,i)=>{
    const posCls = i===0?'p1':i===1?'p2':i===2?'p3':'';
    const col = teamCol(d.team);
    const gap = (i===0||!poleTime||!d.lapTime) ? '' : '+'+((d.lapTime-poleTime).toFixed(3))+'s';
    return `<div class="quali-row ${posCls}">
      <div class="quali-pos ${posCls}">${d.pos}</div>
      <div class="quali-driver">
        <div class="drv-avatar-sm" style="background:${col}22;border-color:${col};color:${col}">${d.abbr.slice(0,3)}</div>
        <div>
          <div class="quali-name">${d.name}</div>
          <div class="quali-team"><span class="tdot" style="background:${col};margin-right:4px"></span>${teamName(d.team)}</div>
        </div>
      </div>
      <div class="quali-gap">${gap}</div>
      <div class="quali-time" style="color:${i===0?'var(--gold)':i<3?'var(--silver)':'var(--text)'}">${d.lapTimeFmt}</div>
    </div>`;
  }).join('');

  el.style.display='';
  el.innerHTML=`<div class="quali-times-card">
    <div class="quali-times-header">
      <div class="quali-times-title">🏁 Qualifying Classification</div>
      <span class="quali-times-badge done">✓ Final</span>
    </div>
    ${rows}
  </div>`;
}

/* ═══════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════ */
const _recentToasts = new Map(); // msg → expireTs — dedupe identical toasts within window
/* Show a toast at most ONCE per unique key (until the key changes).
   Used for "session data loaded" which fires on every 30s auto-fetch cycle —
   we only want to announce it when something actually changed. */
let _toastOnceKey = null;
function showToastOnce(key, msg, type='info', duration=3500){
  if(_toastOnceKey === key) return;   // already shown for this state
  _toastOnceKey = key;
  showToast(msg, type, duration);
}
function showToast(msg, type='info', duration=3500){
  const wrap = $('toastWrap');
  if(!wrap) return;
  // DEDUPE: skip identical toast that fired within the last 8 seconds
  const now = Date.now();
  const exp = _recentToasts.get(msg);
  if(exp && exp > now) return;
  _recentToasts.set(msg, now + 8000);
  // CAP: keep max 3 toasts visible — remove the oldest if we'd exceed that
  while(wrap.children.length >= 3) wrap.firstChild?.remove();
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  wrap.appendChild(div);
  setTimeout(()=>{
    div.style.transition='opacity .3s,transform .3s';
    div.style.opacity='0';
    div.style.transform='translateX(20px)';
    setTimeout(()=>div.remove(), 300);
  }, duration);
}

/* ═══════════════════════════════════════════════
   COUNTDOWN TIMER
   ═══════════════════════════════════════════════ */
function startCountdown(targetDate, sessionName){
  if(countdownTimer) clearInterval(countdownTimer);
  const wrap=$('countdownWrap'), strip=$('countdownStrip'), lbl=$('cdLabel');
  if(!wrap||!strip) return;
  wrap.style.display='block';
  function tick(){
    const diff = targetDate - new Date();
    if(diff <= 0){
      if(lbl) lbl.textContent='NOW';
      strip.innerHTML=`<div class="cd-live"><div class="dot live" style="width:8px;height:8px"></div>${sessionName} — LIVE</div>`;
      clearInterval(countdownTimer);
      return;
    }
    const d=Math.floor(diff/(864e5)), h=Math.floor((diff%864e5)/36e5),
          m=Math.floor((diff%36e5)/6e4),  s=Math.floor((diff%6e4)/1e3);
    if(lbl) lbl.textContent=`Next: ${sessionName}`;
    let html='';
    if(d>0) html+=`<div class="cd-block"><div class="cd-val">${d}</div><div class="cd-lbl">Days</div></div><div class="cd-sep">:</div>`;
    html+=`<div class="cd-block"><div class="cd-val">${String(h).padStart(2,'0')}</div><div class="cd-lbl">Hrs</div></div>`;
    html+=`<div class="cd-sep">:</div>`;
    html+=`<div class="cd-block"><div class="cd-val">${String(m).padStart(2,'0')}</div><div class="cd-lbl">Min</div></div>`;
    html+=`<div class="cd-sep">:</div>`;
    html+=`<div class="cd-block"><div class="cd-val">${String(s).padStart(2,'0')}</div><div class="cd-lbl">Sec</div></div>`;
    strip.innerHTML=html;
  }
  tick();
  countdownTimer=setInterval(tick,1000);
}

function setCountdownFromSessions(sessions, raceDate){
  const now=new Date();
  // Find first future session
  const next=sessions
    .filter(s=>s.date_start && new Date(s.date_start)>now)
    .sort((a,b)=>new Date(a.date_start)-new Date(b.date_start))[0];
  if(next){
    const labels={'Practice 1':'FP1','Practice 2':'FP2','Practice 3':'FP3',
      'Sprint Qualifying':'Sprint Quali','Sprint':'Sprint Race',
      'Qualifying':'Qualifying','Race':'Race'};
    startCountdown(new Date(next.date_start), labels[next.session_name]||next.session_name);
  } else if(raceDate){
    // Fall back to race date
    const rd=new Date(raceDate);
    rd.setHours(14,0,0,0); // assume 14:00 UTC
    if(rd>now) startCountdown(rd,'Race');
  }
}

/* ═══════════════════════════════════════════════
   WEATHER — Live track conditions from OpenF1
   Populates the live strip inside the forecast card
   ═══════════════════════════════════════════════ */
async function fetchWeatherLive(sessionKey){
  if(!sessionKey) return;
  try{
    const data=await of1Fetch(`${OPENF1}/weather?session_key=${sessionKey}`);
    if(!data?.length) return;
    const wx=data[data.length-1];
    const liveEl=$('wxLive');
    if(!liveEl) return;
    const rain=(+wx.rainfall||0)>0;
    liveEl.style.display='flex';
    liveEl.innerHTML=`
      <span style="font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);margin-right:4px">LIVE TRACK ·</span>
      <div class="wx-live-item">🌡 <span class="wx-live-val">${(+wx.air_temperature).toFixed(1)}°C</span> <span style="color:var(--dim)">air</span></div>
      <div class="wx-live-item">🛣 <span class="wx-live-val">${(+wx.track_temperature).toFixed(1)}°C</span> <span style="color:var(--dim)">track</span></div>
      <div class="wx-live-item">💧 <span class="wx-live-val">${wx.humidity}%</span></div>
      <div class="wx-live-item">💨 <span class="wx-live-val">${(+wx.wind_speed).toFixed(1)} m/s</span></div>
      ${rain?`<div class="wx-live-item rain">🌧 <span class="wx-live-val">RAIN</span></div>`:`<div class="wx-live-item">☀ <span class="wx-live-val">Dry</span></div>`}
    `;
    // Make sure the card is visible
    const card=$('weatherCard'); if(card) card.style.display='';
  }catch(e){ console.warn('Weather live:',e.message); }
}

/* ═══════════════════════════════════════════════
   DRIVER FORM ARROWS
   ═══════════════════════════════════════════════ */
function formArrow(driverId){
  const fins=[];
  completedRaces.filter(r=>!String(r.round).endsWith('S')).forEach(r=>{
    const p=r.results.indexOf(driverId);
    if(p>=0) fins.push(p+1);
  });
  if(fins.length<2) return '';
  const last=fins[fins.length-1], prev=fins[fins.length-2];
  if(last<prev) return '<span class="trend-up">↑</span>';
  if(last>prev) return '<span class="trend-dn">↓</span>';
  return '<span class="trend-fl">→</span>';
}

/* ═══════════════════════════════════════════════
   ACCURACY OVERVIEW (History tab)
   ═══════════════════════════════════════════════ */
function renderAccuracyOverview(){
  const el=$('accOverview');
  if(!el) return;
  const seenOv=new Set();
  const scored=cachedPredictions.filter(p=>{
    if(p.accuracy===null || p.prediction?._fallback) return false;
    const k=`${p.circuit_id}|${p.round}|${p.pred_type||'race'}`;
    if(seenOv.has(k)) return false;
    seenOv.add(k); return true;
  });
  if(!scored.length){ el.innerHTML=''; return; }
  const avg=Math.round(scored.reduce((s,p)=>s+p.accuracy,0)/scored.length);
  const best=Math.max(...scored.map(p=>p.accuracy));
  const bestRace=scored.find(p=>p.accuracy===best)?.race_name?.replace(' Grand Prix','')||'—';
  const col=avg>=70?'#3fc07a':avg>=40?'var(--gold)':'var(--red)';
  el.innerHTML=`
    <div class="acc-ov-card">
      <div class="acc-ov-val" style="color:${col}">${avg}%</div>
      <div class="acc-ov-lbl">Avg Accuracy</div>
    </div>
    <div class="acc-ov-card">
      <div class="acc-ov-val" style="color:#3fc07a">${best}%</div>
      <div class="acc-ov-lbl">Best · ${bestRace}</div>
    </div>
    <div class="acc-ov-card">
      <div class="acc-ov-val">${scored.length}</div>
      <div class="acc-ov-lbl">Races Scored</div>
    </div>
    <div class="acc-ov-card">
      <div class="acc-ov-val">${cachedPredictions.length}</div>
      <div class="acc-ov-lbl">Total Predictions</div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════
   AI REPORT CARD (History tab) — deep accuracy breakdown
   ═══════════════════════════════════════════════ */
function _abbrOfId(id){ return drivers.find(x=>x.driverId===id)?.abbr; }
function _samePred(predEntry, actualId){
  if(!predEntry || actualId==null) return false;
  return predEntry.driverId===actualId || (predEntry.abbr && _abbrOfId(actualId)===predEntry.abbr);
}
function _predActualIdx(predEntry, actualIds){
  if(!predEntry) return -1;
  return actualIds.findIndex(id => id===predEntry.driverId || (predEntry.abbr && _abbrOfId(id)===predEntry.abbr));
}

function renderAIReportCard(){
  const el=$('aiReportCard'); if(!el) return;
  // One scored prediction per race+session — keep newest snapshot (cache is created_at.desc),
  // so multi-stage snapshots of the same race aren't double-counted.
  const seen=new Set();
  const scored=cachedPredictions.filter(p=>{
    if(p.accuracy===null || !p.actual_results?.length || !p.prediction?.top10?.length || p.prediction?._fallback) return false;
    const k=`${p.circuit_id}|${p.round}|${p.pred_type||'race'}`;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
  if(!scored.length){ el.innerHTML=''; return; }

  // ── Hit-rate metrics ──
  let winTot=0, winHit=0, podSum=0, podTot=0, t5Sum=0, t5Tot=0, exactHit=0, exactTot=0;
  scored.forEach(p=>{
    const pred=p.prediction.top10, act=p.actual_results;
    if(pred[0]){ winTot++; if(_samePred(pred[0], act[0])) winHit++; }
    const actTop3=act.slice(0,3), predTop3=pred.slice(0,3);
    if(predTop3.length){ podSum += predTop3.filter(pe=>actTop3.some(aid=>_samePred(pe,aid))).length/3; podTot++; }
    const actTop5=act.slice(0,5), predTop5=pred.slice(0,5);
    if(predTop5.length){ t5Sum += predTop5.filter(pe=>actTop5.some(aid=>_samePred(pe,aid))).length/Math.min(5,predTop5.length); t5Tot++; }
    const n=Math.min(pred.length, act.length, 10);
    for(let i=0;i<n;i++){ exactTot++; if(_samePred(pred[i], act[i])) exactHit++; }
  });
  const winnerPct=winTot?Math.round(winHit/winTot*100):0;
  const podiumPct=podTot?Math.round(podSum/podTot*100):0;
  const top5Pct=t5Tot?Math.round(t5Sum/t5Tot*100):0;
  const bullPct=exactTot?Math.round(exactHit/exactTot*100):0;
  const colFor=v=>v>=70?'#3fc07a':v>=40?'var(--gold)':'var(--red)';

  const cards=`
    <div class="acc-ov-card"><div class="acc-ov-val" style="color:${colFor(winnerPct)}">${winnerPct}%</div><div class="acc-ov-lbl">Winner Called</div></div>
    <div class="acc-ov-card"><div class="acc-ov-val" style="color:${colFor(podiumPct)}">${podiumPct}%</div><div class="acc-ov-lbl">Podium Hit Rate</div></div>
    <div class="acc-ov-card"><div class="acc-ov-val" style="color:${colFor(top5Pct)}">${top5Pct}%</div><div class="acc-ov-lbl">Top-5 Hit Rate</div></div>
    <div class="acc-ov-card"><div class="acc-ov-val" style="color:${colFor(bullPct)}">${bullPct}%</div><div class="acc-ov-lbl">Bullseye · exact slot</div></div>`;

  // ── By session type ──
  const byType={};
  scored.forEach(p=>{ const t=p.pred_type||'race'; (byType[t]=byType[t]||[]).push(p.accuracy); });
  const typeLabel={race:'🏆 Grand Prix', sprint:'⚡ Sprint'};
  const typeRows=Object.entries(byType).sort((a,b)=>b[1].length-a[1].length).map(([t,arr])=>{
    const avg=Math.round(arr.reduce((a,b)=>a+b,0)/arr.length), c=colFor(avg);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="min-width:110px;font-size:12px;color:var(--muted)">${typeLabel[t]||t}</span>
      <div class="proj-bar-bg"><div class="proj-bar-fill" style="width:${avg}%;background:${c}"></div></div>
      <span style="min-width:64px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${c}">${avg}% <span style="color:var(--dim);font-size:10px">·${arr.length}</span></span>
    </div>`;
  }).join('');

  // ── Best call / worst miss ──
  const sortedAcc=[...scored].sort((a,b)=>b.accuracy-a.accuracy);
  const best=sortedAcc[0], worst=sortedAcc[sortedAcc.length-1];
  const rn=p=>(p.race_name||p.circuit_id||'—').replace(' Grand Prix','');
  const bestWorst=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="acc-ov-card" style="border-color:rgba(63,192,122,.3)">
        <div style="font-size:10px;color:#3fc07a;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">🎯 Best Call</div>
        <div class="acc-ov-val" style="color:#3fc07a">${best.accuracy}%</div>
        <div class="acc-ov-lbl">${rn(best)}${best.pred_type==='sprint'?' · Sprint':''}</div>
      </div>
      <div class="acc-ov-card" style="border-color:rgba(225,6,0,.3)">
        <div style="font-size:10px;color:var(--red);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">💨 Worst Miss</div>
        <div class="acc-ov-val" style="color:var(--red)">${worst.accuracy}%</div>
        <div class="acc-ov-lbl">${rn(worst)}${worst.pred_type==='sprint'?' · Sprint':''}</div>
      </div>
    </div>`;

  // ── Driver read (predicted slot within ±1 of actual) ──
  const drvStat={};
  scored.forEach(p=>{
    p.prediction.top10.forEach((pe,i)=>{
      const id=pe.driverId || drivers.find(x=>x.abbr===pe.abbr)?.driverId;
      if(!id) return;
      const s=drvStat[id]=drvStat[id]||{n:0,hit:0};
      s.n++;
      const ai=_predActualIdx(pe, p.actual_results);
      if(ai>=0 && Math.abs(ai-i)<=1) s.hit++;
    });
  });
  const drvArr=Object.entries(drvStat).filter(([,s])=>s.n>=3).map(([id,s])=>({
    abbr:_abbrOfId(id)||id, team:drivers.find(x=>x.driverId===id)?.team||'unknown',
    rate:Math.round(s.hit/s.n*100)
  })).sort((a,b)=>b.rate-a.rate);

  let driverBlock='';
  if(drvArr.length>=2){
    const bestD=drvArr.slice(0,3), worstD=drvArr.slice(-3).reverse();
    const mk=(d,good)=>{
      const c=teamCol(d.team), rc=good?'#3fc07a':'var(--red)';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span class="tdot" style="background:${c}"></span>
        <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;min-width:42px">${d.abbr}</span>
        <div class="proj-bar-bg"><div class="proj-bar-fill" style="width:${d.rate}%;background:${rc}"></div></div>
        <span style="min-width:46px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${rc}">${d.rate}%</span>
      </div>`;
    };
    driverBlock=`
      <div class="stitle">AI's Driver Read · predicted within ±1 place</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div><div style="font-size:11px;color:#3fc07a;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Reads best</div>${bestD.map(d=>mk(d,true)).join('')}</div>
        <div><div style="font-size:11px;color:var(--red);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Reads worst</div>${worstD.map(d=>mk(d,false)).join('')}</div>
      </div>`;
  }

  el.innerHTML=`
    <div class="stitle">AI Report Card · ${scored.length} scored prediction${scored.length>1?'s':''}</div>
    <div class="acc-overview">${cards}</div>
    <div class="stitle">Accuracy by Session Type</div>
    ${typeRows}
    <div class="stitle">Highlights</div>
    ${bestWorst}
    ${driverBlock}`;
}

/* ═══════════════════════════════════════════════
   LAP CHART — AI vs Reality tab
   ═══════════════════════════════════════════════ */
async function renderLapChart(sessKey, meetingKey){
  const el=$('lapChartWrap');
  if(!el) return;
  if(!sessKey){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="lap-chart-wrap"><div style="color:var(--muted);padding:20px;text-align:center;font-size:13px">⏳ Loading lap chart…</div></div>`;
  try{
    const [positions,driversList]=await Promise.all([
      of1Fetch(`${OPENF1}/position?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/drivers?session_key=${sessKey}&meeting_key=${meetingKey}`),
    ]);
    if(!positions?.length){ el.innerHTML=''; return; }

    // Build maps
    const numToAbbr={}, numToTeam={};
    (driversList||[]).forEach(d=>{
      const abbr=d.name_acronym?.toUpperCase();
      numToAbbr[d.driver_number]=abbr;
      const drv=drivers.find(x=>x.abbr===abbr);
      numToTeam[d.driver_number]=drv?.team||'unknown';
    });

    // Group by driver, sort by time
    const byDriver={};
    positions.forEach(p=>{
      if(!byDriver[p.driver_number]) byDriver[p.driver_number]=[];
      byDriver[p.driver_number].push({t:new Date(p.date),pos:p.position});
    });
    Object.values(byDriver).forEach(arr=>arr.sort((a,b)=>a.t-b.t));

    // Race time bounds
    const allT=positions.map(p=>new Date(p.date));
    const t0=new Date(Math.min(...allT)), t1=new Date(Math.max(...allT));
    const dur=t1-t0;

    // 60 sample points
    const N=60;
    const pts=Array.from({length:N},(_,i)=>new Date(t0.getTime()+dur*i/(N-1)));

    // Final positions to find top 10
    const finalPos={};
    Object.entries(byDriver).forEach(([num,arr])=>{ finalPos[num]=arr[arr.length-1]?.pos||20; });
    const top10=Object.entries(finalPos).sort((a,b)=>a[1]-b[1]).slice(0,10).map(([n])=>+n);

    // Sample positions
    const data={};
    top10.forEach(num=>{
      const arr=byDriver[num]||[];
      data[num]=pts.map(t=>{
        const last=arr.filter(e=>e.t<=t).slice(-1)[0];
        return last?.pos||null;
      });
    });

    // SVG dimensions
    const W=680,H=280,PL=34,PR=76,PT=16,PB=28;
    const iW=W-PL-PR, iH=H-PT-PB;
    const xS=i=>PL+i/(N-1)*iW;
    const yS=p=>PT+(p-1)/19*iH;

    // Grid lines
    let grid='';
    [1,5,10,15,20].forEach(p=>{
      const y=yS(p);
      grid+=`<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
      grid+=`<text x="${PL-4}" y="${y+4}" font-size="9" fill="#555" text-anchor="end">P${p}</text>`;
    });

    // X labels
    let xlab='';
    [0,.25,.5,.75,1].forEach(f=>{
      const i=Math.round(f*(N-1));
      const lap=Math.round(f*58);
      xlab+=`<text x="${xS(i)}" y="${H-PB+14}" font-size="9" fill="#555" text-anchor="middle">Lap ${lap}</text>`;
    });

    // Driver lines + labels
    let lines='',labels='';
    top10.forEach(num=>{
      const abbr=numToAbbr[num]||String(num);
      const col=teamCol(numToTeam[num]);
      const d=data[num];
      let path='';
      d.forEach((pos,i)=>{
        if(pos===null) return;
        path+=path===''?`M${xS(i)},${yS(pos)}`:`L${xS(i)},${yS(pos)}`;
      });
      if(!path) return;
      const fp=d.filter(Boolean).slice(-1)[0]||finalPos[num];
      lines+=`<path d="${path}" stroke="${col}" stroke-width="1.8" fill="none" opacity="0.85"/>`;
      labels+=`<text x="${W-PR+5}" y="${yS(fp)+4}" font-size="10" fill="${col}" font-weight="700">${abbr}</text>`;
    });

    el.innerHTML=`
      <div class="stitle" style="margin-top:0;margin-bottom:12px">Race Position Tracker — Lap by Lap</div>
      <div class="lap-chart-wrap">
        <svg width="100%" viewBox="0 0 ${W} ${H}" style="min-width:480px;display:block">
          ${grid}${lines}${labels}${xlab}
        </svg>
      </div>`;
  }catch(e){
    el.innerHTML=`<div style="color:var(--dim);font-size:12px;padding:12px">Lap chart: ${e.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════
   SHARE PREDICTION
   ═══════════════════════════════════════════════ */
function _rrect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

async function sharePrediction(){
  trackEvent('share');
  if(!lastPrediction) return;
  const races=(displayRaces.length?displayRaces:(upcomingRaces.length?upcomingRaces:BASE_UPCOMING));
  const race=races[selectedIdx]||races[0];
  const top5=lastPrediction.top10.slice(0,5);

  const S=2, W=480, ROW=72, PAD=20;
  const H=PAD+52+PAD+top5.length*ROW+PAD+36;
  const canvas=document.createElement('canvas');
  canvas.width=W*S; canvas.height=H*S;
  const ctx=canvas.getContext('2d');
  ctx.scale(S,S);

  // Background
  ctx.fillStyle='#12121A'; ctx.fillRect(0,0,W,H);

  // Red top stripe
  ctx.fillStyle='#E10600'; ctx.fillRect(0,0,W,3);

  // Header — F1 logo area
  ctx.fillStyle='#E10600';
  ctx.font='bold 18px "Barlow Condensed",sans-serif';
  ctx.fillText('F1',PAD,PAD+22);
  ctx.fillStyle='#ffffff';
  ctx.font='bold 13px "Barlow Condensed",sans-serif';
  ctx.fillText('AI RACE PREDICTOR',PAD+28,PAD+22);

  // Race name
  ctx.fillStyle='#888';
  ctx.font='11px "Barlow",sans-serif';
  const raceName=(race?.name||'Race Prediction').toUpperCase();
  ctx.fillText(raceName,PAD,PAD+42);

  // Divider
  ctx.strokeStyle='#2a2a3a'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PAD,PAD+52); ctx.lineTo(W-PAD,PAD+52); ctx.stroke();

  // Driver rows
  top5.forEach((d,i)=>{
    const ry=PAD+52+PAD+i*ROW;
    const col=teamCol(d.team)||'#888';

    // Row bg
    _rrect(ctx,PAD,ry,W-PAD*2,ROW-6,8);
    ctx.fillStyle='#1C1C2A'; ctx.fill();

    // Team colour left bar
    ctx.fillStyle=col;
    ctx.fillRect(PAD,ry,4,ROW-6);

    // Position number
    const posCol=i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'#555';
    ctx.fillStyle=posCol;
    ctx.font=`bold 20px "Barlow Condensed",sans-serif`;
    ctx.textAlign='center';
    ctx.fillText(d.pos,PAD+20,ry+(ROW-6)/2+7);

    // Avatar circle
    const ax=PAD+48, ay=ry+(ROW-6)/2;
    ctx.beginPath(); ctx.arc(ax,ay,20,0,Math.PI*2);
    ctx.fillStyle=col+'28'; ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle=col;
    ctx.font=`bold 10px "Barlow Condensed",sans-serif`;
    ctx.fillText(d.abbr.slice(0,3),ax,ay+4);
    ctx.textAlign='left';

    // Name
    ctx.fillStyle='#f0f0f0';
    ctx.font=`600 13px "Barlow",sans-serif`;
    ctx.fillText(d.name,PAD+74,ry+20);

    // Team
    ctx.fillStyle='#666';
    ctx.font=`11px "Barlow",sans-serif`;
    ctx.fillText((d.team||'').replace(/_/g,' '),PAD+74,ry+37);

    // Win prob
    ctx.fillStyle=col;
    ctx.font=`bold 15px "Barlow Condensed",sans-serif`;
    ctx.textAlign='right';
    ctx.fillText(d.winProb+'%',W-PAD,ry+(ROW-6)/2+6);
    ctx.textAlign='left';
  });

  // Footer
  const fy=H-PAD+2;
  ctx.fillStyle='#2a2a3a'; ctx.fillRect(0,H-PAD-8,W,1);
  ctx.fillStyle='#555';
  ctx.font='10px "Barlow",sans-serif';
  ctx.fillText('f1-predictor-theta.vercel.app',PAD,fy+4);
  ctx.textAlign='right';
  ctx.fillStyle='#444';
  ctx.fillText('AI prediction · not official',W-PAD,fy+4);
  ctx.textAlign='left';

  // Share or download
  canvas.toBlob(async blob=>{
    const file=new File([blob],'f1-prediction.png',{type:'image/png'});
    const shareText=`🏎 F1 AI Prediction — ${race?.name||'Race'}\n🥇 ${top5[0]?.name} (${top5[0]?.winProb}%)\n🥈 ${top5[1]?.name}\n🥉 ${top5[2]?.name}\n\nhttps://f1-predictor-theta.vercel.app`;

    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
      try{ await navigator.share({title:'F1 AI Prediction',text:shareText,files:[file]}); return; }
      catch(e){ if(e.name==='AbortError') return; }
    }
    // Fallback: download image
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='f1-prediction.png'; a.click();
    URL.revokeObjectURL(url);
    showToast('Prediction card saved!','success');
  },'image/png');
}

/* ═══════════════════════════════════════════════
   NEWSLETTER SUBSCRIBE
   ═══════════════════════════════════════════════ */
async function subscribeNewsletter(){
  const input=$('nlEmail'), btn=$('nlBtn'), status=$('nlStatus');
  const email=input?.value?.trim();
  if(!email||!email.includes('@')){ showToast('Enter a valid email','warn'); return; }
  btn.disabled=true; btn.textContent='Subscribing…';
  try{
    const r = await fetch('/api/subscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email}), signal:AbortSignal.timeout(10000)});
    if(!r.ok){
      const msg = (await r.json().catch(()=>({})))?.error || 'Subscribe failed — try again';
      if(status) status.innerHTML='<span style="color:var(--red)">'+esc(msg)+'</span>';
      throw new Error(msg);
    }
    input.value='';
    trackEvent('email_join');
    if(status) status.innerHTML='<span style="color:#3fc07a">✓ Subscribed! You\'ll get a report after every race weekend.</span>';
    showToast('✓ Subscribed successfully!','success',5000);
    btn.textContent='✓ Subscribed';
    setTimeout(()=>{ btn.disabled=false; btn.textContent='Subscribe Free'; },4000);
  }catch(e){
    showToast('Subscribe failed — try again','error');
    btn.disabled=false; btn.textContent='Subscribe Free';
  }
}

/* ═══════════════════════════════════════════════
   DNF / RELIABILITY DATA
   ═══════════════════════════════════════════════ */
const BASE_DNFS = {
  'albert_park': [],
  'shanghai':    [],
  'suzuka':      [],
  'miami':       [],
};

/* ═══════════════════════════════════════════════
   PENALTY DATA — 2026 season
   ═══════════════════════════════════════════════ */
const BASE_PENALTIES = [
  {driverId:'antonelli',      type:'time', detail:'5s — track limits (Miami Sprint)',     race:'Miami Sprint', penPts:0},
  {driverId:'max_verstappen', type:'time', detail:'5s — pit exit violation (Miami GP)',   race:'Miami GP',     penPts:0},
  {driverId:'leclerc',        type:'time', detail:'20s — track limits (Miami GP)',         race:'Miami GP',     penPts:0},
];

/* ═══════════════════════════════════════════════
   LIVE RACE TAB — interval reference
   ═══════════════════════════════════════════════ */
let liveRaceRefreshInterval = null;
let pitRefreshInterval = null;

/* ═══════════════════════════════════════════════
   FETCH LIVE RACE
   ═══════════════════════════════════════════════ */
async function fetchLiveRace(){
  const el = $('liveRaceContent');
  if(!el) return;
  el.innerHTML = `<div class="live-empty"><div class="live-empty-icon">⏳</div><div class="live-empty-title">Loading…</div><div class="live-empty-sub">Fetching live session data from OpenF1.</div></div>`;

  try {
    // Find race session key — use existing currentRaceSessKey or look it up
    let sessKey = currentRaceSessKey || liveRaceSessKey;
    let meetKey = currentMeetingKey;

    // If we have a meeting key but no race session key, try to find the race session
    if(!sessKey && meetKey){
      const sessions = await of1Fetch(`${OPENF1}/sessions?meeting_key=${meetKey}&year=${SEASON}`);
      const raceSess = (sessions||[]).find(s => s.session_name==='Race' || s.session_type==='Race');
      if(raceSess) sessKey = raceSess.session_key;
    }

    // If still no session, try fetching latest meeting
    if(!sessKey){
      const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
      const race  = races[selectedIdx] || races[0];
      if(race){
        const meeting = await getOf1Meeting(race);
        if(meeting){
          meetKey = meeting.meeting_key;
          const sessions = await of1Fetch(`${OPENF1}/sessions?meeting_key=${meetKey}&year=${SEASON}`);
          const raceSess = (sessions||[]).find(s => s.session_name==='Race' || s.session_type==='Race');
          if(raceSess){
            sessKey = raceSess.session_key;
            // Check if session is live or recently done
            const isLive  = sessionLive(raceSess);
            const isDone  = sessionDone(raceSess);
            if(!isLive && !isDone){
              renderLiveEmpty('not-live');
              return;
            }
          } else {
            renderLiveEmpty('not-live');
            return;
          }
        } else {
          renderLiveEmpty('not-live');
          return;
        }
      } else {
        renderLiveEmpty('not-live');
        return;
      }
    }

    // Fetch all live data in parallel
    const [positions, rcMessages, stints, driversList] = await Promise.all([
      of1Fetch(`${OPENF1}/position?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/race_control?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/stints?session_key=${sessKey}`),
      of1Fetch(`${OPENF1}/drivers?session_key=${sessKey}&meeting_key=${meetKey||currentMeetingKey}`),
    ]);

    if(!positions?.length){
      renderLiveEmpty('not-live');
      return;
    }

    // Build driver number maps
    const numToAbbr={}, numToId={}, numToTeam={};
    (driversList||[]).forEach(d=>{
      const abbr = d.name_acronym?.toUpperCase();
      numToAbbr[d.driver_number] = abbr;
      const drv = drivers.find(x=>x.abbr===abbr);
      if(drv){ numToId[d.driver_number]=drv.driverId; numToTeam[d.driver_number]=drv.team; }
    });

    // Latest position per driver
    const latestPos={};
    (positions||[]).forEach(p=>{
      if(!latestPos[p.driver_number]||p.date>latestPos[p.driver_number].date) latestPos[p.driver_number]=p;
    });
    const sortedPos = Object.values(latestPos).sort((a,b)=>a.position-b.position);

    // Latest tyre per driver from stints
    const latestStint={};
    (stints||[]).forEach(s=>{
      if(!latestStint[s.driver_number]||s.stint_number>latestStint[s.driver_number].stint_number)
        latestStint[s.driver_number]=s;
    });

    // Pit count per driver (number of stints - 1)
    const pitCount={};
    (stints||[]).forEach(s=>{
      pitCount[s.driver_number] = Math.max((s.stint_number||1)-1, 0);
    });

    // Max lap number from positions (proxy for current lap)
    const allLaps = (positions||[]).map(p=>p.lap_number||0);
    const currentLap = Math.max(...allLaps, 0);

    // Total lap estimate from stints
    const allLapEnds = (stints||[]).map(s=>s.lap_end||0);
    const totalLaps = Math.max(...allLapEnds, currentLap, 0);

    // Race control messages — last 3
    const TYRE_COMPOUND_COL = {SOFT:'#E10600',MEDIUM:'#FFD700',HARD:'#e8e8e8',INTERMEDIATE:'#3fc07a',WET:'#64a0ff',UNKNOWN:'#888'};
    const rcLast3 = (rcMessages||[])
      .filter(m=>m.message)
      .slice(-3)
      .reverse();

    const rcHtml = rcLast3.length
      ? rcLast3.map(m=>{
          const txt = m.message||'';
          const cls = /safety car/i.test(txt) ? 'sc'
                    : /virtual/i.test(txt)     ? 'vsc'
                    : /red flag/i.test(txt)    ? 'red'
                    : 'info';
          const icon = cls==='sc'?'🚗 ':cls==='vsc'?'🚙 ':cls==='red'?'🚩 ':'📢 ';
          return `<div class="rc-msg ${cls}">${icon}${txt}</div>`;
        }).join('')
      : '';

    // Build leaderboard rows
    const maxGap = 999;
    const leaderDate = sortedPos[0]?.date ? new Date(sortedPos[0].date) : null;

    const rows = sortedPos.slice(0,20).map((p,i)=>{
      const pos = p.position;
      const posCls = pos===1?'p1':pos===2?'p2':pos===3?'p3':'';
      const posColor = pos===1?'var(--gold)':pos===2?'var(--silver)':pos===3?'var(--bronze)':'var(--dim)';
      const abbr = numToAbbr[p.driver_number]||'#'+p.driver_number;
      const team = numToTeam[p.driver_number]||'unknown';
      const col  = teamCol(team);
      const stint = latestStint[p.driver_number];
      const compound = (stint?.compound||'UNKNOWN').toUpperCase().replace('ULTRASOFT','SOFT').replace('SUPERSOFT','SOFT');
      const tyreCol = TYRE_COMPOUND_COL[compound]||'#888';
      const tyreLbl = {SOFT:'S',MEDIUM:'M',HARD:'H',INTERMEDIATE:'I',WET:'W',UNKNOWN:'?'}[compound]||'?';
      const stops = pitCount[p.driver_number]??'—';
      // Gap: approximate from date difference vs leader
      let gapTxt = i===0 ? 'LEADER' : '—';
      if(i>0 && leaderDate && p.date){
        const dMs = new Date(p.date)-leaderDate;
        if(dMs>0 && dMs<300000) gapTxt = '+'+( dMs/1000).toFixed(1)+'s';
      }

      return `<div class="live-row ${posCls}">
        <div class="live-pos" style="color:${posColor}">${pos}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="drv-avatar-sm" style="background:${col}22;border-color:${col};color:${col}">${abbr.slice(0,3)}</div>
          <div>
            <div style="font-weight:700;font-size:13px">${abbr}</div>
            <div style="font-size:10px;color:var(--muted)">${teamName(team)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="tyre-dot" style="background:${tyreCol}" title="${compound}"></span>
          <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;color:${tyreCol};font-weight:700">${tyreLbl}</span>
        </div>
        <div class="live-pits">${stops}🔧</div>
        <div class="live-gap">${gapTxt}</div>
      </div>`;
    }).join('');

    // Tyre legend
    const tyreLegend = Object.entries(TYRE_COMPOUND_COL).filter(([k])=>k!=='UNKNOWN').map(([k,c])=>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:${c}">
        <span class="tyre-dot" style="background:${c}"></span>${k[0]+k.slice(1).toLowerCase()}
       </span>`
    ).join('');

    const ts = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="dot live"></div>
          <span class="lap-counter">${currentLap>0?`LAP ${currentLap}${totalLaps>0?' / '+totalLaps:''}`:''}</span>
          <span style="font-family:'Barlow Condensed',sans-serif;font-size:12px;color:var(--muted);letter-spacing:1px;text-transform:uppercase">${currentLap>0?'Race In Progress':'Session Data'}</span>
        </div>
        <div style="font-size:11px;color:var(--dim)">Updated ${ts}</div>
      </div>
      ${rcHtml ? `<div class="rc-strip">${rcHtml}</div>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${tyreLegend}</div>
      <div class="stitle" style="margin-top:0;margin-bottom:8px">Race Positions</div>
      <div class="live-leaderboard">${rows}</div>
    `;

    // Clear position cache so next refresh fetches fresh data
    delete of1Cache[`${OPENF1}/position?session_key=${sessKey}`];
    delete of1Cache[`${OPENF1}/race_control?session_key=${sessKey}`];
    delete of1Cache[`${OPENF1}/stints?session_key=${sessKey}`];

  } catch(e) {
    console.warn('Live race fetch:', e.message);
    el.innerHTML = `<div class="live-empty">
      <div class="live-empty-icon">⚠️</div>
      <div class="live-empty-title">Could Not Load Data</div>
      <div class="live-empty-sub">${e.message}</div>
    </div>`;
  }
}

function renderLiveLocked(sessionLabel){
  const el = $('liveRaceContent');
  if(!el) return;
  const label = sessionLabel || 'Session';
  el.innerHTML = `
    <div class="live-empty">
      <div class="live-empty-icon">🔴</div>
      <div class="live-empty-title" style="color:var(--red)">${label} IN PROGRESS</div>
      <div class="live-empty-sub" style="max-width:380px">
        OpenF1 restricts public data access while a session is live.<br>
        Results and positions load automatically once it ends.
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:10px;align-items:center">
          <a href="https://www.formula1.com/en/live" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:8px;background:rgba(225,6,0,.18);border:1px solid var(--red);color:#fff;padding:11px 24px;border-radius:8px;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;letter-spacing:1px">
            🏎 Watch Live on F1.com →
          </a>
          <a href="https://www.formula1.com/en/timing" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);color:var(--muted);padding:9px 20px;border-radius:8px;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:13px;letter-spacing:1px">
            📊 F1 Live Timing
          </a>
        </div>
        <div style="margin-top:16px;font-size:11px;color:var(--dim)">Tap Auto-fetch after the session ends to load results.</div>
      </div>
    </div>`;
}

function renderLiveEmpty(reason){
  const el = $('liveRaceContent');
  if(!el) return;
  if(reason==='finished'){
    el.innerHTML = `<div class="live-empty">
      <div class="live-empty-icon">🏁</div>
      <div class="live-empty-title">Race Finished</div>
      <div class="live-empty-sub">The race session has ended. Check the AI vs Reality tab for the full comparison, and Pit Stops tab for strategy data.</div>
    </div>`;
  } else {
    el.innerHTML = `<div class="live-empty">
      <div class="live-empty-icon">🔴</div>
      <div class="live-empty-title">No Live Race Found</div>
      <div class="live-empty-sub">No active race session was detected. This tab shows real-time data when a race is in progress. Auto-fetch sessions first to connect to a race weekend.</div>
    </div>`;
  }
}

/* ═══════════════════════════════════════════════
   PRACTICE RESULTS — fetch and render
   ═══════════════════════════════════════════════ */
async function fetchPracticeResults(meetingKey){
  if(!meetingKey) return;
  const card = $('practiceCard');
  const wrap = $('practiceSessions');
  if(!card||!wrap) return;

  try {
    const sessions = await of1Fetch(`${OPENF1}/sessions?meeting_key=${meetingKey}&year=${SEASON}`);
    const practiceSessions = (sessions||[]).filter(s=>
      (s.session_name==='Practice 1'||s.session_name==='Practice 2'||s.session_name==='Practice 3') && sessionDone(s)
    );
    if(!practiceSessions.length){ card.style.display='none'; return; }

    const LABELS = {'Practice 1':'FP1','Practice 2':'FP2','Practice 3':'FP3'};
    const sessHtml = await Promise.all(practiceSessions.map(async sess=>{
      const [positions, driversList] = await Promise.all([
        of1Fetch(`${OPENF1}/position?session_key=${sess.session_key}`),
        of1Fetch(`${OPENF1}/drivers?session_key=${sess.session_key}&meeting_key=${meetingKey}`),
      ]);
      const numToAbbr={}, numToTeam={};
      (driversList||[]).forEach(d=>{
        const abbr=d.name_acronym?.toUpperCase();
        numToAbbr[d.driver_number]=abbr;
        const drv=drivers.find(x=>x.abbr===abbr);
        numToTeam[d.driver_number]=drv?.team||'unknown';
      });
      const latest={};
      (positions||[]).forEach(p=>{
        if(!latest[p.driver_number]||p.date>latest[p.driver_number].date) latest[p.driver_number]=p;
      });
      const top10 = Object.values(latest).sort((a,b)=>a.position-b.position).slice(0,10);
      if(!top10.length) return '';
      const chips = top10.map(p=>{
        const abbr=numToAbbr[p.driver_number]||'#'+p.driver_number;
        const team=numToTeam[p.driver_number]||'unknown';
        const col=teamCol(team);
        return `<span class="prac-chip" style="background:${col}22;color:${col};border-color:${col}44">${abbr}</span>`;
      }).join('');
      return `<div class="prac-sess-box">
        <div class="prac-sess-title">${LABELS[sess.session_name]||sess.session_name}</div>
        <div class="prac-chips">${chips}</div>
      </div>`;
    }));

    const validHtml = sessHtml.filter(Boolean).join('');
    if(!validHtml){ card.style.display='none'; return; }
    wrap.innerHTML = validHtml;
    card.style.display='';
  } catch(e){
    console.warn('Practice results:', e.message);
    if(card) card.style.display='none';
  }
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Reliability & DNF Tracker
   ═══════════════════════════════════════════════ */
function renderReliability(){
  const el = $('reliabilityWrap'); if(!el) return;
  const races = completedRaces.filter(r=>!String(r.round).endsWith('S'));
  if(!races.length){
    el.innerHTML='<div style="color:var(--dim);font-size:13px;padding:6px 0">No completed races yet.</div>';
    return;
  }

  // Collect per-driver: starts and finishes (appearance in results = finish, absence = assumed DNF)
  const starts={}, finishes={}, dnfs={};
  drivers.forEach(d=>{ starts[d.driverId]=0; finishes[d.driverId]=0; dnfs[d.driverId]=0; });

  // Add known DNFs from BASE_DNFS
  Object.values(BASE_DNFS).flat().forEach(id=>{ if(dnfs[id]!==undefined) dnfs[id]++; });

  races.forEach(r=>{
    drivers.forEach(d=>{
      const pos = r.results.indexOf(d.driverId);
      if(pos>=0){
        starts[d.driverId]++;
        finishes[d.driverId]++;
      }
      // We only track top 10 so we can't confidently assign DNFs from result absence
    });
  });

  // Override with known DNFs
  Object.entries(BASE_DNFS).forEach(([circuit, dnfList])=>{
    dnfList.forEach(id=>{
      if(starts[id]!==undefined) starts[id]++;
    });
  });

  // Group by team
  const teamDrivers={};
  drivers.forEach(d=>{
    if(!teamDrivers[d.team]) teamDrivers[d.team]=[];
    teamDrivers[d.team].push(d);
  });

  // Driver-level reliability table
  const allDriverRows = [...drivers].sort((a,b)=>b.pts-a.pts).map(d=>{
    const s=starts[d.driverId]||0, f=finishes[d.driverId]||0, dn=dnfs[d.driverId]||0;
    const rel = s>0 ? Math.round((f/s)*100) : 100;
    const col = teamCol(d.team);
    const relCol = rel>=90?'#3fc07a':rel>=70?'var(--gold)':'var(--red)';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:7px">
          <span class="tdot" style="background:${col}"></span>
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700">${d.abbr}</span>
        </div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--muted);font-size:12px">${teamName(d.team)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700">${s}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700">${f}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${dn>0?'var(--red)':'var(--dim)'}">${dn}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="rel-bar-bg" style="width:80px">
            <div class="rel-bar-fill" style="width:${rel}%;background:${relCol}"></div>
          </div>
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${relCol};min-width:36px">${rel}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:400px">
        <thead>
          <tr>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Driver</th>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Team</th>
            <th style="padding:6px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Starts</th>
            <th style="padding:6px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Finishes</th>
            <th style="padding:6px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">DNFs</th>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Reliability</th>
          </tr>
        </thead>
        <tbody>${allDriverRows}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--dim);margin-top:10px;line-height:1.6">Note: Reliability tracks top-10 finishes. Known DNFs from BASE_DNFS are included. Drivers not appearing in top-10 results may have finished outside top 10 rather than DNF.</div>
  `;
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Championship Projection
   ═══════════════════════════════════════════════ */
function renderChampionshipProjection(){
  const el = $('projectionWrap'); if(!el) return;
  const races = completedRaces.filter(r=>!String(r.round).endsWith('S'));
  const totalRaces = 22;
  const racesCompleted = races.length;
  const racesRemaining = Math.max(totalRaces - racesCompleted, 0);

  if(!racesCompleted){
    el.innerHTML='<div style="color:var(--dim);font-size:13px;padding:6px 0">No completed races yet — projection will appear after the first race.</div>';
    return;
  }

  // Calc avg pts per race per driver
  const ptsPerRace={};
  drivers.forEach(d=>{ ptsPerRace[d.driverId]=[]; });
  races.forEach(r=>{
    r.results.slice(0,10).forEach((id,i)=>{
      if(ptsPerRace[id]) ptsPerRace[id].push(F1P[i]||0);
      else ptsPerRace[id]=[F1P[i]||0];
    });
    // Drivers not in top 10 got 0 points that race
    drivers.forEach(d=>{
      if(!r.results.includes(d.driverId) && ptsPerRace[d.driverId])
        ptsPerRace[d.driverId].push(0);
    });
  });

  const projections = drivers.map(d=>{
    const hist = ptsPerRace[d.driverId]||[];
    const avg = hist.length ? hist.reduce((a,b)=>a+b,0)/hist.length : 0;
    const projected = Math.round(d.pts + avg * racesRemaining);
    return { ...d, avg, projected };
  }).sort((a,b)=>b.projected-a.projected).slice(0,8);

  const maxProjected = Math.max(...projections.map(x=>x.projected), 1);

  const rows = projections.map((d,i)=>{
    const col = teamCol(d.team);
    const pct = Math.round(d.projected/maxProjected*100);
    const posCls = i===0?'var(--gold)':i===1?'var(--silver)':i===2?'var(--bronze)':'var(--text)';
    return `<div class="proj-row">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:${posCls}">${i+1}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="tdot" style="background:${col}"></span>
        <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px">${d.abbr}</span>
      </div>
      <div class="proj-bar-bg">
        <div class="proj-bar-fill" style="width:${pct}%;background:${col}"></div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:${col}">${d.projected}</div>
        <div style="font-size:10px;color:var(--dim)">now: ${d.pts}</div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">
      ${racesCompleted} races completed · ${racesRemaining} remaining of ${totalRaces} · projection assumes current avg pts/race continues
    </div>
    ${rows}
    <div style="font-size:11px;color:var(--dim);margin-top:8px">Projection assumes each driver's season average pts-per-race continues for all remaining rounds.</div>
  `;
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Penalty Tracker
   ═══════════════════════════════════════════════ */
function renderPenalties(){
  const el = $('penaltiesWrap'); if(!el) return;
  if(!BASE_PENALTIES.length){
    el.innerHTML='<div style="color:var(--dim);font-size:13px;padding:6px 0">No penalties recorded for the '+SEASON+' season yet.</div>';
    return;
  }

  // Tally licence penalty points per driver
  const licencePoints={};
  BASE_PENALTIES.forEach(p=>{
    if(!licencePoints[p.driverId]) licencePoints[p.driverId]=0;
    licencePoints[p.driverId]+=(p.penPts||0);
  });

  const rows = BASE_PENALTIES.map(p=>{
    const drv = drivers.find(d=>d.driverId===p.driverId);
    const abbr = drv?.abbr||p.driverId;
    const team = drv?.team||'unknown';
    const col = teamCol(team);
    const badgeCls = p.type==='time'?'time':p.type==='grid'?'grid':p.type==='dsq'?'dsq':'time';
    const typeLabel = p.type==='time'?'Time Penalty':p.type==='grid'?'Grid Penalty':p.type==='dsq'?'DSQ':'Penalty';
    return `<tr>
      <td style="padding:9px 10px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="drv-avatar-sm" style="background:${col}22;border-color:${col};color:${col}">${abbr.slice(0,3)}</div>
          <div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px">${abbr}</div>
            <div style="font-size:10px;color:var(--muted)">${teamName(team)}</div>
          </div>
        </div>
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid var(--border)">
        <span class="pen-badge ${badgeCls}">${typeLabel}</span>
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">${p.detail}</td>
      <td style="padding:9px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--dim)">${p.race}</td>
      <td style="padding:9px 10px;border-bottom:1px solid var(--border);text-align:center">
        ${p.penPts>0?`<span class="pen-pts" style="color:${p.penPts>=8?'var(--red)':p.penPts>=4?'var(--gold)':'var(--muted)'}">${p.penPts}</span>`:`<span style="color:var(--dim);font-size:12px">—</span>`}
      </td>
    </tr>`;
  }).join('');

  // Licence point tallies for drivers with points
  const tallyRows = Object.entries(licencePoints).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([id,pts])=>{
    const drv=drivers.find(d=>d.driverId===id);
    const abbr=drv?.abbr||id;
    const team=drv?.team||'unknown';
    const col=teamCol(team);
    const pct=Math.round(pts/12*100);
    const col2=pts>=8?'var(--red)':pts>=4?'var(--gold)':'var(--muted)';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${col};min-width:36px">${abbr}</span>
      <div class="rel-bar-bg" style="flex:1">
        <div class="rel-bar-fill" style="width:${pct}%;background:${col2}"></div>
      </div>
      <span class="pen-pts" style="color:${col2};min-width:20px">${pts}</span>
      <span style="font-size:10px;color:var(--dim)">/12</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:480px">
        <thead>
          <tr>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Driver</th>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Type</th>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Detail</th>
            <th style="padding:6px 10px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Race</th>
            <th style="padding:6px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)">Pen Pts</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${tallyRows ? `
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--dim);margin:16px 0 10px">Licence Points Tally (ban at 12)</div>
      ${tallyRows}
    ` : '<div style="font-size:12px;color:var(--dim);margin-top:12px">No licence penalty points accumulated this season.</div>'}
  `;
}


/* ═══════════════════════════════════════════════
   LIGHTS OUT — the home screen's call
   Start lights = the weekend's sessions (lit once each has ended; all go out
   while the race runs, like the real start). Then the AI's pick for the chosen
   stage, its reason, and the rest of the predicted order as a timing tower.
   ═══════════════════════════════════════════════ */
const LO = { race:null, stage:null, sig:'', clock:null };
const LO_STAGE_SHORT = { beforeSprintQ:'Before SQ', afterSprintQ:'After SQ', afterSprint:'After sprint', beforeQuali:'Before quali', afterQuali:'After quali' };

function loSelectedRace(){
  const races = (displayRaces.length ? displayRaces : (upcomingRaces.length ? upcomingRaces : BASE_UPCOMING));
  return races[selectedIdx] || races[0] || null;
}
function loEndAt(d, t, min){ return d && t ? Date.parse(`${d}T${t}:00Z`) + min*60000 : null; }
function loSessions(race){
  const sr = SEASON_RACES[race.circuitId] || {};
  const end = k => getSessionEndTime(race, k)?.getTime() ?? null;
  const sprint = !!race.sprint || SPRINT_CIRCUITS.has(race.circuitId);
  const list = sprint
    ? [['FP1', loEndAt(sr.fp1Date, sr.fp1UTC, 60)], ['SQ', end('sprintQuali')], ['Sprint', end('sprint')], ['Quali', end('quali')], ['Race', end('race')]]
    : [['FP1', loEndAt(sr.fp1Date, sr.fp1UTC, 60)], ['FP2', loEndAt(sr.fp2Date, sr.fp2UTC, 60)], ['FP3', loEndAt(sr.fp3Date, sr.fp3UTC, 60)], ['Quali', end('quali')], ['Race', end('race')]];
  // A practice session without a known time counts as done once qualifying is.
  const qEnd = end('quali');
  return list.map(([label, e]) => ({ label, end: e ?? (label.startsWith('FP') ? qEnd : null) }));
}
function loRaceStart(race){
  const t = RACE_TIMES[race.circuitId]?.raceUTC;
  return t ? Date.parse(`${race.date}T${t}:00Z`) : null;
}
function loClockText(race){
  const now = Date.now(), start = loRaceStart(race), end = getSessionEndTime(race,'race')?.getTime();
  if(!start) return { state:'unknown' };
  if(now < start){
    let sec = Math.floor((start - now)/1000);
    const d = Math.floor(sec/86400); sec -= d*86400;
    const pad = n => String(n).padStart(2,'0');
    const hms = `${pad(Math.floor(sec/3600))}:${pad(Math.floor(sec%3600/60))}:${pad(sec%60)}`;
    return { state:'before', value: d ? `${d}d ${hms}` : hms };
  }
  if(end && now < end) return { state:'live' };
  return { state:'after' };
}
function loLocalStart(race){
  const start = loRaceStart(race);
  if(!start) return '';
  const dt = new Date(start);
  return dt.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}) + ' · ' +
         dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function loRenderClock(){
  const race = LO.race, el = $('loClock');
  if(!race || !el) return;
  const c = loClockText(race);
  if(c.state === 'before') el.innerHTML = `<p>Lights out in<small>${esc(loLocalStart(race))}</small></p><b>${c.value}</b>`;
  else if(c.state === 'live') el.innerHTML = `<p>Race in progress<small>${esc(loLocalStart(race))}</small></p><b class="live">LIVE</b>`;
  else if(c.state === 'after') el.innerHTML = `<p>Chequered flag<small>${esc(race.name)}</small></p><a onclick="mobileNav('comp')">See how the AI did</a>`;
  else el.innerHTML = `<p>${esc(race.name)}<small>Session times not published yet</small></p>`;
}

function loGantryHTML(race){
  const now = Date.now(), clock = loClockText(race);
  const sessions = loSessions(race);
  // Remember how many lights this visitor has already seen lit, so only new ones light up.
  const key = `f1_lo_lit_${SEASON}_${race.circuitId}`;
  let seen = 0; try{ seen = +localStorage.getItem(key) || 0; }catch(e){}
  const litCount = sessions.filter(x => x.end && now >= x.end).length;
  try{ localStorage.setItem(key, String(litCount)); }catch(e){}
  const nextIdx = sessions.findIndex(x => !(x.end && now >= x.end));
  let fresh = 0;
  const pods = sessions.map((x, i) => {
    // While the race runs every light is out — that is the start.
    const on = clock.state !== 'live' && x.end && now >= x.end;
    const isNew = on && i >= seen && seen > 0;
    const cls = ['lo-pod', on ? 'on' : '', i === nextIdx && clock.state !== 'live' ? 'next' : '', isNew ? 'lit-now' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" style="${isNew ? `--d:${(fresh++)*120}ms` : ''}"><div class="lo-housing" aria-hidden="true"><div class="lo-lamp"></div><div class="lo-lamp"></div></div><div class="lo-plabel">${x.label}<span class="sr-only">${on ? ' done' : ''}</span></div></div>`;
  }).join('');
  return `<div class="lo-pods">${pods}</div><div class="lo-clock" id="loClock"></div>`;
}

function loSnapshots(race){
  return (cachedPredictions || []).filter(p =>
    p.circuit_id === race.circuitId && String(p.round) === String(race.round) &&
    p.pred_type === 'race' && p.prediction?.top10?.length);
}
function loBestFor(snaps, stage){
  // Newest real AI prediction for the stage, else its baseline.
  const rows = snaps.filter(p => p.stage === stage);
  return rows.find(p => !p.prediction._fallback) || rows[0] || null;
}
function loTeam(d){
  const drv = drivers.find(x => x.abbr === String(d.abbr||'').toUpperCase()) || drivers.find(x => x.driverId === d.driverId);
  const raw = drv?.team || d.team || '';
  const k = String(raw).toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const key = TC[k] ? k : (Object.keys(TN).find(t => TN[t].toLowerCase() === String(raw).toLowerCase()) || k);
  return { color: TC[key] || '#949494', name: TN[key] || teamName(raw) || '' };
}
const loSurname = n => String(n||'').trim().split(/\s+/).slice(-1)[0] || '';

function loGridMap(stage){
  if(stage !== 'afterQuali' || !qualifyingGrid?.length) return null;
  const m = {};
  qualifyingGrid.forEach(g => { const ab = driverAbbr(g.driverId || g.abbr); if(ab) m[ab] = +g.pos; });
  return Object.keys(m).length ? m : null;
}

function renderLightsOut(force){
  const wrap = $('lightsOut');
  const race = loSelectedRace();
  if(!wrap || !race){ if(wrap) wrap.hidden = true; return; }
  const raceChanged = LO.race?.circuitId !== race.circuitId || String(LO.race?.round) !== String(race.round);
  LO.race = race;

  const stages = stagesForRace(race);
  const snaps = loSnapshots(race);
  const have = new Set(stages.filter(st => loBestFor(snaps, st)));
  const current = getCurrentStage(race);
  if(raceChanged) LO.picked = false;
  if(!LO.picked || !stages.includes(LO.stage)){
    // Default: the latest stage with a real AI call, then the latest with any call,
    // otherwise the stage the weekend is in.
    const rev = [...stages].reverse();
    LO.stage = rev.find(st => { const b = loBestFor(snaps, st); return b && !b.prediction._fallback; })
            || rev.find(st => have.has(st)) || (stages.includes(current) ? current : stages[0]);
  }
  const snap = loBestFor(snaps, LO.stage);
  const grid = loGridMap(LO.stage);
  const sig = JSON.stringify([race.circuitId, race.round, LO.stage, snap?.id, snap?.created_at, !!grid, have.size, getCurrentStage(race), predictionsLoaded]);
  wrap.hidden = false;
  $('loGantry').innerHTML = loGantryHTML(race);
  loRenderClock();
  if(LO.clock == null) LO.clock = setInterval(loRenderClock, 1000);
  if(sig === LO.sig && !force) return;
  LO.sig = sig;

  const seg = `<div class="lo-seg" role="tablist" aria-label="Weekend stage">${stages.map(st =>
    `<button role="tab" aria-selected="${st===LO.stage}" class="${st===LO.stage?'act':''}" ${have.has(st)||st===current?'':'disabled'} onclick="loPickStage('${st}')">${LO_STAGE_SHORT[st]||stageLabel(st)}</button>`).join('')}</div>`;

  if(!snap && !predictionsLoaded){
    $('loCall').innerHTML = seg + `<div class="lo-empty"><p>Loading the AI’s calls…</p></div>`;
    $('loTower').innerHTML = '';
    return;
  }
  if(!snap){
    const after = current === 'final';
    $('loCall').innerHTML = seg + `<div class="lo-empty"><p>${after ? 'No call was saved before this race.' : `No call yet for ${esc(stageLabel(LO.stage).toLowerCase())}.`}<small>${after ? 'Predictions made after a race never count.' : 'The AI makes one automatically during the weekend, or ask for it now.'}</small></p>${after ? '' : `<button onclick="runAIPrediction('race')">Generate the AI's call</button>`}</div>`;
    $('loTower').innerHTML = '';
    return;
  }

  // Snapshot text is escaped when read (sbGet → escDeep), so it goes into the markup as is.
  const t10 = snap.prediction.top10.slice().sort((a,b) => (+a.pos||99) - (+b.pos||99));
  const p1 = t10[0], team1 = loTeam(p1);
  const win = v => (v == null || v === '' || isNaN(+v)) ? '—' : (+v < 1 ? '<1%' : `${Math.round(+v)}%`);
  const starts = grid?.[String(p1.abbr||'').toUpperCase()];
  const reason = p1.reasoning || snap.prediction.keyFactor || '';
  $('loCall').innerHTML = seg + `<div class="lo-call" id="loCallBody">
      <div class="lo-who">
        <div><h1>${loSurname(p1.name) || p1.abbr}</h1>
          <div class="lo-team"><i class="lo-slash" style="background:${team1.color}"></i>${esc(team1.name)}${starts ? ` · starts P${starts}` : ''}</div></div>
        <div class="lo-pct"><b>${win(p1.winProb)}</b><small>to win</small></div>
      </div>
      ${snap.prediction._fallback ? `<div class="lo-note">Baseline order, not an AI prediction: the AI was busy when this was saved.${current === 'final' ? '' : ' It is retried every hour.'}</div>` : ''}
      ${reason && !snap.prediction._fallback ? `<div class="lo-radio"><header><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 10.5a3 3 0 0 1 0-5M11 5.5a3 3 0 0 1 0 5M3 12.5a6 6 0 0 1 0-9M13 3.5a6 6 0 0 1 0 9"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>AI race engineer</header><p>“${reason}”</p></div>` : ''}
    </div>`;

  const rows = t10.slice(1, 10).map(d => {
    const tm = loTeam(d), ab = String(d.abbr||'').toUpperCase();
    let dl = '';
    if(grid){
      const g = grid[ab], diff = g ? g - (+d.pos) : null;
      dl = `<div class="lo-dl ${diff>0?'up':diff<0?'dn':''}">${diff==null?'—':diff>0?`+${diff}`:diff<0?`−${-diff}`:'0'}</div>`;
    }
    return `<div class="lo-row"><div class="lo-p">${+d.pos || ''}</div><div class="lo-drv"><i class="lo-slash" style="background:${tm.color}"></i><span class="lo-code">${ab}</span><span class="lo-full">${loSurname(d.name)}</span></div><div class="lo-wp">${win(d.winProb)}</div>${dl}</div>`;
  }).join('');
  const tower = $('loTower');
  tower.classList.toggle('nogrid', !grid);
  tower.innerHTML = `<div class="lo-th"><span>Pos</span><span>Driver</span><span>Win</span>${grid ? '<span>vs grid</span>' : ''}</div>${rows}
    <button class="lo-more" onclick="document.getElementById('podiumWrap')?.scrollIntoView({behavior:'smooth'})">Full analysis<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M3.5 7.5L7 11l3.5-3.5"/></svg></button>`;
  if(!$('podiumWrap') || $('podiumWrap').style.display === 'none') tower.querySelector('.lo-more')?.remove();
}

function loPickStage(stage){
  if(stage === LO.stage) return;
  const body = $('loCallBody');
  LO.stage = stage;
  LO.picked = true;
  if(body && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    body.classList.add('swap');
    setTimeout(() => renderLightsOut(true), 140);
  } else renderLightsOut(true);
}
setInterval(() => { if(!document.hidden) renderLightsOut(); }, 20000);



/* ── Boot ── */
initTheme();                 // restore saved dark/light preference
refreshPredictionsCache();   // load past predictions from Supabase into memory cache
loadData();                  // render baseline + fetch live data
trackEvent('view', { screen: 'pred', ref: document.referrer });

// Older race-report emails linked to /?unsubscribe=1 without saying which address.
if(new URLSearchParams(location.search).has('unsubscribe')){
  setTimeout(async () => {
    history.replaceState(null, '', location.pathname);
    const email = prompt('Enter the email address you subscribed with to stop the race-report emails:');
    if(!email) return;
    const r = await fetch('/api/unsubscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email})}).catch(() => null);
    showToast(r?.ok ? '✓ Unsubscribed — no more race-report emails' : 'Could not unsubscribe — try again', r?.ok ? 'success' : 'error', 6000);
  }, 1200);
}
// H2H selectors are populated after drivers load (buildSelector calls renderHistory which updates drivers)
// We call buildH2HSelectors() again after a short delay to ensure drivers array is populated
setTimeout(buildH2HSelectors, 1500);

if ('serviceWorker' in navigator) {
  // A new version takes over as soon as it installs (sw.js skips waiting); reload once
  // onto it so an update never needs a second reopen. First installs don't reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}

// Sync the visible version pill to APP_VERSION on load (never hardcode in HTML)
(function(){
  const setPill = () => { const p = document.getElementById('versionPill'); if(p) p.textContent = APP_VERSION; };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setPill);
  else setPill();
})();

/* ═══════════════════════════════════════════════
   PUSH NOTIFICATIONS + SETTINGS
   ═══════════════════════════════════════════════ */
const VAPID_PUBLIC_KEY = 'BP8vItzm0aHHypVurrgHgvVjQv3ovdhv1Ykz7MdpfP0ROLc8RUlaoJpErmWpYst19vikBqjM7iM9EwRKm7n5Fjk';

const NOTIF_TYPES = [
  { id:'predictionReady', icon:'🤖', title:'AI prediction ready',        desc:'The server auto-generated a fresh prediction for the current session stage — open the app to view it.' },
  { id:'raceWeekend',  icon:'🏁', title:'Race weekend starts',         desc:'Every Friday a race weekend begins — time to generate your prediction.' },
  { id:'qualifying',   icon:'📋', title:'Qualifying results ready',     desc:'After qualifying ends on Saturday — your final prediction grid is set.' },
  { id:'sprint',       icon:'⚡', title:'Sprint qualifying done',        desc:'Sprint weekends only — grid is set for the sprint race.' },
  { id:'countdown',    icon:'⏱', title:'Race starts in ~1 hour',       desc:'A reminder just before lights out on Sunday.' },
  { id:'results',      icon:'🏆', title:'AI vs Reality ready',          desc:'Official results loaded — see how accurate your prediction was.' },
  { id:'rainAlert',    icon:'🌧', title:'Rain alert for race day',       desc:'Sent Thursday if heavy rain (>50%) is forecast for the race.' },
  { id:'dataFetched',  icon:'🤖', title:'Session data fetched',         desc:'When OpenF1 auto-loads new qualifying or session data for your selected race.' },
  { id:'liveLights',   icon:'🔴', title:'Race is going LIVE',           desc:'The moment the race session starts on Sunday.' },
];

const NOTIF_PREFS_KEY = 'notifPrefs';

function getNotifPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY) || '{}');
    // Default all to true except dataFetched
    const defaults = {};
    NOTIF_TYPES.forEach(t => { defaults[t.id] = t.id !== 'dataFetched'; });
    return { ...defaults, ...saved };
  } catch(e) { return {}; }
}

function saveNotifPrefs(prefs) {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
  // Sync to server if subscribed
  syncPrefsToServer(prefs).catch(()=>{});
}

async function syncPrefsToServer(prefs) {
  const reg = await navigator.serviceWorker.ready.catch(()=>null);
  if(!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(()=>null);
  if(!sub) return;
  await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), preferences: prefs })
  }).catch(()=>{});
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/* ── Notification Settings Modal ── */
function openNotifSettings() {
  const modal = $('notifModal');
  if(!modal) return;
  renderNotifModal();
  modal.style.display = 'block';
  requestAnimationFrame(()=>{ modal.style.opacity='1'; });
}

function closeNotifSettings() {
  const modal = $('notifModal');
  if(modal) modal.style.display = 'none';
}

async function renderNotifModal() {
  const supported = 'Notification' in window && 'PushManager' in window;
  const permission = supported ? Notification.permission : 'unsupported';
  const reg = supported ? await navigator.serviceWorker.ready.catch(()=>null) : null;
  const sub = reg ? await reg.pushManager.getSubscription().catch(()=>null) : null;
  const isOn = !!sub && permission === 'granted';
  const prefs = getNotifPrefs();

  // Update master toggle
  const master = $('notifMaster');
  if(master) { master.checked = isOn; master.disabled = !supported || permission === 'denied'; }

  // Update bell dot
  const dot = $('notifDot');
  if(dot) dot.style.display = isOn ? 'block' : 'none';

  // Update pushCard button state
  const btn = $('pushBtn'), status = $('pushStatus');
  if(btn) {
    if(!supported){ btn.textContent='Not supported'; btn.disabled=true; }
    else if(permission==='denied'){ btn.textContent='Blocked in settings'; btn.disabled=true; if(status) status.innerHTML='<span style="color:#E10600">Enable notifications in your browser settings, then refresh.</span>'; }
    else if(isOn){ btn.textContent='✓ Notifications On'; btn.style.opacity='0.7'; btn.style.cursor='default'; if(status) status.innerHTML='<span style="color:#3fc07a">Active — manage types with the 🔔 button at the top.</span>'; }
    else { btn.textContent='Enable Notifications'; btn.style.opacity=''; btn.style.cursor=''; }
  }

  // Render type rows
  const list = $('notifTypesList');
  if(!list) return;

  if(!supported){
    list.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">Push notifications are not supported in this browser.<br>Add the app to your home screen for full support.</div>';
    return;
  }
  if(permission === 'denied'){
    list.innerHTML = '<div style="padding:20px;color:#E10600;font-size:13px;text-align:center">Notifications are blocked.<br>Go to Settings → Safari/Chrome → Notifications to re-enable.</div>';
    return;
  }

  list.innerHTML = NOTIF_TYPES.map(t => `
    <div class="notif-row${!isOn?' notif-disabled':''}">
      <div class="notif-row-icon">${t.icon}</div>
      <div class="notif-row-body">
        <div class="notif-row-title">${t.title}</div>
        <div class="notif-row-desc">${t.desc}</div>
      </div>
      <label class="notif-toggle-wrap" style="margin-top:2px">
        <input type="checkbox" ${prefs[t.id]?'checked':''} ${!isOn?'disabled':''} onchange="onPrefToggle('${t.id}',this.checked)">
        <span class="notif-toggle"></span>
      </label>
    </div>
  `).join('');
}

function onPrefToggle(id, checked) {
  const prefs = getNotifPrefs();
  prefs[id] = checked;
  saveNotifPrefs(prefs);
}

async function onMasterToggle(checked) {
  if(checked) {
    await enablePushNotifications();
  } else {
    await disablePushNotifications();
  }
  renderNotifModal();
}

async function enablePushNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if(permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const prefs = getNotifPrefs();
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), preferences: prefs })
    });
    const dot = $('notifDot');
    if(dot) dot.style.display = 'block';
    trackEvent('push_on');
    showToast('🔔 Notifications enabled!', 'success', 3000);
    return true;
  } catch(e) {
    showToast('Could not enable notifications', 'error');
    return false;
  }
}

async function disablePushNotifications() {
  const reg = await navigator.serviceWorker.ready.catch(()=>null);
  if(!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(()=>null);
  if(sub) await sub.unsubscribe().catch(()=>{});
  const dot = $('notifDot');
  if(dot) dot.style.display = 'none';
  showToast('Notifications disabled', 'info', 2000);
}

/* Keep old togglePushNotifications for the pushCard button */
async function togglePushNotifications() {
  const reg = await navigator.serviceWorker.ready.catch(()=>null);
  if(!reg) return;
  const existing = await reg.pushManager.getSubscription().catch(()=>null);
  if(existing) { await disablePushNotifications(); renderNotifModal(); return; }
  const ok = await enablePushNotifications();
  if(ok) renderNotifModal();
}

async function initPushUI() {
  if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)){
    const card = $('pushCard');
    if(card) card.style.display = 'none';
    return;
  }
  // Show green dot on bell if already subscribed
  const reg = await navigator.serviceWorker.ready.catch(()=>null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(()=>null) : null;
  if(sub && Notification.permission === 'granted') {
    const dot = $('notifDot');
    if(dot) dot.style.display = 'block';
    const btn = $('pushBtn');
    if(btn){ btn.textContent='✓ Notifications On'; btn.style.opacity='0.7'; btn.style.cursor='default'; }
    const status = $('pushStatus');
    if(status) status.innerHTML='<span style="color:#3fc07a">Active — manage types with the 🔔 button at the top.</span>';
  } else if(Notification.permission === 'denied') {
    const status = $('pushStatus');
    if(status) status.innerHTML='<span style="color:#E10600">Notifications blocked. Enable in browser settings.</span>';
    const btn = $('pushBtn');
    if(btn) btn.disabled = true;
  }
}

/* Local notification when session data is fetched.
   DEDUPE: only fire ONCE per race — the auto-fetch/live loop runs every 30s,
   so without this guard it would spam a native notification every cycle. */
let _notifiedDataFor = null;
function notifyDataFetched(raceName) {
  const prefs = getNotifPrefs();
  if(!prefs.dataFetched) return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  // Don't fire a NATIVE OS notification while the user is actively in the app —
  // that's redundant spam (they can see the in-app toast). Native notifications
  // are for when the app is closed (handled by the SW push handler).
  if(document.visibilityState === 'visible') return;
  if(_notifiedDataFor === raceName) return; // already notified for this race
  _notifiedDataFor = raceName;
  new Notification(`📋 ${raceName} — Data ready`, {
    body: 'Session data loaded. Generate your AI prediction now.',
    icon: '/icons/icon-192.png',
    tag: 'data-fetched',       // same tag = OS replaces rather than stacks
    renotify: false,
  });
}

initPushUI();

/* ═══════════════════════════════════════════════
   AUTO-NOTIFY ON INSTALL / STANDALONE LAUNCH
   ═══════════════════════════════════════════════ */
async function autoRequestNotifications(){
  if(!('Notification' in window) || !('PushManager' in window)) return;
  if(Notification.permission !== 'default') return; // already granted or denied

  // Small delay so the app feels settled before prompting
  await new Promise(r => setTimeout(r, 2500));

  // Show a friendly in-app prompt instead of the raw browser dialog
  showInstallNotifPrompt();
}

function showInstallNotifPrompt(){
  // Don't show if already subscribed or push card not visible
  if($('pushCard')?.style.display==='none') return;

  const toast = document.createElement('div');
  toast.id = 'notifPromptToast';
  toast.style.cssText = `
    position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);
    background:#1E1E2E;border:1px solid rgba(255,255,255,.2);border-radius:12px;
    padding:16px 18px;z-index:9999;max-width:320px;width:calc(100% - 40px);
    box-shadow:0 8px 32px rgba(0,0,0,.5);animation:slideUp .3s ease;
  `;
  toast.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:6px">🔔 Get race weekend alerts?</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">
      Get notified every Friday a race weekend starts — so you never miss predicting.
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="acceptNotifPrompt()" style="flex:1;padding:9px;background:var(--ai);border:none;border-radius:7px;color:#fff;font-weight:700;font-size:13px;cursor:pointer">Enable</button>
      <button onclick="dismissNotifPrompt()" style="padding:9px 14px;background:none;border:1px solid var(--border2);border-radius:7px;color:var(--muted);font-size:13px;cursor:pointer">Later</button>
    </div>
  `;
  document.body.appendChild(toast);
}

async function acceptNotifPrompt(){
  dismissNotifPrompt();
  await togglePushNotifications();
}

function dismissNotifPrompt(){
  const t = document.getElementById('notifPromptToast');
  if(t) t.remove();
  localStorage.setItem('notifPromptDismissed', Date.now());
}

// Trigger when added to home screen
window.addEventListener('appinstalled', () => {
  console.log('PWA installed — prompting for notifications');
  setTimeout(autoRequestNotifications, 3000);
});

// Trigger on standalone launch if never prompted before
const isStandalone = navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

const lastDismissed = localStorage.getItem('notifPromptDismissed');
const dismissedRecently = lastDismissed && (Date.now() - +lastDismissed) < 7 * 24 * 60 * 60 * 1000;

if(isStandalone && !dismissedRecently && Notification.permission === 'default'){
  // Wait for app to fully load before prompting
  window.addEventListener('load', () => setTimeout(autoRequestNotifications, 3000));
}

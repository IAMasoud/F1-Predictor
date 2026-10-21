/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// The one season calendar for the whole project: the website, the Vercel API, the
// Supabase functions and the live bridge all read it from here.
//
// loadSeason() reads the official schedule (Jolpica "current" season, including every
// session time) and switches to the next season by itself once the last race is a week
// old and next year's calendar is published. If Jolpica can't be reached it falls back
// to the 2026 calendar below.

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
export const FALLBACK_SEASON = 2026;

// Jolpica ids that differ from the ids this project uses (and stores in the database).
export const CIRCUIT_ALIAS = { madring: 'ifema_madrid', vegas: 'las_vegas' };
export const DRIVER_ALIAS = { arvid_lindblad: 'lindblad' };
export const siteCircuitId = id => CIRCUIT_ALIAS[id] || id;
export const siteDriverId = id => DRIVER_ALIAS[id] || id;

// What the schedule doesn't say: circuit character (for the AI prompt), the OpenF1
// "location" name, and a flag for emails. Unknown circuits get sensible defaults.
export const CIRCUITS = {
  albert_park:   { type: 'semi-street', of1: 'Melbourne',         flag: '🇦🇺' },
  shanghai:      { type: 'balanced',    of1: 'Shanghai',          flag: '🇨🇳' },
  suzuka:        { type: 'technical',   of1: 'Suzuka',            flag: '🇯🇵' },
  bahrain:       { type: 'power',       of1: 'Sakhir',            flag: '🇧🇭' },
  jeddah:        { type: 'street',      of1: 'Jeddah',            flag: '🇸🇦' },
  miami:         { type: 'street',      of1: 'Miami Gardens',     flag: '🇺🇸' },
  imola:         { type: 'technical',   of1: 'Imola',             flag: '🇮🇹' },
  villeneuve:    { type: 'semi-street', of1: 'Montréal',          flag: '🇨🇦' },
  monaco:        { type: 'street',      of1: 'Monte Carlo',       flag: '🇲🇨' },
  catalunya:     { type: 'balanced',    of1: 'Barcelona',         flag: '🇪🇸' },
  red_bull_ring: { type: 'power',       of1: 'Spielberg',         flag: '🇦🇹' },
  silverstone:   { type: 'balanced',    of1: 'Silverstone',       flag: '🇬🇧' },
  spa:           { type: 'power',       of1: 'Spa-Francorchamps', flag: '🇧🇪' },
  hungaroring:   { type: 'technical',   of1: 'Budapest',          flag: '🇭🇺' },
  zandvoort:     { type: 'technical',   of1: 'Zandvoort',         flag: '🇳🇱' },
  monza:         { type: 'power',       of1: 'Monza',             flag: '🇮🇹' },
  ifema_madrid:  { type: 'street',      of1: 'Madrid',            flag: '🇪🇸' },
  baku:          { type: 'street',      of1: 'Baku',              flag: '🇦🇿' },
  sepang:        { type: 'power',       of1: 'Kuala Lumpur',      flag: '🇲🇾' },
  marina_bay:    { type: 'street',      of1: 'Marina Bay',        flag: '🇸🇬' },
  americas:      { type: 'balanced',    of1: 'Austin',            flag: '🇺🇸' },
  rodriguez:     { type: 'technical',   of1: 'Mexico City',       flag: '🇲🇽' },
  interlagos:    { type: 'balanced',    of1: 'São Paulo',         flag: '🇧🇷' },
  las_vegas:     { type: 'power',       of1: 'Las Vegas',         flag: '🇺🇸' },
  losail:        { type: 'power',       of1: 'Lusail',            flag: '🇶🇦' },
  yas_marina:    { type: 'technical',   of1: 'Yas Marina',        flag: '🇦🇪' },
};

// The names this site has always used for 2026 (stored in its saved predictions).
const NAMES_2026 = {
  sepang:       { name: 'Bahrain Grand Prix (Malaysia)' },
  interlagos:   { name: 'São Paulo Grand Prix', circuit: 'Autodromo Jose Carlos Pace' },
  rodriguez:    { circuit: 'Autodromo Hermanos Rodriguez' },
  albert_park:  { circuit: 'Albert Park Circuit' },
  zandvoort:    { circuit: 'Circuit Zandvoort' },
  monza:        { circuit: 'Autodromo Nazionale Monza' },
  las_vegas:    { circuit: 'Las Vegas Strip Circuit' },
};

// Session lengths used to decide when a session has ended (minutes).
export const SESSION_MINUTES = { sprintQuali: 45, sprint: 60, quali: 60, race: 120 };

// 2026 schedule as published by Jolpica (UTC), used only when it can't be reached.
const FALLBACK_2026 = [
  {round:1,circuitId:"albert_park",date:"2026-03-08",raceUTC:"04:00",qualiDate:"2026-03-07",qualiUTC:"05:00",fp1Date:"2026-03-06",fp1UTC:"01:30",fp2Date:"2026-03-06",fp2UTC:"05:00",fp3Date:"2026-03-07",fp3UTC:"01:30",name:"Australian Grand Prix",circuit:"Albert Park Grand Prix Circuit",country:"Australia",lat:-37.8497,lon:144.968,locality:"Melbourne"},
  {round:2,circuitId:"shanghai",date:"2026-03-15",raceUTC:"07:00",qualiDate:"2026-03-14",qualiUTC:"07:00",fp1Date:"2026-03-13",fp1UTC:"03:30",sprint:true,sprintQualiDate:"2026-03-13",sprintQualiUTC:"07:30",sprintDate:"2026-03-14",sprintUTC:"03:00",name:"Chinese Grand Prix",circuit:"Shanghai International Circuit",country:"China",lat:31.3389,lon:121.22,locality:"Shanghai"},
  {round:3,circuitId:"suzuka",date:"2026-03-29",raceUTC:"05:00",qualiDate:"2026-03-28",qualiUTC:"06:00",fp1Date:"2026-03-27",fp1UTC:"02:30",fp2Date:"2026-03-27",fp2UTC:"06:00",fp3Date:"2026-03-28",fp3UTC:"02:30",name:"Japanese Grand Prix",circuit:"Suzuka Circuit",country:"Japan",lat:34.8431,lon:136.541,locality:"Suzuka"},
  {round:4,circuitId:"miami",date:"2026-05-03",raceUTC:"20:00",qualiDate:"2026-05-02",qualiUTC:"20:00",fp1Date:"2026-05-01",fp1UTC:"16:00",sprint:true,sprintQualiDate:"2026-05-01",sprintQualiUTC:"20:30",sprintDate:"2026-05-02",sprintUTC:"16:00",name:"Miami Grand Prix",circuit:"Miami International Autodrome",country:"USA",lat:25.9581,lon:-80.2389,locality:"Miami"},
  {round:5,circuitId:"villeneuve",date:"2026-05-24",raceUTC:"20:00",qualiDate:"2026-05-23",qualiUTC:"20:00",fp1Date:"2026-05-22",fp1UTC:"16:30",sprint:true,sprintQualiDate:"2026-05-22",sprintQualiUTC:"20:30",sprintDate:"2026-05-23",sprintUTC:"16:00",name:"Canadian Grand Prix",circuit:"Circuit Gilles Villeneuve",country:"Canada",lat:45.5,lon:-73.5228,locality:"Montreal"},
  {round:6,circuitId:"monaco",date:"2026-06-07",raceUTC:"13:00",qualiDate:"2026-06-06",qualiUTC:"14:00",fp1Date:"2026-06-05",fp1UTC:"11:30",fp2Date:"2026-06-05",fp2UTC:"15:00",fp3Date:"2026-06-06",fp3UTC:"10:30",name:"Monaco Grand Prix",circuit:"Circuit de Monaco",country:"Monaco",lat:43.7347,lon:7.42056,locality:"Monte Carlo"},
  {round:7,circuitId:"catalunya",date:"2026-06-14",raceUTC:"13:00",qualiDate:"2026-06-13",qualiUTC:"14:00",fp1Date:"2026-06-12",fp1UTC:"11:30",fp2Date:"2026-06-12",fp2UTC:"15:00",fp3Date:"2026-06-13",fp3UTC:"10:30",name:"Barcelona Grand Prix",circuit:"Circuit de Barcelona-Catalunya",country:"Spain",lat:41.57,lon:2.26111,locality:"Barcelona"},
  {round:8,circuitId:"red_bull_ring",date:"2026-06-28",raceUTC:"13:00",qualiDate:"2026-06-27",qualiUTC:"14:00",fp1Date:"2026-06-26",fp1UTC:"11:30",fp2Date:"2026-06-26",fp2UTC:"15:00",fp3Date:"2026-06-27",fp3UTC:"10:30",name:"Austrian Grand Prix",circuit:"Red Bull Ring",country:"Austria",lat:47.2197,lon:14.7647,locality:"Spielberg"},
  {round:9,circuitId:"silverstone",date:"2026-07-05",raceUTC:"14:00",qualiDate:"2026-07-04",qualiUTC:"15:00",fp1Date:"2026-07-03",fp1UTC:"11:30",sprint:true,sprintQualiDate:"2026-07-03",sprintQualiUTC:"15:30",sprintDate:"2026-07-04",sprintUTC:"11:00",name:"British Grand Prix",circuit:"Silverstone Circuit",country:"UK",lat:52.0786,lon:-1.01694,locality:"Silverstone"},
  {round:10,circuitId:"spa",date:"2026-07-19",raceUTC:"13:00",qualiDate:"2026-07-18",qualiUTC:"14:00",fp1Date:"2026-07-17",fp1UTC:"11:30",fp2Date:"2026-07-17",fp2UTC:"15:00",fp3Date:"2026-07-18",fp3UTC:"10:30",name:"Belgian Grand Prix",circuit:"Circuit de Spa-Francorchamps",country:"Belgium",lat:50.4372,lon:5.97139,locality:"Spa"},
  {round:11,circuitId:"hungaroring",date:"2026-07-26",raceUTC:"13:00",qualiDate:"2026-07-25",qualiUTC:"14:00",fp1Date:"2026-07-24",fp1UTC:"11:30",fp2Date:"2026-07-24",fp2UTC:"15:00",fp3Date:"2026-07-25",fp3UTC:"10:30",name:"Hungarian Grand Prix",circuit:"Hungaroring",country:"Hungary",lat:47.5789,lon:19.2486,locality:"Budapest"},
  {round:12,circuitId:"zandvoort",date:"2026-08-23",raceUTC:"13:00",qualiDate:"2026-08-22",qualiUTC:"14:00",fp1Date:"2026-08-21",fp1UTC:"10:30",sprint:true,sprintQualiDate:"2026-08-21",sprintQualiUTC:"14:30",sprintDate:"2026-08-22",sprintUTC:"10:00",name:"Dutch Grand Prix",circuit:"Circuit Park Zandvoort",country:"Netherlands",lat:52.3888,lon:4.54092,locality:"Zandvoort"},
  {round:13,circuitId:"monza",date:"2026-09-06",raceUTC:"13:00",qualiDate:"2026-09-05",qualiUTC:"14:00",fp1Date:"2026-09-04",fp1UTC:"10:30",fp2Date:"2026-09-04",fp2UTC:"14:00",fp3Date:"2026-09-05",fp3UTC:"10:30",name:"Italian Grand Prix",circuit:"Autodromo Nazionale di Monza",country:"Italy",lat:45.6156,lon:9.28111,locality:"Monza"},
  {round:14,circuitId:"ifema_madrid",date:"2026-09-13",raceUTC:"13:00",qualiDate:"2026-09-12",qualiUTC:"14:00",fp1Date:"2026-09-11",fp1UTC:"11:30",fp2Date:"2026-09-11",fp2UTC:"15:00",fp3Date:"2026-09-12",fp3UTC:"10:30",name:"Spanish Grand Prix",circuit:"Madring",country:"Spain",lat:40.46528,lon:-3.61528,locality:"Madrid"},
  {round:15,circuitId:"baku",date:"2026-09-26",raceUTC:"11:00",qualiDate:"2026-09-25",qualiUTC:"12:00",fp1Date:"2026-09-24",fp1UTC:"08:30",fp2Date:"2026-09-24",fp2UTC:"12:00",fp3Date:"2026-09-25",fp3UTC:"08:30",name:"Azerbaijan Grand Prix",circuit:"Baku City Circuit",country:"Azerbaijan",lat:40.3725,lon:49.8533,locality:"Baku"},
  {round:16,circuitId:"sepang",date:"2026-10-04",raceUTC:"07:00",qualiDate:"2026-10-03",qualiUTC:"08:00",fp1Date:"2026-10-02",fp1UTC:"04:30",fp2Date:"2026-10-02",fp2UTC:"08:00",fp3Date:"2026-10-03",fp3UTC:"04:30",name:"Bahrain Grand Prix in Malaysia",circuit:"Sepang International Circuit",country:"Malaysia",lat:2.76083,lon:101.738,locality:"Kuala Lumpur"},
  {round:17,circuitId:"marina_bay",date:"2026-10-11",raceUTC:"12:00",qualiDate:"2026-10-10",qualiUTC:"13:00",fp1Date:"2026-10-09",fp1UTC:"08:30",sprint:true,sprintQualiDate:"2026-10-09",sprintQualiUTC:"12:30",sprintDate:"2026-10-10",sprintUTC:"09:00",name:"Singapore Grand Prix",circuit:"Marina Bay Street Circuit",country:"Singapore",lat:1.2914,lon:103.864,locality:"Marina Bay"},
  {round:18,circuitId:"americas",date:"2026-10-25",raceUTC:"20:00",qualiDate:"2026-10-24",qualiUTC:"21:00",fp1Date:"2026-10-23",fp1UTC:"17:30",fp2Date:"2026-10-23",fp2UTC:"21:00",fp3Date:"2026-10-24",fp3UTC:"17:30",name:"United States Grand Prix",circuit:"Circuit of the Americas",country:"USA",lat:30.1328,lon:-97.6411,locality:"Austin"},
  {round:19,circuitId:"rodriguez",date:"2026-11-01",raceUTC:"20:00",qualiDate:"2026-10-31",qualiUTC:"21:00",fp1Date:"2026-10-30",fp1UTC:"18:30",fp2Date:"2026-10-30",fp2UTC:"22:00",fp3Date:"2026-10-31",fp3UTC:"17:30",name:"Mexico City Grand Prix",circuit:"Autódromo Hermanos Rodríguez",country:"Mexico",lat:19.4042,lon:-99.0907,locality:"Mexico City"},
  {round:20,circuitId:"interlagos",date:"2026-11-08",raceUTC:"17:00",qualiDate:"2026-11-07",qualiUTC:"18:00",fp1Date:"2026-11-06",fp1UTC:"15:30",fp2Date:"2026-11-06",fp2UTC:"19:00",fp3Date:"2026-11-07",fp3UTC:"14:30",name:"Brazilian Grand Prix",circuit:"Autódromo José Carlos Pace",country:"Brazil",lat:-23.7036,lon:-46.6997,locality:"São Paulo"},
  {round:21,circuitId:"las_vegas",date:"2026-11-22",raceUTC:"04:00",qualiDate:"2026-11-21",qualiUTC:"04:00",fp1Date:"2026-11-20",fp1UTC:"00:30",fp2Date:"2026-11-20",fp2UTC:"04:00",fp3Date:"2026-11-21",fp3UTC:"00:30",name:"Las Vegas Grand Prix",circuit:"Las Vegas Strip Street Circuit",country:"USA",lat:36.1147,lon:-115.173,locality:"Las Vegas"},
  {round:22,circuitId:"losail",date:"2026-11-29",raceUTC:"16:00",qualiDate:"2026-11-28",qualiUTC:"18:00",fp1Date:"2026-11-27",fp1UTC:"13:30",fp2Date:"2026-11-27",fp2UTC:"17:00",fp3Date:"2026-11-28",fp3UTC:"14:30",name:"Qatar Grand Prix",circuit:"Lusail International Circuit",country:"Qatar",lat:25.49,lon:51.4542,locality:"Lusail"},
  {round:23,circuitId:"yas_marina",date:"2026-12-06",raceUTC:"13:00",qualiDate:"2026-12-05",qualiUTC:"14:00",fp1Date:"2026-12-04",fp1UTC:"09:30",fp2Date:"2026-12-04",fp2UTC:"13:00",fp3Date:"2026-12-05",fp3UTC:"10:30",name:"Abu Dhabi Grand Prix",circuit:"Yas Marina Circuit",country:"UAE",lat:24.4672,lon:54.6031,locality:"Abu Dhabi"}
];

function finish(season, r) {
  const meta = CIRCUITS[r.circuitId] || {};
  const names = season === 2026 ? NAMES_2026[r.circuitId] || {} : {};
  return {
    ...r,
    season,
    name: names.name || r.name,
    circuit: names.circuit || r.circuit,
    type: meta.type || 'balanced',
    of1: meta.of1 || r.locality,
    flag: meta.flag || '🏁',
    sprint: !!r.sprint,
  };
}

const hm = t => (t ? String(t).slice(0, 5) : undefined);

/** Jolpica RaceTable → this project's race objects (sorted by round). */
export function racesFromJolpica(table) {
  const season = Number(table?.season);
  return (table?.Races || []).map(r => {
    const o = {
      round: Number(r.round),
      circuitId: siteCircuitId(r.Circuit?.circuitId),
      date: r.date,
      raceUTC: hm(r.time),
      qualiDate: r.Qualifying?.date,
      qualiUTC: hm(r.Qualifying?.time),
      fp1Date: r.FirstPractice?.date,
      fp1UTC: hm(r.FirstPractice?.time),
      fp2Date: r.SecondPractice?.date,
      fp2UTC: hm(r.SecondPractice?.time),
      fp3Date: r.ThirdPractice?.date,
      fp3UTC: hm(r.ThirdPractice?.time),
      name: r.raceName,
      circuit: r.Circuit?.circuitName,
      country: r.Circuit?.Location?.country,
      locality: r.Circuit?.Location?.locality,
      lat: Number(r.Circuit?.Location?.lat),
      lon: Number(r.Circuit?.Location?.long),
    };
    if (r.Sprint) {
      Object.assign(o, {
        sprint: true,
        sprintQualiDate: r.SprintQualifying?.date, sprintQualiUTC: hm(r.SprintQualifying?.time),
        sprintDate: r.Sprint.date, sprintUTC: hm(r.Sprint.time),
      });
    }
    return finish(season, o);
  }).sort((a, b) => a.round - b.round);
}

export function fallbackSeason() {
  return { season: FALLBACK_SEASON, races: FALLBACK_2026.map(r => finish(FALLBACK_SEASON, r)), source: 'fallback' };
}

/** When a session ends (ms since epoch), or null when the schedule doesn't have it. */
export function sessionEndMs(race, kind) {
  const f = {
    sprintQuali: [race?.sprintQualiDate, race?.sprintQualiUTC],
    sprint: [race?.sprintDate, race?.sprintUTC],
    quali: [race?.qualiDate, race?.qualiUTC],
    race: [race?.date, race?.raceUTC],
  }[kind];
  if (!f?.[0] || !f?.[1]) return null;
  return Date.parse(`${f[0]}T${f[1]}:00Z`) + SESSION_MINUTES[kind] * 60000;
}

let memo = null, memoAt = 0;
/**
 * The season to use right now: { season, races, source }. Cached for an hour.
 * opts.fetchImpl lets callers pass their own fetch; opts.now is for tests.
 */
export async function loadSeason({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 6000 } = {}) {
  if (memo && now - memoAt < 3600000) return memo;
  const get = async path => {
    const r = await fetchImpl(`${JOLPICA}/${path}.json?limit=40`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`Jolpica ${r.status}`);
    return (await r.json())?.MRData?.RaceTable;
  };
  try {
    const table = await get('current');
    const races = racesFromJolpica(table);
    if (!races.length) throw new Error('empty schedule');
    let result = { season: Number(table.season), races, source: 'jolpica' };
    // A week after the final race, move on as soon as next season's calendar exists.
    if (now > Date.parse(races[races.length - 1].date) + 7 * 86400000) {
      const next = racesFromJolpica(await get(String(result.season + 1)).catch(() => null));
      if (next.length) result = { season: result.season + 1, races: next, source: 'jolpica' };
    }
    memo = result; memoAt = now;
    return result;
  } catch (e) {
    return fallbackSeason();
  }
}

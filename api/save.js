/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// The only way data gets written to the predictions / sessions tables from outside
// the server. The browser (and the live bridge, with its key) send rows here; they
// are validated, trimmed to known fields and written with the server key.
import { isAllowedOrigin, clientIp, rateLimited, sb } from './_guard.js';
import { loadSeason } from '../season.js';

// Pre-race stages only: a prediction saved after the race ('final') would be made with the result known.
const STAGES = new Set(['beforeQuali', 'beforeSprintQ', 'afterSprintQ', 'afterSprint', 'afterQuali']);
const SESSION = /^(Practice [1-3]|Sprint Qualifying|Sprint Shootout|Sprint|Qualifying|Race)$/;
const ABBR = /^[A-Z]{3}$/;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : undefined);
const code = v => { const a = String(v || '').trim().toUpperCase(); return ABBR.test(a) ? a : undefined; };
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
class Invalid extends Error {}
const need = (v, what) => { if (v === undefined || v === null || v === '') throw new Invalid(what); return v; };

function predictionRow(r) {
  const p = r?.prediction;
  const top10 = Array.isArray(p?.top10) ? p.top10.slice(0, 10) : [];
  if (!top10.length) throw new Invalid('prediction.top10');
  return {
    race_name:  need(str(r.race_name, 80), 'race_name'),
    round:      need(int(Number(r.round), 1, 30), 'round'),
    circuit_id: need(/^[a-z_]{3,20}$/.test(r.circuit_id || '') ? r.circuit_id : undefined, 'circuit_id'),
    race_date:  need(/^\d{4}-\d{2}-\d{2}$/.test(r.race_date || '') ? r.race_date : undefined, 'race_date'),
    pred_type:  need(['race', 'sprint'].includes(r.pred_type) ? r.pred_type : undefined, 'pred_type'),
    stage:      need(STAGES.has(r.stage) ? r.stage : undefined, 'stage'),
    hidden:     false, // a new call for a stage the admin hid is shown again
    prediction: clean({
      top10: top10.map((d, i) => clean({
        pos:       int(Number(d?.pos), 1, 30) ?? i + 1,
        driverId:  /^[A-Za-z_.-]{1,40}$/.test(d?.driverId || '') ? d.driverId : undefined,
        name:      str(d?.name, 60),
        abbr:      need(code(d?.abbr), 'top10.abbr'),
        team:      str(d?.team, 40),
        winProb:   num(Number(d?.winProb), 0, 100),
        reasoning: str(d?.reasoning, 800),
      })),
      overallAnalysis: str(p.overallAnalysis, 6000),
      keyFactor:       str(p.keyFactor, 600),
      upsetAlert:      str(p.upsetAlert, 600),
      reasoning:       str(p.reasoning, 1500),
      confidence:      num(Number(p.confidence), 0, 100),
    }),
    actual_results: null,
    accuracy: null,
  };
}

function sessionRow(r) {
  // Keep only entries with a valid position + driver code (drops e.g. bare car numbers).
  const grid = (Array.isArray(r?.grid_data) ? r.grid_data.slice(0, 30) : [])
    .filter(g => int(Number(g?.pos), 1, 30) !== undefined && code(g?.abbr));
  if (!grid.length) throw new Invalid('grid_data');
  return {
    circuit_id:   need(/^[a-z_]{3,20}$/.test(r.circuit_id || '') ? r.circuit_id : undefined, 'circuit_id'),
    round:        need(int(Number(r.round), 1, 30), 'round'),
    year:         int(Number(r.year), 2024, 2100) ?? new Date().getUTCFullYear(),
    session_name: need(SESSION.test(r.session_name || '') ? r.session_name : undefined, 'session_name'),
    grid_data: grid.map(g => clean({
      pos:        need(int(Number(g?.pos), 1, 30), 'grid.pos'),
      abbr:       need(code(g?.abbr), 'grid.abbr'),
      lap:        int(g?.lap, 0, 100),
      inPit:      typeof g?.inPit === 'boolean' ? g.inPit : undefined,
      retired:    typeof g?.retired === 'boolean' ? g.retired : undefined,
      pitCount:   int(g?.pitCount, 0, 20),
      lastPitLap: int(g?.lastPitLap, 0, 100),
      totalLaps:  int(g?.totalLaps, 1, 100),
      gap:        typeof g?.gap === 'string' && /^[+\d. :LAPSlaps]{1,12}$/.test(g.gap) ? g.gap : undefined,
      tyre:       ['S', 'M', 'H', 'I', 'W'].includes(g?.tyre) ? g.tyre : undefined,
      tyreAge:    int(g?.tyreAge, 0, 100),
      flag:       typeof g?.flag === 'string' && /^[A-Za-z ]{1,20}$/.test(g.flag) ? g.flag : undefined,
    })),
    source:     str(r.source, 30) || 'unknown',
    fetched_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bridgeKey = process.env.CRON_SECRET;
  const fromBridge = !!bridgeKey && req.headers['x-bridge-key'] === bridgeKey;
  if (!fromBridge) {
    if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (rateLimited('save:' + clientIp(req), 60, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });
  }

  const { type, row } = req.body || {};
  let path, body;
  try {
    if (type === 'prediction') {
      body = predictionRow(row);
      // Once the race (or sprint) has started, a new call would be made with the race in view:
      // it is not saved, so it can never replace the call made before the start.
      const { races } = await loadSeason();
      const r = races.find(x => x.circuitId === body.circuit_id && Number(x.round) === body.round);
      const at = (d, t) => (d && t ? Date.parse(`${d}T${t}:00Z`) : null);
      const start = body.pred_type === 'sprint' ? at(r?.sprintDate, r?.sprintUTC) : at(r?.date, r?.raceUTC);
      if (start && Date.now() >= start) return res.status(409).json({ error: 'The race has started, so new calls are not saved' });
      path = 'predictions?on_conflict=circuit_id,round,pred_type,stage';
    } else if (type === 'session') {
      body = sessionRow(row);
      path = 'sessions?on_conflict=circuit_id,round,year,session_name';
    } else {
      return res.status(400).json({ error: 'Unknown type' });
    }
  } catch (e) {
    if (e instanceof Invalid) return res.status(400).json({ error: `Invalid or missing ${e.message}` });
    throw e;
  }

  try {
    const r = await sb(path, { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
    if (!r.ok) {
      console.warn('[save]', type, r.status, (await r.text()).slice(0, 200));
      return res.status(502).json({ error: 'Database write failed' });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.warn('[save]', type, e.message);
    res.status(502).json({ error: 'Database write failed' });
  }
}

/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Sends race-weekend report emails to all subscribers via Brevo.
// Triggered automatically by the live bridge when the race ends,
// or manually with the CRON_SECRET key (?key=…, optional &circuit=<id> for an older race).
import { unsubToken } from './_guard.js';
import { loadSeason, FALLBACK_SEASON } from '../season.js';

export const config = { maxDuration: 30 };

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 'final' snapshots are made after the race, so they never count as the AI's call.
const PRE_RACE_STAGES = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];

// Same formula as the website and the scoring job: exact = 1, within ±2 = 0.5.
function calcAccuracy(predAbbrs, actualAbbrs) {
  const n = Math.min(predAbbrs.length, actualAbbrs.length, 10);
  if (!n) return null;
  let exact = 0, close = 0;
  for (let i = 0; i < n; i++) {
    if (predAbbrs[i] === actualAbbrs[i]) { exact++; continue; }
    const j = actualAbbrs.indexOf(predAbbrs[i]);
    if (j >= 0 && Math.abs(j - i) <= 2) close++;
  }
  return Math.round(((exact + close * 0.5) / n) * 100);
}

const TEAM_COLORS = {
  mercedes:'#27F4D2', ferrari:'#E8002D', mclaren:'#FF8000', red_bull:'#3671C6',
  williams:'#64C4FF', aston_martin:'#229971', alpine:'#FF87BC', racing_bulls:'#6692FF',
  audi:'#C8B820', haas:'#B6BABD', cadillac:'#CC0033',
};

function normalizeTeam(name='') {
  const k = name.toLowerCase().replace(/[\s-]+/g, '_').replace(/_f1_team$/, '');
  return TEAM_COLORS[k] ? k : (
    k.includes('mercedes')?'mercedes':k.includes('ferrari')?'ferrari':
    k.includes('mclaren')?'mclaren':k.includes('red_bull')?'red_bull':
    k.includes('williams')?'williams':k.includes('aston')?'aston_martin':
    k.includes('alpine')?'alpine':k.includes('racing_bulls')||k.includes('vcarb')?'racing_bulls':
    k.includes('audi')||k.includes('sauber')?'audi':k.includes('haas')?'haas':
    k.includes('cadillac')?'cadillac':'unknown'
  );
}

// The season calendar (shared season.js) — circuit name/flag and the "next race" teaser.
// Filled at the start of each request.
let CALENDAR = [];
let SEASON = FALLBACK_SEASON;
const metaForCircuit = (id) => CALENDAR.find(c => c.id === id) || null;
const metaForRound   = (r)  => CALENDAR.find(c => Number(c.round) === Number(r)) || null;
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); } catch { return ''; } };

function buildEmailHtml({ meta, round, grid, prediction, accuracy, nextRace, roster = {} }) {
  const APP = 'https://f1-predictor-theta.vercel.app';
  const medals = ['🥇', '🥈', '🥉'];

  // grid_data is [{pos, abbr}] only — names/teams come from the official standings
  // (roster), AI win chance / predicted position from the AI prediction.
  // Every text value is escaped here, before it goes into the HTML.
  const predList = (prediction?.top10 || []).map(p => ({ ...p, abbr: esc(p.abbr), name: esc(p.name), team: esc(p.team) }));
  grid = (grid || []).map(g => ({ ...g, abbr: esc(g.abbr) }));
  const dmap = {};
  predList.forEach(p => { if (p.abbr) dmap[p.abbr] = { name: p.name || '', team: p.team || '', winProb: Number(p.winProb) || null, predPos: Number(p.pos) || null }; });
  const info  = a => ({ name: '', team: '', winProb: null, predPos: null, ...(dmap[a] || {}),
                        ...(roster[a] ? { name: esc(roster[a].name), team: esc(roster[a].team) } : {}) });
  const color = a => TEAM_COLORS[normalizeTeam(info(a).team)] || '#888';

  const order   = grid.slice().sort((x, y) => x.pos - y.pos);
  const top10   = order.slice(0, 10);
  const podium  = order.slice(0, 3);
  const winner  = order[0] || null;

  // ── Derived stats (only from data we actually have) ──
  const actAbbr  = order.map(g => g.abbr);
  const predAbbr = predList.slice().sort((a, b) => a.pos - b.pos).map(p => p.abbr);
  const predTop3 = predAbbr.slice(0, 3);
  const actTop3  = actAbbr.slice(0, 3);
  const podiumHits = predTop3.filter(a => actTop3.includes(a)).length;
  let exact = 0;
  order.forEach(g => { if (info(g.abbr).predPos === g.pos) exact++; });
  let mover = null, bestGain = 0;
  order.forEach(g => {
    const pp = info(g.abbr).predPos;
    if (pp) { const gain = pp - g.pos; if (gain > bestGain) { bestGain = gain; mover = g.abbr; } }
  });

  // ── HERO ──
  const dateStr = fmtDate(meta?.date || Date.now());
  const hero = `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:linear-gradient(135deg,#1a0306 0%,#0a0a0a 60%)">
      <tr><td style="padding:26px 28px 22px">
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%"><tr>
          <td style="font-size:12px;color:#E10600;letter-spacing:3px;font-weight:800">F1&nbsp;PREDICTOR</td>
          <td style="font-size:11px;color:#777;letter-spacing:2px;text-align:right">${meta?.season || SEASON}&nbsp;SEASON</td>
        </tr></table>
        <div style="font-size:11px;color:#888;letter-spacing:4px;text-transform:uppercase;margin-top:18px">Race Report</div>
        <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px"><tr>
          <td style="background:#E10600;color:#fff;font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 9px;border-radius:5px">ROUND&nbsp;${String(round).padStart(2,'0')}</td>
          <td style="width:10px"></td>
          <td style="font-size:26px;font-weight:800;color:#fff;line-height:1.1">${meta?.gp || `Round ${round}`}</td>
        </tr></table>
        <div style="font-size:13px;color:#9a9a9a;margin-top:10px">${meta?.flag || '🏁'} ${meta?.venue || ''}${dateStr ? ' &nbsp;·&nbsp; ' + dateStr : ''}</div>
      </td></tr>
    </table>`;

  // ── WINNER SPOTLIGHT ──
  const wColor = winner ? color(winner.abbr) : '#FF8000';
  const wInfo  = winner ? info(winner.abbr) : {};
  const aiTie  = (wInfo.winProb != null)
    ? `<div style="font-size:11px;color:#777">AI WIN CHANCE</div><div style="font-size:17px;color:#fff;font-weight:700;margin-top:2px">${wInfo.winProb}%</div>${wInfo.predPos ? `<div style="font-size:11px;color:#888;margin-top:2px">AI ranked them P${wInfo.predPos}</div>` : ''}`
    : `<div style="font-size:11px;color:#777">RESULT</div><div style="font-size:17px;color:#fff;font-weight:700;margin-top:2px">P1</div>`;
  const spotlight = winner ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:22px">
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:rgba(255,128,0,0.06);border:1px solid ${wColor}40;border-left:5px solid ${wColor};border-radius:10px">
        <tr><td style="padding:16px 18px">
          <div style="font-size:11px;color:${wColor};letter-spacing:2px;text-transform:uppercase;font-weight:800">🏆 Race Winner</div>
          <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-top:8px"><tr>
            <td>
              <span style="font-size:30px;font-weight:800;color:#fff;letter-spacing:1px">${winner.abbr}</span>
              ${wInfo.name ? `<span style="font-size:15px;color:#ccc;font-weight:600;margin-left:8px">${wInfo.name}</span>` : ''}
              ${wInfo.team ? `<div style="font-size:12px;color:${wColor};margin-top:3px;font-weight:600">${wInfo.team}</div>` : ''}
            </td>
            <td style="text-align:right;vertical-align:top">${aiTie}</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr></table>` : '';

  // ── PODIUM ──
  const podiumCells = podium.map((d, i) => `
    <td style="padding:14px 6px;background:rgba(255,255,255,0.03);border-radius:8px;text-align:center;border-top:3px solid ${color(d.abbr)}">
      <div style="font-size:24px;margin-bottom:6px">${medals[i]}</div>
      <div style="font-weight:800;font-size:18px;color:#fff;letter-spacing:1px">${d.abbr}</div>
      <div style="font-size:11px;color:#aaa;margin-top:3px">${info(d.abbr).name || ''}</div>
      <div style="font-size:10px;color:${color(d.abbr)};margin-top:2px">${info(d.abbr).team || ''}</div>
    </td>`).join('<td style="width:8px"></td>');
  const podiumBlock = `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:24px">
      <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Podium</div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%"><tr>${podiumCells}</tr></table>
    </td></tr></table>`;

  // ── KEY STATS STRIP ──
  const stat = (val, label, c) => `
    <td style="width:33.3%;padding:14px 8px;background:rgba(255,255,255,0.03);border-radius:8px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:${c}">${val}</div>
      <div style="font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:4px">${label}</div>
    </td>`;
  const accColor = accuracy == null ? '#777' : accuracy >= 70 ? '#00e676' : accuracy >= 40 ? '#FFD700' : '#E10600';
  const statsBlock = prediction ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:22px">
      <div style="font-size:11px;color:#c07aff;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;font-weight:700">🤖 AI Scorecard</div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%"><tr>
        ${stat(accuracy == null ? '—' : accuracy + '%', 'Accuracy', accColor)}
        <td style="width:8px"></td>
        ${stat(podiumHits + '/3', 'Podium Hits', podiumHits >= 2 ? '#00e676' : '#fff')}
        <td style="width:8px"></td>
        ${stat(mover ? '▲ ' + mover : exact + '/10', mover ? 'Biggest Riser' : 'Exact Spots', mover ? '#00e676' : '#fff')}
      </tr></table>
    </td></tr></table>` : '';

  // ── PREDICTED vs ACTUAL ──
  const col = (title, rows) => `
    <td style="width:50%;vertical-align:top;padding:0 6px">
      <div style="font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;text-align:center">${title}</div>
      ${rows}
    </td>`;
  const predRows = predAbbr.slice(0, 5).map((a, i) => {
    const hit = actTop3.includes(a) && i < 3;
    return `<div style="padding:7px 10px;margin-bottom:5px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:13px;color:#ddd"><span style="color:#666">P${i+1}</span> &nbsp;<strong style="color:#fff">${a}</strong>${hit ? ' <span style="color:#00e676">✓</span>' : ''}</div>`;
  }).join('');
  const actRows = actAbbr.slice(0, 5).map((a, i) => {
    const predicted = predAbbr.includes(a);
    return `<div style="padding:7px 10px;margin-bottom:5px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid ${color(a)};font-size:13px;color:#ddd"><span style="color:#666">P${i+1}</span> &nbsp;<strong style="color:#fff">${a}</strong>${predicted ? '' : ' <span style="color:#E10600;font-size:10px">NEW</span>'}</div>`;
  }).join('');
  const vsBlock = prediction ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:24px">
      <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Predicted vs Actual</div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%"><tr>
        ${col('🔮 AI Predicted', predRows)}
        ${col('🏁 Actual Top 5', actRows)}
      </tr></table>
    </td></tr></table>` : '';

  // ── FULL TOP 10 ──
  const top10Rows = top10.map((d) => `
    <tr>
      <td style="padding:9px 10px;font-weight:800;color:${color(d.abbr)};width:42px;font-size:13px">P${d.pos}</td>
      <td style="padding:9px 10px;font-weight:700;color:#fff;font-size:13px;width:56px">${d.abbr}</td>
      <td style="padding:9px 10px;color:#bbb;font-size:12px">${info(d.abbr).name || ''}</td>
      <td style="padding:9px 10px;color:#888;font-size:11px;text-align:right">${info(d.abbr).team || ''}</td>
    </tr>`).join('');
  const top10Block = `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:24px">
      <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Top 10 Finish</div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-collapse:collapse;background:rgba(255,255,255,0.02);border-radius:8px;overflow:hidden">${top10Rows}</table>
    </td></tr></table>`;

  // ── NEXT RACE TEASER ──
  const nextBlock = nextRace ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding-top:26px">
      <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:linear-gradient(135deg,rgba(225,6,0,0.12),rgba(192,122,255,0.08));border:1px solid #333;border-radius:10px">
        <tr><td style="padding:18px 20px">
          <div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase">Up Next · Round ${nextRace.round}</div>
          <div style="font-size:19px;font-weight:800;color:#fff;margin-top:6px">${nextRace.flag} ${nextRace.gp}</div>
          <div style="font-size:12px;color:#999;margin-top:3px">${nextRace.venue} · ${fmtDate(nextRace.date)}</div>
          <a href="${APP}" style="display:inline-block;margin-top:14px;background:#E10600;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:1px;font-size:12px">Generate Prediction →</a>
        </td></tr>
      </table>
    </td></tr></table>` : '';

  // ── FOOTER ──
  const footer = `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;padding:0 28px"><tr><td style="padding:30px 0 26px;text-align:center">
      <a href="${APP}" style="display:inline-block;background:#1a1a1a;border:1px solid #333;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:1.5px;font-size:13px">Open Full App →</a>
      <div style="font-size:11px;color:#666;margin-top:20px">You're subscribed to F1 Predictor race reports.</div>
      <div style="font-size:11px;color:#666;margin-top:4px"><a href="%%UNSUB_URL%%" style="color:#888">Unsubscribe</a></div>
      <div style="font-size:10px;color:#444;margin-top:14px">© 2026 F1 Predictor · AI race forecasting</div>
    </td></tr></table>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${meta?.gp || 'Race'} Report</title></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff">
  <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;margin:0 auto;background:#0a0a0a">
    <tr><td style="padding:0">
      ${hero}${spotlight}${podiumBlock}${statsBlock}${vsBlock}${top10Block}${nextBlock}${footer}
    </td></tr>
  </table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — accepts CRON_SECRET (which you already have set in Vercel)
  const auth = req.headers.authorization || '';
  const triggerKey = req.body?.key || req.query?.key || '';
  const expected = process.env.CRON_SECRET || process.env.NEWSLETTER_TRIGGER_KEY;
  if (expected && triggerKey !== expected && !auth.includes(expected)) {
    return res.status(401).json({ error: 'Unauthorized — pass key in body or as query ?key=' });
  }

  // Brevo only — no domain verification needed, free tier sends to any subscriber
  const BREVO_KEY  = process.env.BREVO_API_KEY;
  const SB_URL = process.env.SB_URL || 'https://zeqxzyisqwemqsvspbyj.supabase.co';
  const SB_KEY = process.env.SB_SERVICE_KEY;   // subscribers are only readable with the server key
  const FROM_EMAIL = process.env.NEWSLETTER_FROM_EMAIL || 'ahmoudy365@gmail.com';
  const FROM_NAME  = process.env.NEWSLETTER_FROM_NAME  || 'F1 Predictor';

  if (!BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY not set in Vercel env vars' });
  if (!SB_KEY)    return res.status(500).json({ error: 'SB_SERVICE_KEY not set in Vercel env vars' });

  try {
    const sbHeaders = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` };
    const cal = await loadSeason();
    SEASON = cal.season;
    CALENDAR = cal.races.map(r => ({ round: r.round, id: r.circuitId, gp: r.name, flag: r.flag, venue: r.circuit, date: r.date, season: r.season }));

    // Which race: the most recent finished one on the calendar (or ?circuit=<id>).
    const today = new Date().toISOString().slice(0, 10);
    const wanted = String(req.query?.circuit || req.body?.circuit || '');
    const meta = wanted ? metaForCircuit(wanted)
                        : CALENDAR.filter(c => c.date <= today).sort((a, b) => b.round - a.round)[0];
    if (!meta) return res.status(404).json({ error: 'Unknown race' });

    // Its result: newest Race row for that circuit with a usable grid.
    const sessR = await fetch(`${SB_URL}/rest/v1/sessions?session_name=eq.Race&year=eq.${SEASON}&circuit_id=eq.${meta.id}&order=fetched_at.desc&limit=5`, { headers: sbHeaders });
    const sess = ((await sessR.json()) || []).find(r => (r.grid_data || []).filter(g => g.abbr && g.pos).length >= 10);
    if (!sess) return res.status(404).json({ error: `No race result saved yet for ${meta.gp}` });
    const grid = (sess.grid_data || []).filter(g => g.abbr && g.pos).sort((x, y) => x.pos - y.pos);

    // The AI's final pre-race prediction for this race (baselines don't count as AI).
    const predR = await fetch(`${SB_URL}/rest/v1/predictions?circuit_id=eq.${meta.id}&round=eq.${meta.round}&pred_type=eq.race&stage=neq.final&hidden=eq.false&select=stage,prediction,accuracy`, { headers: sbHeaders });
    const best = ((await predR.json()) || [])
      .filter(p => p.prediction?.top10?.length && !p.prediction._fallback)
      .sort((x, y) => (PRE_RACE_STAGES.indexOf(x.stage) + 1 || 50) - (PRE_RACE_STAGES.indexOf(y.stage) + 1 || 50))[0];
    const prediction = best?.prediction || null;
    const accuracy = prediction
      ? (best.accuracy ?? calcAccuracy(prediction.top10.map(p => String(p.abbr || '').toUpperCase()), grid.map(g => g.abbr)))
      : null;

    // Driver names + teams from the official standings.
    const roster = {};
    try {
      const js = await fetch(`https://api.jolpi.ca/ergast/f1/${SEASON}/driverstandings.json?limit=40`, { signal: AbortSignal.timeout(6000) });
      (await js.json())?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.forEach(e => {
        if (e.Driver?.code) roster[e.Driver.code] = { name: `${e.Driver.givenName} ${e.Driver.familyName}`, team: e.Constructors?.[0]?.name || '' };
      });
    } catch { /* names fall back to the prediction */ }

    // Get subscribers
    const subR = await fetch(`${SB_URL}/rest/v1/subscribers?active=eq.true&select=id,email`, { headers: sbHeaders });
    const subs = await subR.json();
    if (!Array.isArray(subs)) return res.status(502).json({ error: 'Could not read subscribers' });
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'No active subscribers' });

    const nextRace = metaForRound(meta.round + 1);
    const raceName = meta.gp;
    const html = buildEmailHtml({ meta, round: meta.round, grid, prediction, accuracy, nextRace, roster });
    const APP = 'https://f1-predictor-theta.vercel.app';
    const unsubUrl = id => { try { return `${APP}/api/unsubscribe?id=${id}&t=${unsubToken(id)}`; } catch { return `${APP}/?unsubscribe=1`; } };

    const winnerAbbr = grid[0]?.abbr;
    const subject = winnerAbbr ? `🏁 ${raceName}: ${winnerAbbr} wins — full race report` : `🏁 ${raceName} — race report`;

    // ?preview=1 (from the admin page): return the email instead of sending it.
    if (req.query?.preview === '1' || req.body?.preview === true) {
      return res.status(200).json({ ok: true, preview: true, subject, race: raceName, round: meta.round, circuit: meta.id,
        recipients: subs.length, html: html.replace('%%UNSUB_URL%%', '#') });
    }

    // Send via Brevo — free tier sends to any subscriber, no domain needed
    let sent = 0, failed = 0;
    const errors = [];

    for (const s of subs) {
      try {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': BREVO_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: FROM_NAME, email: FROM_EMAIL },
            to: [{ email: s.email }],
            subject,
            htmlContent: html.replace('%%UNSUB_URL%%', unsubUrl(s.id)),
            headers: { 'List-Unsubscribe': `<${unsubUrl(s.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          }),
        });
        if (r.ok) sent++;
        else { failed++; errors.push({ email: s.email, status: r.status, body: (await r.text()).slice(0, 200) }); }
      } catch (e) { failed++; errors.push({ email: s.email, error: e.message }); }
    }

    // Keep a record for the admin page ("was the Singapore report sent?").
    await fetch(`${SB_URL}/rest/v1/newsletter_log`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ circuit_id: meta.id, round: meta.round, season: SEASON, sent, failed }),
    }).catch(() => {});

    res.status(200).json({
      ok: true,
      sent, failed, total: subs.length,
      race: raceName,
      round: meta.round,
      aiPrediction: prediction ? (best.stage || 'yes') : 'none (no AI prediction for this race)',
      provider: 'brevo',
      ...(errors.length ? { errors } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

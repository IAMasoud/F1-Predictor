/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// The race report email, sent to subscribers through Brevo. Needs the CRON_SECRET.
//   ?preview=1            build it and return the HTML (admin page)
//   ?test=1  {to}         send it to one address only, never logged (admin page)
//   (no flag)             send to every subscriber; refuses a race already sent unless &force=1
//   ?mode=auto            hourly from pg_cron: sends the latest race once, after the result is
//                         in and the AI's call is scored. The live bridge's trigger lands here too.
import { unsubToken } from './_guard.js';
import { loadSeason, sessionEndMs, FALLBACK_SEASON } from '../season.js';

export const config = { maxDuration: 60 };

const APP = 'https://f1-predictor-theta.vercel.app';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 'final' snapshots are made after the race, so they never count as the AI's call.
const PRE_RACE_STAGES = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];
const HOUR = 3600e3;

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
function normalizeTeam(name = '') {
  const k = name.toLowerCase().replace(/[\s-]+/g, '_').replace(/_f1_team$/, '');
  return TEAM_COLORS[k] ? k : (
    k.includes('mercedes') ? 'mercedes' : k.includes('ferrari') ? 'ferrari' :
    k.includes('mclaren') ? 'mclaren' : k.includes('red_bull') ? 'red_bull' :
    k.includes('williams') ? 'williams' : k.includes('aston') ? 'aston_martin' :
    k.includes('alpine') ? 'alpine' : k.includes('racing_bulls') || k.includes('vcarb') ? 'racing_bulls' :
    k.includes('audi') || k.includes('sauber') ? 'audi' : k.includes('haas') ? 'haas' :
    k.includes('cadillac') ? 'cadillac' : 'unknown'
  );
}
const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch { return ''; } };

/* The email, in the site's Lights Out style: black ground, start-light red, no gradients.
   Built from tables with inline styles so it holds up in Gmail, Outlook and Apple Mail. */
function buildEmailHtml({ race, season, grid, prediction, accuracy, stage, nextRace, roster = {} }) {
  const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  const COND = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  const predList = (prediction?.top10 || []).map(p => ({ pos: Number(p.pos), abbr: String(p.abbr || '').toUpperCase(), name: p.name, team: p.team, winProb: Number(p.winProb) || null }))
    .filter(p => p.abbr).sort((a, b) => a.pos - b.pos);
  const order = (grid || []).filter(g => g.abbr && g.pos).map(g => ({ pos: Number(g.pos), abbr: String(g.abbr).toUpperCase() })).sort((x, y) => x.pos - y.pos);
  const who = a => roster[a] || predList.find(p => p.abbr === a) || {};
  const nameOf = a => who(a).name || a;
  const surname = a => String(nameOf(a)).split(' ').slice(-1)[0];
  const color = a => TEAM_COLORS[normalizeTeam(who(a).team || '')] || '#8c8c8c';
  const slash = a => `<span style="display:inline-block;width:4px;height:16px;background:${color(a)};transform:skewX(-18deg);vertical-align:-2px;margin-right:8px"></span>`;

  const act = order.map(g => g.abbr), pred = predList.map(p => p.abbr);
  const winner = order[0]?.abbr || null;
  const aiPick = predList[0] || null;
  const podiumHits = pred.slice(0, 3).filter(a => act.slice(0, 3).includes(a)).length;
  let exact = 0, close = 0;
  pred.slice(0, 10).forEach((a, i) => { if (act[i] === a) exact++; else { const j = act.indexOf(a); if (j >= 0 && Math.abs(j - i) <= 2) close++; } });
  const mark = (a, i) => act[i] === a ? 'exact' : (act.indexOf(a) >= 0 && Math.abs(act.indexOf(a) - i) <= 2) ? 'close' : 'miss';
  const lamp = kind => kind === 'exact'
    ? '<span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#ff2a2a"></span>'
    : kind === 'close'
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:6px;border:2px solid #ff2a2a"></span>'
      : '<span style="display:inline-block;width:10px;height:10px;border-radius:6px;background:#2a2a2d"></span>';

  const wrap = inner => `<tr><td style="padding:0 24px">${inner}</td></tr>`;
  const label = t => `<div style="font:600 11px ${FONT};letter-spacing:2px;text-transform:uppercase;color:#949494;margin:28px 0 10px">${t}</div>`;

  const head = `
    <tr><td style="padding:26px 24px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="font:700 12px ${FONT};letter-spacing:3px;color:#ffffff"><span style="color:#ff2a2a">&#9679;&#9679;&#9679;&#9679;</span><span style="color:#3a3a3e">&#9679;</span>&nbsp; F1 PREDICTOR</td>
        <td align="right" style="font:500 12px ${FONT};color:#949494">${season} season · round ${race.round}</td>
      </tr></table>
      <div style="font:600 11px ${FONT};letter-spacing:2px;text-transform:uppercase;color:#ff2a2a;margin-top:26px">Race report</div>
      <div style="font:italic 800 34px/1.02 ${COND};text-transform:uppercase;color:#ffffff;margin-top:6px">${esc(race.name)}</div>
      <div style="font:500 14px ${FONT};color:#b4b4b4;margin-top:8px">${esc(race.circuit || '')} · ${esc(fmtDate(race.date))}</div>
    </td></tr>`;

  const winnerBlock = winner ? wrap(`${label('Winner')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#111113;border-radius:10px"><tr>
      <td style="padding:16px 18px">
        <div style="font:italic 800 40px/1 ${COND};text-transform:uppercase;color:#ffffff">${slash(winner)}${esc(surname(winner))}</div>
        <div style="font:500 14px ${FONT};color:#b4b4b4;margin-top:6px">${esc(who(winner).team || '')}</div>
      </td>
      <td align="right" style="padding:16px 18px;font:500 13px ${FONT};color:#b4b4b4;vertical-align:top">${aiPick ? `The AI picked<br><b style="font:italic 800 22px ${COND};color:#ffffff">${esc(aiPick.abbr)}${aiPick.winProb ? ` ${aiPick.winProb}%` : ''}</b>` : ''}</td>
    </tr></table>`) : '';

  const score = prediction ? wrap(`${label(`How the AI did${stage ? ` · its last call before the race` : ''}`)}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      ${[[accuracy == null ? '—' : `${accuracy}%`, 'Score'], [`${podiumHits}/3`, 'Podium places'], [`${exact}`, 'Exact places'], [`${close}`, 'Within two']].map(([v, l], i) =>
        `<td width="25%" style="background:#111113;border-radius:10px;padding:12px 12px;${i ? 'border-left:6px solid #070708;' : ''}">
          <div style="font:italic 800 28px/1 ${COND};color:#ffffff">${v}</div>
          <div style="font:500 12px ${FONT};color:#949494;margin-top:6px">${l}</div></td>`).join('')}
    </tr></table>`) : wrap(`${label('How the AI did')}<div style="font:500 14px ${FONT};color:#b4b4b4">The AI had no call saved before this race, so there is nothing to score.</div>`);

  const vs = prediction && order.length ? wrap(`${label('The AI called · what happened')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
      ${pred.slice(0, 10).map((a, i) => `<tr>
        <td width="34" style="padding:8px 0;border-bottom:1px solid #222225;font:italic 800 18px ${COND};color:#ffffff">${i + 1}</td>
        <td style="padding:8px 0;border-bottom:1px solid #222225;font:italic 800 18px ${COND};color:#ffffff">${slash(a)}${esc(a)}</td>
        <td width="30" align="center" style="padding:8px 0;border-bottom:1px solid #222225">${lamp(mark(a, i))}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #222225;font:italic 800 18px ${COND};color:#ffffff">${act[i] ? `${esc(act[i])}` : '—'}</td>
      </tr>`).join('')}
    </table>
    <div style="font:500 12px ${FONT};color:#949494;margin-top:8px">${lamp('exact')} exact place &nbsp; ${lamp('close')} within two places &nbsp; ${lamp('miss')} missed</div>`) : '';

  const top10 = order.length ? wrap(`${label('Top 10')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
      ${order.slice(0, 10).map(g => `<tr>
        <td width="34" style="padding:7px 0;border-bottom:1px solid #222225;font:italic 800 17px ${COND};color:#ffffff">${g.pos}</td>
        <td style="padding:7px 0;border-bottom:1px solid #222225;font:600 14px ${FONT};color:#ffffff">${slash(g.abbr)}${esc(nameOf(g.abbr))}</td>
        <td align="right" style="padding:7px 0;border-bottom:1px solid #222225;font:500 13px ${FONT};color:#949494">${esc(who(g.abbr).team || '')}</td>
      </tr>`).join('')}
    </table>`) : '';

  const next = nextRace ? wrap(`${label(`Up next · round ${nextRace.round}`)}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#111113;border-radius:10px"><tr><td style="padding:16px 18px">
      <div style="font:italic 800 26px/1.05 ${COND};text-transform:uppercase;color:#ffffff">${esc(nextRace.name)}</div>
      <div style="font:500 13px ${FONT};color:#b4b4b4;margin-top:6px">${esc(nextRace.circuit || '')} · ${esc(fmtDate(nextRace.date))}</div>
      <a href="${APP}" style="display:inline-block;margin-top:14px;background:#e01e1e;color:#ffffff;text-decoration:none;font:700 14px ${FONT};letter-spacing:.5px;text-transform:uppercase;padding:11px 20px;border-radius:8px">See the AI's next call</a>
    </td></tr></table>`) : '';

  const foot = `<tr><td style="padding:30px 24px 30px;font:500 12px/1.6 ${FONT};color:#949494">
      You get this because you joined the F1 Predictor race reports.<br>
      <a href="%%UNSUB_URL%%" style="color:#b4b4b4">Unsubscribe</a> &nbsp;·&nbsp; <a href="${APP}" style="color:#b4b4b4">Open the app</a>
    </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">
<title>${esc(race.name)} race report</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#070708">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#070708"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#070708">
      ${head}${winnerBlock}${score}${vs}${top10}${next}${foot}
    </table>
  </td></tr></table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })() : (req.body || {});
  const auth = req.headers.authorization || '';
  const triggerKey = body.key || req.query?.key || '';
  const expected = process.env.CRON_SECRET || process.env.NEWSLETTER_TRIGGER_KEY;
  if (!expected || (triggerKey !== expected && auth !== `Bearer ${expected}`)) return res.status(401).json({ error: 'Unauthorized' });

  const preview = req.query?.preview === '1' || body.preview === true;
  const test = req.query?.test === '1';
  // The live bridge posts { key, race } when the flag falls; it is handled like the hourly check.
  const auto = req.query?.mode === 'auto' || (!!body.race && !preview && !test);
  const force = req.query?.force === '1';

  const BREVO_KEY = process.env.BREVO_API_KEY;
  const SB_URL = process.env.SB_URL || 'https://zeqxzyisqwemqsvspbyj.supabase.co';
  const SB_KEY = process.env.SB_SERVICE_KEY;
  const FROM_EMAIL = process.env.NEWSLETTER_FROM_EMAIL || 'ahmoudy365@gmail.com';
  const FROM_NAME = process.env.NEWSLETTER_FROM_NAME || 'F1 Predictor';
  if (!SB_KEY) return res.status(500).json({ error: 'SB_SERVICE_KEY not set' });
  if (!preview && !BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY not set' });

  const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
  const sbGet = async path => { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbH, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; };

  try {
    const { season = FALLBACK_SEASON, races } = await loadSeason();
    const now = Date.now();
    const endOf = r => sessionEndMs(r, 'race') ?? Date.parse(`${r.date}T23:59:00Z`);

    // Which race: ?circuit=<id>, or the most recent one that has finished.
    const wanted = String(req.query?.circuit || body.circuit || '');
    const race = wanted ? races.find(r => r.circuitId === wanted) : [...races].reverse().find(r => endOf(r) <= now);
    if (!race) return res.status(404).json({ error: 'Unknown race' });
    const ended = endOf(race);

    const sends = await sbGet(`newsletter_log?season=eq.${season}&round=eq.${race.round}&select=id,ts,sent,kind&order=ts.desc`);
    const done = (sends || []).find(s => s.sent > 0);
    if (auto) {
      const skip = why => res.status(200).json({ ok: true, skipped: why, race: race.name });
      if (now - ended < 1.5 * HOUR) return skip('the race finished less than 90 minutes ago');
      if (now - ended > 3 * 24 * HOUR) return skip('the race is more than three days old');
      if (done || (sends || []).some(s => s.kind === 'auto')) return skip('already sent');
    }

    // The result: newest Race row for that circuit with a usable grid.
    const rows = await sbGet(`sessions?session_name=eq.Race&year=eq.${season}&circuit_id=eq.${race.circuitId}&order=fetched_at.desc&limit=5`);
    const sess = (rows || []).find(r => (r.grid_data || []).filter(g => g.abbr && g.pos).length >= 10);
    if (!sess) return auto ? res.status(200).json({ ok: true, skipped: 'no result saved yet', race: race.name })
      : res.status(404).json({ error: `No race result saved yet for the ${race.name}` });
    const grid = (sess.grid_data || []).filter(g => g.abbr && g.pos).sort((x, y) => x.pos - y.pos);

    // The AI's last call before the race (baselines don't count as the AI).
    const preds = await sbGet(`predictions?circuit_id=eq.${race.circuitId}&round=eq.${race.round}&pred_type=eq.race&stage=neq.final&hidden=eq.false&select=stage,prediction,accuracy`);
    const best = (preds || []).filter(p => p.prediction?.top10?.length && !p.prediction._fallback)
      .sort((x, y) => (PRE_RACE_STAGES.indexOf(x.stage) + 1 || 50) - (PRE_RACE_STAGES.indexOf(y.stage) + 1 || 50))[0];
    const prediction = best?.prediction || null;
    // Wait for the scoring job (official result) for up to 8 hours before sending on our own numbers.
    if (auto && prediction && best.accuracy == null && now - ended < 8 * HOUR) return res.status(200).json({ ok: true, skipped: 'waiting for the official score', race: race.name });
    const accuracy = prediction
      ? (best.accuracy ?? calcAccuracy(prediction.top10.map(p => String(p.abbr || '').toUpperCase()), grid.map(g => g.abbr)))
      : null;

    // Driver names + teams from the official standings.
    const roster = {};
    try {
      const js = await fetch(`https://api.jolpi.ca/ergast/f1/${season}/driverstandings.json?limit=40`, { signal: AbortSignal.timeout(6000) });
      (await js.json())?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.forEach(e => {
        if (e.Driver?.code) roster[e.Driver.code] = { name: `${e.Driver.givenName} ${e.Driver.familyName}`, team: e.Constructors?.[0]?.name || '' };
      });
    } catch { /* names fall back to the prediction */ }

    const nextRace = races.find(r => r.round === race.round + 1) || null;
    const html = buildEmailHtml({ race, season, grid, prediction, accuracy, stage: best?.stage, nextRace, roster });
    const winnerName = roster[grid[0]?.abbr]?.name?.split(' ').slice(-1)[0] || grid[0]?.abbr;
    const subject = `${race.name}: ${winnerName} wins${accuracy != null ? ` · the AI scored ${accuracy}%` : ''}`;

    const subs = test ? [] : await sbGet('subscribers?active=eq.true&select=id,email');
    if (!Array.isArray(subs)) return res.status(502).json({ error: 'Could not read subscribers' });

    if (preview) {
      return res.status(200).json({ ok: true, preview: true, subject, race: race.name, round: race.round, circuit: race.circuitId,
        recipients: subs.length, sent: done ? { ts: done.ts, sent: done.sent, kind: done.kind } : null, html: html.replace('%%UNSUB_URL%%', '#') });
    }
    if (!test && done && !auto && !force) {
      return res.status(409).json({ error: 'already sent', alreadySent: { ts: done.ts, sent: done.sent, kind: done.kind }, race: race.name });
    }

    const unsubUrl = id => { try { return `${APP}/api/unsubscribe?id=${id}&t=${unsubToken(id)}`; } catch { return `${APP}/?unsubscribe=1`; } };
    const sendOne = async (to, unsub, subj) => {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: FROM_EMAIL }, to: [{ email: to }], subject: subj,
          htmlContent: html.replace('%%UNSUB_URL%%', unsub),
          ...(unsub.startsWith(`${APP}/api/`) ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
    };

    if (test) {
      const to = String(body.to || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) return res.status(400).json({ error: 'No test address' });
      try { await sendOne(to, `${APP}/?unsubscribe=1`, `[Test] ${subject}`); }
      catch (e) { return res.status(502).json({ error: `Brevo refused the test: ${e.message}` }); }
      return res.status(200).json({ ok: true, test: true, to, race: race.name });
    }
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'No active subscribers' });

    // Automatic sends claim the race first, so two triggers can never both send it.
    let claim = null;
    if (auto) {
      const r = await fetch(`${SB_URL}/rest/v1/newsletter_log`, {
        method: 'POST', headers: { ...sbH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ circuit_id: race.circuitId, round: race.round, season, sent: 0, failed: 0, kind: 'auto' }),
      });
      if (r.status === 409) return res.status(200).json({ ok: true, skipped: 'already being sent', race: race.name });
      if (!r.ok) return res.status(502).json({ error: 'Could not record the send' });
      claim = (await r.json())?.[0] || null;
    }

    let sent = 0, failed = 0;
    const errors = [];
    for (const s of subs) {
      try { await sendOne(s.email, unsubUrl(s.id), subject); sent++; }
      catch (e) { failed++; errors.push({ id: s.id, error: e.message }); }
    }

    // Keep a record for the admin page ("was the Singapore report sent?").
    if (claim) {
      await fetch(`${SB_URL}/rest/v1/newsletter_log?id=eq.${claim.id}`, {
        method: 'PATCH', headers: { ...sbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ sent, failed }),
      }).catch(() => {});
    } else {
      await fetch(`${SB_URL}/rest/v1/newsletter_log`, {
        method: 'POST', headers: { ...sbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ circuit_id: race.circuitId, round: race.round, season, sent, failed, kind: 'manual' }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, sent, failed, total: subs.length, race: race.name, round: race.round, auto,
      aiPrediction: prediction ? best.stage : 'none', ...(errors.length ? { errors } : {}) });
  } catch (err) {
    console.warn('[newsletter]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

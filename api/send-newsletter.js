/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// Sends race-weekend report emails to all subscribers via Resend.
// Triggered automatically by the live bridge when the race ends,
// or manually via Vercel dashboard / curl for testing.
export const config = { maxDuration: 30 };

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

function buildEmailHtml(race, grid, prediction, accuracy) {
  const podium = grid.slice(0, 3);
  const top10  = grid.slice(0, 10);
  const dnfs   = grid.filter(g => g.retired);
  const podiumHtml = podium.map((d, i) => {
    const teamKey = normalizeTeam(d.team || '');
    const color = TEAM_COLORS[teamKey] || '#888';
    const medals = ['🥇', '🥈', '🥉'];
    return `<td style="padding:14px;background:rgba(255,255,255,0.03);border-radius:8px;text-align:center;border-left:4px solid ${color};font-family:Arial,sans-serif">
      <div style="font-size:24px;margin-bottom:6px">${medals[i]}</div>
      <div style="font-weight:700;font-size:18px;color:#fff;letter-spacing:1px">${d.abbr}</div>
      <div style="font-size:11px;color:#aaa;margin-top:2px">${d.name || ''}</div>
    </td>`;
  }).join('<td style="width:8px"></td>');

  const top10Rows = top10.map((d, i) => {
    const teamKey = normalizeTeam(d.team || '');
    const color = TEAM_COLORS[teamKey] || '#888';
    return `<tr>
      <td style="padding:8px 6px;font-weight:700;color:${color};width:36px">P${i+1}</td>
      <td style="padding:8px 6px;font-weight:600;color:#fff">${d.abbr}</td>
      <td style="padding:8px 6px;color:#aaa;font-size:12px">${d.name || ''}</td>
      <td style="padding:8px 6px;color:#888;font-size:12px;text-align:right">${d.team || ''}</td>
    </tr>`;
  }).join('');

  const aiBlock = (prediction && accuracy !== null) ? `
    <table cellpadding="0" cellspacing="0" style="width:100%;background:rgba(192,122,255,0.08);border:1px solid rgba(192,122,255,0.3);border-radius:10px;margin:20px 0;padding:16px">
      <tr><td>
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#c07aff;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">🤖 AI Prediction vs Reality</div>
        <div style="font-size:32px;font-weight:700;color:#c07aff;margin-top:6px">${accuracy}% accuracy</div>
        <div style="font-size:12px;color:#aaa;margin-top:4px">AI predicted top 3: ${(prediction.top10 || []).slice(0,3).join(' · ')}</div>
      </td></tr>
    </table>` : '';

  const dnfBlock = dnfs.length ? `
    <div style="margin-top:24px;padding:14px;background:rgba(225,6,0,0.06);border-left:3px solid #E10600;border-radius:6px">
      <div style="font-size:11px;color:#E10600;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:6px">DNFs (${dnfs.length})</div>
      <div style="font-size:13px;color:#ccc">${dnfs.map(d => `${d.abbr} (lap ${d.lap})`).join(' · ')}</div>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${race.name} Report</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff">
  <table cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;padding:30px 20px">
    <tr><td>
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:11px;color:#E10600;letter-spacing:3px;font-weight:700">F1 PREDICTOR · 2026 SEASON</div>
        <div style="font-size:26px;font-weight:700;margin-top:8px;color:#fff">${race.name}</div>
        <div style="font-size:13px;color:#888;margin-top:4px">Race Result · ${new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'})}</div>
      </div>

      <div style="text-align:center;font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">🏆 Podium</div>
      <table cellpadding="0" cellspacing="0" style="width:100%"><tr>${podiumHtml}</tr></table>

      ${aiBlock}

      <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin:28px 0 10px">Top 10 Finish</div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${top10Rows}</table>

      ${dnfBlock}

      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #222;text-align:center">
        <a href="https://f1-predictor-theta.vercel.app/" style="display:inline-block;background:#E10600;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:1.5px;font-size:13px">Open Full App →</a>
        <div style="font-size:11px;color:#666;margin-top:20px">You're subscribed to F1 Predictor race reports.</div>
        <div style="font-size:11px;color:#666;margin-top:4px">
          <a href="https://f1-predictor-theta.vercel.app/?unsubscribe=1" style="color:#888">Unsubscribe</a>
        </div>
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
  const SB_URL = process.env.SB_URL || process.env.SUPABASE_URL || 'https://zeqxzyisqwemqsvspbyj.supabase.co';
  const SB_KEY = process.env.SB_SERVICE_KEY || process.env.SB_ANON_KEY || process.env.SUPABASE_KEY;
  const FROM_EMAIL = process.env.NEWSLETTER_FROM_EMAIL || 'ahmoudy365@gmail.com';
  const FROM_NAME  = process.env.NEWSLETTER_FROM_NAME  || 'F1 Predictor';

  if (!BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY not set in Vercel env vars' });
  if (!SB_KEY)    return res.status(500).json({ error: 'No Supabase key found (SB_SERVICE_KEY / SB_ANON_KEY / SUPABASE_KEY)' });

  try {
    // Find the most recent Race session row
    const sbHeaders = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` };
    const sessR = await fetch(`${SB_URL}/rest/v1/sessions?session_name=eq.Race&year=eq.2026&order=fetched_at.desc&limit=1`, { headers: sbHeaders });
    const sessRows = await sessR.json();
    if (!sessRows?.length) return res.status(404).json({ error: 'No Race row in Supabase yet' });
    const sess = sessRows[0];

    // Optional: pull the matching AI prediction + accuracy
    const predR = await fetch(`${SB_URL}/rest/v1/predictions?circuit_id=eq.${sess.circuit_id}&pred_type=eq.race&order=created_at.desc&limit=1`, { headers: sbHeaders });
    const predRows = await predR.json();
    const prediction = predRows?.[0]?.prediction || null;
    const accuracy   = predRows?.[0]?.accuracy ?? null;

    // Get subscribers
    const subR = await fetch(`${SB_URL}/rest/v1/subscribers?active=eq.true&select=email`, { headers: sbHeaders });
    const subs = await subR.json();
    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0, message: 'No active subscribers' });

    const race = { name: `Round ${sess.round} · ${sess.circuit_id.replace(/_/g,' ')}` };
    const html = buildEmailHtml(race, sess.grid_data || [], prediction, accuracy);

    // Send via Brevo — free tier sends to any subscriber, no domain needed
    let sent = 0, failed = 0;
    const errors = [];
    const subject = `🏁 ${race.name} — race result`;

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
            htmlContent: html,
          }),
        });
        if (r.ok) sent++;
        else { failed++; errors.push({ email: s.email, status: r.status, body: (await r.text()).slice(0, 200) }); }
      } catch (e) { failed++; errors.push({ email: s.email, error: e.message }); }
    }

    res.status(200).json({
      ok: true,
      sent, failed, total: subs.length,
      race: race.name,
      provider: 'brevo',
      ...(errors.length ? { errors } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

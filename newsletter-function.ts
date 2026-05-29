// Supabase Edge Function: send-newsletter
// Sends a race weekend report to all subscribers after each race
// Deploy to: Supabase → Edge Functions → New Function → "send-newsletter"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENF1 = 'https://api.openf1.org/v1';

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'F1 Predictor <races@yourdomain.com>';

  // Get latest scored prediction
  const { data: predictions } = await supabase
    .from('predictions')
    .select('*')
    .not('accuracy', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!predictions?.length) {
    return new Response(JSON.stringify({ ok: false, reason: 'No scored predictions yet' }));
  }

  const pred = predictions[0];
  const top10 = pred.prediction?.top10 || [];
  const actual = pred.actual_results || [];
  const accuracy = pred.accuracy;
  const raceName = pred.race_name || 'Latest Race';

  // Get subscribers
  const { data: subscribers } = await supabase
    .from('subscribers')
    .select('email')
    .eq('active', true);

  if (!subscribers?.length) {
    return new Response(JSON.stringify({ ok: false, reason: 'No subscribers' }));
  }

  // Driver name helpers
  const driverNames: Record<string, string> = {
    antonelli:'Andrea K. Antonelli', russell:'George Russell', leclerc:'Charles Leclerc',
    norris:'Lando Norris', hamilton:'Lewis Hamilton', piastri:'Oscar Piastri',
    max_verstappen:'Max Verstappen', bearman:'Oliver Bearman', colapinto:'Franco Colapinto',
    gasly:'Pierre Gasly', lawson:'Liam Lawson', sainz:'Carlos Sainz',
    lindblad:'Arvid Lindblad', hadjar:'Isack Hadjar', albon:'Alex Albon',
    bortoleto:'Gabriel Bortoleto', ocon:'Esteban Ocon', hulkenberg:'Nico Hülkenberg',
    bottas:'Valtteri Bottas', perez:'Sergio Pérez', alonso:'Fernando Alonso', stroll:'Lance Stroll',
  };
  const abbrs: Record<string, string> = {
    antonelli:'ANT', russell:'RUS', leclerc:'LEC', norris:'NOR', hamilton:'HAM',
    piastri:'PIA', max_verstappen:'VER', bearman:'BEA', colapinto:'COL', gasly:'GAS',
    lawson:'LAW', sainz:'SAI', lindblad:'LIN', hadjar:'HAD', albon:'ALB',
    bortoleto:'BOR', ocon:'OCO', hulkenberg:'HUL', bottas:'BOT', perez:'PER',
    alonso:'ALO', stroll:'STR',
  };
  const n = (id: string) => driverNames[id] || id;
  const a = (id: string) => abbrs[id] || id.toUpperCase().slice(0, 3);

  // Accuracy colour
  const accColour = accuracy >= 70 ? '#00e676' : accuracy >= 40 ? '#FFD700' : '#E10600';
  const accLabel = accuracy >= 80 ? 'Excellent' : accuracy >= 60 ? 'Good' : accuracy >= 40 ? 'Fair' : 'Poor';

  // Build comparison rows
  const rows = top10.slice(0, 10).map((d: any, i: number) => {
    const actualId = actual[i];
    const isMatch = d.driverId === actualId || a(d.driverId) === a(actualId || '');
    const bg = isMatch ? '#0d2318' : '#1a0d0d';
    const tick = isMatch ? '✓' : '✗';
    const tickCol = isMatch ? '#00e676' : '#E10600';
    return `
      <tr style="background:${bg}">
        <td style="padding:8px 12px;color:#555;font-family:monospace">P${i + 1}</td>
        <td style="padding:8px 12px;color:#aaa">🤖 ${d.name || n(d.driverId)}</td>
        <td style="padding:8px 12px;color:#888">🏁 ${n(actualId)}</td>
        <td style="padding:8px 12px;color:${tickCol};font-weight:700;text-align:center">${tick}</td>
      </tr>`;
  }).join('');

  // HTML email
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Helvetica Neue',Arial,sans-serif;color:#f0f0f0">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">

    <!-- Header -->
    <div style="border-bottom:2px solid #E10600;padding-bottom:16px;margin-bottom:24px;display:flex;align-items:center;gap:12px">
      <div style="font-size:36px;font-weight:900;color:#E10600;letter-spacing:-2px;line-height:1">F1</div>
      <div>
        <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#555">AI Race Predictor · 2026</div>
        <div style="font-size:11px;color:#444;margin-top:2px;letter-spacing:1px">POST-RACE REPORT</div>
      </div>
    </div>

    <!-- Race title -->
    <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;letter-spacing:1px">${raceName}</h1>
    <p style="color:#666;font-size:13px;margin:0 0 24px">Race weekend complete — here's how the AI performed.</p>

    <!-- Accuracy score -->
    <div style="background:#161616;border:1px solid #222;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
      <div style="font-size:64px;font-weight:900;color:${accColour};line-height:1">${accuracy}%</div>
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#666;margin-top:6px">${accLabel} AI Accuracy</div>
      <div style="display:flex;justify-content:center;gap:24px;margin-top:16px">
        <div style="text-align:center">
          <div style="font-size:22px;font-weight:700;color:#00e676">${top10.filter((d: any, i: number) => d.driverId === actual[i] || a(d.driverId) === a(actual[i] || '')).length}</div>
          <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">Exact Hits</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:22px;font-weight:700;color:#FFD700">${top10.filter((d: any, i: number) => {
            const ap = actual.findIndex((id: string) => id === d.driverId);
            return ap >= 0 && Math.abs(ap - i) <= 2 && ap !== i;
          }).length}</div>
          <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">Within ±2</div>
        </div>
      </div>
    </div>

    <!-- AI Predicted P1-P3 -->
    <div style="background:#161616;border:1px solid #222;border-radius:10px;padding:20px;margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#666;margin-bottom:14px;border-left:3px solid #E10600;padding-left:10px">🤖 AI Predicted Podium</div>
      ${top10.slice(0,3).map((d: any, i: number) => {
        const medals = ['🥇','🥈','🥉'];
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:18px">${medals[i]}</span>
          <span style="font-weight:700">${d.name || n(d.driverId)}</span>
          <span style="color:#666;font-size:12px;margin-left:auto">${d.winProb}% confidence</span>
        </div>`;
      }).join('')}
    </div>

    <!-- Actual Result P1-P3 -->
    <div style="background:#161616;border:1px solid #222;border-radius:10px;padding:20px;margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#666;margin-bottom:14px;border-left:3px solid #00e676;padding-left:10px">🏁 Actual Race Podium</div>
      ${actual.slice(0,3).map((id: string, i: number) => {
        const medals = ['🥇','🥈','🥉'];
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:18px">${medals[i]}</span>
          <span style="font-weight:700">${n(id)}</span>
        </div>`;
      }).join('')}
    </div>

    <!-- Full comparison table -->
    <div style="background:#161616;border:1px solid #222;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <div style="padding:14px 16px;border-bottom:1px solid #222;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#666">
        Full Top 10 Comparison
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#111">
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;letter-spacing:1px">Pos</th>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;letter-spacing:1px">AI Predicted</th>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;letter-spacing:1px">Actual</th>
            <th style="padding:8px 12px;text-align:center;color:#444;font-size:10px;letter-spacing:1px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:32px">
      <a href="https://f1-predictor-theta.vercel.app" style="display:inline-block;background:linear-gradient(135deg,#E10600,#c07aff);color:#fff;font-weight:700;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;padding:14px 32px;border-radius:8px;text-decoration:none">
        View Full Analysis →
      </a>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #1a1a1a;padding-top:16px;text-align:center;font-size:11px;color:#333;line-height:1.7">
      F1 AI Race Predictor 2026 · Powered by Llama 3.3 &amp; OpenF1<br>
      <a href="https://f1-predictor-theta.vercel.app" style="color:#444">f1-predictor-theta.vercel.app</a>
    </div>

  </div>
</body>
</html>`;

  // Send to all subscribers via Resend
  let sent = 0, failed = 0;
  for (const sub of subscribers) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: sub.email,
        subject: `🏎 ${raceName} — AI got ${accuracy}% right`,
        html,
      }),
    });
    if (res.ok) sent++; else failed++;
  }

  return new Response(
    JSON.stringify({ ok: true, sent, failed, race: raceName, accuracy }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

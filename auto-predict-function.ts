/**
 * AUTO-PREDICT EDGE FUNCTION
 * Runs every hour via Supabase cron.
 * If a race is 18–30 hours away and no prediction exists yet,
 * it builds the full AI prompt and calls OpenRouter to generate one,
 * then saves it to the predictions table.
 *
 * Deploy: supabase functions deploy auto-predict
 * Cron:   0 * * * *  (every hour)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENROUTER_KEY = Deno.env.get('OPENROUTER_KEY');
const JOLPI = 'https://api.jolpi.ca/ergast/f1';

/* ── Full 2026 calendar (22 rounds, Bahrain & Saudi cancelled) ── */
const CALENDAR_2026 = [
  { round:1,  name:'Australian Grand Prix',    circuitId:'albert_park',  date:'2026-03-08', circuit:'Albert Park Circuit',            type:'semi-street', sprint:false },
  { round:2,  name:'Chinese Grand Prix',       circuitId:'shanghai',     date:'2026-03-15', circuit:'Shanghai International Circuit', type:'balanced',    sprint:true  },
  { round:3,  name:'Japanese Grand Prix',      circuitId:'suzuka',       date:'2026-03-29', circuit:'Suzuka Circuit',                 type:'technical',   sprint:false },
  { round:4,  name:'Miami Grand Prix',         circuitId:'miami',        date:'2026-05-04', circuit:'Miami International Autodrome',  type:'semi-street', sprint:true  },
  { round:5,  name:'Canadian Grand Prix',      circuitId:'villeneuve',   date:'2026-05-24', circuit:'Circuit Gilles Villeneuve',      type:'semi-street', sprint:true  },
  { round:6,  name:'Monaco Grand Prix',        circuitId:'monaco',       date:'2026-06-07', circuit:'Circuit de Monaco',              type:'street',      sprint:false },
  { round:7,  name:'Spanish Grand Prix',       circuitId:'catalunya',    date:'2026-06-14', circuit:'Circuit de Barcelona-Catalunya', type:'balanced',    sprint:false },
  { round:8,  name:'Austrian Grand Prix',      circuitId:'red_bull_ring',date:'2026-06-28', circuit:'Red Bull Ring',                  type:'power',       sprint:false },
  { round:9,  name:'British Grand Prix',       circuitId:'silverstone',  date:'2026-07-05', circuit:'Silverstone Circuit',            type:'balanced',    sprint:true  },
  { round:10, name:'Belgian Grand Prix',       circuitId:'spa',          date:'2026-07-19', circuit:'Circuit de Spa-Francorchamps',   type:'power',       sprint:false },
  { round:11, name:'Hungarian Grand Prix',     circuitId:'hungaroring',  date:'2026-07-26', circuit:'Hungaroring',                    type:'technical',   sprint:false },
  { round:12, name:'Dutch Grand Prix',         circuitId:'zandvoort',    date:'2026-08-23', circuit:'Circuit Zandvoort',              type:'technical',   sprint:true  },
  { round:13, name:'Italian Grand Prix',       circuitId:'monza',        date:'2026-09-06', circuit:'Autodromo Nazionale Monza',      type:'power',       sprint:false },
  { round:14, name:'Madrid Grand Prix',        circuitId:'ifema_madrid', date:'2026-09-13', circuit:'IFEMA Madrid Street Circuit',    type:'street',      sprint:false },
  { round:15, name:'Azerbaijan Grand Prix',    circuitId:'baku',         date:'2026-09-26', circuit:'Baku City Circuit',              type:'street',      sprint:false },
  { round:16, name:'Singapore Grand Prix',     circuitId:'marina_bay',   date:'2026-10-11', circuit:'Marina Bay Street Circuit',      type:'street',      sprint:true  },
  { round:17, name:'United States Grand Prix', circuitId:'americas',     date:'2026-10-25', circuit:'Circuit of the Americas',        type:'balanced',    sprint:false },
  { round:18, name:'Mexico City Grand Prix',   circuitId:'rodriguez',    date:'2026-11-01', circuit:'Autodromo Hermanos Rodriguez',   type:'technical',   sprint:false },
  { round:19, name:'São Paulo Grand Prix',     circuitId:'interlagos',   date:'2026-11-08', circuit:'Autodromo Jose Carlos Pace',     type:'balanced',    sprint:false },
  { round:20, name:'Las Vegas Grand Prix',     circuitId:'las_vegas',    date:'2026-11-21', circuit:'Las Vegas Strip Circuit',        type:'power',       sprint:false },
  { round:21, name:'Qatar Grand Prix',         circuitId:'losail',       date:'2026-11-29', circuit:'Lusail International Circuit',   type:'power',       sprint:false },
  { round:22, name:'Abu Dhabi Grand Prix',     circuitId:'yas_marina',   date:'2026-12-06', circuit:'Yas Marina Circuit',             type:'technical',   sprint:false },
];

/* ── Current 2026 standings (updated after each race in BASE_DRIVERS) ── */
const DRIVER_STANDINGS = [
  { driverId:'antonelli',      name:'Andrea Kimi Antonelli', abbr:'ANT', team:'Mercedes',      pts:100 },
  { driverId:'russell',        name:'George Russell',         abbr:'RUS', team:'Mercedes',      pts:80  },
  { driverId:'leclerc',        name:'Charles Leclerc',        abbr:'LEC', team:'Ferrari',       pts:59  },
  { driverId:'norris',         name:'Lando Norris',           abbr:'NOR', team:'McLaren',       pts:51  },
  { driverId:'hamilton',       name:'Lewis Hamilton',         abbr:'HAM', team:'Ferrari',       pts:51  },
  { driverId:'piastri',        name:'Oscar Piastri',          abbr:'PIA', team:'McLaren',       pts:43  },
  { driverId:'max_verstappen', name:'Max Verstappen',         abbr:'VER', team:'Red Bull',      pts:26  },
  { driverId:'bearman',        name:'Oliver Bearman',         abbr:'BEA', team:'Haas',          pts:17  },
  { driverId:'gasly',          name:'Pierre Gasly',           abbr:'GAS', team:'Alpine',        pts:16  },
  { driverId:'lawson',         name:'Liam Lawson',            abbr:'LAW', team:'Racing Bulls',  pts:10  },
  { driverId:'colapinto',      name:'Franco Colapinto',       abbr:'COL', team:'Alpine',        pts:7   },
  { driverId:'lindblad',       name:'Arvid Lindblad',         abbr:'LIN', team:'Racing Bulls',  pts:4   },
  { driverId:'hadjar',         name:'Isack Hadjar',           abbr:'HAD', team:'Red Bull',      pts:4   },
  { driverId:'sainz',          name:'Carlos Sainz',           abbr:'SAI', team:'Williams',      pts:4   },
  { driverId:'bortoleto',      name:'Gabriel Bortoleto',      abbr:'BOR', team:'Audi',          pts:2   },
  { driverId:'ocon',           name:'Esteban Ocon',           abbr:'OCO', team:'Haas',          pts:1   },
  { driverId:'albon',          name:'Alex Albon',             abbr:'ALB', team:'Williams',      pts:1   },
  { driverId:'hulkenberg',     name:'Nico Hülkenberg',        abbr:'HUL', team:'Audi',          pts:0   },
  { driverId:'bottas',         name:'Valtteri Bottas',        abbr:'BOT', team:'Cadillac',      pts:0   },
  { driverId:'perez',          name:'Sergio Pérez',           abbr:'PER', team:'Cadillac',      pts:0   },
  { driverId:'alonso',         name:'Fernando Alonso',        abbr:'ALO', team:'Aston Martin',  pts:0   },
  { driverId:'stroll',         name:'Lance Stroll',           abbr:'STR', team:'Aston Martin',  pts:0   },
];

const COMPLETED_RESULTS = [
  { round:'1',  raceName:'Australian GP',     circuitId:'albert_park', results:['russell','antonelli','leclerc','hamilton','norris','max_verstappen','bearman','lindblad','bortoleto','gasly'] },
  { round:'2S', raceName:'Chinese GP Sprint', circuitId:'shanghai',    results:['russell','leclerc','hamilton','norris','antonelli','piastri','lawson','bearman'] },
  { round:'2',  raceName:'Chinese GP',        circuitId:'shanghai',    results:['antonelli','russell','hamilton','leclerc','bearman','gasly','lawson','hadjar','sainz','colapinto'] },
  { round:'3',  raceName:'Japanese GP',       circuitId:'suzuka',      results:['antonelli','piastri','leclerc','russell','norris','hamilton','gasly','max_verstappen','lawson','ocon'] },
  { round:'4S', raceName:'Miami GP Sprint',   circuitId:'miami',       results:['norris','piastri','leclerc','russell','max_verstappen','antonelli','hamilton','gasly'] },
  { round:'4',  raceName:'Miami GP',          circuitId:'miami',       results:['antonelli','norris','piastri','russell','max_verstappen','hamilton','colapinto','leclerc','sainz','albon'] },
];

const CIRCUIT_CONTEXT: Record<string, string> = {
  villeneuve:   'Semi-street circuit, Montreal. Long straight + heavy braking chicanes. Safety car near-guaranteed. Hamilton has 7 wins. High brake wear. Highest SC probability on calendar.',
  monaco:       'Extreme street circuit. Overtaking impossible — qualifying = finishing position. Leclerc multiple poles. Verstappen won 2021/2023. Ferrari/low-rake cars favoured.',
  catalunya:    'Well-known test circuit. High-speed. Rear tyre deg critical. Hamilton 6 wins historically. Red Bull/Mercedes dominated recent years.',
  red_bull_ring:'Short, power-focused. Multiple DRS zones. Red Bull home race — dominated. Norris near-win 2024. Unpredictable weather.',
  silverstone:  'Ultra-fast, high-downforce. Rain possible. Hamilton 8 wins — master of this circuit. Norris won 2024. McLaren strong here.',
  spa:          'Longest circuit. Infamous weather — can rain in one sector while dry in another. Hamilton 6 wins, great wet weather specialist. Verstappen dominant recent years.',
  hungaroring:  'Tight, twisty — Monaco without barriers. Hamilton 8 wins. Piastri won 2024. Overtaking nearly impossible.',
  zandvoort:    'Narrow, banked circuit. Verstappen won every Dutch GP since return. Russell won 2024. Difficult to overtake.',
  monza:        'Fastest race. Minimal downforce. Slipstream racing. Ferrari crowd favourite and always motivated here.',
  ifema_madrid: 'Brand new 2026 street circuit. No data — maximum uncertainty.',
  baku:         'Street circuit, 2.2km straight + narrow old city. Leclerc fast in qualifying. Safety car 100% guaranteed.',
  marina_bay:   'Night race, extreme heat/humidity. Grid position = final position. Safety car guaranteed.',
  americas:     'Mixed layout — all corner types. Hamilton 6 wins. Verstappen dominant recent years.',
  rodriguez:    'High altitude (2200m). Red Bull engine historically strong at altitude. Crowd favourite Perez retired.',
  interlagos:   'Anti-clockwise, unpredictable rain. Hamilton supernatural in wet. Senna S iconic corner.',
  las_vegas:    'Cold night temperatures. Leclerc won 2024. Tyre warm-up critical. Power unit circuit.',
  losail:       'High tyre degradation. Verstappen won 2021/2023. Smooth driving style rewarded.',
  yas_marina:   'Season finale. Smooth, representative circuit. Championship context matters — leaders protect positions.',
  suzuka:       'Iconic figure-8. S-curves, 130R. Verstappen dominant 2022-2024. Mercedes strong historically.',
  shanghai:     'Long back straight. Technical sector 2. Sprint weekend. Hamilton 6 wins historically.',
  miami:        'Semi-street, abrasive surface. High tyre deg. Norris won 2024 + 2026 sprint. Antonelli won 2026 race.',
  albert_park:  'Season opener. Anti-clockwise park circuit. Russell won 2026 opener.',
};

function buildPredictionPrompt(race: any, pastPredictions: any[]): string {
  const raceResults = COMPLETED_RESULTS.filter(r => !String(r.round).endsWith('S'));
  const resultsStr = raceResults.map(r => {
    const top3 = r.results.slice(0, 3).map((id, i) => {
      const d = DRIVER_STANDINGS.find(x => x.driverId === id);
      return `P${i+1}:${d?.abbr || id}`;
    }).join(' ');
    return `${r.raceName}: ${top3}`;
  }).join('\n');

  // Form trends
  const formMap: Record<string, number[]> = {};
  raceResults.forEach(r => {
    r.results.forEach((id, i) => {
      if (!formMap[id]) formMap[id] = [];
      formMap[id].push(i + 1);
    });
  });
  const formStr = DRIVER_STANDINGS.slice(0, 15).map(d => {
    const fins = formMap[d.driverId] || [];
    if (!fins.length) return `${d.abbr}: no finishes`;
    const last = fins.slice(-3);
    const avg = (last.reduce((a, b) => a + b, 0) / last.length).toFixed(1);
    const diff = last.length >= 2 ? last[last.length-1] - last[0] : 0;
    const arrow = diff <= -2 ? '↑SURGING' : diff >= 2 ? '↓FADING' : '→STABLE';
    return `${d.abbr}: [${last.map(p => 'P'+p).join(',')}] avg:P${avg} ${arrow}`;
  }).join('\n');

  // Past predictions for this circuit
  const circuitPreds = pastPredictions.filter(p => p.circuit_id === race.circuitId && p.accuracy !== null);
  let correctionStr = '';
  if (circuitPreds.length) {
    correctionStr = '\n\n🔄 PREVIOUS AI PREDICTIONS AT THIS CIRCUIT:\n';
    circuitPreds.slice(-2).forEach((p: any) => {
      const pred5 = (p.prediction?.top10 || []).slice(0, 5).map((x: any, i: number) => `P${i+1}:${x.abbr}`).join(' ');
      const act5  = (p.actual_results || []).slice(0, 5).map((id: string, i: number) => {
        const d = DRIVER_STANDINGS.find(x => x.driverId === id);
        return `P${i+1}:${d?.abbr || id}`;
      }).join(' ');
      const errors = (p.prediction?.top10 || []).map((predD: any) => {
        const ai = (p.actual_results || []).indexOf(predD.driverId);
        if (ai === -1 || Math.abs(predD.pos - (ai+1)) < 3) return null;
        return `${predD.abbr} pred P${predD.pos}→actual P${ai+1}`;
      }).filter(Boolean);
      correctionStr += `• ${p.race_name}: ${p.accuracy}% accuracy\n  Predicted: ${pred5}\n  Actual: ${act5}\n`;
      if (errors.length) correctionStr += `  ❌ Fix these: ${errors.slice(0, 3).join(' | ')}\n`;
    });
    correctionStr += 'MANDATORY: Correct these recurring errors.';
  }

  const circuitInfo = CIRCUIT_CONTEXT[race.circuitId] || 'No specific circuit history available.';
  const driverLines = DRIVER_STANDINGS.map(d =>
    `${d.name}(${d.abbr}) ${d.team} ${d.pts}pts`
  ).join('\n');

  const constructorStr = 'Mercedes:180, Ferrari:110, McLaren:94, Red Bull:30, Alpine:23, Haas:18, Racing Bulls:14, Williams:5, Audi:2';

  return `You are a neutral, data-driven F1 race analyst.${correctionStr}

Your job: predict the top 10 finishing order for the GRAND PRIX at ${race.name} (${race.circuit}, Round ${race.round}).

CIRCUIT PROFILE: ${circuitInfo}

2026 COMPLETED RACE RESULTS:
${resultsStr}

KEY NOTES: Mercedes dominant (ANT 3 wins, RUS 1 win). McLaren major upgrades — NOR/PIA now front-runners. Ferrari consistent but no wins. Red Bull struggling (VER best P5). Bahrain & Saudi Arabia cancelled. Chinese GP was sprint weekend.

DRIVER STANDINGS & FORM:
${driverLines}

DRIVER FORM TREND (last 3 races):
${formStr}

CONSTRUCTOR STANDINGS: ${constructorStr}

SESSION DATA: No qualifying data yet — this is a pre-race prediction.

CRITICAL RULES:
1. Do NOT default to Antonelli winning every race. Assess circuit-specific merits.
2. McLaren (NOR/PIA) are genuine front-runners at any circuit. Do not underestimate.
3. Red Bull (VER) is struggling — best result P5. Reflect this.
4. Ferrari (LEC/HAM) consistent podium threat — no wins yet but fast.
5. Mercedes dominant package but Antonelli is a rookie — can crack under pressure.
6. Drivers marked ↑SURGING should rank higher than standing suggests.
7. Win probabilities must sum to exactly 100%.
8. BE BOLD. Don't copy championship order — circuit history and form should guide you.

Respond ONLY with this exact JSON (no markdown, no text outside JSON):
{"top10":[{"pos":1,"driverId":"DRIVER_ID","name":"Full Name","abbr":"ABB","team":"Team","winProb":XX.X,"reasoning":"brief reason"},{"pos":2,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":3,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":4,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":5,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":6,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":7,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":8,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":9,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."},{"pos":10,"driverId":"...","name":"...","abbr":"...","team":"...","winProb":XX.X,"reasoning":"..."}],"overallAnalysis":"Three paragraphs: 1) How circuit suits current car hierarchy. 2) Key drivers to watch. 3) What could cause upsets.","keyFactor":"Single most decisive factor","upsetAlert":"One driver who could surprise and why"}`;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date();
  const log: string[] = [];

  // Find races that are 18–30 hours away (sweet spot: not too early, not too late)
  const targetRaces = CALENDAR_2026.filter(race => {
    const raceDate = new Date(race.date);
    const hoursUntil = (raceDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil >= 18 && hoursUntil <= 30;
  });

  if (!targetRaces.length) {
    return new Response(JSON.stringify({ ok: true, message: 'No races in prediction window', checked: now.toISOString() }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  for (const race of targetRaces) {
    try {
      // Check if prediction already exists
      const { data: existing } = await supabase
        .from('predictions')
        .select('id')
        .eq('circuit_id', race.circuitId)
        .eq('round', race.round)
        .eq('pred_type', 'race')
        .maybeSingle();

      if (existing) {
        log.push(`SKIP: ${race.name} — prediction already exists`);
        continue;
      }

      // Fetch past predictions for circuit-specific learning
      const { data: pastPreds } = await supabase
        .from('predictions')
        .select('*')
        .eq('circuit_id', race.circuitId)
        .not('accuracy', 'is', null)
        .order('created_at', { ascending: false })
        .limit(3);

      // Fetch recent predictions for bias detection
      const { data: recentPreds } = await supabase
        .from('predictions')
        .select('*')
        .not('accuracy', 'is', null)
        .order('created_at', { ascending: false })
        .limit(12);

      const allPastPreds = [...(pastPreds || []), ...(recentPreds || [])];

      // Build prompt and call OpenRouter
      const prompt = buildPredictionPrompt(race, allPastPreds);

      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://f1-predictor.vercel.app',
          'X-Title': 'F1 Race Predictor Auto',
        },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: [
            { role: 'system', content: 'You are an expert F1 race analyst. Always respond with valid JSON only — no markdown, no text outside the JSON object.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.9,
          max_tokens: 3500,
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        log.push(`AI error ${race.name}: HTTP ${aiRes.status} — ${errText.slice(0, 100)}`);
        continue;
      }

      const aiData = await aiRes.json();
      const raw = aiData?.choices?.[0]?.message?.content || '';
      if (!raw) {
        log.push(`AI empty response for ${race.name}`);
        continue;
      }

      // Extract JSON from response
      const jsonStart = raw.indexOf('{');
      const jsonEnd   = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        log.push(`No JSON found in AI response for ${race.name}`);
        continue;
      }
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      if (!parsed?.top10?.length) {
        log.push(`Invalid prediction structure for ${race.name}`);
        continue;
      }

      // Save to Supabase
      await supabase.from('predictions').upsert({
        race_name:      race.name,
        round:          race.round,
        circuit_id:     race.circuitId,
        race_date:      race.date,
        pred_type:      'race',
        prediction:     parsed,
        actual_results: null,
        accuracy:       null,
        created_at:     new Date().toISOString(),
      }, { onConflict: 'circuit_id,round,pred_type' });

      log.push(`✅ AUTO-PREDICTED: ${race.name} (Round ${race.round}) — winner: ${parsed.top10[0]?.name}`);

    } catch (e: any) {
      log.push(`ERROR ${race.name}: ${e.message}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: targetRaces.length, log }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

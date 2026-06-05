import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const OPENF1  = 'https://api.openf1.org/v1';

// ─── 2026 CALENDAR (22 rounds — Bahrain & Saudi Arabia CANCELLED) ─────────────
const CALENDAR_2026 = [
  { round:1,  circuitId:'albert_park', location:'Melbourne',  raceDate:'2026-03-08', sprint:false },
  { round:2,  circuitId:'shanghai',    location:'Shanghai',   raceDate:'2026-03-15', sprint:true  },
  { round:3,  circuitId:'suzuka',      location:'Suzuka',     raceDate:'2026-03-29', sprint:false },
  { round:4,  circuitId:'miami',       location:'Miami',      raceDate:'2026-05-04', sprint:true  },
  { round:5,  circuitId:'villeneuve',  location:'Montreal',   raceDate:'2026-05-24', sprint:true  },
  { round:6,  circuitId:'monaco',      location:'Monaco',     raceDate:'2026-06-07', sprint:false },
  { round:7,  circuitId:'catalunya',   location:'Barcelona',  raceDate:'2026-06-14', sprint:false },
  { round:8,  circuitId:'red_bull_ring',location:'Spielberg', raceDate:'2026-06-28', sprint:false },
  { round:9,  circuitId:'silverstone', location:'Silverstone',raceDate:'2026-07-05', sprint:true  },
  { round:10, circuitId:'spa',         location:'Spa',        raceDate:'2026-07-19', sprint:false },
  { round:11, circuitId:'hungaroring', location:'Budapest',   raceDate:'2026-07-26', sprint:false },
  { round:12, circuitId:'zandvoort',   location:'Zandvoort',  raceDate:'2026-08-23', sprint:true  },
  { round:13, circuitId:'monza',       location:'Monza',      raceDate:'2026-09-06', sprint:false },
  { round:14, circuitId:'ifema_madrid',location:'Madrid',     raceDate:'2026-09-13', sprint:false },
  { round:15, circuitId:'baku',        location:'Baku',       raceDate:'2026-09-26', sprint:false },
  { round:16, circuitId:'marina_bay',  location:'Singapore',  raceDate:'2026-10-11', sprint:true  },
  { round:17, circuitId:'americas',    location:'Austin',     raceDate:'2026-10-25', sprint:false },
  { round:18, circuitId:'rodriguez',   location:'Mexico City',raceDate:'2026-11-01', sprint:false },
  { round:19, circuitId:'interlagos',  location:'São Paulo',  raceDate:'2026-11-08', sprint:false },
  { round:20, circuitId:'las_vegas',   location:'Las Vegas',  raceDate:'2026-11-21', sprint:false },
  { round:21, circuitId:'losail',      location:'Lusail',     raceDate:'2026-11-29', sprint:false },
  { round:22, circuitId:'yas_marina',  location:'Abu Dhabi',  raceDate:'2026-12-06', sprint:false },
];

// Jolpica circuit key → our circuitId
const JOLPICA_CIRCUIT_MAP: Record<string, string> = {
  albert_park:   'albert_park',
  shanghai:      'shanghai',
  suzuka:        'suzuka',
  miami:         'miami',
  villeneuve:    'villeneuve',
  monaco:        'monaco',
  catalunya:     'catalunya',
  red_bull_ring: 'red_bull_ring',
  silverstone:   'silverstone',
  spa:           'spa',
  hungaroring:   'hungaroring',
  zandvoort:     'zandvoort',
  monza:         'monza',
  madrid:        'ifema_madrid',
  baku:          'baku',
  marina_bay:    'marina_bay',
  americas:      'americas',
  rodriguez:     'rodriguez',
  interlagos:    'interlagos',
  las_vegas:     'las_vegas',
  losail:        'losail',
  yas_marina:    'yas_marina',
};

// Ergast driver IDs → our abbreviations
const ERGAST_TO_ABBR: Record<string, string> = {
  antonelli:       'ANT',
  russell:         'RUS',
  leclerc:         'LEC',
  norris:          'NOR',
  hamilton:        'HAM',
  piastri:         'PIA',
  max_verstappen:  'VER',
  bearman:         'BEA',
  gasly:           'GAS',
  ocon:            'OCO',
  hadjar:          'HAD',
  lawson:          'LAW',
  colapinto:       'COL',
  sainz:           'SAI',
  albon:           'ALB',
  bortoleto:       'BOR',
  hulkenberg:      'HUL',
  stroll:          'STR',
  lindblad:        'LIN',
  alonso:          'ALO',
  bottas:          'BOT',
  perez:           'PER',
};

// ─── SCORING ──────────────────────────────────────────────────────────────────
const RACE_PTS   = [25,18,15,12,10,8,6,4,2,1];
const SPRINT_PTS = [8,7,6,5,4,3,2,1];

function scoreTop10(predicted: string[], actual: string[]): number {
  if (!predicted?.length || !actual?.length) return 0;
  const top10Pred   = predicted.slice(0,10);
  const top10Actual = actual.slice(0,10);
  let score = 0, maxScore = 0;

  for (let i = 0; i < top10Actual.length; i++) {
    const pts = RACE_PTS[i] ?? 1;
    maxScore += pts;
    const predPos = top10Pred.indexOf(top10Actual[i]);
    if (predPos === i) {
      score += pts; // exact match
    } else if (predPos !== -1) {
      const off = Math.abs(predPos - i);
      const partial = Math.max(0, pts - off);
      score += partial;
    }
  }
  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

// ─── FETCH RACE RESULTS FROM JOLPICA ─────────────────────────────────────────
async function fetchJolpicaResults(round: number, isSprint: boolean): Promise<string[] | null> {
  try {
    const endpoint = isSprint
      ? `${JOLPICA}/2026/${round}/sprint.json?limit=30`
      : `${JOLPICA}/2026/${round}/results.json?limit=30`;

    const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const data = await res.json();
    const table = data?.MRData?.RaceTable;
    if (!table) return null;

    const races = isSprint ? table.Races?.[0]?.SprintResults : table.Races?.[0]?.Results;
    if (!races?.length) return null;

    // Sort by position, return driver id abbreviations
    return races
      .sort((a: any, b: any) => parseInt(a.position) - parseInt(b.position))
      .map((r: any) => {
        const ergastId = r.Driver?.driverId ?? '';
        return ERGAST_TO_ABBR[ergastId] ?? r.Driver?.code?.toUpperCase() ?? ergastId.toUpperCase();
      });
  } catch {
    return null;
  }
}

// ─── FETCH RESULTS FROM OPENF1 (fallback) ─────────────────────────────────────
async function fetchOpenF1Results(
  location: string,
  sessionType: 'Race' | 'Sprint'
): Promise<string[] | null> {
  try {
    // Find meeting
    const mRes = await fetch(
      `${OPENF1}/meetings?year=2026&location=${encodeURIComponent(location)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!mRes.ok) return null;
    const meetings = await mRes.json();
    if (!meetings?.length) return null;
    const meetingKey = meetings[0].meeting_key;

    // Find session
    const sRes = await fetch(
      `${OPENF1}/sessions?meeting_key=${meetingKey}&session_name=${encodeURIComponent(sessionType)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!sRes.ok) return null;
    const sessions = await sRes.json();
    const sess = sessions?.find((s: any) =>
      s.session_name === sessionType || s.session_type === sessionType
    );
    if (!sess) return null;

    // Get drivers for abbreviation map
    const drvRes = await fetch(
      `${OPENF1}/drivers?session_key=${sess.session_key}&meeting_key=${meetingKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const driverList = drvRes.ok ? await drvRes.json() : [];
    const numToAbbr: Record<number, string> = {};
    driverList?.forEach((d: any) => {
      numToAbbr[d.driver_number] = d.name_acronym?.toUpperCase();
    });

    // Get final positions
    const posRes = await fetch(
      `${OPENF1}/position?session_key=${sess.session_key}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!posRes.ok) return null;
    const positions = await posRes.json();

    // Get last position entry per driver
    const latest: Record<number, any> = {};
    positions?.forEach((p: any) => {
      if (!latest[p.driver_number] || p.date > latest[p.driver_number].date)
        latest[p.driver_number] = p;
    });

    return Object.values(latest)
      .sort((a: any, b: any) => a.position - b.position)
      .map((p: any) => numToAbbr[p.driver_number] || String(p.driver_number));
  } catch {
    return null;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now      = new Date();
  const results: string[] = [];

  // Process races that finished in the last 12 hours up to 7 days ago
  // (wide window so nothing is missed if the cron misfires)
  const recentRaces = CALENDAR_2026.filter(race => {
    const raceDate = new Date(race.raceDate);
    const diffHrs  = (now.getTime() - raceDate.getTime()) / (1000 * 60 * 60);
    return diffHrs >= 3 && diffHrs <= 336; // 3h → 14 days after race (forgiving if a cron run is missed)
  });

  for (const race of recentRaces) {
    const sessionTypes = race.sprint
      ? [
          { label: 'Sprint', isSprint: true,  predType: 'sprint' },
          { label: 'Race',   isSprint: false, predType: 'race'   },
        ]
      : [
          { label: 'Race',   isSprint: false, predType: 'race'   },
        ];

    for (const { label, isSprint, predType } of sessionTypes) {
      try {
        // ── 1. Find ALL prediction snapshots in Supabase ─────────────────────
        // We now save one snapshot per stage (beforeQuali, afterQuali, final…),
        // so multiple rows can match. .maybeSingle() THROWS on >1 row, so we
        // must select the full list and score every unscored snapshot.
        const { data: preds, error: predErr } = await supabase
          .from('predictions')
          .select('id, prediction, accuracy')
          .eq('circuit_id', race.circuitId)
          .eq('round', race.round)
          .eq('pred_type', predType);

        if (predErr) {
          results.push(`DB error for ${race.location} ${label}: ${predErr.message}`);
          continue;
        }

        if (!preds?.length) {
          results.push(`No prediction found: ${race.location} ${label} — skipping`);
          continue;
        }

        // ── 2. Skip if every snapshot is already scored ──────────────────────
        const unscored = preds.filter((p: any) => p.accuracy === null || p.accuracy === undefined);
        if (!unscored.length) {
          results.push(`Already scored: ${race.location} ${label} (${preds.length} snapshot(s))`);
          continue;
        }

        // ── 3. Fetch actual results (once for all snapshots) ─────────────────
        let actualResults: string[] | null = null;

        // Try Jolpica first (official Ergast data)
        actualResults = await fetchJolpicaResults(race.round, isSprint);

        // Fallback: OpenF1
        if (!actualResults?.length) {
          actualResults = await fetchOpenF1Results(race.location, label as 'Race' | 'Sprint');
        }

        if (!actualResults?.length) {
          results.push(`Results not yet available: ${race.location} ${label}`);
          continue;
        }

        // ── 4-6. Parse, score and patch EACH unscored snapshot ───────────────
        let scoredCount = 0;
        for (const pred of unscored) {
          let predictedOrder: string[] = [];
          try {
            const p = pred.prediction;
            if (Array.isArray(p)) {
              predictedOrder = p.map((x: any) =>
                typeof x === 'string' ? x.toUpperCase() : (x.abbr ?? x.driverId ?? '').toUpperCase()
              );
            } else if (p?.top10) {
              predictedOrder = p.top10.map((x: any) =>
                typeof x === 'string' ? x.toUpperCase() : (x.abbr ?? x.driverId ?? '').toUpperCase()
              );
            } else if (typeof p === 'string') {
              // Plaintext fallback — extract 3-letter abbreviations in order
              const matches = (p as string).match(/\b[A-Z]{3}\b/g) ?? [];
              predictedOrder = [...new Set(matches)];
            }
          } catch {
            results.push(`Could not parse prediction ${pred.id} for ${race.location} ${label}`);
            continue;
          }

          const accuracy = scoreTop10(predictedOrder, actualResults);

          const { error: updateErr } = await supabase
            .from('predictions')
            .update({
              actual_results: actualResults,
              accuracy:       accuracy,
            })
            .eq('id', pred.id);

          if (updateErr) {
            results.push(`Update failed: ${race.location} ${label} #${pred.id} — ${updateErr.message}`);
          } else {
            scoredCount++;
          }
        }

        if (scoredCount) {
          results.push(`Scored: ${race.location} ${label} → ${scoredCount} snapshot(s) updated`);
        }

      } catch (e: any) {
        results.push(`Error ${race.location} ${label}: ${e.message}`);
      }
    }
  }

  const summary = results.length
    ? results
    : ['No races in scoring window (3h–7d post-race)'];

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, details: summary }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// The shared season calendar (season.js in the repo root).
import { loadSeason } from '../../../season.js'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const OPENF1  = 'https://api.openf1.org/v1';

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

// Jolpica ids that differ from the ids the website uses.
const ID_ALIAS: Record<string, string> = { arvid_lindblad: 'lindblad' };
const siteId = (id: string) => ID_ALIAS[id] ?? id;

const ABBR_TO_ERGAST: Record<string, string> =
  Object.fromEntries(Object.entries(ERGAST_TO_ABBR).map(([id, ab]) => [ab, id]));

// ─── SCORING (same formula as the website's calcAccuracy) ─────────────────────
// Over the predicted top 10: exact position = 1 point, within ±2 places of the
// actual finishing position = 0.5 point. Percentage of the maximum.
function calcAccuracy(predAbbrs: string[], actualAbbrs: string[]): number | null {
  const n = Math.min(predAbbrs.length, actualAbbrs.length, 10);
  if (!n) return null;
  let exact = 0, close = 0;
  for (let i = 0; i < n; i++) {
    const a = predAbbrs[i];
    if (a === actualAbbrs[i]) { exact++; continue; }
    const j = actualAbbrs.indexOf(a);
    if (j >= 0 && Math.abs(j - i) <= 2) close++;
  }
  return Math.round(((exact + close * 0.5) / n) * 100);
}

const toAbbr = (x: any): string => {
  if (!x) return '';
  if (typeof x === 'string') return (ERGAST_TO_ABBR[x] ?? x).toUpperCase();
  return String(x.abbr ?? ERGAST_TO_ABBR[x.driverId] ?? x.driverId ?? '').toUpperCase();
};
const isIdList = (a: any) => Array.isArray(a) && a.length >= 15 && a.every((x: any) => typeof x === 'string' && /^[a-z_]+$/.test(x));

// ─── FETCH RESULTS (returns Ergast driverIds in finishing order) ──────────────
async function fetchJolpicaResults(season: number, round: number, isSprint: boolean): Promise<string[] | null> {
  try {
    const endpoint = `${JOLPICA}/${season}/${round}/${isSprint ? 'sprint' : 'results'}.json?limit=40`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();
    const race = data?.MRData?.RaceTable?.Races?.[0];
    const rows = isSprint ? race?.SprintResults : race?.Results;
    if (!rows?.length) return null;
    return rows
      .sort((a: any, b: any) => parseInt(a.position) - parseInt(b.position))
      .map((r: any) => siteId(r.Driver?.driverId || ABBR_TO_ERGAST[String(r.Driver?.code || '').toUpperCase()] || String(r.Driver?.code || '').toLowerCase()));
  } catch {
    return null;
  }
}

async function fetchOpenF1Results(season: number, location: string, sessionType: 'Race' | 'Sprint'): Promise<string[] | null> {
  try {
    const mRes = await fetch(`${OPENF1}/meetings?year=${season}&location=${encodeURIComponent(location)}`, { signal: AbortSignal.timeout(10000) });
    if (!mRes.ok) return null;
    const meetingKey = (await mRes.json())?.[0]?.meeting_key;
    if (!meetingKey) return null;
    const sRes = await fetch(`${OPENF1}/sessions?meeting_key=${meetingKey}&session_name=${encodeURIComponent(sessionType)}`, { signal: AbortSignal.timeout(10000) });
    if (!sRes.ok) return null;
    const sess = (await sRes.json())?.find((s: any) => s.session_name === sessionType);
    if (!sess?.date_end || new Date(sess.date_end) > new Date()) return null;
    const [drvRes, posRes] = await Promise.all([
      fetch(`${OPENF1}/drivers?session_key=${sess.session_key}`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${OPENF1}/position?session_key=${sess.session_key}`, { signal: AbortSignal.timeout(15000) }),
    ]);
    if (!posRes.ok) return null;
    const numToAbbr: Record<number, string> = {};
    (drvRes.ok ? await drvRes.json() : []).forEach((d: any) => { numToAbbr[d.driver_number] = String(d.name_acronym || '').toUpperCase(); });
    const latest: Record<number, any> = {};
    (await posRes.json())?.forEach((p: any) => {
      if (!latest[p.driver_number] || p.date > latest[p.driver_number].date) latest[p.driver_number] = p;
    });
    const order = Object.values(latest).sort((a: any, b: any) => a.position - b.position)
      .map((p: any) => { const ab = numToAbbr[p.driver_number] || ''; return ABBR_TO_ERGAST[ab] || ab.toLowerCase(); });
    return order.length >= 15 ? order : null;
  } catch {
    return null;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
// Runs every 2 hours (pg_cron). For every race finished in the last 14 days it
// (re)scores EACH stored snapshot on its own against the official classification,
// and only writes rows whose score or stored result actually changed. Older races
// are settled; call with ?all=1 to rescore the whole season.
const RECENT_MS = 14 * 86400 * 1000;
Deno.serve(async (req: Request) => {
  const all = new URL(req.url).searchParams.get('all') === '1';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  const details: string[] = [];
  const { season, races } = await loadSeason();

  const finished = races.filter((r: any) => {
    const since = now - new Date(r.date).getTime();
    return since >= 3 * 3600 * 1000 && (all || since <= RECENT_MS);
  });

  for (const race of finished) {
    const kinds = race.sprint
      ? [{ label: 'Sprint', isSprint: true, predType: 'sprint' }, { label: 'Race', isSprint: false, predType: 'race' }]
      : [{ label: 'Race', isSprint: false, predType: 'race' }];

    for (const { label, isSprint, predType } of kinds) {
      try {
        const { data: preds, error } = await supabase
          .from('predictions')
          .select('id, prediction, accuracy, actual_results')
          .eq('circuit_id', race.circuitId)
          .eq('round', race.round)
          .eq('pred_type', predType);
        if (error) { details.push(`DB error ${race.of1} ${label}: ${error.message}`); continue; }
        if (!preds?.length) continue;

        // Official classification first (Jolpica); OpenF1 only for a race in the last
        // week that Jolpica hasn't published yet; a stored list only if both fail.
        let actual: string[] | null = await fetchJolpicaResults(season, race.round, isSprint);
        if (!actual && now - new Date(race.date).getTime() < 7 * 86400 * 1000) {
          actual = await fetchOpenF1Results(season, race.of1, label as 'Race' | 'Sprint');
        }
        if (!actual) actual = preds.find((p: any) => isIdList(p.actual_results))?.actual_results ?? null;
        if (!actual?.length) { details.push(`Results not yet available: ${race.of1} ${label}`); continue; }

        const actualAbbrs = actual.map(toAbbr);
        let updated = 0;
        for (const p of preds) {
          const top10 = p.prediction?.top10;
          if (!Array.isArray(top10) || !top10.length) continue;
          const acc = calcAccuracy(top10.map(toAbbr), actualAbbrs);
          const sameActual = JSON.stringify(p.actual_results) === JSON.stringify(actual);
          if (acc === p.accuracy && sameActual) continue;
          const { error: upErr } = await supabase.from('predictions')
            .update({ actual_results: actual, accuracy: acc }).eq('id', p.id);
          if (upErr) details.push(`Update failed ${race.of1} ${label} #${p.id}: ${upErr.message}`);
          else updated++;
        }
        if (updated) details.push(`Scored ${race.of1} ${label}: ${updated} snapshot(s) updated`);
      } catch (e: any) {
        details.push(`Error ${race.of1} ${label}: ${e.message}`);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, details: details.length ? details : ['Nothing to update'] }),
    { headers: { 'Content-Type': 'application/json' } });
});

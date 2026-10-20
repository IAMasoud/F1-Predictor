import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// The shared season calendar (season.js in the repo root).
import { loadSeason } from '../../../season.js'

const OPENF1 = 'https://api.openf1.org/v1';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date();
  const results: string[] = [];
  const { season, races } = await loadSeason();

  // Find race weekends active in the last 5 days or next 1 day
  const activeRaces = races.filter((race: any) => {
    const raceDate = new Date(race.date);
    const diffDays = (raceDate.getTime() - now.getTime()) / (1000*60*60*24);
    return diffDays >= -2 && diffDays <= 5;
  });

  for (const race of activeRaces) {
    try {
      // Get OpenF1 meeting
      const mRes = await fetch(`${OPENF1}/meetings?year=${season}&location=${encodeURIComponent(race.of1)}`);
      if (!mRes.ok) continue;
      const meetings = await mRes.json();
      if (!meetings?.length) continue;
      const meeting = meetings[0];

      // Get sessions
      const sRes = await fetch(`${OPENF1}/sessions?meeting_key=${meeting.meeting_key}&year=${season}`);
      if (!sRes.ok) continue;
      const sessions = await sRes.json();
      if (!sessions?.length) continue;

      for (const sess of sessions) {
        // Skip sessions that haven't finished yet
        if (!sess.date_end || new Date(sess.date_end) > now) continue;

        // Check if already saved in Supabase
        const { data: existing } = await supabase
          .from('sessions')
          .select('id, grid_data')
          .eq('circuit_id', race.circuitId)
          .eq('round', race.round)
          .eq('year', season)
          .eq('session_name', sess.session_name)
          .maybeSingle();

        // Skip only if we already stored a real grid with driver codes
        // (an empty grid, or one with bare car numbers, gets retried).
        if (existing && (existing.grid_data || []).some((g: any) => /^[A-Z]{3}$/.test(g.abbr))) continue;

        // Fetch positions + drivers for this session
        const [posRes, drvRes] = await Promise.all([
          fetch(`${OPENF1}/position?session_key=${sess.session_key}`),
          fetch(`${OPENF1}/drivers?session_key=${sess.session_key}&meeting_key=${meeting.meeting_key}`),
        ]);

        if (!posRes.ok) { results.push(`OpenF1 positions unavailable (${posRes.status}): ${race.of1} — ${sess.session_name}`); continue; }
        const positions  = await posRes.json();
        const driverList = drvRes.ok  ? await drvRes.json()  : [];

        // Build driver number → abbreviation map
        const numToAbbr: Record<number, string> = {};
        driverList?.forEach((d: any) => {
          numToAbbr[d.driver_number] = d.name_acronym?.toUpperCase();
        });

        // Get last position entry per driver
        const latest: Record<number, any> = {};
        positions?.forEach((p: any) => {
          if (!latest[p.driver_number] || p.date > latest[p.driver_number].date)
            latest[p.driver_number] = p;
        });

        // Without the driver list we'd only have car numbers — wait for the next run.
        if (!Object.keys(numToAbbr).length) { results.push(`Driver list not available yet: ${race.of1} — ${sess.session_name}`); continue; }
        const gridData = Object.values(latest)
          .sort((a: any, b: any) => a.position - b.position)
          .map((p: any) => ({ abbr: numToAbbr[p.driver_number], pos: p.position }))
          .filter((g: any) => /^[A-Z]{3}$/.test(g.abbr || ''));

        if (!gridData.length) { results.push(`No positions yet: ${race.of1} — ${sess.session_name}`); continue; }

        // Save to Supabase
        await supabase.from('sessions').upsert({
          circuit_id:   race.circuitId,
          round:        race.round,
          year:         season,
          session_name: sess.session_name,
          session_key:  sess.session_key,
          grid_data:    gridData,
          is_live:      false,
          source:       'openf1-sync',
          fetched_at:   new Date().toISOString(),
        }, { onConflict: 'circuit_id,round,year,session_name' });

        results.push(`Saved: ${race.of1} — ${sess.session_name}`);
      }
    } catch(e: any) {
      results.push(`Error ${race.of1}: ${e.message}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, synced: results.length, details: results }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

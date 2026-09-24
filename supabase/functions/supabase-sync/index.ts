import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENF1 = 'https://api.openf1.org/v1';

// Full 2026 calendar — 22 rounds (Bahrain & Saudi Arabia CANCELLED)
const CALENDAR_2026 = [
  { round:1,  circuitId:'albert_park',  location:'Melbourne',   raceDate:'2026-03-08', sprint:false },
  { round:2,  circuitId:'shanghai',     location:'Shanghai',    raceDate:'2026-03-15', sprint:true  },
  { round:3,  circuitId:'suzuka',       location:'Suzuka',      raceDate:'2026-03-29', sprint:false },
  { round:4,  circuitId:'miami',        location:'Miami Gardens',       raceDate:'2026-05-03', sprint:true  },
  { round:5,  circuitId:'villeneuve',   location:'Montréal',    raceDate:'2026-05-24', sprint:true  },
  { round:6,  circuitId:'monaco',       location:'Monte Carlo',      raceDate:'2026-06-07', sprint:false },
  { round:7,  circuitId:'catalunya',    location:'Barcelona',   raceDate:'2026-06-14', sprint:false },
  { round:8,  circuitId:'red_bull_ring',location:'Spielberg',   raceDate:'2026-06-28', sprint:false },
  { round:9,  circuitId:'silverstone',  location:'Silverstone', raceDate:'2026-07-05', sprint:true  },
  { round:10, circuitId:'spa',          location:'Spa-Francorchamps',         raceDate:'2026-07-19', sprint:false },
  { round:11, circuitId:'hungaroring',  location:'Budapest',    raceDate:'2026-07-26', sprint:false },
  { round:12, circuitId:'zandvoort',    location:'Zandvoort',   raceDate:'2026-08-23', sprint:true  },
  { round:13, circuitId:'monza',        location:'Monza',       raceDate:'2026-09-06', sprint:false },
  { round:14, circuitId:'ifema_madrid', location:'Madrid',      raceDate:'2026-09-13', sprint:false },
  { round:15, circuitId:'baku',         location:'Baku',        raceDate:'2026-09-26', sprint:false },
  { round:16, circuitId:'sepang',         location:'Kuala Lumpur',        raceDate:'2026-10-04', sprint:false },
  { round:17, circuitId:'marina_bay',   location:'Marina Bay',   raceDate:'2026-10-11', sprint:true  },
  { round:18, circuitId:'americas',     location:'Austin',      raceDate:'2026-10-25', sprint:false },
  { round:19, circuitId:'rodriguez',    location:'Mexico City', raceDate:'2026-11-01', sprint:false },
  { round:20, circuitId:'interlagos',   location:'São Paulo',   raceDate:'2026-11-08', sprint:false },
  { round:21, circuitId:'las_vegas',    location:'Las Vegas',   raceDate:'2026-11-22', sprint:false },
  { round:22, circuitId:'losail',       location:'Lusail',      raceDate:'2026-11-29', sprint:false },
  { round:23, circuitId:'yas_marina',   location:'Yas Marina',   raceDate:'2026-12-06', sprint:false },
];

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date();
  const results: string[] = [];

  // Find race weekends active in the last 5 days or next 1 day
  const activeRaces = CALENDAR_2026.filter(race => {
    const raceDate = new Date(race.raceDate);
    const diffDays = (raceDate.getTime() - now.getTime()) / (1000*60*60*24);
    return diffDays >= -2 && diffDays <= 5;
  });

  for (const race of activeRaces) {
    try {
      // Get OpenF1 meeting
      const mRes = await fetch(`${OPENF1}/meetings?year=2026&location=${encodeURIComponent(race.location)}`);
      if (!mRes.ok) continue;
      const meetings = await mRes.json();
      if (!meetings?.length) continue;
      const meeting = meetings[0];

      // Get sessions
      const sRes = await fetch(`${OPENF1}/sessions?meeting_key=${meeting.meeting_key}&year=2026`);
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
          .eq('year', 2026)
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

        if (!posRes.ok) { results.push(`OpenF1 positions unavailable (${posRes.status}): ${race.location} — ${sess.session_name}`); continue; }
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
        if (!Object.keys(numToAbbr).length) { results.push(`Driver list not available yet: ${race.location} — ${sess.session_name}`); continue; }
        const gridData = Object.values(latest)
          .sort((a: any, b: any) => a.position - b.position)
          .map((p: any) => ({ abbr: numToAbbr[p.driver_number], pos: p.position }))
          .filter((g: any) => /^[A-Z]{3}$/.test(g.abbr || ''));

        if (!gridData.length) { results.push(`No positions yet: ${race.location} — ${sess.session_name}`); continue; }

        // Save to Supabase
        await supabase.from('sessions').upsert({
          circuit_id:   race.circuitId,
          round:        race.round,
          year:         2026,
          session_name: sess.session_name,
          session_key:  sess.session_key,
          grid_data:    gridData,
          is_live:      false,
          source:       'openf1-sync',
          fetched_at:   new Date().toISOString(),
        }, { onConflict: 'circuit_id,round,year,session_name' });

        results.push(`Saved: ${race.location} — ${sess.session_name}`);
      }
    } catch(e: any) {
      results.push(`Error ${race.location}: ${e.message}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, synced: results.length, details: results }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

"""Feature building for the F1 ML model, shared by training and by the test race.

Three stages, one row per driver:
  pre   - before qualifying: season form, team form, reliability, circuit history, FP1
  quali - pre + grid slot and qualifying gap to pole
  live  - quali + the live timing a fan sees: position, gap, tyre, tyre age, stops, lap
Every feature uses only what was known at that moment (no peeking at later races).
"""
import json, os, glob, math
from datetime import datetime
import numpy as np
import pandas as pd

D = os.environ.get('ML_DATA') or os.path.join(os.path.dirname(__file__), 'data')
LAST_YEAR = datetime.utcnow().year  # seasons are read up to this one (files that exist)
COMPOUND = {'SOFT': 0, 'MEDIUM': 1, 'HARD': 2, 'INTERMEDIATE': 3, 'WET': 4, 'S': 0, 'M': 1, 'H': 2, 'I': 3, 'W': 4}

PRE = ['drv_form3', 'drv_form5', 'drv_quali5', 'team_form5', 'team_quali5', 'drv_dnf10', 'team_dnf10',
       'champ_pos', 'pts_share', 'circ_hist', 'circ_chaos', 'fp1_pos', 'fp1_gap', 'round_frac',
       'wet_race', 'wet_skill', 'wet_x']
# wet_race: 1 if the race is run in the wet. Training uses what happened; a prediction runs the model
# twice (dry and wet) and mixes the two by the forecast's chance of rain.
# wet_skill: places a driver gains in wet races beyond what he gains in dry ones (shrunk towards 0).
QUALI = PRE + ['grid', 'quali_pos', 'quali_gap']
# live rows know the weather NOW (tyres on the car), not whether rain comes later, so no wet_race there
LIVE = [c for c in QUALI if c not in ('wet_race', 'wet_x')] + ['wet_now_x', 'cur_pos', 'gap_leader', 'gap_ahead', 'gap_behind', 'lap_frac', 'laps_left', 'compound', 'tyre_age',
                'stops', 'wet', 'pos_gained', 'owes_stop', 'virt_pos', 'virt_gap', 'catch_rate', 'virt_catch', 'cushion_rate']
# catch_rate: seconds per lap a car must gain to reach the leader in the laps left (the same idea at any
# race length, so the model is not lost on lap 70 of 71); cushion_rate: the same for the car behind.
PIT_LOSS = 22.0  # seconds a pit stop costs, roughly, on most tracks


def add_virtual(frame, key):
    """Where each car would be once everyone has made their one compulsory dry-weather stop."""
    f = frame
    f['owes_stop'] = ((f['stops'].fillna(0) == 0) & (f['compound'].fillna(1) <= 2)).astype(float)
    # a car in the pit lane right now has its stop counted but not yet its time loss (live timing shows
    # the gap from the last timing line); real lap data has no such cars, so the column may be missing
    if 'in_pit' in f:
        f['owes_stop'] = np.maximum(f['owes_stop'], f['in_pit'].astype(float))
    f['virt_gap'] = f['gap_leader'] + f['owes_stop'] * PIT_LOSS
    f['virt_pos'] = f.groupby(key)['virt_gap'].rank(method='first')
    f['virt_gap'] = f['virt_gap'] - f.groupby(key)['virt_gap'].transform('min')
    # the simple answer the live stage corrects: the running order early on, then (from a quarter
    # distance, once stops start) the order after everyone's stop. Chosen on 2024-2025: from lap 20
    # the stop-adjusted order beat the plain running order in both seasons.
    left = f['laps_left'] + 1.0
    f['catch_rate'] = f['gap_leader'] / left
    f['virt_catch'] = f['virt_gap'] / left
    f['cushion_rate'] = f['gap_behind'] / left
    f['base_live'] = np.where(f['lap_frac'] >= 0.25, f['virt_pos'], f['cur_pos'])
    return f


def load(name):
    with open(os.path.join(D, name)) as f:
        v = json.load(f)
    return v if v is not None else []


def tsec(t):
    if not t:
        return None
    if ':' in t:
        m, s = t.split(':')
        return int(m) * 60 + float(s)
    return float(t)


def jolpica_races():
    """Every race 2019-2026 in date order with results + qualifying merged."""
    races = []
    for y in range(2019, LAST_YEAR + 1):
        if not os.path.exists(os.path.join(D, f'jolpica_results_{y}.json')):
            continue
        res = load(f'jolpica_results_{y}.json')
        q = {r['round']: r for r in load(f'jolpica_quali_{y}.json')}
        for r in res:
            qr = q.get(r['round'], {}).get('QualifyingResults', [])
            races.append({'season': y, 'round': int(r['round']), 'date': r['date'], 'circuit': r['Circuit']['circuitId'],
                          'name': r['raceName'], 'results': r['Results'], 'quali': qr})
    races.sort(key=lambda r: r['date'])
    return races


# Wet races. 2023+: from the tyres (at least 10% of all race laps on intermediates or wets).
# 2019-2022 (before OpenF1): the well-known wet races, by hand. Spa 2021 left out (never really raced).
WET_HAND = {(2019, 'hockenheimring'), (2020, 'istanbul'), (2021, 'imola'), (2021, 'sochi'), (2021, 'istanbul'),
            (2022, 'imola'), (2022, 'monaco'), (2022, 'marina_bay'), (2022, 'suzuka')}


def wet_dates():
    out = set()
    for y in range(2023, LAST_YEAR + 1):
        p = os.path.join(D, f'of1_sessions_{y}.json')
        if not os.path.exists(p):
            continue
        for s in load(f'of1_sessions_{y}.json'):
            sp = os.path.join(D, f"of1_stints_{s['session_key']}.json")
            if s['session_name'] != 'Race' or not os.path.exists(sp):
                continue
            st = load(f"of1_stints_{s['session_key']}.json")
            n = lambda x: max(0, (x.get('lap_end') or 0) - (x.get('lap_start') or 0) + 1)
            wet = sum(n(x) for x in st if (x.get('compound') or '').upper() in ('INTERMEDIATE', 'WET'))
            if wet / max(1, sum(n(x) for x in st)) >= 0.10:
                out.add(s['date_start'][:10])
    return out


def is_wet(race, wd):
    return (race['season'], race['circuit']) in WET_HAND or race['date'] in wd


def finish_pos(r):
    return int(r['position'])


def is_dnf(r):
    st = r['status']
    return not (st == 'Finished' or 'Lap' in st)


class History:
    """Rolling memory of what happened, fed race by race in date order."""

    def __init__(self):
        self.drv_fin, self.drv_q, self.drv_dnf = {}, {}, {}
        self.team_fin, self.team_q, self.team_dnf = {}, {}, {}
        self.circ = {}          # circuit -> list of |grid - finish|
        self.drv_circ = {}      # (driver, circuit) -> finishes
        self.pts = {}           # season -> driver -> points
        self.wet_gain, self.dry_gain = {}, {}   # driver -> places gained (grid - finish), wet / dry races
        self.circ_wet = {}      # circuit -> list of 1/0 (was it wet)

    @staticmethod
    def _mean(lst, n, default=np.nan):
        x = lst[-n:]
        return float(np.mean(x)) if x else default

    def features(self, season, rnd, n_rounds, circuit, code, team):
        pts = self.pts.get(season, {})
        order = sorted(pts.items(), key=lambda kv: -kv[1])
        champ = next((i + 1 for i, (c, _) in enumerate(order) if c == code), len(order) + 1 if order else np.nan)
        lead = order[0][1] if order else 0
        circ = self.circ.get(circuit, [])
        wg, dg = self.wet_gain.get(code, []), self.dry_gain.get(code, [])
        wet_skill = (sum(wg) - len(wg) * (np.mean(dg) if dg else 0.0)) / (len(wg) + 3.0)
        return {
            'wet_skill': wet_skill,
            'drv_form3': self._mean(self.drv_fin.get(code, []), 3),
            'drv_form5': self._mean(self.drv_fin.get(code, []), 5),
            'drv_quali5': self._mean(self.drv_q.get(code, []), 5),
            'team_form5': self._mean(self.team_fin.get(team, []), 10),
            'team_quali5': self._mean(self.team_q.get(team, []), 10),
            'drv_dnf10': self._mean(self.drv_dnf.get(code, []), 10, 0.1),
            'team_dnf10': self._mean(self.team_dnf.get(team, []), 20, 0.1),
            'champ_pos': champ,
            'pts_share': (pts.get(code, 0) / lead) if lead else np.nan,
            'circ_hist': self._mean(self.drv_circ.get((code, circuit), []), 4),
            'circ_chaos': float(np.mean(circ[-60:])) if circ else np.nan,
            'round_frac': rnd / max(n_rounds, 1),
        }

    def rain_climate(self, circuit):
        """chance of a wet race at this circuit from its own history (a fair 'forecast' for old races)"""
        h = self.circ_wet.get(circuit, [])
        return (sum(h) + 0.15 * 4) / (len(h) + 4)

    def add(self, race, wet=False):
        circuit, season = race['circuit'], race['season']
        self.circ_wet.setdefault(circuit, []).append(1 if wet else 0)
        qpos = {q['Driver']['code']: int(q['position']) for q in race['quali']}
        sp = self.pts.setdefault(season, {})
        for r in race['results']:
            code, team = r['Driver']['code'], r['Constructor']['constructorId']
            fin, dnf = finish_pos(r), is_dnf(r)
            self.drv_fin.setdefault(code, []).append(fin)
            self.team_fin.setdefault(team, []).append(fin)
            self.drv_dnf.setdefault(code, []).append(1.0 if dnf else 0.0)
            self.team_dnf.setdefault(team, []).append(1.0 if dnf else 0.0)
            if code in qpos:
                self.drv_q.setdefault(code, []).append(qpos[code])
                self.team_q.setdefault(team, []).append(qpos[code])
            self.drv_circ.setdefault((code, circuit), []).append(fin)
            if int(r['grid']) > 0 and not dnf:
                self.circ.setdefault(circuit, []).append(abs(int(r['grid']) - fin))
                (self.wet_gain if wet else self.dry_gain).setdefault(code, []).append(int(r['grid']) - fin)
            sp[code] = sp.get(code, 0) + float(r['points'])

    def add_sprint(self, season, sprint_results):
        sp = self.pts.setdefault(season, {})
        for r in sprint_results:
            sp[r['Driver']['code']] = sp.get(r['Driver']['code'], 0) + float(r['points'])


def quali_feats(quali, code):
    """grid-independent qualifying info: position and gap to pole in %."""
    times = {q['Driver']['code']: min([t for t in (tsec(q.get('Q1')), tsec(q.get('Q2')), tsec(q.get('Q3'))) if t] or [np.nan])
             for q in quali}
    pole = np.nanmin(list(times.values())) if times else np.nan
    qp = {q['Driver']['code']: int(q['position']) for q in quali}
    t = times.get(code, np.nan)
    gap = (t / pole - 1) * 100 if (t == t and pole == pole) else np.nan
    return qp.get(code, np.nan), min(gap, 5.0) if gap == gap else np.nan


def fp1_lookup():
    """(date, code) -> (fp1 position, gap s) from OpenF1, 2023+."""
    out = {}
    for y in range(2023, LAST_YEAR + 1):
        p = os.path.join(D, f'of1_sessions_{y}.json')
        if not os.path.exists(p):
            continue
        sessions = load(f'of1_sessions_{y}.json')
        for s in sessions:
            if s['session_name'] != 'Race':
                continue
            fp1 = next((x for x in sessions if x['meeting_key'] == s['meeting_key'] and x['session_name'] == 'Practice 1'), None)
            dp = os.path.join(D, f"of1_drivers_{s['session_key']}.json")
            if not fp1 or not os.path.exists(os.path.join(D, f"of1_fp1_{fp1['session_key']}.json")) or not os.path.exists(dp):
                continue
            num2code = {d['driver_number']: d['name_acronym'] for d in load(dp)}
            rows = [r for r in load(f"of1_fp1_{fp1['session_key']}.json") if r.get('position')]
            best = [r.get('duration') for r in rows]
            best = [b if isinstance(b, (int, float)) else (min([x for x in b if x] or [np.nan]) if isinstance(b, list) else np.nan) for b in best]
            top = np.nanmin(best) if best else np.nan
            for r, b in zip(rows, best):
                c = num2code.get(r['driver_number'])
                if c:
                    out[(s['date_start'][:10], c)] = (r['position'], b - top if b == b else np.nan)
    return out


def build_pre_quali_rows(until=None):
    """Training rows for the pre and quali stages, 2019 on. until='YYYY-MM-DD' stops before that date
    (to rebuild exactly what was known before a past race)."""
    races = [r for r in jolpica_races() if until is None or r['date'] < until]
    fp1 = fp1_lookup()
    sprints = {}
    for y in range(2026, LAST_YEAR + 1):
        if os.path.exists(os.path.join(D, f'jolpica_sprint_{y}.json')):
            for sp in load(f'jolpica_sprint_{y}.json'):
                sprints[(y, int(sp['round']))] = sp['SprintResults']
    n_rounds = {}
    for r in races:
        n_rounds[r['season']] = max(n_rounds.get(r['season'], 0), r['round'])
    H, rows = History(), []
    wd = wet_dates()
    for race in races:
        nf = len(race['results'])
        wet = 1.0 if is_wet(race, wd) else 0.0
        clim = H.rain_climate(race['circuit'])
        for r in race['results']:
            code, team = r['Driver']['code'], r['Constructor']['constructorId']
            f = H.features(race['season'], race['round'], n_rounds[race['season']], race['circuit'], code, team)
            qp, qg = quali_feats(race['quali'], code)
            fpp, fpg = fp1.get((race['date'], code), (np.nan, np.nan))
            grid = int(r['grid']) if int(r['grid']) > 0 else nf
            f.update({'wet_race': wet, 'wet_x': wet * f['wet_skill'], 'rain_clim': clim,
                      'fp1_pos': fpp, 'fp1_gap': fpg, 'grid': grid, 'quali_pos': qp, 'quali_gap': qg,
                      'season': race['season'], 'round': race['round'], 'date': race['date'], 'circuit': race['circuit'],
                      'code': code, 'team': team, 'n_field': nf, 'target': finish_pos(r)})
            rows.append(f)
        H.add(race, wet=bool(wet))
        if (race['season'], race['round']) in sprints:
            H.add_sprint(race['season'], sprints[(race['season'], race['round'])])
    return pd.DataFrame(rows), H, races


def _parse_ts(s):
    return datetime.fromisoformat(s).timestamp() if s else None


def build_live_rows(pre_df, marks=(10, 20, 30, 40, 50, 60, 70)):
    """Training rows for the live stage from OpenF1 lap timing (2023+), joined to the pre/quali features."""
    rows = []
    jrows = pre_df.set_index(['date', 'code'])
    for y in range(2023, LAST_YEAR + 1):
        p = os.path.join(D, f'of1_sessions_{y}.json')
        if not os.path.exists(p):
            continue
        for s in load(f'of1_sessions_{y}.json'):
            if s['session_name'] != 'Race':
                continue
            k, date = s['session_key'], s['date_start'][:10]
            lp, sp, dp = (os.path.join(D, f'of1_{t}_{k}.json') for t in ('laps', 'stints', 'drivers'))
            if not all(os.path.exists(x) for x in (lp, sp, dp)):
                continue
            num2code = {d['driver_number']: d['name_acronym'] for d in load(dp)}
            laps, stints = load(lp), load(sp)
            # line-crossing time at the end of lap L for each driver
            by = {}
            for l in laps:
                by.setdefault(l['driver_number'], {})[l['lap_number']] = l
            cross = {}
            for n, ls in by.items():
                for L, l in ls.items():
                    nxt = ls.get(L + 1)
                    t = _parse_ts(nxt['date_start']) if nxt and nxt.get('date_start') else (
                        _parse_ts(l['date_start']) + l['lap_duration'] if l.get('date_start') and l.get('lap_duration') else None)
                    if t:
                        cross.setdefault(n, {})[L] = t
            total = max((max(ls) for ls in by.values()), default=0)
            if total < 30:
                continue
            day = pre_df[pre_df['date'] == date]
            if day.empty:
                # OpenF1 dates the session by its start; Jolpica by race day (same day for nearly all)
                continue
            # the usual every-10-laps marks, plus 5 and 2 laps from the end of every race, so the model
            # learns how races finish whatever their length
            for L in sorted(set(marks) | {total - 5, total - 2}):
                if L >= total or L < 1:
                    continue
                at = [(cross[n][L], n) for n in cross if L in cross[n]]
                if len(at) < 10:
                    continue
                at.sort()
                lead_t = at[0][0]
                for i, (t, n) in enumerate(at):
                    code = num2code.get(n)
                    if not code or (date, code) not in jrows.index:
                        continue
                    base = jrows.loc[(date, code)]
                    if isinstance(base, pd.DataFrame):
                        base = base.iloc[0]
                    st = [x for x in stints if x['driver_number'] == n and x.get('lap_start') and x['lap_start'] <= L]
                    st.sort(key=lambda x: x['stint_number'])
                    cur = st[-1] if st else None
                    comp = COMPOUND.get((cur or {}).get('compound') or '', np.nan)
                    age = ((cur.get('tyre_age_at_start') or 0) + L - cur['lap_start'] + 1) if cur else np.nan
                    r = {c: base[c] for c in QUALI if c in LIVE}
                    r.update({'cur_pos': i + 1, 'gap_leader': min(t - lead_t, 200.0),
                              'gap_ahead': min(t - at[i - 1][0], 60.0) if i else 0.0,
                              'gap_behind': min(at[i + 1][0] - t, 60.0) if i + 1 < len(at) else 60.0,
                              'lap_frac': L / total, 'laps_left': total - L, 'compound': comp, 'tyre_age': age,
                              'stops': (cur['stint_number'] - 1) if cur else np.nan, 'wet': 1.0 if comp in (3, 4) else 0.0,
                              'wet_now_x': (1.0 if comp in (3, 4) else 0.0) * base['wet_skill'],
                              'pos_gained': base['grid'] - (i + 1),
                              'season': y, 'date': date, 'code': code, 'lap': L, 'target': base['target'],
                              'mark': 'std' if L in marks else 'late'})
                    rows.append(r)
    df = pd.DataFrame(rows)
    return add_virtual(df, ['date', 'lap']) if len(df) else df

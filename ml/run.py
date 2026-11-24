"""The F1 ML model on real race weekends. Run by GitHub Actions (.github/workflows/ml.yml).

Each run works out what is due for the current weekend and does only that:
  pre    after FP1, before qualifying: the finishing order + win chances (rain forecast mixed in)
  quali  after qualifying, before the race
  live   during the race: a new call every lap from the site's live timing (Supabase `sessions`)
  score  once a race is over: each saved call is scored with the site's accuracy formula
Calls are saved to the private table ml_predictions (shown only in Pit Wall) through the
ml_ingest / ml_score functions, which need ML_KEY. The site's AI is not touched.

  python ml/run.py                 the scheduled run
  python ml/run.py --dry --round 21   rebuild a past weekend exactly as it was known then, print, save nothing
Env: SB_URL, SB_ANON (public anon key), ML_KEY (secret; not needed with --dry).
"""
import json, os, sys, time, subprocess, urllib.request, urllib.parse
from datetime import datetime, timezone
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import COMPOUND, build_pre_quali_rows, build_live_rows, add_virtual  # noqa: E402
from train import STAGES, RANKED, EXTRA, add_ranks, fit, fit_win, predict, temper, site_accuracy  # noqa: E402

TUNE = json.load(open(os.path.join(HERE, 'tune.json')))['tune']
SB_URL = os.environ.get('SB_URL', 'https://zeqxzyisqwemqsvspbyj.supabase.co').rstrip('/')
SB_ANON = os.environ.get('SB_ANON', '')
if not SB_ANON:  # the public anon key the site itself ships (admin.html); read-only by design
    import re
    _m = re.search(r"const SB_ANON = '([^']+)'", open(os.path.join(HERE, '..', 'admin.html')).read())
    SB_ANON = _m.group(1) if _m else ''
ML_KEY = os.environ.get('ML_KEY', '')
ARGS = sys.argv[1:]
DRY = '--dry' in ARGS
FORCE_ROUND = int(ARGS[ARGS.index('--round') + 1]) if '--round' in ARGS else None
UA = {'User-Agent': 'f1-predictor-ml/1.0'}
MIN = 60.0


def log(*a):
    print(datetime.now(timezone.utc).strftime('%H:%M:%S'), *a, flush=True)


def http(url, body=None, headers=None, timeout=40):
    h = dict(UA, **(headers or {}))
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=h, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        txt = r.read().decode()
    return json.loads(txt) if txt else None


def try_http(url, tries=3, **kw):
    for k in range(tries):
        try:
            return http(url, **kw)
        except Exception as e:  # network blips, 5xx
            if k == tries - 1:
                log('request failed', url.split('?')[0], str(e)[:120])
            time.sleep(3 * (k + 1))
    return None


def sb_headers():
    return {'apikey': SB_ANON, 'Authorization': f'Bearer {SB_ANON}'}


def rpc(name, args):
    return http(f'{SB_URL}/rest/v1/rpc/{name}', body=args, headers=sb_headers())


# ---- calendar ------------------------------------------------------------------
def load_season():
    out = subprocess.run(['node', os.path.join(HERE, 'season.mjs')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def at(date, hhmm):
    return datetime.fromisoformat(f'{date}T{hhmm}:00+00:00').timestamp() if date and hhmm else None


def times(r):
    t = {'fp1': at(r.get('fp1Date'), r.get('fp1UTC')), 'quali': at(r.get('qualiDate'), r.get('qualiUTC')),
         'race': at(r.get('date'), r.get('raceUTC') or '13:00')}
    t['fp1_end'] = (t['fp1'] or t['quali'] - 26 * 3600) + 60 * MIN
    t['quali_end'] = t['quali'] + 60 * MIN if t['quali'] else t['race'] - 20 * 3600
    t['race_end'] = t['race'] + 120 * MIN
    return t


# ---- the weekend's public data --------------------------------------------------
def of1(path):
    return try_http('https://api.openf1.org/v1/' + path) or []


def of1_session(year, name, date):
    for s in of1(f'sessions?year={year}&session_name={urllib.parse.quote(name)}'):
        if (s.get('date_start') or '')[:10] == date:
            return s
    return None


def best_time(d):
    if isinstance(d, (int, float)):
        return float(d)
    if isinstance(d, list):
        v = [x for x in d if isinstance(x, (int, float))]
        return min(v) if v else np.nan
    return np.nan


def session_table(year, name, date):
    """[(pos, code, team_name, best lap s)] for an OpenF1 session that has finished, else None."""
    s = of1_session(year, name, date)
    if not s:
        return None
    res = [r for r in of1(f"session_result?session_key={s['session_key']}") if r.get('position')]
    if len(res) < 10:
        return None
    drv = {d['driver_number']: d for d in of1(f"drivers?session_key={s['session_key']}")}
    rows = []
    for r in sorted(res, key=lambda r: r['position']):
        d = drv.get(r['driver_number'], {})
        if d.get('name_acronym'):
            rows.append((r['position'], d['name_acronym'], d.get('team_name', ''), best_time(r.get('duration'))))
    return rows or None


def rain_forecast(r, H):
    """Open-Meteo's chance of rain on race day (free, no key); further out than its 16 days, the circuit's own history."""
    if r.get('lat') is not None:
        u = (f"https://api.open-meteo.com/v1/forecast?latitude={r['lat']}&longitude={r['lon']}"
             f"&daily=precipitation_probability_max&timezone=UTC&start_date={r['date']}&end_date={r['date']}")
        j = try_http(u)
        v = (((j or {}).get('daily') or {}).get('precipitation_probability_max') or [None])[0]
        if isinstance(v, (int, float)):
            return v / 100.0, 'forecast'
    return H.rain_climate(r['circuitId']), 'circuit history'


# ---- the model --------------------------------------------------------------------
class Weekend:
    def __init__(self, season, r, n_rounds, need_live=False):
        self.season, self.r, self.n_rounds = season, r, n_rounds
        until = r['date']                 # only what was known before this race
        pre, H, races = build_pre_quali_rows(until=until)
        pre = add_ranks(pre, 'date')
        self.H, self.races = H, races
        self.models = {}
        for st in ('pre', 'quali'):
            cols, base, _ = STAGES[st]
            self.models[st] = (fit(pre, cols, base), fit_win(pre, cols))
        if need_live:
            live = build_live_rows(pre)
            live = live.merge(pre[['date', 'code', 'rain_clim'] + EXTRA + ['base_pre']], on=['date', 'code'], how='left')
            cols, base, _ = STAGES['live']
            self.models['live'] = (fit(live, cols, base), fit_win(live, cols))
        self.lineup = self._lineup()
        log(f"trained on {len(pre)} driver-races before {until}" + (' (+ live)' if need_live else ''))

    def _lineup(self):
        last = [x for x in self.races if x['season'] == self.season] or self.races[-1:]
        return {res['Driver']['code']: res['Constructor']['constructorId'] for res in last[-1]['results']}

    def seat(self, code, team_name, table):
        """a driver new to the grid gets the team of a known driver with the same OpenF1 team name"""
        if code in self.lineup:
            return self.lineup[code]
        for _, c, tn, _ in table or []:
            if tn == team_name and c in self.lineup:
                return self.lineup[c]
        return 'unknown'

    def frame(self, fp1, quali):
        r = self.r
        entry = quali or fp1 or [(i + 1, c, '', np.nan) for i, c in enumerate(self.lineup)]
        teams = {c: self.seat(c, tn, entry) for _, c, tn, _ in entry}
        fp = {c: (p, t) for p, c, _, t in (fp1 or [])}
        fp_top = np.nanmin([t for *_, t in fp1]) if fp1 else np.nan
        q = {c: (p, t) for p, c, _, t in (quali or [])}
        pole = np.nanmin([t for *_, t in quali]) if quali else np.nan
        rows = []
        for code, team in teams.items():
            f = self.H.features(self.season, r['round'], self.n_rounds, r['circuitId'], code, team)
            fpp, fpt = fp.get(code, (np.nan, np.nan))
            qp, qt = q.get(code, (np.nan, np.nan))
            f.update({'code': code, 'team': team, 'fp1_pos': fpp, 'fp1_gap': fpt - fp_top if fpt == fpt else np.nan,
                      'grid': qp if qp == qp else len(teams), 'quali_pos': qp,
                      'quali_gap': min((qt / pole - 1) * 100, 5.0) if (qt == qt and pole == pole) else np.nan,
                      'wet_race': 0.0, 'wet_x': 0.0})
            rows.append(f)
        df = pd.DataFrame(rows)
        for c in RANKED:
            df[c + '_rk'] = df[c].rank(method='average', na_option='keep')
        df['base_pre'] = df[['champ_pos_rk', 'drv_quali5_rk', 'team_quali5_rk']].mean(axis=1).fillna(10.5)
        return df

    def call(self, frame, stage, p_rain=0.0):
        cols, base, _ = STAGES[stage]
        m, mw = self.models[stage]
        key = pd.Series(np.zeros(len(frame)), index=frame.index)
        score, pwin = predict(m, mw, frame, cols, base, p_rain, key)
        score = frame[base].values + TUNE[stage]['lam'] * (score - frame[base].values)
        pwin = temper(pwin, TUNE[stage]['T'], key)
        order = np.argsort(score, kind='stable')
        codes = frame['code'].values
        return [codes[i] for i in order[:10]], {codes[i]: round(float(pwin[i]) * 100, 1) for i in order}


def parse_gap(g, lap_s):
    g = str(g or '').strip().upper().replace('+', '')
    if not g or g in ('LEADER', 'INTERVAL'):
        return 0.0
    if g.endswith('L') or 'LAP' in g:
        n = ''.join(ch for ch in g if ch.isdigit())
        return lap_s * (int(n) if n else 1)
    try:
        return float(g)
    except ValueError:
        return np.nan


def live_frame(base_df, cars, lap_s=90.0):
    """the site's live timing row -> model rows (cars sorted by position, retired cars dropped)"""
    cars = sorted([c for c in cars if c.get('abbr')], key=lambda c: c.get('pos') or 99)
    lead_lap = max([c.get('curLap') or c.get('lap') or 0 for c in cars] or [0])
    total = max([c.get('totalLaps') or 0 for c in cars] or [0])
    # a car far behind the leader's lap count has stopped
    cars = [c for c in cars if (lead_lap if c.get('lap') is None else c['lap']) >= lead_lap - 3]
    gaps = []
    for i, c in enumerate(cars):
        g = 0.0 if i == 0 else (parse_gap(c['gap'], lap_s) if c.get('gap') else np.nan)  # blank = unknown
        gaps.append(g if g == g else (gaps[-1] + 1.0 if gaps else 0.0))
    rows = []
    for i, c in enumerate(cars):
        b = base_df[base_df.code == c['abbr']]
        if b.empty:
            continue
        b = b.iloc[0].to_dict()
        comp = COMPOUND.get(str(c.get('tyre') or '').upper(), np.nan)
        wet_now = 1.0 if comp in (3, 4) else 0.0
        b.update({'cur_pos': i + 1, 'gap_leader': min(gaps[i], 200.0), 'gap_ahead': min(gaps[i] - gaps[i - 1], 60.0) if i else 0.0,
                  'gap_behind': min(gaps[i + 1] - gaps[i], 60.0) if i + 1 < len(cars) else 60.0,
                  'lap_frac': lead_lap / max(total, 1), 'laps_left': max(total - lead_lap, 0), 'compound': comp,
                  'tyre_age': c.get('tyreAge', np.nan), 'stops': c.get('pitCount', np.nan), 'in_pit': bool(c.get('inPit')),
                  'wet': wet_now, 'wet_now_x': wet_now * b['wet_skill'], 'pos_gained': b['grid'] - (i + 1), 'lap': lead_lap})
        rows.append(b)
    if len(rows) < 5:
        return None, lead_lap, total
    return add_virtual(pd.DataFrame(rows), 'lap'), lead_lap, total


# ---- saving -------------------------------------------------------------------------
def save(season, r, stage, lap, top10, win, info):
    row = {'season': season, 'round': r['round'], 'circuit_id': r['circuitId'], 'stage': stage, 'lap': lap,
           'top10': top10, 'win': win, 'info': info}
    fav = max(win, key=win.get) if win else '-'
    log(f"{stage}{' L' + str(lap) if lap else ''}: {' '.join(top10)} | P1 {win.get(top10[0])}% | favourite {fav} {win.get(fav)}%")
    if DRY:
        return
    rpc('ml_ingest', {'p_key': ML_KEY, 'p_rows': [row]})


def status(season):
    if DRY:
        return []
    return rpc('ml_status', {'p_key': ML_KEY, 'p_season': season}) or []


def score_due(season, races, st, now):
    """score every saved call of a finished race that has no score yet"""
    todo = sorted({x['round'] for x in st if x.get('accuracy') is None})
    for rnd in todo:
        r = next((x for x in races if x['round'] == rnd), None)
        if not r or now < times(r)['race_end'] + 2 * 3600:
            continue
        j = try_http(f'https://api.jolpi.ca/ergast/f1/{season}/{rnd}/results.json')
        res = (((j or {}).get('MRData') or {}).get('RaceTable') or {}).get('Races') or []
        if not res:
            log(f'round {rnd}: no official result yet')
            continue
        actual = [x['Driver']['code'] for x in sorted(res[0]['Results'], key=lambda x: int(x['position']))]
        rows = [{'season': season, 'round': rnd, 'stage': x['stage'], 'lap': x['lap'],
                 'accuracy': site_accuracy(x['top10'], actual), 'winner_hit': bool(x['top10'] and x['top10'][0] == actual[0])}
                for x in st if x['round'] == rnd and x.get('accuracy') is None]
        rpc('ml_score', {'p_key': ML_KEY, 'p_rows': rows, 'p_actual': actual})
        log(f'round {rnd}: scored {len(rows)} calls, winner {actual[0]}')


def collect():
    log('downloading new data')
    subprocess.run(['node', os.path.join(HERE, 'collect.mjs')], check=True)
    open(os.path.join(os.environ.get('ML_DATA') or os.path.join(HERE, 'data'), '.updated'), 'w').write(str(time.time()))


def live_loop(wk, season, r, df, have_laps, until):
    lap_s = 90.0
    last = max(have_laps or [0])
    q = urllib.parse.urlencode({'circuit_id': f"eq.{r['circuitId']}", 'round': f"eq.{r['round']}", 'year': f'eq.{season}',
                                'session_name': 'eq.Race', 'select': 'grid_data,is_live,fetched_at', 'order': 'fetched_at.desc', 'limit': 1})
    while time.time() < until:
        rows = try_http(f'{SB_URL}/rest/v1/sessions?{q}', headers=sb_headers()) or []
        cars = rows[0]['grid_data'] if rows and isinstance(rows[0].get('grid_data'), list) else []
        if cars and any(c.get('gap') for c in cars):
            lf, lap, total = live_frame(df, cars, lap_s)
            if lf is not None and lap > last and lap >= 1:
                top10, win = wk.call(lf, 'live')
                save(season, r, 'live', int(lap), top10, win, {'laps': int(total), 'cars': len(lf)})
                last = lap
                if total and lap >= total:
                    log('chequered flag'); return
        if DRY:
            return
        time.sleep(20)
    log('live window over')


def main():
    if not DRY and len(ML_KEY) < 32:
        log('ML_KEY is not set (GitHub: Settings > Secrets and variables > Actions), nothing to do'); return
    S = load_season()
    season, races = S['season'], S['races']
    now = time.time()
    st = status(season)
    if not DRY:
        score_due(season, races, st, now)
    if FORCE_ROUND:
        r = next(x for x in races if x['round'] == FORCE_ROUND)
    else:
        r = next((x for x in races if times(x)['race_end'] + 4 * 3600 > now), None)
    if not r:
        log('season over'); return
    t = times(r)
    have = {(x['stage'], x['lap']) for x in st if x['round'] == r['round']}
    pre_due = DRY or (t['fp1_end'] + 20 * MIN <= now < t['quali'] and ('beforeQuali', 0) not in have)
    quali_due = DRY or (t['quali_end'] + 15 * MIN <= now < t['race'] and ('afterQuali', 0) not in have)
    live_due = DRY or (t['race'] - 45 * MIN <= now < t['race_end'] + 75 * MIN)
    log(f"{season} round {r['round']} {r['circuitId']}: pre {pre_due} quali {quali_due} live {live_due}")
    if not (pre_due or quali_due or live_due):
        return
    year = int(r['date'][:4])
    fp1 = session_table(year, 'Practice 1', r.get('fp1Date')) if r.get('fp1Date') else None
    quali = session_table(year, 'Qualifying', r.get('qualiDate')) if (quali_due or live_due) else None
    if pre_due and not fp1 and not DRY and now < t['quali'] - 90 * MIN:
        log('FP1 results not out yet, trying again next run'); pre_due = False
    if quali_due and not quali:
        log('qualifying results not out yet'); quali_due = False
    if not (pre_due or quali_due or live_due):
        return
    if not DRY:
        collect()
    wk = Weekend(season, r, len(races), need_live=live_due)
    p_rain, src = rain_forecast(r, wk.H)
    info = {'rain': round(p_rain, 2), 'rain_source': src, 'fp1': bool(fp1), 'quali': bool(quali)}
    if pre_due:
        top10, win = wk.call(wk.frame(fp1, None), 'pre', p_rain)
        save(season, r, 'beforeQuali', 0, top10, win, info)
    if quali_due:
        top10, win = wk.call(wk.frame(fp1, quali), 'quali', p_rain)
        save(season, r, 'afterQuali', 0, top10, win, info)
    if live_due:
        df = wk.frame(fp1, quali)
        live_loop(wk, season, r, df, [x[1] for x in have if x[0] == 'live'], t['race_end'] + 75 * MIN)


if __name__ == '__main__':
    main()

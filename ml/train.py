"""Trains the F1 models and checks them honestly on 2026 races they never saw.

Two kinds of model per stage (pre = before qualifying, quali = after it, live = during the race):
  order model  starts from the simple answer (form blend / the grid / the running order) and learns only
               the CORRECTION to it. A correction of zero falls back to the simple answer.
  win model    the chance each driver wins, learned directly (a yes/no model), then scaled so the
               field adds up to 100%. This replaced simulating the order model's average error, which
               was far too cautious at the end of a race.

Rain: before the race nobody knows if it will be wet. The order and win models are trained with what
really happened (wet_race), and a prediction runs them twice, dry and wet, mixed by the forecast's chance
of rain. Old races get a fair stand-in forecast: how often that circuit has been wet before.

How it is checked: walk-forward through 2026. Before each 2026 race the models are trained on everything
before that race only, then scored on it with the site's own accuracy formula.
  python train.py
Writes models/*.txt and models/meta.json.
"""
import json, os
import numpy as np
import pandas as pd
import lightgbm as lgb
from features import PRE, QUALI, LIVE, build_pre_quali_rows, build_live_rows

HERE = os.path.dirname(__file__)
os.makedirs(os.path.join(HERE, 'models'), exist_ok=True)
PARAMS = dict(objective='huber', alpha=3.0, learning_rate=0.03, num_leaves=7, min_data_in_leaf=60,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=7)
WIN_PARAMS = dict(objective='binary', learning_rate=0.03, num_leaves=7, min_data_in_leaf=40, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=7)
ROUNDS = 300
RANKED = ['drv_form3', 'drv_form5', 'drv_quali5', 'team_form5', 'team_quali5', 'champ_pos', 'fp1_pos', 'circ_hist', 'wet_skill']
EXTRA = [c + '_rk' for c in RANKED]
WEATHER = {'wet_race', 'wet_skill', 'wet_x', 'wet_now_x', 'wet_skill_rk'}


def weights(seasons):
    # the latest season counts most (2026 brought a new rulebook): x4, the one before x1.5, then x1.2
    latest = seasons.max()
    return seasons.map(lambda y: {0: 4.0, 1: 1.5, 2: 1.2}.get(latest - y, 1.0))


def add_ranks(df, key):
    """Where a driver stands among THIS race's field, which survives rule changes better than raw numbers."""
    for c in RANKED:
        df[c + '_rk'] = df.groupby(key)[c].rank(method='average', na_option='keep')
    # the simple answer the pre-quali stage corrects
    # (chosen on 2024-2025 only: the blend beat each part alone, 35-36% vs 30-34%)
    df['base_pre'] = df[['champ_pos_rk', 'drv_quali5_rk', 'team_quali5_rk']].mean(axis=1).fillna(10.5)
    return df


def site_accuracy(pred, actual):
    """Exactly the site's calcAccuracy: top 10, exact = 1, within 2 places = 0.5."""
    n = min(len(pred), len(actual), 10)
    ex = cl = 0
    for i in range(n):
        if pred[i] == actual[i]:
            ex += 1
            continue
        if pred[i] in actual and abs(actual.index(pred[i]) - i) <= 2:
            cl += 1
    return round((ex + cl * 0.5) / n * 100) if n else None


def order_of(g, col):
    return list(g.sort_values(col, kind='stable')['code'])


def fit(df, cols, base):
    y = df['target'] - df[base]
    return lgb.train(PARAMS, lgb.Dataset(df[cols], y, weight=weights(df['season'])), num_boost_round=ROUNDS)


# more gap to the front can never raise the chance of winning; more cushion behind can never lower it
MONO = {'cur_pos': -1, 'gap_leader': -1, 'virt_pos': -1, 'virt_gap': -1, 'catch_rate': -1, 'virt_catch': -1,
        'base_live': -1, 'cushion_rate': 1, 'grid': -1}


def fit_win(df, cols):
    y = (df['target'] == 1).astype(int)
    p = dict(WIN_PARAMS, monotone_constraints=[MONO.get(c, 0) for c in cols], monotone_constraints_method='advanced')
    return lgb.train(p, lgb.Dataset(df[cols], y, weight=weights(df['season'])), num_boost_round=ROUNDS)


def with_wet(frame, w):
    f = frame.copy()
    f['wet_race'] = float(w)
    f['wet_x'] = f['wet_race'] * f['wet_skill']
    return f


def norm(p, groups):
    s = pd.Series(p).groupby(groups.values).transform('sum').values
    return p / np.where(s > 0, s, 1)


def predict(m, mw, frame, cols, base, p_rain, groups):
    """order score and win chance, mixed over dry/wet when the stage uses the weather."""
    if 'wet_race' not in cols:
        return frame[base].values + m.predict(frame[cols]), norm(mw.predict(frame[cols]), groups)
    sd, sw = (frame[base].values + m.predict(with_wet(frame, w)[cols]) for w in (0, 1))
    pd_, pw = (norm(mw.predict(with_wet(frame, w)[cols]), groups) for w in (0, 1))
    return (1 - p_rain) * sd + p_rain * sw, (1 - p_rain) * pd_ + p_rain * pw


STAGES = {'pre': (PRE + EXTRA, 'base_pre', 'form blend (champ + quali form)'),
          'quali': (QUALI + EXTRA, 'grid', 'starting-grid order'),
          'live': (LIVE + EXTRA, 'base_live', 'running order (stop-adjusted from 1/4 distance)')}

def walk(pre, live, season):
    """Walk-forward through one season: per race (and lap), the pieces of every prediction."""
    out = {}
    dates = sorted(pre.loc[pre.season == season, 'date'].unique())
    for stage in ('pre', 'quali', 'live'):
        cols, base, _ = STAGES[stage]
        data = live if stage == 'live' else pre
        frames = []
        for d in dates:
            tr, te = data[data.date < d], data[data.date == d].copy()
            if te.empty or len(tr) < 200:
                continue
            m, mw = fit(tr, cols, base), fit_win(tr, cols)
            for k, g in (te.groupby('lap') if stage == 'live' else [(None, te)]):
                g = g.copy()
                key = pd.Series(np.zeros(len(g)), index=g.index)
                score, pwin = predict(m, mw, g, cols, base, float(g['rain_clim'].iloc[0]), key)
                g['corr'], g['pwin'], g['race'] = score - g[base].values, pwin, f'{d}_{k}'
                frames.append(g)
        out[stage] = pd.concat(frames) if frames else pd.DataFrame()
    return out


def temper(p, T, groups):
    q = np.power(np.clip(p, 1e-6, 1), T)
    return norm(q, groups)


def evaluate(f, base, lam, T):
    """site accuracy, winner hit, chance given to the real winner, for one setting of shrink/temper."""
    f = f.copy()
    f['pred'] = f[base] + lam * f['corr']
    f['pw'] = temper(f['pwin'].values, T, f['race'])
    rows = []
    for race, g in f.groupby('race', sort=False):
        actual = order_of(g, 'target')
        pred = order_of(g, 'pred')
        i = list(g['code']).index(actual[0])
        j = int(np.argmax(g['pw'].values))
        rows.append({'race': race, 'lap': g['lap'].iloc[0] if 'lap' in g else None, 'acc': site_accuracy(pred, actual),
                     'b_acc': site_accuracy(order_of(g, base), actual), 'win': pred[0] == actual[0],
                     'b_win': order_of(g, base)[0] == actual[0], 'p_winner': float(g['pw'].values[i]),
                     'p_pick': float(g['pw'].values[j]), 'pick_won': g['code'].values[j] == actual[0]})
    return pd.DataFrame(rows)


LAMS = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25]
TS = [0.4, 0.55, 0.7, 0.85, 1.0, 1.2, 1.4]

if __name__ == '__main__':
    pre, H, races = build_pre_quali_rows()
    pre = add_ranks(pre, 'date')
    live = build_live_rows(pre)
    live = live.merge(pre[['date', 'code', 'rain_clim'] + EXTRA + ['base_pre']], on=['date', 'code'], how='left')
    print(f'rows: pre/quali {len(pre)} ({pre.season.min()}-{pre.season.max()}), live {len(live)} '
          f'({live.season.min()}-{live.season.max()}, {live.date.nunique()} races)')

    # 1) choose how much of the correction to apply and how sharp the win chances are, on 2025 ONLY
    w25 = walk(pre, live, 2025)
    tune = {}
    for stage, f in w25.items():
        base = STAGES[stage][1]
        lam = max(LAMS, key=lambda l: (evaluate(f, base, l, 1.0).acc.mean(), -abs(l - 1)))
        T = min(TS, key=lambda t: -np.log(np.clip(evaluate(f, base, lam, t).p_winner, 1e-3, 1)).mean())
        tune[stage] = {'lam': lam, 'T': T}
        print(f'2025 tuning {stage:5}: apply {lam:.2f} of the correction, win sharpness {T}')

    # 2) the honest check: 2026, with those settings fixed
    w26 = walk(pre, live, 2026)
    report = {}
    for stage, f in w26.items():
        base, base_name = STAGES[stage][1], STAGES[stage][2]
        new = evaluate(f, base, tune[stage]['lam'], tune[stage]['T'])
        raw = evaluate(f, base, 1.0, 1.0)
        ll = lambda r: round(float(-np.log(np.clip(r.p_winner, 1e-3, 1)).mean()), 3)
        def summ(g, gr):
            return {'model_acc': round(g.acc.mean(), 1), 'untuned_acc': round(gr.acc.mean(), 1), 'base_acc': round(g.b_acc.mean(), 1),
                    'model_win': round(g.win.mean() * 100), 'base_win': round(g.b_win.mean() * 100), 'races': len(g),
                    'favourite_won': round(g.pick_won.mean() * 100),
                    'chance_given_to_winner': round(g.p_winner.mean() * 100, 1)}
        if stage == 'live':
            report['live'] = {}
            raw_late = evaluate(f[f['mark'] == 'late'], base, tune[stage]['lam'], tune[stage]['T'])
            print(f"live final laps ({len(raw_late)} snapshots, 2 or 5 to go): model {raw_late.acc.mean():5.1f}% "
                  f"base {raw_late.b_acc.mean():5.1f}% | chance to winner {raw_late.p_winner.mean()*100:5.1f}%")
            new, raw = (evaluate(f[f['mark'] == 'std'], base, l_, T_) for l_, T_ in ((tune[stage]['lam'], tune[stage]['T']), (1.0, 1.0)))
            for L in sorted(new.lap.unique()):
                s_ = summ(new[new.lap == L], raw[raw.lap == L]); report['live'][int(L)] = s_
                print(f"live L{int(L):<3}({s_['races']:2}): model {s_['model_acc']:5.1f}% (untuned {s_['untuned_acc']:5.1f}) | "
                      f"{base_name} {s_['base_acc']:5.1f}% | winner: P1 {s_['model_win']}% fav {s_['favourite_won']}% base {s_['base_win']}% | chance to winner {s_['chance_given_to_winner']:5.1f}%")
        else:
            report[stage] = summ(new, raw) | {'baseline': base_name}
            s_ = report[stage]
            print(f"{stage:6}({s_['races']:2}): model {s_['model_acc']:5.1f}% (untuned {s_['untuned_acc']:5.1f}) winner {s_['model_win']}% | "
                  f"{base_name} {s_['base_acc']:5.1f}% winner {s_['base_win']}% | chance given to the winner {s_['chance_given_to_winner']}%")
        bins = pd.cut(new.p_pick, [0, .2, .4, .6, .8, 1.0])
        cal = new.groupby(bins, observed=True).agg(n=('pick_won', 'size'), said=('p_pick', 'mean'), won=('pick_won', 'mean'))
        report.setdefault('calibration', {})[stage] = [{'said': round(a.said * 100), 'won': round(a.won * 100), 'n': int(a.n)} for _, a in cal.iterrows()]
        print(f"   log-loss on the winner {ll(new)} (untuned {ll(raw)}) | when it says X% its pick wins: "
              f"{[(c['said'], c['won'], c['n']) for c in report['calibration'][stage]]}")

    # 3) final models on everything
    sig = {}
    for stage in ('pre', 'quali', 'live'):
        cols, base, _ = STAGES[stage]
        data = live if stage == 'live' else pre
        fit(data, cols, base).save_model(os.path.join(HERE, 'models', f'{stage}.txt'))
        fit_win(data, cols).save_model(os.path.join(HERE, 'models', f'win_{stage}.txt'))
    json.dump({'tune': tune, 'report': report, 'extra': EXTRA, 'ranked': RANKED}, open(os.path.join(HERE, 'models', 'meta.json'), 'w'), indent=1)
    imp = pd.Series(lgb.Booster(model_file=os.path.join(HERE, 'models', 'quali.txt')).feature_importance('gain'), index=STAGES['quali'][0])
    print('biggest after-quali corrections come from:', ', '.join(imp.sort_values(ascending=False).index[:6]))

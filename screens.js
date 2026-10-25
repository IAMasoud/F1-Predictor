/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
/* The Lights Out screens. Loaded after app.js and built on its data (drivers, completedRaces,
   cachedPredictions, SEASON_RACES, qualifyingGrid …): Predict with tabs, the Live timing tower,
   Reality side by side, the Season title fight, Calendar with the next weekend first, Analytics
   (how good the AI is) and More. The old blocks stay in the page, hidden, so nothing that writes
   to them breaks. */

const SCR = { tab: 'order', reality: null, h2h: null, liveTimer: null, liveRow: null, calDone: false, allDrivers: false, howOpen: false, archStage: null, archType: 'race' };
const SCR_STAGES = ['afterQuali', 'afterSprint', 'afterSprintQ', 'beforeQuali', 'beforeSprintQ'];
const SCR_ICON = {
  chev: '<path d="M9 6l6 6-6 6"/>',
  season: '<path d="M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0z"/><path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  arch: '<path d="M4 5h16v4H4zM6 9v10h12V9M10 13h4"/>',
  pits: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>',
};
const scrIco = (k, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SCR_ICON[k]}</svg>`;

/* ── small helpers over app.js data ── */
function scrDrv(x){
  const a = String(x || '').toUpperCase();
  return drivers.find(d => d.abbr === a) || drivers.find(d => d.driverId === x) ||
         BASE_DRIVERS.find(d => d.abbr === a || d.driverId === x) || null;
}
const scrAbbr = x => driverAbbr(x);
const scrSurname = a => { const d = scrDrv(a); return d ? String(d.name || a).trim().split(/\s+/).slice(-1)[0] : a; };
const scrCol = a => teamCol(scrDrv(a)?.team || '');
const scrTeam = a => teamName(scrDrv(a)?.team || '') || '';
const scrGPs = () => (completedRaces || []).filter(r => !String(r.round).endsWith('S') && r.results?.length);
const scrShort = n => String(n || '').replace(/ Grand Prix.*$/i, '').replace(/\s*\(.*\)$/, '');
function scrRaces(){ return Object.values(SEASON_RACES || {}).sort((a, b) => a.round - b.round); }
function scrRaceEnd(r){ return r?.date && r?.raceUTC ? Date.parse(`${r.date}T${r.raceUTC}:00Z`) + 2 * 3600e3 : r?.date ? Date.parse(`${r.date}T23:59:00Z`) : 0; }
function scrAt(d, t){ return d && t ? Date.parse(`${d}T${t}:00Z`) : null; }
function scrLocal(ms, o = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }){ return ms ? new Date(ms).toLocaleString(undefined, o) : '—'; }
const scrTime = ms => scrLocal(ms, { hour: 'numeric', minute: '2-digit' });
function scrAgo(ms){ const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; }
const scrWin = v => (v == null || v === '' || isNaN(+v)) ? '—' : (+v < 1 ? '<1%' : `${Math.round(+v)}%`);

function scrRow(abbr, right = '', pos = null){
  return `<div class="trow">${pos != null ? `<div class="pbox">${pos}</div>` : ''}<i class="slash" style="background:${scrCol(abbr)}"></i><span class="code">${esc(abbr)}</span><span class="nm">${esc(scrSurname(abbr))}</span>${right}</div>`;
}

/* The AI's last call before a race (what gets scored): real AI first, then baseline. */
function scrBestSnap(circuitId, round){
  const rows = (cachedPredictions || []).filter(p => p.circuit_id === circuitId && String(p.round) === String(round) && p.pred_type === 'race' && p.prediction?.top10?.length);
  const rank = p => (p.prediction._fallback ? 100 : 0) + (SCR_STAGES.indexOf(p.stage) + 1 || 50);
  return rows.sort((a, b) => rank(a) - rank(b))[0] || null;
}
/* Same scoring as the server: exact place = 1, within two places = 0.5, over the top 10. */
function scrScore(pred, act){
  const n = Math.min(pred.length, act.length, 10);
  let exact = 0, close = 0; const marks = [];
  for(let i = 0; i < n; i++){
    if(pred[i] === act[i]){ exact++; marks.push('on'); continue; }
    const j = act.indexOf(pred[i]);
    if(j >= 0 && Math.abs(j - i) <= 2){ close++; marks.push('half'); } else marks.push('');
  }
  return { n, exact, close, missed: n - exact - close, pct: n ? Math.round((exact + close * .5) / n * 100) : null, marks };
}
function scrSeasonAI(){
  return scrGPs().map(r => {
    const s = scrBestSnap(r.circuitId, r.round);
    if(!s) return null;
    const pred = s.prediction.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99)).map(d => String(d.abbr || scrAbbr(d.driverId)).toUpperCase());
    const act = r.results.map(scrAbbr);
    const sc = scrScore(pred, act);
    return { round: +r.round, name: r.raceName, circuitId: r.circuitId, snap: s, baseline: !!s.prediction._fallback,
      pct: s.accuracy ?? sc.pct, sc, pred, act, called: pred[0], winner: act[0] };
  }).filter(Boolean).sort((a, b) => a.round - b.round);
}

/* ═══════════════ 1B · PREDICT ═══════════════ */
function scrGantry(race){
  const now = Date.now(), clock = loClockText(race), sessions = loSessions(race);
  const sr = SEASON_RACES[race.circuitId] || {};
  const startOf = label => ({ FP1: scrAt(sr.fp1Date, sr.fp1UTC), FP2: scrAt(sr.fp2Date, sr.fp2UTC), FP3: scrAt(sr.fp3Date, sr.fp3UTC),
    SQ: scrAt(sr.sprintQualiDate, sr.sprintQualiUTC), Sprint: scrAt(sr.sprintDate, sr.sprintUTC), Quali: scrAt(sr.qualiDate, sr.qualiUTC), Race: scrAt(sr.date, sr.raceUTC) })[label];
  const key = `f1_lo_lit_${SEASON}_${race.circuitId}`;
  let seen = 0; try{ seen = +localStorage.getItem(key) || 0; }catch(e){}
  const lit = sessions.filter(x => x.end && now >= x.end).length;
  try{ localStorage.setItem(key, String(lit)); }catch(e){}
  const next = sessions.findIndex(x => !(x.end && now >= x.end));
  let fresh = 0;
  const pods = sessions.map((x, i) => {
    const on = clock.state !== 'live' && x.end && now >= x.end;
    const isNew = on && seen > 0 && i >= seen;
    const st = startOf(x.label);
    const cls = ['lo-pod', on ? 'on' : '', i === next && clock.state !== 'live' ? 'next' : '', isNew ? 'lit-now' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" style="${isNew ? `--d:${(fresh++) * 120}ms` : ''}"><div class="lo-housing" aria-hidden="true"><div class="lo-lamp"></div><div class="lo-lamp"></div></div>
      <div class="lo-plabel">${x.label}<small>${st ? scrLocal(st, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</small><span class="sr-only">${on ? ' done' : ''}</span></div></div>`;
  }).join('');
  return `<div class="lo-pods">${pods}</div><div class="lo-clock" id="loClock"></div>`;
}

function scrPredictShell(){
  const wrap = $('lightsOut');
  if(wrap.dataset.v2) return;
  wrap.dataset.v2 = '1';
  wrap.innerHTML = `
    <div class="lo-gantry" id="loGantry" aria-label="Weekend sessions"></div>
    <div id="loCallBody" class="lo-call" aria-live="polite"></div>
    <div class="pv-tabs" role="tablist" aria-label="The AI's call">
      ${[['order', 'Order'], ['weekend', 'Weekend'], ['analysis', 'Analysis'], ['alerts', 'Alerts']].map(([k, l]) => `<button type="button" role="tab" id="pvt-${k}" aria-controls="pv-${k}" aria-selected="${SCR.tab === k}" onclick="scrPredictTab('${k}')">${l}</button>`).join('')}
    </div>
    <div class="pv-pane v2" id="pv-order" role="tabpanel" aria-labelledby="pvt-order">
      <div id="pvOrder"></div>
      <div class="pv-actions"><button type="button" class="btn2 red" id="pvAsk" onclick="scrAsk()">Ask the AI</button><button type="button" class="btn2" id="pvSprint" onclick="scrAskSprint()" hidden>Sprint prediction</button></div>
      <div id="pvWork"></div>
    </div>
    <div class="pv-pane v2" id="pv-weekend" role="tabpanel" aria-labelledby="pvt-weekend" hidden></div>
    <div class="pv-pane v2" id="pv-analysis" role="tabpanel" aria-labelledby="pvt-analysis" hidden></div>
    <div class="pv-pane v2" id="pv-alerts" role="tabpanel" aria-labelledby="pvt-alerts" hidden></div>`;
  // The AI's progress indicator and error box keep working where the buttons are now.
  const work = $('pvWork');
  ['aiThinking', 'errBox'].forEach(id => { const el = $(id); if(el) work.appendChild(el); });
  scrPredictTab(SCR.tab, true);
}
function scrPredictTab(k, quiet){
  SCR.tab = k;
  ['order', 'weekend', 'analysis', 'alerts'].forEach(t => {
    const pane = $(`pv-${t}`), tab = $(`pvt-${t}`);
    if(pane) pane.hidden = t !== k;
    if(tab) tab.setAttribute('aria-selected', String(t === k));
  });
  if(k === 'alerts') scrAlertsRender();
  if(!quiet && typeof trackEvent === 'function') trackEvent('screen', { screen: `pred-${k}` });
}

renderLightsOut = function(force){
  const wrap = $('lightsOut');
  const race = loSelectedRace();
  if(!wrap || !race){ if(wrap) wrap.hidden = true; return; }
  scrPredictShell();
  wrap.hidden = false;
  const raceChanged = LO.race?.circuitId !== race.circuitId || String(LO.race?.round) !== String(race.round);
  LO.race = race;
  const stages = stagesForRace(race), snaps = loSnapshots(race);
  const have = new Set(stages.filter(st => loBestFor(snaps, st)));
  const current = getCurrentStage(race);
  if(raceChanged) LO.picked = false;
  if(!LO.picked || !stages.includes(LO.stage)){
    const rev = [...stages].reverse();
    LO.stage = rev.find(st => { const b = loBestFor(snaps, st); return b && !b.prediction._fallback; })
            || rev.find(st => have.has(st)) || (stages.includes(current) ? current : stages[0]);
  }
  const snap = loBestFor(snaps, LO.stage);
  const grid = loGridMap(LO.stage);
  const wx = window._wxDays || [];
  $('loGantry').innerHTML = scrGantry(race);
  loRenderClock();
  if(LO.clock == null) LO.clock = setInterval(loRenderClock, 1000);

  const sprint = !!race.sprint || SPRINT_CIRCUITS.has(race.circuitId);
  const ask = $('pvAsk'), sp = $('pvSprint');
  const curSnap = loBestFor(snaps, current);
  if(ask){
    ask.textContent = current === 'final' ? 'Ask the AI about this race' : (curSnap && !curSnap.prediction._fallback ? 'Ask the AI again' : 'Ask the AI');
    ask.disabled = false;
  }
  if(sp) sp.hidden = !sprint || !['beforeSprintQ', 'afterSprintQ'].includes(current);

  const sig = JSON.stringify([race.circuitId, race.round, LO.stage, snap?.id, snap?.created_at, grid ? Object.keys(grid).length : 0, have.size, current,
    (qualifyingGrid || []).length, (sprintQualiGrid || []).length, wx.length && wx[wx.length - 1]?.date, predictionsLoaded]);
  if(sig === LO.sig && !force) return;
  LO.sig = sig;

  /* the call */
  const callEl = $('loCallBody');
  callEl.classList.remove('swap');
  if(!snap && !predictionsLoaded){
    // The saved calls are still on their way from the cloud: don't say there are none.
    callEl.innerHTML = `<div class="empty v2" style="margin-top:16px"><b>Loading the AI’s calls…</b></div>`;
  } else if(!snap){
    const after = current === 'final';
    callEl.innerHTML = `<div class="empty v2" style="margin-top:16px"><b>${after ? 'No call was saved before this race.' : `No call yet for ${esc(stageLabel(LO.stage).toLowerCase())}.`}</b>
      <p>${after ? 'Calls made after a race never count.' : 'The AI makes one by itself after each session. You can also ask for it now in the Order tab.'}</p></div>`;
  } else {
    const t10 = snap.prediction.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99));
    const p1 = t10[0], ab = String(p1.abbr || '').toUpperCase();
    const starts = grid?.[ab];
    callEl.innerHTML = `<div class="pv-call v2"><div style="min-width:0"><div class="lbl">The AI's call · ${esc(stageLabel(LO.stage).toLowerCase())}${snap.prediction._fallback ? ' · baseline' : ''}</div>
        <div class="big" style="margin-top:6px">${loSurname(p1.name) || ab}</div>
        <div class="team"><i class="slash" style="background:${loTeam(p1).color}"></i>${esc(loTeam(p1).name)}${starts ? ` · starts P${starts}` : ''}</div></div>
      <div style="text-align:right;flex-shrink:0"><div class="big">${scrWin(p1.winProb)}</div><div class="team" style="justify-content:flex-end">to win</div></div></div>`;
  }

  /* Order tab */
  const seg = `<div class="seg" role="group" aria-label="Weekend stage">${stages.map(st =>
    `<button type="button" aria-pressed="${st === LO.stage}" ${have.has(st) || st === current ? '' : 'disabled'} onclick="loPickStage('${st}')">${LO_STAGE_SHORT[st] || stageLabel(st)}</button>`).join('')}</div>`;
  let order = seg;
  if(snap){
    const t10 = snap.prediction.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99));
    const reason = t10[0].reasoning || snap.prediction.keyFactor || '';
    const rows = t10.slice(1, 10).map(d => {
      const ab = String(d.abbr || '').toUpperCase();
      let dl = '';
      if(grid){ const g = grid[ab], diff = g ? g - (+d.pos) : null;
        dl = `<span class="num ${diff > 0 ? 'up' : diff < 0 ? 'dn' : ''}" style="margin-left:0;width:42px;font-size:14px">${diff == null ? '—' : diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : '0'}</span>`; }
      return scrRow(ab, `<span class="num" style="width:52px">${scrWin(d.winProb)}</span>${dl}`, +d.pos || '');
    }).join('');
    order += `<div style="margin-top:14px"><div style="display:flex;height:24px;align-items:center;font:500 12px 'Barlow';color:var(--dim)"><span>Pos · driver</span><span style="margin-left:auto;width:52px;text-align:right">Win</span>${grid ? '<span style="width:42px;text-align:right">vs grid</span>' : ''}</div>${rows}</div>`;
    if(snap.prediction._fallback) order += `<p class="note">Baseline order, not an AI prediction: the AI was busy when this was saved.${current === 'final' ? '' : ' It is retried every hour.'}</p>`;
    else if(reason) order += `<div class="pv-radio"><div class="lbl">AI race engineer</div><p>“${reason}”</p></div>`;
  }
  $('pvOrder').innerHTML = order;

  /* Weekend tab */
  $('pv-weekend').innerHTML = scrWeekendHTML(race);
  /* Analysis tab */
  $('pv-analysis').innerHTML = scrAnalysisHTML(snap);
  if(SCR.tab === 'alerts') scrAlertsRender();
};

function scrWeekendHTML(race){
  const wx = (window._wxDays || []).filter(d => d.raceDate === race.date);
  const rd = wx.find(d => d.race);
  const facts = SCR_FACTS[race.circuitId];
  const laps = CIRCUIT_TOTAL_LAPS[race.circuitId];
  const path = CIRCUIT_LAYOUTS[race.circuitId];
  const rainy = wx.filter(d => d.rain >= 40);
  const summary = !wx.length ? '' : rainy.length ? `Rain likely on ${rainy.map(d => d.dow).join(', ')}` : 'Dry all weekend';
  let h = `<div class="pv-tiles">
    <div class="pv-tile"><span class="lbl">Race day${rd ? ` · ${rd.dow}` : ''}</span>${rd ? `<b>${rd.hi}°</b><p>${rd.rain}% rain · low ${rd.lo}°<br>${summary}</p>` : '<p>The forecast appears about two weeks before the race.</p>'}</div>
    <div class="pv-tile"><span class="lbl">${esc(race.circuit || '')}</span>
      ${path ? `<svg viewBox="0 0 200 120" width="100%" height="64" style="display:block;margin-top:8px" aria-hidden="true"><path d="${path}" fill="none" stroke="var(--text)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
      <p>${[facts ? `${facts[0]} km` : '', laps ? `${laps} laps` : '', facts ? `${facts[1]} turns` : ''].filter(Boolean).join(' · ')}</p></div>
  </div>`;
  if(wx.length > 1) h += `<div class="pv-days">${wx.map(d => `<span>${d.race ? '<b style="color:var(--text)">Race</b>' : d.dow} ${d.hi}° · ${d.rain}%</span>`).join('')}</div>`;
  const q = (qualifyingGrid || []).slice().sort((a, b) => a.pos - b.pos);
  const sq = (sprintQualiGrid || []).slice().sort((a, b) => a.pos - b.pos);
  const g = q.length ? q : sq;
  h += `<h2 class="scr-h">${q.length || !sq.length ? 'Starting grid' : 'Sprint grid'}</h2><p class="scr-sub">${g.length ? (q.length ? 'From qualifying' : 'From sprint qualifying') : 'Appears here as soon as qualifying ends.'}</p>`;
  if(g.length){
    const top = g.slice(0, 10);
    h += `<div class="pv-grid" style="height:${10 + top.length * 29 + 30}px">${top.map((x, i) => {
      const ab = scrAbbr(x.driverId);
      return `<div class="pv-slot ${i === 0 ? 'pole' : ''}" style="left:${i % 2 ? 'calc(50% + 11px)' : '0'};top:${10 + i * 29}px"><span class="n">${x.pos}</span><i class="slash" style="background:${scrCol(ab)}"></i><span class="code">${esc(ab)}</span><span class="nm">${esc(scrSurname(ab))}</span></div>`;
    }).join('')}</div>`;
  }
  return h;
}

function scrAnalysisHTML(snap){
  if(!snap) return '<div class="empty"><b>No analysis yet.</b><p>It appears with the AI’s first call of the weekend.</p></div>';
  const p = snap.prediction;
  if(p._fallback) return '<div class="empty"><b>This is a baseline order.</b><p>The AI was busy when it was saved, so there is no analysis for this stage. The next AI call brings one.</p></div>';
  const paras = String(p.overallAnalysis || '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean);
  const t10 = p.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99));
  return `${p.keyFactor ? `<div class="lbl">What decides it</div><p class="pv-key" style="margin:6px 0 0">${p.keyFactor}</p>` : ''}
    ${paras.map(t => `<p class="pv-para">${t}</p>`).join('')}
    ${p.upsetAlert ? `<div class="pv-upset"><div class="lbl">Upset to watch</div><p>${p.upsetAlert}</p></div>` : ''}
    <h2 class="scr-h">Driver by driver</h2>
    <div class="card" style="padding:2px 14px">${t10.map(d => { const ab = String(d.abbr || '').toUpperCase();
      return `<div class="pv-reason"><div class="top"><div class="pbox">${+d.pos || ''}</div><i class="slash" style="background:${scrCol(ab)}"></i><span class="code">${ab}</span><span class="nm">${scrWin(d.winProb)} to win</span></div>${d.reasoning ? `<p>${d.reasoning}</p>` : ''}</div>`; }).join('')}</div>`;
}

function scrAsk(){
  const race = loSelectedRace();
  if(!race) return;
  const stage = getCurrentStage(race);
  try{ setMode((qualifyingGrid || []).length ? 'post' : 'pre'); }catch(e){}
  const cur = loBestFor(loSnapshots(race), stage);
  const btn = $('pvAsk'); if(btn) btn.disabled = true;
  if(cur && !cur.prediction._fallback && stage !== 'final') forceFreshPrediction(); else runAIPrediction('race');
  setTimeout(() => { const b = $('pvAsk'); if(b) b.disabled = false; }, 4000);
}
function scrAskSprint(){ try{ setMode('pre'); }catch(e){} runAIPrediction('sprint'); }

/* Alerts tab: notifications on this device + the race report email */
const SCR_ALERTS = [['predictionReady', 'The AI’s call is ready'], ['qualifying', 'Qualifying results'], ['countdown', 'Lights out in an hour'], ['results', 'Race results and the AI’s score']];
async function scrPushState(){
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if(!supported) return { supported: false };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return { supported: true, permission: Notification.permission, on: !!sub && Notification.permission === 'granted' };
}
async function scrAlertsRender(){
  const el = $('pv-alerts');
  if(!el) return;
  const st = await scrPushState();
  const prefs = typeof getNotifPrefs === 'function' ? getNotifPrefs() : {};
  const mailDraft = $('pvMail')?.value || '';
  let note = '';
  if(!st.supported) note = /iphone|ipad/i.test(navigator.userAgent) ? 'On iPhone, add the app to your home screen first (Share, then Add to Home Screen), then turn notifications on here.' : 'This browser can’t show notifications.';
  else if(st.permission === 'denied') note = 'Notifications are blocked for this site. Allow them in your browser settings, then come back.';
  el.innerHTML = `<div class="card" style="padding:2px 14px">
      <div class="pv-switch"><span>Notifications on this device<small>${st.on ? 'On' : 'Off'}</small></span><button type="button" class="tgl" role="switch" aria-label="Notifications on this device" aria-checked="${!!st.on}" ${!st.supported || st.permission === 'denied' ? 'disabled' : ''} onclick="scrPushToggle(this)"></button></div>
      ${SCR_ALERTS.map(([id, label]) => `<div class="pv-switch"><span>${label}</span><button type="button" class="tgl" role="switch" aria-label="${label}" aria-checked="${prefs[id] !== false}" ${st.on ? '' : 'disabled'} onclick="scrPrefToggle('${id}', this)"></button></div>`).join('')}
    </div>
    ${note ? `<p class="note">${note}</p>` : ''}
    <button type="button" class="link" style="margin-top:12px" onclick="openNotifSettings()">All notification types</button>
    <h2 class="scr-h">Race report by email</h2><p class="scr-sub">Free. One email after each race: the result, the AI’s score and what’s next. Unsubscribe with one click.</p>
    <form class="pv-mail" onsubmit="event.preventDefault();scrJoin()"><input id="pvMail" type="email" autocomplete="email" placeholder="Your email" aria-label="Your email" value="${esc(mailDraft)}"><button type="submit" class="btn2" id="pvJoin">Join</button></form>
    <p class="note" id="pvMailMsg" role="status"></p>`;
}
async function scrPushToggle(btn){
  btn.disabled = true;
  const st = await scrPushState();
  if(st.on) await disablePushNotifications(); else await enablePushNotifications();
  scrAlertsRender();
}
function scrPrefToggle(id, btn){
  const on = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', String(on));
  onPrefToggle(id, on);
}
async function scrJoin(){
  const v = ($('pvMail')?.value || '').trim(), msg = $('pvMailMsg'), btn = $('pvJoin');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ msg.textContent = 'That doesn’t look like an email address.'; return; }
  btn.disabled = true; msg.textContent = 'Joining…';
  try{
    const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v }), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || 'Could not join. Try again in a minute.');
    trackEvent('email_join');
    msg.textContent = 'You’re in. The next race report comes after the race.';
    $('pvMail').value = '';
  }catch(e){ msg.textContent = e.message; }
  btn.disabled = false;
}

/* ═══════════════ 2A · LIVE ═══════════════ */
const SCR_LIVE_NAME = { 'Grand Prix': 'Race', 'Sprint Race': 'Sprint', 'Sprint Qualifying': 'Sprint Qualifying', 'Qualifying': 'Qualifying' };
const SCR_SESSION_TITLE = { Race: 'Race', Sprint: 'Sprint', Qualifying: 'Qualifying', 'Sprint Qualifying': 'Sprint qualifying' };
// Every 5 seconds during a session (the cloud saves the timing that often), every 15 otherwise,
// and at once when you come back to the app.
const scrLiveEvery = () => { const race = loSelectedRace(); return race && getLiveSessionLabel(race) ? 5000 : 15000; };
function scrLiveStart(){
  clearTimeout(SCR.liveTimer);
  const tick = async () => {
    if(document.body.dataset.screen !== 'live') return;
    if(!document.hidden) await scrLiveLoad(true).catch(() => {});
    if(document.body.dataset.screen === 'live') SCR.liveTimer = setTimeout(tick, scrLiveEvery());
  };
  scrLiveLoad().catch(() => {}).finally(() => { if(document.body.dataset.screen === 'live') SCR.liveTimer = setTimeout(tick, scrLiveEvery()); });
  if(!SCR.liveVis){
    SCR.liveVis = true;
    document.addEventListener('visibilitychange', () => { if(!document.hidden && document.body.dataset.screen === 'live') scrLiveLoad(true).catch(() => {}); });
  }
}
async function scrLiveRefresh(btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Updating…'; }
  SCR.refreshedAt = Date.now();
  await scrLiveLoad(true).catch(() => {});
  setTimeout(() => { const b = document.querySelector('#vLive .lv-refresh'); if(b) b.textContent = 'Refresh'; }, 1800);
}
async function scrLiveLoad(quiet){
  const el = $('vLive');
  if(!el) return;
  const race = loSelectedRace();
  if(!race){ el.innerHTML = '<div class="empty"><b>No race selected.</b></div>'; return; }
  const live = getLiveSessionLabel(race);
  if(!quiet && !SCR.liveRow) el.innerHTML = '<p class="scr-sub" style="padding:20px 0">Loading the timing…</p>';
  const name = live ? SCR_LIVE_NAME[live] : null;
  let rows = [], row = null;
  // During a session only that session's row is fetched, so the 5-second refresh stays small.
  if(name){
    try{ rows = await sbGet(`sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&session_name=eq.${encodeURIComponent(name)}&order=fetched_at.desc&limit=3`) || []; }catch(e){}
    row = pickBestSessionRow(rows, name);
  }
  if(!row){
    try{ rows = await sbGet(`sessions?circuit_id=eq.${race.circuitId}&year=eq.${SEASON}&order=fetched_at.desc&limit=20`) || []; }catch(e){}
    if(name) row = pickBestSessionRow(rows, name);
    if(!row){
      const cands = ['Race', 'Sprint', 'Qualifying', 'Sprint Qualifying'].map(n => pickBestSessionRow(rows, n)).filter(Boolean);
      row = cands.sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at))[0] || null;
    }
  }
  // A dropped connection on a phone shouldn't blank the tower: keep showing the last good data.
  if(!row && SCR.liveRow?.circuit_id === race.circuitId) row = SCR.liveRow;
  SCR.liveRow = row;
  scrLiveRender(race, live, row);
}
function scrLiveRender(race, live, row){
  const el = $('vLive');
  const isLive = !!live && row && SCR_LIVE_NAME[live] === row.session_name;
  const pre = scrBestSnap(race.circuitId, race.round);
  const ai = window._lastLiveAI && window._lastLiveAI.circuitId === race.circuitId ? window._lastLiveAI : null;
  const preTop = pre ? pre.prediction.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99))[0] : null;
  let h = '';
  if(row){
    const g = (row.grid_data || []).filter(x => x.abbr && x.pos).sort((a, b) => a.pos - b.pos);
    const total = g.find(x => x.totalLaps)?.totalLaps || (row.session_name === 'Race' ? CIRCUIT_TOTAL_LAPS[race.circuitId] : null);
    const racey = row.session_name === 'Race' || row.session_name === 'Sprint';
    // The lap the leader is on, like the TV graphic: F1's own lap counter when the feed gives it,
    // otherwise one more than the leader's completed laps.
    const done = Math.max(0, ...g.map(x => +x.lap || 0)), cur = +(g.find(x => x.curLap)?.curLap) || 0;
    const lap = cur || (isLive && racey ? Math.min(total || 99, done + 1) : done);
    const title = SCR_SESSION_TITLE[row.session_name] || row.session_name;
    const big = isLive && racey && lap ? `LAP ${lap}${total ? `<span>/${total}</span>` : ''}` : esc(title.toUpperCase());
    const FLAG = { AllClear: ['green', 'Green flag'], Yellow: ['yellow', 'Yellow flag'], SCDeployed: ['yellow', 'Safety car'], VSCDeployed: ['yellow', 'Virtual safety car'], VSCEnding: ['yellow', 'VSC ending'], Red: ['red', 'Red flag'] };
    const tf = isLive && FLAG[g.find(x => x.flag)?.flag];
    const flag = tf ? `<span class="lv-flag ${tf[0]}"><i></i>${tf[1]}</span>` : isLive ? '<span class="lv-flag live"><i></i>Live</span>' : `<span class="lv-flag"><i></i>Finished</span>`;
    const hasGap = g.some(x => x.gap), hasTyre = g.some(x => x.tyre), hasPits = racey && g.some(x => x.pitCount != null);
    const fresh = SCR.refreshedAt && Date.now() - SCR.refreshedAt < 1500;
    h += `<div class="lv-top"><div style="min-width:0"><div class="lbl">${esc(race.name)} · ${esc(title.toLowerCase())}</div><div class="big">${big}</div></div>
      <div class="lv-acts">${flag}<button type="button" class="lv-refresh" onclick="scrLiveRefresh(this)">${fresh ? 'Updated' : 'Refresh'}</button></div></div>`;
    if(racey && (isLive || ai)){
      h += `<div class="lv-ai"><div><div class="lbl">The AI right now</div><div class="scr-sub" style="margin-top:3px">${ai ? `Lap ${ai.lap}${ai.totalLaps ? ` of ${ai.totalLaps}` : ''}` : preTop ? `Before the start it said ${esc(String(preTop.abbr || '').toUpperCase())}, ${scrWin(preTop.winProb)}` : 'No call before the start'}</div></div>
        ${ai ? `<b>${esc(ai.top)}${ai.confidence ? ` ${ai.confidence}%` : ''}</b>` : isLive ? '<button type="button" class="btn2 red" onclick="scrLiveAsk(this)">Ask the AI now</button>' : ''}</div>`;
    } else if(!isLive && preTop && racey){
      h += `<div class="lv-ai"><div><div class="lbl">Before the start the AI said</div><div class="scr-sub" style="margin-top:3px">See how it did in Reality</div></div><b>${esc(String(preTop.abbr || '').toUpperCase())} ${scrWin(preTop.winProb)}</b></div>`;
    }
    h += `<div class="lv-th"><span>Pos</span><span>Driver</span><span class="lv-cols">${hasGap ? '<span class="lv-gap">Gap</span>' : ''}${hasTyre ? '<span class="lv-tyre">Tyre</span>' : ''}${hasPits ? '<span class="lv-pits">Pits</span>' : ''}</span></div>`;
    h += g.map(x => {
      const right = `<span class="lv-cols">${x.inPit && isLive ? '<span class="pit">PIT</span>' : ''}${hasGap ? `<span class="lv-gap">${x.pos === 1 ? 'Leader' : esc(x.gap || '—')}</span>` : ''}${hasTyre ? `<span class="lv-tyre">${x.tyre ? `<span class="tyre ${esc(x.tyre)}">${esc(x.tyre)}</span><span class="nm">${x.tyreAge ?? ''}</span>` : ''}</span>` : ''}${hasPits ? `<span class="lv-pits">${x.pitCount ?? '—'}</span>` : ''}</span>`;
      return scrRow(x.abbr, right, x.pos);
    }).join('');
    const src = row.source === 'f1-signalr-live' ? 'Live timing feed' : row.source === 'openf1-sync' ? 'OpenF1' : row.source === 'f1com' ? 'Formula1.com' : 'Saved result';
    h += `<p class="note">${src} · updated ${scrAgo(Date.parse(row.fetched_at))}${isLive ? ' · refreshes every 5 seconds' : ''}</p>`;
  } else {
    const sessions = loSessions(race), nx = sessions.find(s => !(s.end && Date.now() >= s.end));
    const sr = SEASON_RACES[race.circuitId] || {};
    const startMs = nx ? ({ FP1: scrAt(sr.fp1Date, sr.fp1UTC), FP2: scrAt(sr.fp2Date, sr.fp2UTC), FP3: scrAt(sr.fp3Date, sr.fp3UTC), SQ: scrAt(sr.sprintQualiDate, sr.sprintQualiUTC), Sprint: scrAt(sr.sprintDate, sr.sprintUTC), Quali: scrAt(sr.qualiDate, sr.qualiUTC), Race: scrAt(sr.date, sr.raceUTC) })[nx.label] : null;
    h += `<div class="lv-top"><div><div class="lbl">${esc(race.name)}</div><div class="big">NO SESSION</div></div><span class="lv-flag"><i></i>Off air</span></div>
      <div class="empty" style="margin-top:14px"><b>${nx ? `Next: ${esc(nx.label === 'SQ' ? 'Sprint qualifying' : nx.label === 'Quali' ? 'Qualifying' : nx.label)}, ${scrLocal(startMs)}` : 'The weekend is over.'}</b>
      <p>The timing tower fills in here during qualifying, the sprint and the race.</p></div>`;
    const last = scrGPs().slice(-1)[0];
    if(last){
      h += `<h2 class="scr-h">Last race · ${esc(scrShort(last.raceName))}</h2><p class="scr-sub">Final classification</p><div style="margin-top:8px">${last.results.slice(0, 10).map((id, i) => scrRow(scrAbbr(id), '', i + 1)).join('')}</div>`;
    }
  }
  el.innerHTML = h;
}
async function scrLiveAsk(btn){
  btn.disabled = true; btn.textContent = 'Thinking…';
  try{ await runMidRacePrediction(); }finally{ scrLiveRender(loSelectedRace(), getLiveSessionLabel(loSelectedRace()), SCR.liveRow); }
}

/* ═══════════════ 3A · REALITY ═══════════════ */
function scrRealityRender(){
  const el = $('vComp');
  if(!el) return;
  const gps = scrGPs().slice().sort((a, b) => b.round - a.round);
  if(!gps.length){ el.innerHTML = '<div class="empty"><b>No races finished yet.</b><p>The comparison appears after the first race.</p></div>'; return; }
  const sel = loSelectedRace();
  const selDone = sel && gps.find(r => r.circuitId === sel.circuitId && String(r.round) === String(sel.round));
  if(SCR.reality == null || (selDone && SCR.realityFor !== `${sel.circuitId}-${sel.round}`)){
    SCR.reality = selDone ? +selDone.round : +gps[0].round;
    SCR.realityFor = sel ? `${sel.circuitId}-${sel.round}` : '';
  }
  const r = gps.find(x => +x.round === SCR.reality) || gps[0];
  const season = scrSeasonAI();
  const item = season.find(x => x.round === +r.round);
  const pickHTML = `<select class="pick" aria-label="Race" onchange="SCR.reality=+this.value;scrRealityRender()">${gps.map(x => `<option value="${x.round}" ${+x.round === +r.round ? 'selected' : ''}>R${x.round} · ${esc(x.raceName)}</option>`).join('')}</select>`;
  let h = pickHTML;
  if(!item){
    h += `<div class="empty" style="margin-top:16px"><b>No call was saved before ${esc(r.raceName)}.</b><p>The AI’s calls started after the first rounds, or this race had none.</p></div>
      <h2 class="scr-h">The result</h2><div style="margin-top:8px">${r.results.slice(0, 10).map((id, i) => scrRow(scrAbbr(id), '', i + 1)).join('')}</div>`;
  } else {
    const sc = item.sc;
    h += `<div class="rl-score"><div><div class="big">${item.pct}%</div><p class="scr-sub" style="margin-top:8px">The AI’s last call before the race (${esc(stageLabel(item.snap.stage).toLowerCase())})${item.baseline ? '. This was a baseline order, not an AI call.' : ''}</p></div></div>
      <div class="rl-legend"><span><i class="lampdot on"></i>${sc.exact} exact</span><span><i class="lampdot half"></i>${sc.close} within two places</span><span><i class="lampdot"></i>${sc.missed} missed</span></div>
      <div class="rl-th"><span>The AI called</span><span></span><span style="text-align:right">What happened</span></div>
      ${item.pred.slice(0, sc.n).map((c, i) => { const fin = item.act.indexOf(c), a = item.act[i];
        return `<div class="rl-row"><div class="l"><div class="pbox">${i + 1}</div><i class="slash" style="background:${scrCol(c)}"></i><span class="code">${esc(c)}</span><span class="fin">${fin < 0 ? 'out of the top 10' : `P${fin + 1}`}</span></div>
          <div class="m"><i class="lampdot ${sc.marks[i]}" role="img" aria-label="${sc.marks[i] === 'on' ? 'exact' : sc.marks[i] === 'half' ? 'within two places' : 'missed'}"></i></div>
          <div class="r"><span class="code">${esc(a || '—')}</span><i class="slash" style="background:${scrCol(a)}"></i></div></div>`; }).join('')}`;
  }
  if(season.length){
    const avg = Math.round(season.reduce((s, x) => s + x.pct, 0) / season.length);
    h += `<h2 class="scr-h">This season</h2><p class="scr-sub">Average ${avg}% over ${season.length} races · red is the race above, outlined bars were baselines · tap a bar</p>
      <div class="rl-bars">${season.map(x => `<button type="button" title="R${x.round} ${esc(x.name)}: ${x.pct}%" aria-label="Round ${x.round}, ${x.pct}%" onclick="SCR.reality=${x.round};scrRealityRender()"><i class="${x.round === +r.round ? 'cur' : x.baseline ? 'base' : ''}" style="height:${Math.max(3, x.pct * 1.8)}px"></i><span>${x.round}</span></button>`).join('')}</div>`;
  }
  el.innerHTML = h;
}

/* ═══════════════ 4B · SEASON ═══════════════ */
function scrSeasonRender(){
  const el = $('vHist');
  if(!el) return;
  const st = drivers.slice().sort((a, b) => b.pts - a.pts);
  if(!st.length){ el.innerHTML = '<div class="empty"><b>Standings are loading.</b></div>'; return; }
  const races = scrRaces(), gps = scrGPs();
  const done = new Set(gps.map(r => +r.round));
  const doneSprints = new Set((completedRaces || []).filter(r => String(r.round).endsWith('S')).map(r => parseInt(r.round)));
  const leftGP = races.filter(r => !done.has(r.round)).length;
  const leftSprint = races.filter(r => r.sprint && !doneSprints.has(r.round)).length;
  const left = leftGP * 25 + leftSprint * 8;
  const leader = st[0], second = st[1];
  const fight = st.slice(1).filter(d => leader.pts - d.pts <= left);
  const wins = {};
  gps.forEach(r => { const a = scrAbbr(r.results[0]); wins[a] = (wins[a] || 0) + 1; });
  const total = races.length || 23;
  let h = `<div class="ss-lead"><div class="lbl">${leftGP ? `Leads the championship after ${gps.length} of ${total} rounds` : 'World champion'}</div>
    <div class="row"><div class="big" style="text-transform:uppercase;min-width:0">${esc(scrSurname(leader.abbr))}</div><div class="big">${leader.pts}</div></div>
    <div class="pv-call" style="margin-top:0"><div class="team" style="display:flex;align-items:center;gap:8px;margin-top:9px;font:500 15px 'Barlow';color:var(--muted)"><i class="slash" style="background:${scrCol(leader.abbr)}"></i>${esc(scrTeam(leader.abbr))} · ${wins[leader.abbr] || 0} win${wins[leader.abbr] === 1 ? '' : 's'}${second ? ` · ${leader.pts - second.pts} points clear` : ''}</div></div></div>`;
  if(leftGP){
    h += `<h2 class="scr-h">Still in the fight</h2><p class="scr-sub">${leftGP} race${leftGP === 1 ? '' : 's'}${leftSprint ? ` and ${leftSprint} sprint${leftSprint === 1 ? '' : 's'}` : ''} left, ${left} points to play for.${fight.length ? ` ${fight.length === 1 ? 'One driver' : fight.length + ' drivers'} can still catch ${esc(scrSurname(leader.abbr))}.` : ''}</p>`;
    h += fight.length ? `<div class="card" style="margin-top:10px;padding:2px 14px">${fight.map(d => { const gap = leader.pts - d.pts;
        return `<div class="ss-fight"><div class="top"><i class="slash" style="background:${scrCol(d.abbr)}"></i><span class="code">${esc(d.abbr)}</span><span class="nm">${esc(scrSurname(d.abbr))} · ${d.pts} pts</span><span class="need">${gap} behind</span></div><div class="ss-track"><i style="width:${Math.min(100, gap / Math.max(1, left) * 100)}%"></i></div><div class="ss-cap">Needs ${Math.min(100, Math.round(gap / Math.max(1, left) * 100))}% of the points left</div></div>`; }).join('')}</div>`
      : `<div class="empty" style="margin-top:10px"><b>${esc(scrSurname(leader.abbr))} has won the title.</b><p>Nobody can catch the points lead any more.</p></div>`;
    const out = st.slice(1).find(d => leader.pts - d.pts > left);
    if(out && fight.length) h += `<p class="note">${esc(scrSurname(out.abbr))} and everyone below are out: more than ${left} points behind.</p>`;
  }
  const wl = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  if(wl.length) h += `<h2 class="scr-h">Race wins</h2><div class="ss-wins">${wl.map(([a, n]) => `<div><b>${n}</b><span><i class="slash" style="background:${scrCol(a)};height:13px"></i><span class="code" style="font-size:17px">${esc(a)}</span></span></div>`).join('')}</div>`;
  const cons = (constructors || []).slice().sort((a, b) => b.pts - a.pts);
  if(cons.length){
    const max = Math.max(1, cons[0].pts);
    h += `<h2 class="scr-h">Teams</h2><div class="card" style="margin-top:10px;padding:2px 14px">${cons.map((c, i) => `<div class="ss-team"><div class="pbox">${i + 1}</div><i class="slash" style="background:${teamCol(c.name)}"></i><span class="t">${esc(teamName(c.name) || c.name)}</span><span style="margin-left:auto;display:flex;align-items:center;gap:12px"><span class="ss-bar"><i style="width:${c.pts / max * 100}%;background:${teamCol(c.name)}"></i></span><span class="num" style="width:36px">${c.pts}</span></span></div>`).join('')}</div>`;
  }
  const list = SCR.allDrivers ? st : st.slice(0, 10);
  h += `<h2 class="scr-h">Drivers</h2><div style="margin-top:8px">${list.map((d, i) => scrRow(d.abbr, `<span class="num">${d.pts}</span>`, i + 1)).join('')}</div>
    ${st.length > 10 ? `<button type="button" class="link" style="margin-top:10px" onclick="SCR.allDrivers=!SCR.allDrivers;scrSeasonRender()">${SCR.allDrivers ? 'Show the top 10' : `Show all ${st.length} drivers`}</button>` : ''}`;
  el.innerHTML = h;
}

/* ═══════════════ 5B · CALENDAR ═══════════════ */
function scrSessions(r){
  const L = [['FP1', r.fp1Date, r.fp1UTC, 60]];
  if(r.sprint) L.push(['Sprint quali', r.sprintQualiDate, r.sprintQualiUTC, 45], ['Sprint', r.sprintDate, r.sprintUTC, 60]);
  else L.push(['FP2', r.fp2Date, r.fp2UTC, 60], ['FP3', r.fp3Date, r.fp3UTC, 60]);
  L.push(['Qualifying', r.qualiDate, r.qualiUTC, 60], ['Race', r.date, r.raceUTC, 120]);
  return L.map(([name, d, t, dur]) => ({ name, start: scrAt(d, t), dur })).filter(s => s.start);
}
function scrCalendarRender(){
  const el = $('vCal');
  if(!el) return;
  const races = scrRaces();
  if(!races.length){ el.innerHTML = '<div class="empty"><b>The calendar is loading.</b></div>'; return; }
  const now = Date.now();
  const doneSet = new Set(scrGPs().map(r => +r.round));
  const next = races.find(r => !doneSet.has(r.round) && scrRaceEnd(r) > now) || null;
  const rest = races.filter(r => r !== next && !doneSet.has(r.round) && scrRaceEnd(r) > now);
  let h = `<p class="scr-sub">${races.length} rounds · ${doneSet.size} done · times in your time zone</p>`;
  if(next){
    const ss = scrSessions(next), first = ss[0]?.start;
    const midnight = t => new Date(t).setHours(0, 0, 0, 0);
    const toFirst = first ? Math.round((midnight(first) - midnight(now)) / 864e5) : 0;
    const when = !first || now >= first ? 'this weekend' : toFirst < 1 ? 'starts today' : toFirst === 1 ? 'starts tomorrow' : `starts in ${toFirst} days`;
    let range = '';
    try{ range = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).formatRange(new Date(first), new Date(Date.parse(next.date + 'T12:00:00Z'))); }
    catch(e){ range = scrLocal(Date.parse(next.date + 'T12:00:00Z'), { day: 'numeric', month: 'short' }); }
    h += `<div class="cl-next" style="margin-top:12px"><div class="lbl">Next · Round ${next.round} · ${when}${next.sprint ? ' · sprint weekend' : ''}</div>
      <div class="big">${esc(scrShort(next.name))}</div><p class="scr-sub" style="margin-top:6px">${esc(next.circuit || '')} · ${range}</p>
      <div class="cl-tt" style="margin-top:12px">${ss.map(s => `<div class="r ${s.start + s.dur * 6e4 < now ? 'done' : ''} ${s.name === 'Race' ? 'race' : ''}"><span class="s">${s.name}</span><span class="t">${scrLocal(s.start)}</span></div>`).join('')}</div>
      <button type="button" class="btn2 block" style="margin-top:12px" onclick="scrIcs(${next.round})">Add the weekend to my calendar</button></div>`;
  }
  let mon = '';
  rest.forEach(r => {
    const ms = scrAt(r.date, r.raceUTC) || Date.parse(r.date + 'T12:00:00Z');
    const m = scrLocal(ms, { month: 'long' });
    if(m !== mon){ if(mon) h += '</div>'; mon = m; h += `<div class="cl-mon">${m}</div><div class="card" style="padding:2px 14px">`; }
    h += `<div class="cl-row"><span class="d">${scrLocal(ms, { day: 'numeric' })}<small>${scrLocal(ms, { weekday: 'short' })}</small></span><div style="min-width:0"><b>${esc(scrShort(r.name))}</b><span class="s2">Round ${r.round} · race ${scrTime(ms)}${r.sprint ? ' · sprint weekend' : ''}${r.round === races.length ? ' · final round' : ''}</span></div></div>`;
  });
  if(mon) h += '</div>';
  const season = scrSeasonAI();
  const gps = scrGPs();
  if(gps.length){
    h += `<button type="button" class="cl-done" aria-expanded="${SCR.calDone}" onclick="SCR.calDone=!SCR.calDone;scrCalendarRender()"><span><b>${gps.length} races done</b><span class="note" style="display:block;margin-top:2px">Winners and the AI’s score for each</span></span><span style="color:var(--dim)">${SCR.calDone ? 'Hide' : 'Show'}</span></button>`;
    if(SCR.calDone){
      h += `<div class="card" style="margin-top:8px;padding:2px 14px">${gps.slice().reverse().map(r => { const w = scrAbbr(r.results[0]), s = season.find(x => x.round === +r.round);
        return `<div class="cl-row"><span class="d">${r.round}<small>${esc(scrLocal(Date.parse(r.date + 'T12:00:00Z'), { day: 'numeric', month: 'short' }))}</small></span><div style="min-width:0"><b>${esc(scrShort(r.raceName))}</b></div>
          <div class="res"><span style="display:flex;align-items:center;gap:6px;justify-content:flex-end"><i class="slash" style="background:${scrCol(w)};height:13px"></i>${esc(w)}</span><small>${s ? `AI ${s.pct}%${s.baseline ? ' · baseline' : ''}` : 'no call'}</small></div></div>`; }).join('')}</div>`;
    }
  }
  el.innerHTML = h;
}
function scrIcs(round){
  const r = scrRaces().find(x => x.round === round);
  if(!r) return;
  const z = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const evs = scrSessions(r).map(s => ['BEGIN:VEVENT', `UID:f1p-${SEASON}-${r.round}-${s.name.replace(/\s/g, '')}@f1-predictor`, `DTSTAMP:${z(Date.now())}`,
    `DTSTART:${z(s.start)}`, `DTEND:${z(s.start + s.dur * 6e4)}`, `SUMMARY:${scrShort(r.name)} GP · ${s.name}`, `LOCATION:${r.circuit || ''}`, 'END:VEVENT'].join('\r\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//F1 Predictor//EN', 'CALSCALE:GREGORIAN', ...evs, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${scrShort(r.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-gp-${SEASON}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  trackEvent('share', { detail: 'ics' });
}

/* ═══════════════ 6A · ANALYTICS ═══════════════ */
function scrAnalyticsRender(){
  const el = $('vAnlt');
  if(!el) return;
  const season = scrSeasonAI();
  const ai = season.filter(x => !x.baseline);
  let h = '<p class="scr-sub">How good is the AI? Every call is scored against the official result.</p>';
  if(!season.length){ el.innerHTML = h + '<div class="empty" style="margin-top:12px"><b>Nothing scored yet.</b><p>Numbers appear after the first race with a call.</p></div>'; return; }
  const avg = Math.round(season.reduce((s, x) => s + x.pct, 0) / season.length);
  const winners = ai.filter(x => x.called === x.winner).length;
  let pod = 0; ai.forEach(x => x.pred.slice(0, 3).forEach(c => { if(x.act.slice(0, 3).includes(c)) pod++; }));
  const hardest = (ai.length ? ai : season).slice().sort((a, b) => a.pct - b.pct)[0];
  h += `<div class="an-kpi">
    <div><span class="lbl">Average score</span><b>${avg}%</b><p>Across ${season.length} race${season.length === 1 ? '' : 's'} with a call</p></div>
    <div><span class="lbl">Winner called</span><b>${winners} of ${ai.length}</b><p>AI calls only, baselines left out</p></div>
    <div><span class="lbl">Podium places</span><b>${pod} of ${ai.length * 3}</b><p>Its top three drivers who finished in the top three</p></div>
    <div><span class="lbl">Hardest race</span><b>${hardest.pct}%</b><p>${esc(scrShort(hardest.name))}, Round ${hardest.round}</p></div></div>`;
  /* score by race */
  const W = Math.max(300, Math.min(760, Math.round(el.clientWidth || 360))), H = 200, L = 26, B = 22, T = 10, n = season.length, bw = (W - L) / n;
  const Y = v => H - B - v / 60 * (H - B - T);
  let s = `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score by race, average ${avg}%"><g font-family="Barlow, sans-serif" font-size="12" fill="var(--dim)">`;
  [0, 20, 40, 60].forEach(v => { s += `<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"/><text x="0" y="${Y(v) + 4}">${v}</text>`; });
  season.forEach((x, i) => { const bx = L + i * bw + bw * .18, w = bw * .64, y = Y(Math.min(60, x.pct));
    s += `<rect x="${bx}" y="${y}" width="${w}" height="${H - B - y}" rx="2" fill="${i === n - 1 ? 'var(--lamp)' : x.baseline ? 'var(--sec)' : 'var(--muted)'}" ${x.baseline ? 'stroke="var(--border2)"' : ''}><title>R${x.round} ${esc(x.name)}: ${x.pct}%</title></rect>
      <text x="${bx + w / 2}" y="${H - 6}" text-anchor="middle">${x.round}</text>`; });
  s += `</g><line x1="${L}" x2="${W}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="var(--text)" stroke-dasharray="5 5"/></svg>`;
  h += `<h2 class="scr-h">Score by race</h2><p class="scr-sub">Dashed line: the ${avg}% average. Red is the latest race, outlined bars were baselines.</p>${s}`;
  /* who it misjudges */
  const err = {};
  ai.forEach(x => x.pred.slice(0, 10).forEach((c, i) => { const j = x.act.indexOf(c); if(j >= 0) (err[c] ||= []).push(j - i); }));
  const minN = Math.max(3, Math.min(5, Math.floor(ai.length / 2)));
  const bias = Object.entries(err).filter(([, v]) => v.length >= minN).map(([c, v]) => [c, Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10]).filter(([, v]) => Math.abs(v) >= .5).sort((a, b) => b[1] - a[1]);
  if(bias.length){
    const mx = Math.max(3, ...bias.map(b => Math.abs(b[1])));
    h += `<h2 class="scr-h">Who it misjudges</h2><p class="scr-sub">Average places between the AI’s call and the result${bias[0][1] > 0 ? `. It rates ${esc(scrSurname(bias[0][0]))} ${bias[0][1]} places too high.` : ''}</p>
      <div class="card" style="margin-top:10px"><div class="an-axis"><span></span><span>Rated too low</span><span style="text-align:right">Rated too high</span><span></span></div>
      ${bias.map(([c, v]) => `<div class="an-bias"><span class="c"><i class="slash" style="background:${scrCol(c)};height:13px"></i>${esc(c)}</span><span class="l">${v < 0 ? `<i style="width:${-v / mx * 100}%"></i>` : ''}</span><span class="r">${v > 0 ? `<i style="width:${v / mx * 100}%"></i>` : ''}</span><span class="v">${v > 0 ? '+' : '−'}${Math.abs(v)}</span></div>`).join('')}</div>`;
  }
  /* head to head */
  const st = drivers.slice().sort((a, b) => b.pts - a.pts);
  if(st.length > 1){
    if(!SCR.h2h) SCR.h2h = [st[0].abbr, st[1].abbr];
    const [a, b] = SCR.h2h;
    const gps = scrGPs();
    const posOf = (r, c) => { const i = r.results.map(scrAbbr).indexOf(c); return i < 0 ? null : i + 1; };
    let aheadA = 0, aheadB = 0; const pa = [], pb = [];
    gps.forEach(r => { const x = posOf(r, a), y = posOf(r, b); if(x) pa.push(x); if(y) pb.push(y); if(x && y){ x < y ? aheadA++ : aheadB++; } });
    const avgP = v => v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—';
    const wins = c => gps.filter(r => scrAbbr(r.results[0]) === c).length;
    const pods = v => v.filter(x => x <= 3).length;
    const pts = c => scrDrv(c)?.pts ?? '—';
    const opt = sel => st.map(d => `<option value="${d.abbr}" ${d.abbr === sel ? 'selected' : ''}>${esc(d.abbr)} · ${esc(scrSurname(d.abbr))}</option>`).join('');
    h += `<h2 class="scr-h">Head to head</h2><div class="an-h2h-pick"><select class="pick" aria-label="First driver" onchange="SCR.h2h[0]=this.value;scrAnalyticsRender()">${opt(a)}</select><span class="lbl">vs</span><select class="pick" aria-label="Second driver" onchange="SCR.h2h[1]=this.value;scrAnalyticsRender()">${opt(b)}</select></div>
      <div class="card" style="margin-top:10px;padding:2px 14px">
        <div class="an-h2h"><b>${aheadA}</b><span>races ahead</span><b>${aheadB}</b></div>
        <div class="an-h2h"><b>${wins(a)}</b><span>wins</span><b>${wins(b)}</b></div>
        <div class="an-h2h"><b>${pods(pa)}</b><span>podiums</span><b>${pods(pb)}</b></div>
        <div class="an-h2h"><b>${avgP(pa)}</b><span>average finish</span><b>${avgP(pb)}</b></div>
        <div class="an-h2h"><b>${pts(a)}</b><span>points</span><b>${pts(b)}</b></div></div>`;
  }
  el.innerHTML = h;
}


/* ═══════════════ PREDICTIONS ARCHIVE ═══════════════ */
function scrArchRender(){
  const el = $('vArch');
  if(!el) return;
  const race = loSelectedRace();
  if(!race){ el.innerHTML = '<div class="empty"><b>No race selected.</b></div>'; return; }
  const all = (cachedPredictions || []).filter(p => p.circuit_id === race.circuitId && String(p.round) === String(race.round) && p.prediction?.top10?.length);
  const types = ['race', ...(all.some(p => p.pred_type === 'sprint') ? ['sprint'] : [])];
  if(!types.includes(SCR.archType)) SCR.archType = 'race';
  const stages = stagesForRace(race);
  const of = st => { const rows = all.filter(p => p.pred_type === SCR.archType && p.stage === st); return rows.find(p => !p.prediction._fallback) || rows[0] || null; };
  if(!stages.includes(SCR.archStage) || !of(SCR.archStage)){
    const rev = [...stages].reverse();
    SCR.archStage = rev.find(st => of(st) && !of(st).prediction._fallback) || rev.find(st => of(st)) || stages[0];
  }
  const snap = of(SCR.archStage);
  let h = `<p class="scr-sub">Every call the AI made for ${esc(race.name)}, by stage. Pick another race on the Predict screen.</p>`;
  if(types.length > 1) h += `<div class="seg" role="group" aria-label="Race or sprint" style="margin-top:12px">${types.map(t => `<button type="button" aria-pressed="${t === SCR.archType}" onclick="SCR.archType='${t}';scrArchRender()">${t === 'race' ? 'Grand Prix' : 'Sprint'}</button>`).join('')}</div>`;
  h += `<div class="seg" role="group" aria-label="Stage" style="margin-top:10px;display:flex">${stages.map(st => `<button type="button" aria-pressed="${st === SCR.archStage}" ${of(st) ? '' : 'disabled'} onclick="SCR.archStage='${st}';scrArchRender()">${LO_STAGE_SHORT[st] || stageLabel(st)}</button>`).join('')}</div>`;
  if(!snap){ el.innerHTML = h + '<div class="empty" style="margin-top:14px"><b>No calls saved yet for this race.</b><p>They appear here as the AI makes them during the weekend.</p></div>'; return; }
  const t10 = snap.prediction.top10.slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99));
  const p1 = t10[0], ab = String(p1.abbr || '').toUpperCase();
  h += `<div class="pv-call"><div style="min-width:0"><div class="lbl">${esc(stageLabel(snap.stage))} · saved ${scrLocal(Date.parse(snap.created_at))}${snap.prediction._fallback ? ' · baseline' : ''}</div><div class="big" style="margin-top:6px">${esc(scrSurname(ab))}</div></div>
    <div style="text-align:right;flex-shrink:0"><div class="big">${scrWin(p1.winProb)}</div><div class="team" style="justify-content:flex-end">to win</div></div></div>`;
  if(snap.accuracy != null) h += `<p class="note">Scored ${snap.accuracy}% against the result.</p>`;
  if(snap.prediction._fallback) h += '<p class="note">Baseline order, not an AI prediction: the AI was busy when this was saved.</p>';
  h += `<div style="margin-top:12px">${t10.map(d => scrRow(String(d.abbr || '').toUpperCase(), `<span class="num">${scrWin(d.winProb)}</span>`, +d.pos || '')).join('')}</div>`;
  if(snap.prediction.keyFactor && !snap.prediction._fallback) h += `<div class="pv-radio"><div class="lbl">What decides it</div><p>${snap.prediction.keyFactor}</p></div>`;
  el.innerHTML = h;
}

/* ═══════════════ PIT STOPS ═══════════════ */
async function scrPitsRender(){
  const el = $('vPits');
  if(!el) return;
  const race = loSelectedRace();
  let sessKey = currentRaceSessKey, meetKey = currentMeetingKey;
  const head = `<p class="scr-sub">${race ? esc(race.name) + ' · ' : ''}tyre strategy and stop times from the race.</p>`;
  const again = '<button type="button" class="btn2" style="margin-top:12px" onclick="scrPitsRender()">Try again</button>';
  const busy = () => { el.innerHTML = head + `<div class="empty" style="margin-top:12px"><b>OpenF1 is busy right now.</b><p>Its free data service limits how often it can be asked. Try again in a minute.</p>${again}</div>`; };
  of1RateLimited = false;
  // OpenF1's free tier allows about 3 requests a second, so space out the ones not already cached.
  const pace = url => of1Cache[url] ? Promise.resolve() : new Promise(r => setTimeout(r, 350));
  const get = async url => { await pace(url); return of1Fetch(url); };
  // Finished races load from the cloud copy, which skips OpenF1, so look the race session up here.
  if(!sessKey && race && scrRaceEnd(race) < Date.now()){
    el.innerHTML = head + '<p class="scr-sub" style="padding:16px 0">Loading the stops…</p>';
    try{
      const mtg = await getOf1Meeting(race);
      if(mtg) await new Promise(r => setTimeout(r, 350));
      const rs = mtg ? ((await getOf1Sessions(mtg.meeting_key)) || []).find(s => s.session_name === 'Race') : null;
      if(rs){ sessKey = rs.session_key; meetKey = mtg.meeting_key; }
    }catch(e){ if(/429/.test(e.message)) of1RateLimited = true; }
    if(!sessKey && of1RateLimited) return busy();
  }
  if(!sessKey){
    el.innerHTML = head + `<div class="empty" style="margin-top:12px"><b>Pit stops appear after the race.</b><p>During the race, the Live screen shows how many times each car has stopped.</p></div>`;
    return;
  }
  el.innerHTML = head + '<p class="scr-sub" style="padding:16px 0">Loading the stops…</p>';
  try{
    // One request at a time: OpenF1 limits bursts.
    const stints = await get(`${OPENF1}/stints?session_key=${sessKey}`);
    if(!stints?.length){
      if(of1RateLimited) return busy();
      const recent = race && Date.now() - scrRaceEnd(race) < 6 * 3600e3;
      el.innerHTML = head + `<div class="empty" style="margin-top:12px">${recent ? '<b>Not published yet.</b><p>Stop data usually appears within an hour of the flag.</p>' : '<b>No stop data for this race.</b><p>OpenF1 did not publish pit-stop data for it.</p>'}</div>`;
      return;
    }
    const pits = await get(`${OPENF1}/pit?session_key=${sessKey}`);
    const list = await get(`${OPENF1}/drivers?session_key=${sessKey}&meeting_key=${meetKey}`);
    if(of1RateLimited) return busy();
    const ab = {}; (list || []).forEach(d => { ab[d.driver_number] = String(d.name_acronym || '').toUpperCase(); });
    // Finishing order from the official result when we have it, else OpenF1's last positions.
    const done = race && scrGPs().find(r => r.circuitId === race.circuitId && String(r.round) === String(race.round));
    const finish = {};
    if(done) done.results.forEach((id, i) => { finish[scrAbbr(id)] = i + 1; });
    else (await get(`${OPENF1}/position?session_key=${sessKey}`) || []).forEach(p => { const a = ab[p.driver_number]; if(a && (!finish[a] || p.date > finish[a + '_d'])){ finish[a] = p.position; finish[a + '_d'] = p.date; } });
    const posOf = n => finish[ab[n]] || 99;
    const byDrv = {}; stints.forEach(s => (byDrv[s.driver_number] ||= []).push(s));
    // stop_duration is the time stationary; when it's missing, pit_duration (the whole pit lane) is shown instead.
    const t = p => p.stop_duration > 1 && p.stop_duration < 60 ? { s: p.stop_duration, lane: false } : p.pit_duration > 1.5 && p.pit_duration < 90 ? { s: p.pit_duration, lane: true } : null;
    const stops = {}; (pits || []).forEach(p => { const x = t(p); if(x) (stops[p.driver_number] ||= []).push({ ...p, x }); });
    const total = Math.max(1, ...stints.map(s => s.lap_end || 0));
    const nums = Object.keys(byDrv).map(Number).sort((a, b) => posOf(a) - posOf(b));
    const allStops = Object.values(stops).flat().sort((a, b) => a.x.s - b.x.s);
    const lane = allStops.length && allStops.every(p => p.x.lane);
    const fastest = allStops[0];
    const strat = {}; nums.forEach(n => { const k = Math.max(0, byDrv[n].length - 1); strat[k] = (strat[k] || 0) + 1; });
    const common = Object.entries(strat).sort((a, b) => b[1] - a[1])[0];
    const C = { SOFT: ['S', '#ff3b30'], MEDIUM: ['M', '#ffd60a'], HARD: ['H', 'var(--text)'], INTERMEDIATE: ['I', '#30d158'], WET: ['W', '#0a84ff'] };
    let h = head + `<div class="an-kpi">
      <div><span class="lbl">Stops</span><b>${allStops.length}</b><p>Across ${nums.length} cars</p></div>
      <div><span class="lbl">${lane ? 'Quickest through the pit lane' : 'Fastest stop'}</span><b>${fastest ? fastest.x.s.toFixed(1) + 's' : '—'}</b><p>${fastest ? esc(ab[fastest.driver_number] || '') + `, lap ${fastest.lap_number}` : 'No timed stops'}</p></div>
      ${common ? `<div style="grid-column:1/3"><span class="lbl">Most common</span><b>${common[0] === '0' ? 'No stop' : `${common[0]} stop${common[0] === '1' ? '' : 's'}`}</b><p>${common[1]} of ${nums.length} cars</p></div>` : ''}</div>`;
    h += `<h2 class="scr-h">Strategy by car</h2><p class="scr-sub">Finishing order · each bar is one set of tyres, as long as it ran${lane ? ' · times are the whole trip through the pit lane' : ''}</p><div class="card" style="margin-top:10px;padding:2px 14px">`;
    h += nums.slice(0, 20).map(n => {
      const a = ab[n] || `#${n}`, ss = byDrv[n].slice().sort((x, y) => x.stint_number - y.stint_number);
      const strip = ss.map(s => { const len = Math.max(1, (s.lap_end || total) - (s.lap_start || 1) + 1), c = C[String(s.compound || '').toUpperCase()] || ['?', 'var(--dim)'];
        return `<span title="${esc(s.compound || '')} · ${len} laps" style="flex:${len};height:14px;border-radius:3px;box-shadow:inset 0 0 0 2px ${c[1]};display:flex;align-items:center;justify-content:center;font:800 10px 'Barlow Condensed',sans-serif">${len >= 6 ? c[0] : ''}</span>`; }).join('');
      const times = (stops[n] || []).sort((x, y) => x.lap_number - y.lap_number).map(p => p.x.s.toFixed(1)).join(' · ');
      return `<div style="padding:10px 0;border-top:1px solid var(--border)"><div class="trow" style="border:0;min-height:30px"><div class="pbox">${posOf(n) < 99 ? posOf(n) : '–'}</div><i class="slash" style="background:${scrCol(a)}"></i><span class="code">${esc(a)}</span><span class="nm">${esc(scrSurname(a))}</span><span class="num" style="font-size:13px;color:var(--muted)">${times ? times + ' s' : 'no stop'}</span></div>
        <div style="display:flex;gap:3px;margin-top:6px">${strip}</div></div>`;
    }).join('');
    h += '</div>';
    el.innerHTML = h;
  }catch(e){
    if(/429/.test(e.message)) return busy();
    el.innerHTML = head + `<div class="empty" style="margin-top:12px"><b>Could not load the stops.</b><p>Check your connection, then try again.</p>${again}</div>`;
  }
}

/* ═══════════════ MORE ═══════════════ */
function scrTheme(){ try{ return localStorage.getItem('f1_theme') || 'dark'; }catch(e){ return 'dark'; } }
function scrApplyTheme(mode){
  const light = mode === 'light' || (mode === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.body.classList.toggle('light', light);
  const b = $('themeBtn'); if(b) b.innerHTML = light ? THEME_ICON.sun : THEME_ICON.moon;
}
function scrSetTheme(mode){ try{ localStorage.setItem('f1_theme', mode); }catch(e){} scrApplyTheme(mode); scrMoreRender(); }
toggleTheme = function(){ scrSetTheme(document.body.classList.contains('light') ? 'dark' : 'light'); };
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if(scrTheme() === 'auto') scrApplyTheme('auto'); });

function scrMoreRender(){
  const el = $('vMore');
  if(!el) return;
  const t = scrTheme();
  const D = [['hist', 'season', 'Season', 'The title fight, wins and every standing'], ['cal', 'cal', 'Calendar', 'All the rounds in your time'],
    ['anlt', 'chart', 'Analytics', 'How good the AI is, and head to head'], ['arch', 'arch', 'Predictions archive', 'Every call the AI made, by stage'], ['pits', 'pits', 'Pit stops', 'Stops and tyres from the latest race']];
  el.innerHTML = `<div class="card" style="padding:2px 14px">${D.map(([k, i, tl, sub]) => `<button type="button" class="mo-li" onclick="mobileNav('${k}')">${scrIco(i)}<span><b>${tl}</b><small>${sub}</small></span><span class="chev">${scrIco('chev', 18)}</span></button>`).join('')}</div>
    <h2 class="scr-h">Settings</h2>
    <div class="card" style="margin-top:10px;padding:2px 14px">
      <div class="mo-set"><b>Notifications</b><button type="button" class="link" onclick="openNotifSettings()">Choose which</button></div>
      <div class="mo-set"><b>Race report by email</b><button type="button" class="link" onclick="mobileNav('pred');scrPredictTab('alerts')">Sign up</button></div>
      <div class="mo-set"><b>Appearance</b><span class="seg" role="group" aria-label="Appearance">${[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => `<button type="button" aria-pressed="${t === k}" onclick="scrSetTheme('${k}')">${l}</button>`).join('')}</span></div>
    </div>
    <h2 class="scr-h">About</h2>
    <div class="card" style="margin-top:10px;padding:2px 14px">
      <button type="button" class="mo-li" aria-expanded="${SCR.howOpen}" onclick="SCR.howOpen=!SCR.howOpen;scrMoreRender()"><span><b>How the AI works</b></span><span class="chev">${SCR.howOpen ? 'Hide' : scrIco('chev', 18)}</span></button>
      ${SCR.howOpen ? `<div class="mo-how">
        <p>Before qualifying, after qualifying and around the sprint, Google’s Gemini AI predicts the top 10 from the season so far: results, standings, recent form, the circuit, practice and qualifying times and the weather forecast.</p>
        <p>Each call is saved with its stage. Calls made after a race never count. When the free AI is busy, a simple baseline order (the grid or the standings) is saved and clearly labelled, and the AI is asked again every hour.</p>
        <p>After the race every call is scored against the official result: an exact place is worth 1 point, a place within two is worth half, out of the top 10. That score is what you see in Reality and Analytics.</p></div>` : ''}
      <a class="mo-li" href="/privacy"><span><b>Privacy</b><small>What we collect (very little) and why</small></span><span class="chev">${scrIco('chev', 18)}</span></a>
      <a class="mo-li" href="/terms"><span><b>Terms</b><small>For fun only, never betting advice</small></span><span class="chev">${scrIco('chev', 18)}</span></a>
    </div>
    <p class="mo-foot">F1 Predictor · ${esc(APP_VERSION)}<br>An independent fan project. Not affiliated with Formula 1, the FIA or any team.</p>`;
}

/* ═══════════════ NAVIGATION ═══════════════ */
const SCR_ALL = ['pred', 'live', 'comp', 'hist', 'cal', 'anlt', 'more', 'arch', 'pits'];
const SCR_TOP = [['pred', 'Predict'], ['live', 'Live'], ['comp', 'Reality'], ['hist', 'Season'], ['cal', 'Calendar'], ['anlt', 'Analytics'], ['more', 'More']];
function scrTopNav(t){ document.querySelectorAll('.topnav button').forEach(b => b.dataset.t === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')); }

setTab = function(t){
  if(!SCR_ALL.includes(t)) t = 'pred';
  if(t !== setTab._last){ setTab._last = t; trackEvent('screen', { screen: t }); }
  document.body.dataset.screen = t;
  SCR_ALL.forEach(k => { $('p' + cap(k))?.classList.toggle('active', k === t); });
  if(t !== 'live'){ clearInterval(SCR.liveTimer); SCR.liveTimer = null; if(liveRaceRefreshInterval){ clearInterval(liveRaceRefreshInterval); liveRaceRefreshInterval = null; } }
  if(t !== 'pits' && pitRefreshInterval){ clearInterval(pitRefreshInterval); pitRefreshInterval = null; }
  if(t === 'pred'){ renderLightsOut(true); try{ syncForceFreshBtn(loSelectedRace()); }catch(e){} }
  if(t === 'arch') scrArchRender();
  if(t === 'pits') scrPitsRender();
  if(t === 'live') scrLiveStart();
  if(t === 'comp') scrRealityRender();
  if(t === 'hist') scrSeasonRender();
  if(t === 'cal') scrCalendarRender();
  if(t === 'anlt') scrAnalyticsRender();
  if(t === 'more') scrMoreRender();
  syncMobileBottomNav(t); syncMobileMoreView(t); scrTopNav(t);
};
syncMobileBottomNav = function(tab){
  const key = ({ pred: 'pred', live: 'live', comp: 'comp' })[tab] || 'more';
  document.querySelectorAll('#mobileBottomNav .mnav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === key));
};
mobileNav = function(t){ closeMoreSheet(); setTab(t); window.scrollTo({ top: 0 }); };
openMoreSheet = function(){ mobileNav('more'); };

/* re-render whatever is on screen when new data arrives */
window.scrOnData = function(){
  const t = document.body.dataset.screen;
  if(t === 'comp') scrRealityRender(); else if(t === 'hist') scrSeasonRender(); else if(t === 'cal') scrCalendarRender();
  else if(t === 'anlt') scrAnalyticsRender(); else if(t === 'live') scrLiveLoad(true); else if(t === 'arch') scrArchRender();
  renderLightsOut(true);
};
window.scrOnWeather = () => renderLightsOut(true);
window.scrOnLiveAI = () => { if(document.body.dataset.screen === 'live') scrLiveRender(loSelectedRace(), getLiveSessionLabel(loSelectedRace()), SCR.liveRow); };

/* Circuit facts the schedule doesn't carry: lap length (km) and corners. */
const SCR_FACTS = {
  albert_park: [5.278, 14], shanghai: [5.451, 16], suzuka: [5.807, 18], bahrain: [5.412, 15], jeddah: [6.174, 27], miami: [5.412, 19],
  villeneuve: [4.361, 14], monaco: [3.337, 19], catalunya: [4.657, 14], red_bull_ring: [4.318, 10], silverstone: [5.891, 18], spa: [7.004, 19],
  hungaroring: [4.381, 14], zandvoort: [4.259, 14], monza: [5.793, 11], ifema_madrid: [5.474, 22], baku: [6.003, 20], sepang: [5.543, 15],
  marina_bay: [4.940, 19], americas: [5.513, 20], rodriguez: [4.304, 17], interlagos: [4.309, 15], las_vegas: [6.201, 17], losail: [5.419, 16], yas_marina: [5.281, 16],
};

/* ── set up the new screens ── */
(function scrInit(){
  Object.assign(TEAM_ALIAS, { 'rb f1 team':'racing_bulls', 'cadillac f1 team':'cadillac', 'cadillac f1':'cadillac', 'audi f1 team':'audi', 'stake f1 team kick sauber':'audi' });
  delete MOBILE_SECTION_TITLES.comp; delete MOBILE_SECTION_TITLES.live;
  Object.assign(MOBILE_SECTION_TITLES, { hist: 'Season', cal: 'Calendar', anlt: 'Analytics', more: 'More', arch: 'Predictions archive', pits: 'Pit stops' });
  [['pLive', 'vLive'], ['pComp', 'vComp'], ['pHist', 'vHist'], ['pCal', 'vCal'], ['pAnlt', 'vAnlt'], ['pArch', 'vArch'], ['pPits', 'vPits']].forEach(([p, v]) => {
    const pane = $(p); if(!pane) return;
    pane.classList.add('v2-pane');
    pane.insertAdjacentHTML('afterbegin', `<div class="v2" id="${v}"></div>`);
  });
  const anlt = $('pAnlt');
  if(anlt && !$('pMore')) anlt.insertAdjacentHTML('afterend', '<div class="pane v2-pane" id="pMore"><div class="v2" id="vMore"></div></div>');
  const head = document.querySelector('.header');
  if(head && !head.querySelector('.topnav')){
    head.querySelector('.lo-brand')?.insertAdjacentHTML('afterend', `<nav class="topnav" aria-label="Screens">${SCR_TOP.map(([k, l]) => `<button type="button" data-t="${k}" onclick="mobileNav('${k}')">${l}</button>`).join('')}</nav>`);
  }
  const moreBtn = document.querySelector('#mobileBottomNav [data-nav="more"]');
  if(moreBtn) moreBtn.setAttribute('onclick', "mobileNav('more')");
  scrApplyTheme(scrTheme());
  document.body.dataset.screen = 'pred';
  scrTopNav('pred');
  renderLightsOut(true);
})();

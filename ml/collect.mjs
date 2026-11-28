// Downloads the data the ML model learns from into ml/data (or $ML_DATA):
//   Jolpica 2019-now: race results with grid + status, qualifying, this season's sprints
//   OpenF1 2023-now: race laps (line-crossing times), stints (tyres), drivers, FP1 results
// Files already downloaded are kept; this season's Jolpica files are refreshed every run.
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs'

const DIR = (process.env.ML_DATA || new URL('./data/', import.meta.url).pathname).replace(/\/?$/, '/')
mkdirSync(DIR, { recursive: true })
const NOW_YEAR = new Date().getUTCFullYear()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = { 'User-Agent': 'pitwall-ml/1.0' }

async function getJSON(url, tries = 6) {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) })
      if (r.ok) return await r.json()
      if (r.status === 404) return null
    } catch {}
    await sleep(2000 * (k + 1))
  }
  throw new Error('failed ' + url)
}
const cached = async (name, fn) => {
  const p = DIR + name
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
  const v = await fn()
  writeFileSync(p, JSON.stringify(v))
  return v
}

async function jolpicaAll(path, key) {
  const out = []
  for (let off = 0; ; off += 100) {
    const j = await getJSON(`https://api.jolpi.ca/ergast/f1/${path}.json?limit=100&offset=${off}`)
    const races = j.MRData.RaceTable.Races
    for (const r of races) { // a race can straddle two pages: merge by round
      const have = out.find((x) => x.round === r.round)
      if (have) have[key].push(...r[key])
      else out.push(r)
    }
    await sleep(400)
    if (off + 100 >= +j.MRData.total) break
  }
  return out
}

for (const f of [`jolpica_results_${NOW_YEAR}.json`, `jolpica_quali_${NOW_YEAR}.json`, `jolpica_sprint_${NOW_YEAR}.json`, `of1_sessions_${NOW_YEAR}.json`])
  rmSync(DIR + f, { force: true }) // this season changes every weekend
for (let y = 2019; y <= NOW_YEAR; y++) {
  await cached(`jolpica_results_${y}.json`, () => jolpicaAll(`${y}/results`, 'Results'))
  await cached(`jolpica_quali_${y}.json`, () => jolpicaAll(`${y}/qualifying`, 'QualifyingResults'))
}
for (let y = 2026; y <= NOW_YEAR; y++) await cached(`jolpica_sprint_${y}.json`, () => jolpicaAll(`${y}/sprint`, 'SprintResults'))
console.log('jolpica up to', NOW_YEAR)

const OF = 'https://api.openf1.org/v1/'
for (let y = 2023; y <= NOW_YEAR; y++) {
  const sessions = (await cached(`of1_sessions_${y}.json`, () => getJSON(`${OF}sessions?year=${y}`))) || []
  // a race's files are only written once it is over (date_end + 3 h, so OpenF1 has the whole race)
  const races = sessions.filter((s) => s.session_name === 'Race' && Date.parse(s.date_end) + 3 * 3600e3 < Date.now())
  let n = 0
  for (const s of races) {
    const k = s.session_key
    try {
      for (const t of ['laps', 'stints', 'drivers']) {
        if (!existsSync(DIR + `of1_${t}_${k}.json`)) { await cached(`of1_${t}_${k}.json`, () => getJSON(`${OF}${t}?session_key=${k}`)); await sleep(350); n++ }
      }
      const fp1 = sessions.find((x) => x.meeting_key === s.meeting_key && x.session_name === 'Practice 1')
      if (fp1 && !existsSync(DIR + `of1_fp1_${fp1.session_key}.json`)) {
        try { await cached(`of1_fp1_${fp1.session_key}.json`, () => getJSON(`${OF}session_result?session_key=${fp1.session_key}`, 3)) } catch {}
        await sleep(350); n++
      }
    } catch (e) { console.log('race missing', y, s.location, e.message) }
  }
  console.log('openf1', y, races.length, 'races,', n, 'new files')
}

/*
 * F1 AI Race Predictor — Copyright (c) 2026 Ahmed Masoud. All Rights Reserved.
 * Proprietary. Unauthorized copying or reuse prohibited. See LICENSE.
 * Canary: F1PRED-AM-2026-9f3c2a7b4e
 */
// F1.com results page scraper.
// F1's livetiming.formula1.com static endpoint is blocked (403),
// but their public results pages at formula1.com/en/results/... ARE accessible
// and parseable. They publish results ~30 min after each session ends.
//
// Caveat: not real-time DURING a session — F1.com only publishes after the
// session officially ends. Real-time during sessions requires OpenF1 paid
// or a SignalR client. This is the best free post-session source.

export const config = { maxDuration: 25 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const F1_BASE = 'https://www.formula1.com';

// Map our internal session kinds → F1.com URL suffixes
const KIND_PATH = {
  'race':         'race-result',
  'sprint':       'sprint-results',
  'quali':        'qualifying',
  'sprintQuali':  'sprint-qualifying',     // 2023+; older "sprint-shootout" handled as fallback
  'fp1':          'practice-1',
  'fp2':          'practice-2',
  'fp3':          'practice-3',
};

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`F1.com ${r.status} on ${url}`);
  return r.text();
}

// Parse rows from the F1.com results table.
// Row cells: [position, driverNumber, "First Last TLA", team, laps, time, points]
function parseRows(html) {
  // Each result row uses Table-module_body-row__... class. Match the full row content.
  const rowRe = /<tr class="Table-module_body-row__[^"]*">([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  const rows = [];
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const cells = [];
    let c;
    while ((c = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length < 4) continue;

    const position = parseInt(cells[0], 10);
    const number   = parseInt(cells[1], 10);
    // Driver cell: "Lando Norris NOR" — TLA is last word, 3 uppercase letters
    const driverCell = cells[2] || '';
    const tlaMatch = driverCell.match(/\b([A-Z]{3})\b\s*$/);
    const tla = tlaMatch ? tlaMatch[1] : '';
    const name = driverCell.replace(/\s+[A-Z]{3}\s*$/, '').trim();
    const team = cells[3] || '';

    if (!isNaN(position) && tla) {
      rows.push({
        position, number, tla, name, team,
        laps:   parseInt(cells[4], 10) || 0,
        time:   cells[5] || '',
        points: parseFloat(cells[6]) || 0,
      });
    }
  }
  return rows;
}

// Look up the F1.com race URL for a given year + slug
// e.g. year=2026, slug="canada" → /en/results/2026/races/1285/canada/race-result
async function findRaceUrl(year, slug, sessionPath) {
  const indexHtml = await fetchHtml(`${F1_BASE}/en/results/${year}/races`);
  // Match e.g. /en/results/2026/races/1285/canada/race-result
  const re = new RegExp(`/en/results/${year}/races/(\\d+)/${slug}/race-result`, 'i');
  const m = indexHtml.match(re);
  if (!m) {
    // Loose fallback — try partial slug match
    const looseRe = new RegExp(`/en/results/${year}/races/(\\d+)/[a-z0-9-]*${slug}[a-z0-9-]*/race-result`, 'i');
    const m2 = indexHtml.match(looseRe);
    if (!m2) return null;
    return `${F1_BASE}/en/results/${year}/races/${m2[1]}/${m2[0].split('/')[5]}/${sessionPath}`;
  }
  return `${F1_BASE}/en/results/${year}/races/${m[1]}/${slug}/${sessionPath}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const {
    year = '2026',
    slug = '',
    kind = 'race',
  } = req.query;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug param (e.g. canada, monaco)' });
  }

  const sessionPath = KIND_PATH[kind];
  if (!sessionPath) {
    return res.status(400).json({ error: 'Invalid kind', validKinds: Object.keys(KIND_PATH) });
  }

  try {
    const url = await findRaceUrl(year, slug, sessionPath);
    if (!url) {
      return res.status(404).json({ ok: false, error: 'Race URL not found on F1.com', year, slug });
    }

    const html = await fetchHtml(url);

    // Check if F1.com has actually published results (vs "no result yet" page)
    if (html.includes('Table-module_no-result-content')) {
      return res.status(200).json({
        ok: false,
        published: false,
        message: 'F1.com has not yet published results for this session',
        url,
      });
    }

    const rows = parseRows(html);
    if (!rows.length) {
      return res.status(200).json({
        ok: false,
        published: false,
        message: 'No result rows found — session likely not yet published',
        url,
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.status(200).json({
      ok: true,
      published: true,
      year,
      slug,
      kind,
      sessionPath,
      url,
      count: rows.length,
      results: rows,
      fetchedAt: new Date().toISOString(),
      source: 'formula1.com',
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'F1.com scrape error',
      details: err.message,
    });
  }
}

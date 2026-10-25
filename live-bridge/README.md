# F1 Live Bridge

Connects to Formula 1's official live-timing SignalR feed and writes positions to your Supabase in real-time. Your PWA reads from Supabase and shows live data to all users.

**Free. Real-time. Same data F1 TV uses.**

## What it does

```
F1 SignalR  →  This script  →  Supabase  →  Your PWA users
  (live)         (parsing)      (storage)     (everywhere)
```

One person runs this script. Everyone using the PWA sees live positions automatically.

## Setup (one-time, ~5 minutes)

### 1. Install Node.js
If you don't have it: download from https://nodejs.org (the LTS version).

### 2. Install dependencies
Open Terminal, cd to this folder, and run:
```bash
cd /Users/ahmedmasoud/Desktop/f1-predictor/live-bridge
npm install
```

### 3. Configure credentials
```bash
cp .env.example .env
```
Then open `.env` and fill in:
- `BRIDGE_KEY` — the `CRON_SECRET` value from Vercel (Settings → Environment Variables).
  The bridge saves through the site's `/api/save` endpoint; the database itself is read-only to the public key.
- `NEWSLETTER_TRIGGER_KEY` — the same value, if the race-report email should go out automatically after the race.

## In the cloud (the usual way)

Live timing runs in Supabase, so no computer has to stay on: the `live` edge function
(`supabase/functions/live/`) does the same job as this script. The pg_cron job `live-cloud` calls it
every minute from Friday to Sunday; during a session each run connects to F1's feed (Server-Sent
Events), saves positions every 3 seconds for about 50 seconds, and ends, and the next minute's run
carries on. Pit Wall → Health and reports shows its runs and can start it by hand for 2 hours.
F1 blocks GitHub Actions machines, so the GitHub workflow (`.github/workflows/live-timing.yml`) is
not used. This script is the backup: run it on your computer if the cloud runs ever fail.

## Run it on your computer (every race weekend)

```bash
npm start
```

You'll see output like:
```
14:32:01 🏎  F1 Live Bridge starting…
14:32:01 📡 Negotiating with F1 SignalR...
14:32:02 ✅ WebSocket connected
14:32:02 📨 Subscribed to: TimingData, DriverList, SessionInfo, TrackStatus, LapCount
14:32:03 🏁 Session: Canadian Grand Prix · Race · Montreal
14:32:08 ✅ Flushed 20 positions → Race · Leader: VER lap 1
14:32:13 ✅ Flushed 20 positions → Race · Leader: VER lap 2
...
```

Leave the Terminal window open. The script saves new positions every 5 seconds.

When you're done (after the session), close the Terminal window or press `Ctrl+C`.

## Configuration

Edit `.env`:
- `FLUSH_INTERVAL_MS` — how often to save positions (default 5000ms = 5s). Lower = more real-time.
- `DEBUG=true` — verbose logging if something looks wrong.

## Resource usage

Negligible — see main project for benchmarks. Won't impact your computer.

## Troubleshooting

**"WebSocket closed" repeating** — F1's SignalR drops idle connections; the script auto-reconnects. Normal.

**"Save failed: 403"** — `BRIDGE_KEY` doesn't match the `CRON_SECRET` in Vercel.
**"Save failed: 400"** — the site rejected the data (the message says which field).

**"Negotiate failed: 403"** — F1 has tightened access. Try again later; usually works during race weekends.

**No data showing in PWA** — check Supabase Table Editor → `sessions` table. If rows are being added, the bridge is working and the PWA-side query just needs a refresh.

## Architecture

This script:
1. Calls F1's SignalR `/negotiate` to get a connection token
2. Opens a WebSocket to `wss://livetiming.formula1.com/signalr/connect`
3. Subscribes to `TimingData`, `DriverList`, `SessionInfo`, etc.
4. Decompresses `.z` (zlib) payloads
5. Merges incoming updates into in-memory state
6. Every `FLUSH_INTERVAL_MS`, writes the current grid to Supabase

The Supabase write is an UPSERT on `(circuit_id, round, year, session_name)` so each session always has exactly one row with the latest data.

## License

Personal use only. F1 owns the timing data — this bridge connects to their public SignalR feed the same way their official website does. Don't redistribute the data.

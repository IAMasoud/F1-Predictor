-- The AI's live calls during a race ("Ask the AI now" on the Live screen), so the latest one is
-- shown to everyone and survives a reload. Written only by api/predict.js (server key) while a
-- race is running; anyone can read them, like the predictions. They never count in any score.
create table if not exists public.live_calls (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  season     int not null,
  circuit_id text not null,
  round      int,
  lap        int,
  total_laps int,
  top10      jsonb not null,           -- driver codes in the predicted finishing order
  win_chance int,                      -- chance the predicted winner wins, 1-99
  model      text
);
create index if not exists live_calls_race on public.live_calls (circuit_id, season, created_at desc);
alter table public.live_calls enable row level security;
revoke all on public.live_calls from anon, authenticated;
grant select on public.live_calls to anon;
drop policy if exists "public select" on public.live_calls;
create policy "public select" on public.live_calls for select to anon using (true);

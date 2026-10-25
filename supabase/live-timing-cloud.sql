-- Live timing in the cloud, the Supabase way (edge function `live`): one run per minute during
-- sessions, each ~50 seconds. F1 blocks GitHub's machines, so the GitHub Actions route
-- (live-timing.sql) is switched off. Server-only table: RLS on, no policies.
create table if not exists public.live_runs (
  id      bigserial primary key,
  ts      timestamptz not null default now(),
  session text,
  flushes int not null default 0,
  ms      int not null default 0,
  error   text
);
create index if not exists live_runs_ts on public.live_runs (ts desc);
alter table public.live_runs enable row level security;
revoke all on public.live_runs from anon, authenticated;

-- Every minute from Friday to Sunday (UTC); the function does nothing outside a session.
select cron.unschedule('live-timing') where exists (select 1 from cron.job where jobname = 'live-timing');
select cron.unschedule('live-cloud') where exists (select 1 from cron.job where jobname = 'live-cloud');
select cron.schedule('live-cloud', '* * * * 5,6,0', $$select net.http_post(url:='https://zeqxzyisqwemqsvspbyj.supabase.co/functions/v1/live', body:='{}'::jsonb, headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=10000);$$);

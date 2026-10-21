-- Live timing in the cloud: one row per session the ops function started on GitHub Actions
-- (see .github/workflows/live-timing.yml). Server-only: RLS on, no policies.
create table if not exists public.bridge_runs (
  id            bigserial primary key,
  session_key   text not null unique,          -- 2026-18-fp1, or manual-<ms> for Pit Wall starts
  label         text not null,
  starts_at     timestamptz,
  minutes       int not null,
  status        text not null default 'started', -- started | failed
  error         text,
  attempts      int not null default 1,
  dispatched_at timestamptz not null default now()
);
alter table public.bridge_runs enable row level security;
revoke all on public.bridge_runs from anon, authenticated;

-- Every 5 minutes from Thursday to Sunday (UTC): start a run 5 to 10 minutes before each session.
select cron.unschedule('live-timing') where exists (select 1 from cron.job where jobname = 'live-timing');
select cron.schedule('live-timing', '*/5 * * * 4,5,6,0', $$select net.http_post(url:='https://zeqxzyisqwemqsvspbyj.supabase.co/functions/v1/ops?task=bridge', body:='{}'::jsonb, headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=60000);$$);

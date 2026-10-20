-- F1 Predictor — race-report automation, site health, weekly report (applied 2026-10-21).
-- Like analytics.sql: row level security on, no policies, so only the server key can read
-- or write these tables. Scheduled calls read the shared secret from Vault (cron_secret).

-- Race report: at most one automatic send per race. Manual sends from the admin page
-- are logged as 'manual', tests are never logged.
alter table public.newsletter_log add column if not exists kind text not null default 'manual';
create unique index if not exists newsletter_auto_once on public.newsletter_log (season, round) where kind = 'auto';

-- One row per daily scan of the live site.
create table if not exists public.health_checks (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  ok      boolean not null,
  failed  integer not null default 0,
  checks  jsonb not null default '[]'::jsonb,   -- [{ name, ok, detail }]
  source  text not null default 'scan'
);
create index if not exists health_checks_ts_idx on public.health_checks (ts desc);
alter table public.health_checks enable row level security;
revoke all on public.health_checks from anon, authenticated;

-- Bugs found and fixed: written by the daily scan, the maintenance agent and the admin page.
-- A problem that is still open keeps one row (fingerprint), however many scans see it.
create table if not exists public.maintenance_log (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  kind         text not null check (kind in ('found', 'fixed', 'note')),
  title        text not null,
  detail       text,
  source       text not null default 'scan',        -- scan, agent, admin
  resolved     boolean not null default false,
  resolved_ts  timestamptz,
  fingerprint  text
);
create index if not exists maintenance_log_ts_idx on public.maintenance_log (ts desc);
create unique index if not exists maintenance_open_once on public.maintenance_log (fingerprint) where not resolved and fingerprint is not null;
alter table public.maintenance_log enable row level security;
revoke all on public.maintenance_log from anon, authenticated;

-- Server-only settings, e.g. where the weekly report is delivered (Telegram, Discord, WhatsApp).
create table if not exists public.app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- The weekly one-page reports (the PDF itself is in the private "reports" storage bucket).
create table if not exists public.weekly_reports (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  week_start  date not null,
  week_end    date not null,
  path        text not null,
  summary     jsonb,
  delivered   jsonb
);
create index if not exists weekly_reports_created_idx on public.weekly_reports (created_at desc);
alter table public.weekly_reports enable row level security;
revoke all on public.weekly_reports from anon, authenticated;

insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;

-- ── Scheduled jobs ──
-- AI calls: every 15 minutes (the job only works inside a race weekend; a busy AI is retried
-- until it answers, so a baseline is replaced as soon as the free tier has room).
select cron.schedule('retry-predictions', '*/15 * * * *', $$select net.http_get(url:='https://f1-predictor-theta.vercel.app/api/push-send?mode=predictions', headers:=jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=290000);$$);

-- Race report: checked hourly; sends once the race is official and scored (see send-newsletter.js).
select cron.schedule('race-report', '50 * * * *', $$select net.http_post(url:='https://f1-predictor-theta.vercel.app/api/send-newsletter?mode=auto', body:='{}'::jsonb, headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=120000);$$);

-- Daily scan of the live site, and the weekly report every Monday.
select cron.schedule('site-scan', '0 6 * * *', $$select net.http_post(url:='https://zeqxzyisqwemqsvspbyj.supabase.co/functions/v1/ops?task=scan', body:='{}'::jsonb, headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=120000);$$);
select cron.schedule('weekly-report', '0 7 * * 1', $$select net.http_post(url:='https://zeqxzyisqwemqsvspbyj.supabase.co/functions/v1/ops?task=weekly', body:='{}'::jsonb, headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds:=120000);$$);

-- Pitwall — analytics + admin tables (applied 2026-10-20).
-- Only the server (service key) can read or write these: row level security is on and
-- there are no policies, so the public "anon" key sees nothing.

-- Usage events from the site, sent by /api/track. No cookies: `visitor` is a hash of
-- IP + browser + a salt that changes every day, so a visitor can be counted for a day
-- but not followed across days.
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  name        text not null,           -- view, screen, generate, install, push_on, email_join, share, error
  screen      text,
  visitor     text,
  country     text,
  device      text,                    -- phone, tablet, desktop
  os          text,
  browser     text,
  referrer    text,                    -- domain only
  standalone  boolean,                 -- opened as the installed app
  lang        text,
  app_version text,
  detail      text
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_name_ts_idx on public.events (name, ts);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

-- One row per AI attempt (which model, how long, whether it worked).
create table if not exists public.ai_calls (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  source  text,                        -- user (Generate button) or auto (scheduled)
  model   text,
  ok      boolean not null,
  ms      integer,
  error   text,
  race    text,
  stage   text
);
create index if not exists ai_calls_ts_idx on public.ai_calls (ts);
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;

-- Daily totals kept after the raw events are cleared.
create table if not exists public.daily_stats (
  day    date not null,
  metric text not null,                -- visitors, views, events, country, device, screen, referrer, os, browser
  key    text not null default '',
  value  integer not null,
  primary key (day, metric, key)
);
alter table public.daily_stats enable row level security;
revoke all on public.daily_stats from anon, authenticated;

-- Admin can hide a bad prediction from the site without deleting it.
alter table public.predictions add column if not exists hidden boolean not null default false;
drop policy if exists "public select" on public.predictions;
create policy "public select" on public.predictions for select to anon using (not hidden);

-- Roll one day of events into daily_stats (safe to run again for the same day).
create or replace function public.rollup_events(d date) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from daily_stats where day = d;
  insert into daily_stats (day, metric, key, value)
    select d, 'visitors', '', count(distinct visitor) from events where ts >= d and ts < d + 1
    union all select d, 'views', '', count(*) from events where name = 'view' and ts >= d and ts < d + 1
    union all select d, 'events', name, count(*) from events where ts >= d and ts < d + 1 group by name
    union all select d, 'country', coalesce(country, '?'), count(distinct visitor) from events where ts >= d and ts < d + 1 group by country
    union all select d, 'device', coalesce(device, '?'), count(distinct visitor) from events where ts >= d and ts < d + 1 group by device
    union all select d, 'os', coalesce(os, '?'), count(distinct visitor) from events where ts >= d and ts < d + 1 group by os
    union all select d, 'browser', coalesce(browser, '?'), count(distinct visitor) from events where ts >= d and ts < d + 1 group by browser
    union all select d, 'screen', coalesce(screen, '?'), count(*) from events where name in ('view', 'screen') and ts >= d and ts < d + 1 group by screen
    union all select d, 'referrer', referrer, count(distinct visitor) from events where referrer is not null and ts >= d and ts < d + 1 group by referrer
    union all select d, 'installed', '', count(distinct visitor) from events where standalone and ts >= d and ts < d + 1;
end $$;
revoke execute on function public.rollup_events(date) from public, anon, authenticated;

-- Scheduled-job health for the admin dashboard (reads pg_cron's run history).
create or replace function public.admin_job_status() returns table (
  jobname text, schedule text, active boolean, runs_7d bigint, failed_7d bigint,
  last_start timestamptz, last_status text
) language sql security definer set search_path = public, cron as $$
  select j.jobname, j.schedule, j.active,
         count(d.runid) filter (where d.start_time > now() - interval '7 days'),
         count(d.runid) filter (where d.start_time > now() - interval '7 days' and d.status <> 'succeeded'),
         max(d.start_time),
         (array_agg(d.status order by d.start_time desc))[1]
  from cron.job j left join cron.job_run_details d on d.jobid = j.jobid
  group by j.jobid, j.jobname, j.schedule, j.active
  order by j.jobname;
$$;
revoke execute on function public.admin_job_status() from public, anon, authenticated;

-- Nightly at 00:20 UTC: roll up yesterday, then keep raw events 35 days and AI calls 180 days.
select cron.schedule('rollup-analytics', '20 0 * * *', $$
  select public.rollup_events(current_date - 1);
  delete from public.events where ts < now() - interval '35 days';
  delete from public.ai_calls where ts < now() - interval '180 days';
$$);

-- One row per race-report email run (shown on the admin page).
create table if not exists public.newsletter_log (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  season    integer,
  round     integer,
  circuit_id text,
  sent      integer,
  failed    integer
);
alter table public.newsletter_log enable row level security;
revoke all on public.newsletter_log from anon, authenticated;
-- Dashboard numbers for the last `days` days (raw events cover 35 days; older days come from daily_stats).
create or replace function public.admin_overview(days integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(days, 1) - 1);
  prev  timestamptz := since - make_interval(days => greatest(days, 1));
  out jsonb;
begin
  with e as (select * from events where ts >= since),
  top as (
    select metric, jsonb_agg(jsonb_build_object('key', key, 'value', value) order by value desc) list from (
      select 'countries' metric, coalesce(country,'?') key, count(distinct visitor) value from e group by 2
      union all select 'devices', coalesce(device,'?'), count(distinct visitor) from e group by 2
      union all select 'os', coalesce(os,'?'), count(distinct visitor) from e group by 2
      union all select 'browsers', coalesce(browser,'?'), count(distinct visitor) from e group by 2
      union all select 'screens', coalesce(screen,'?'), count(*) from e where name in ('view','screen') group by 2
      union all select 'referrers', referrer, count(distinct visitor) from e where referrer is not null group by 2
      union all select 'events', name, count(*) from e group by 2
    ) t group by metric
  ),
  per_day as (
    select d::date as day,
      coalesce((select count(distinct visitor) from e where ts >= d and ts < d + interval '1 day'),
               (select value from daily_stats where day = d::date and metric = 'visitors' and key = ''), 0) visitors,
      coalesce((select count(*) from e where name = 'view' and ts >= d and ts < d + interval '1 day'), 0) views
    from generate_series(since, date_trunc('day', now()), interval '1 day') d
  )
  select jsonb_build_object(
    'days', days,
    'visitors', (select count(distinct visitor) from e),
    'views', (select count(*) from e where name = 'view'),
    'installed', (select count(distinct visitor) from e where standalone or name = 'install'),
    'prev_visitors', (select count(distinct visitor) from events where ts >= prev and ts < since),
    'live_now', (select count(distinct visitor) from events where ts > now() - interval '5 minutes'),
    'per_day', (select jsonb_agg(jsonb_build_object('day', day, 'visitors', visitors, 'views', views) order by day) from per_day),
    'top', (select jsonb_object_agg(metric, list) from top),
    'errors', (select jsonb_agg(x) from (select jsonb_build_object('ts', ts, 'detail', detail, 'screen', screen, 'browser', browser) x
               from e where name = 'error' order by ts desc limit 10) z)
  ) into out;
  return out;
end $$;
revoke execute on function public.admin_overview(integer) from public, anon, authenticated;

-- How the free AI has been doing (one row per attempt in ai_calls).
create or replace function public.admin_ai(days integer default 7) returns jsonb
language sql security definer set search_path = public as $$
  with a as (select * from ai_calls where ts >= now() - make_interval(days => days))
  select jsonb_build_object(
    'attempts', (select count(*) from a),
    'ok', (select count(*) filter (where ok) from a),
    'by_model', (select jsonb_agg(m order by (m->>'attempts')::int desc) from (
        select jsonb_build_object('model', model, 'attempts', count(*), 'ok', count(*) filter (where ok),
          'p50', percentile_cont(0.5) within group (order by ms) filter (where ok),
          'p95', percentile_cont(0.95) within group (order by ms) filter (where ok)) m
        from a group by model) t),
    'by_source', (select jsonb_object_agg(coalesce(source,'?'), n) from (select source, count(*) filter (where ok) n from a group by source) s),
    'per_day', (select jsonb_agg(jsonb_build_object('day', day, 'ok', okn, 'failed', bad) order by day) from (
        select date_trunc('day', ts)::date as day, count(*) filter (where ok) okn, count(*) filter (where not ok) bad from a group by 1) d),
    'recent_errors', (select jsonb_agg(x) from (select jsonb_build_object('ts', ts, 'model', model, 'error', error, 'source', source) x
        from a where not ok order by ts desc limit 8) z)
  );
$$;
revoke execute on function public.admin_ai(integer) from public, anon, authenticated;

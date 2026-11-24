-- The ML model's calls (ml/run.py, run by GitHub Actions). Private: no public read or write.
-- Pit Wall reads it through /api/admin (server key). GitHub writes only through the three
-- functions below, which check ML_KEY against the sha256 stored in app_settings.ml_key_hash.
create table if not exists public.ml_predictions (
  id          bigint generated always as identity primary key,
  season      int  not null,
  round       int  not null,
  circuit_id  text not null,
  stage       text not null check (stage in ('beforeQuali', 'afterQuali', 'live')),
  lap         int  not null default 0 check (lap between 0 and 120),
  top10       jsonb not null,                 -- ["VER","NOR",...]
  win         jsonb not null default '{}',    -- {"VER": 41.2, ...} chance to win, %
  info        jsonb not null default '{}',    -- rain forecast, which sessions were known
  accuracy    numeric,                        -- the site's formula, once the race is over
  winner_hit  boolean,
  actual      jsonb,                          -- the real finishing order (codes)
  created_at  timestamptz not null default now(),
  scored_at   timestamptz,
  unique (season, round, stage, lap)
);
alter table public.ml_predictions enable row level security;
revoke all on public.ml_predictions from anon, authenticated;

create or replace function public.ml_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(length(p_key) >= 32 and encode(extensions.digest(p_key, 'sha256'), 'hex') =
         (select value from public.app_settings where key = 'ml_key_hash'), false)
$$;
revoke all on function public.ml_key_ok(text) from public, anon, authenticated;

create or replace function public.ml_ingest(p_key text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.ml_key_ok(p_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then raise exception 'bad rows'; end if;
  insert into public.ml_predictions (season, round, circuit_id, stage, lap, top10, win, info)
  select (r->>'season')::int, (r->>'round')::int, left(r->>'circuit_id', 40), r->>'stage', coalesce((r->>'lap')::int, 0),
         r->'top10', coalesce(r->'win', '{}'), coalesce(r->'info', '{}')
  from jsonb_array_elements(p_rows) r
  where jsonb_typeof(r->'top10') = 'array' and jsonb_array_length(r->'top10') between 1 and 10
  on conflict (season, round, stage, lap) do update
    set top10 = excluded.top10, win = excluded.win, info = excluded.info, created_at = now()
    where public.ml_predictions.accuracy is null;   -- a scored call is final
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ml_status(p_key text, p_season int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ml_key_ok(p_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('round', round, 'stage', stage, 'lap', lap, 'top10', top10, 'accuracy', accuracy))
                   from public.ml_predictions where season = p_season), '[]');
end $$;

create or replace function public.ml_score(p_key text, p_rows jsonb, p_actual jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.ml_key_ok(p_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.ml_predictions m
     set accuracy = (r->>'accuracy')::numeric, winner_hit = (r->>'winner_hit')::boolean, actual = p_actual, scored_at = now()
    from jsonb_array_elements(p_rows) r
   where m.season = (r->>'season')::int and m.round = (r->>'round')::int and m.stage = r->>'stage'
     and m.lap = coalesce((r->>'lap')::int, 0) and m.accuracy is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ml_ingest(text, jsonb), public.ml_status(text, int), public.ml_score(text, jsonb, jsonb) from public;
grant execute on function public.ml_ingest(text, jsonb), public.ml_status(text, int), public.ml_score(text, jsonb, jsonb) to anon;

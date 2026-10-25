-- Emails to every subscriber that are not race reports (e.g. "the race is live"), one row per
-- send so each kind goes out at most once per race. Kept apart from newsletter_log, which the
-- race report logic reads. Server-only: RLS on, no policies.
create table if not exists public.email_broadcasts (
  id      bigserial primary key,
  ts      timestamptz not null default now(),
  kind    text not null,            -- live
  season  int not null,
  round   int not null,
  sent    int not null default 0,
  failed  int not null default 0
);
create unique index if not exists email_broadcasts_once on public.email_broadcasts (kind, season, round);
alter table public.email_broadcasts enable row level security;
revoke all on public.email_broadcasts from anon, authenticated;

-- Telegram bot (@ the bot saved in Pit Wall): team members link their own Telegram chat with a
-- one-time code from Pit Wall, then send commands (scan, report, status...) to the `bot` edge
-- function. Pit Wall's Assistant tab runs the same commands. Server-only: RLS on, no policies.

-- Who is who: one Telegram chat per Pit Wall admin.
create table if not exists public.telegram_links (
  user_id   uuid primary key,                 -- the Pit Wall admin (auth.users id)
  chat_id   bigint not null unique,
  username  text,
  name      text,
  linked_at timestamptz not null default now()
);

-- One-time codes for t.me/<bot>?start=<code>, made in Pit Wall, valid for 30 minutes.
create table if not exists public.telegram_codes (
  code       text primary key,
  user_id    uuid not null,
  expires_at timestamptz not null
);

-- Every command, from Telegram or Pit Wall: who asked what and when (also stops quick repeats).
create table if not exists public.bot_log (
  id      bigserial primary key,
  ts      timestamptz not null default now(),
  user_id uuid,
  via     text not null,                      -- telegram | pitwall
  command text not null,
  ok      boolean
);
create index if not exists bot_log_ts on public.bot_log (ts desc);

alter table public.telegram_links enable row level security;
alter table public.telegram_codes enable row level security;
alter table public.bot_log enable row level security;
revoke all on public.telegram_links, public.telegram_codes, public.bot_log from anon, authenticated;

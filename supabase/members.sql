-- F1 Predictor — team invites and applications (applied 2026-10-21).
-- The owner makes an invite link for a role; the person fills in /join; the owner accepts or
-- rejects in Pit Wall → Members. Like the other admin tables: row level security on, no
-- policies, so only the server key can read or write them.

create table if not exists public.admin_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,                 -- the secret part of the /join#t=… link
  role        text not null,                        -- what the owner typed, e.g. "Data analyst"
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,                          -- one application per link
  revoked     boolean not null default false
);
alter table public.admin_invites enable row level security;
revoke all on public.admin_invites from anon, authenticated;

create table if not exists public.member_applications (
  id               uuid primary key default gen_random_uuid(),
  invite_id        uuid references public.admin_invites(id) on delete set null,
  role             text not null,
  created_at       timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  -- required
  full_name        text not null,
  date_of_birth    date not null,
  email            text not null,
  -- optional
  phone            text,
  location         text,
  education_level  text,
  school           text,
  major            text,
  graduation_year  integer,
  occupation       text,
  skills           text,
  languages        text,
  interests        text,
  linkedin         text,
  website          text,
  hours_per_week   integer,
  about            text,
  cv_path          text,                             -- in the private "applications" bucket
  cv_name          text,
  -- the sign-in account made from their email and password (blocked until accepted)
  auth_user_id     uuid,
  decided_at       timestamptz,
  decided_by       uuid,
  decision_note    text,
  email_status     text
);
create index if not exists member_applications_created_idx on public.member_applications (created_at desc);
alter table public.member_applications enable row level security;
revoke all on public.member_applications from anon, authenticated;

-- CVs: private, 10 MB, PDF or Word only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applications', 'applications', false, 10485760,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in accounts (admins and people waiting for an answer) never read these directly;
-- row level security already blocks them, this removes the leftover table grants too.
revoke all on public.subscribers, public.push_subscriptions from authenticated;

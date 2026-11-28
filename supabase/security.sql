-- Pitwall — database access rules (applied 2026-09-24).
-- The browser uses the public "anon" key, which is visible in the page source, so it
-- may only READ predictions and sessions. Every write goes through the site's server
-- endpoints (/api/save, /api/subscribe, /api/unsubscribe, /api/push-subscribe),
-- which validate the data and use the server-only service key.

-- predictions + sessions: public read, no public writes
drop policy if exists "public insert" on public.predictions;
drop policy if exists "public update" on public.predictions;
drop policy if exists "public insert" on public.sessions;
drop policy if exists "public update" on public.sessions;
revoke insert, update, delete, truncate, references, trigger on public.predictions, public.sessions from anon;

-- subscribers + push_subscriptions: no public access at all
drop policy if exists "anon can insert subscribers"  on public.subscribers;
drop policy if exists "anon can update subscribers"  on public.subscribers;
drop policy if exists "service can read subscribers" on public.subscribers;
revoke all on public.subscribers, public.push_subscriptions from anon;

-- (the "public select" policies on predictions and sessions stay)

-- ── To undo (not recommended) ─────────────────────────────────────────────
-- grant insert, update on public.predictions, public.sessions to anon;
-- create policy "public insert" on public.predictions for insert to anon with check (true);
-- create policy "public update" on public.predictions for update to anon using (true) with check (true);
-- create policy "public insert" on public.sessions   for insert to anon with check (true);
-- create policy "public update" on public.sessions   for update to anon using (true) with check (true);

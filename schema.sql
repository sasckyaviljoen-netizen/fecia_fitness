-- Road to 70.3 — Supabase schema
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It creates the sync table and locks it down so each user only ever sees their own rows.

create table if not exists public.app_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Row Level Security: a signed-in user can only read/write rows tagged with their own id.
alter table public.app_state enable row level security;

drop policy if exists "own rows: select" on public.app_state;
create policy "own rows: select" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.app_state;
create policy "own rows: insert" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.app_state;
create policy "own rows: update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.app_state;
create policy "own rows: delete" on public.app_state
  for delete using (auth.uid() = user_id);

-- Optional: enable Realtime so edits on one device push to the others instantly.
-- The app also syncs on focus/reconnect, so this is a nice-to-have, not required.
-- alter publication supabase_realtime add table public.app_state;

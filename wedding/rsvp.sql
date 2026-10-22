-- Wedding RSVPs — Supabase setup
-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Guests can only ADD replies. Nobody visiting the site can read, change or delete them.
-- To see replies: Supabase dashboard -> Table Editor -> wedding_rsvps (you can export to CSV there).

create table if not exists public.wedding_rsvps (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text        not null check (char_length(name) between 1 and 200),
  attending  boolean     not null,
  dietary    text        check (char_length(dietary) <= 500),
  song       text        check (char_length(song) <= 200),
  note       text        check (char_length(note) <= 2000)
);

alter table public.wedding_rsvps enable row level security;

-- Visitors may insert a reply. There is deliberately no select/update/delete policy,
-- so replies are only visible to you in the dashboard.
drop policy if exists "guests can submit an rsvp" on public.wedding_rsvps;
create policy "guests can submit an rsvp" on public.wedding_rsvps
  for insert to anon, authenticated
  with check (true);

grant insert on public.wedding_rsvps to anon, authenticated;

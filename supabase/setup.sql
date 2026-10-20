-- =====================================================================
-- Plant Diary database setup
--
-- How to use: open your Supabase project, go to SQL Editor, paste this
-- whole file, and click Run. It is safe to run again later (for example
-- after an app update that changes this file).
--
-- What it creates:
--   * tables for spaces, members, plants, care events and photo records
--   * row-level security, so each signed-in person can only reach the
--     spaces they belong to
--   * a private "photos" storage bucket with the same rules
--   * small helper functions for creating spaces, invites and joining
--   * a ping() function used by the daily keep-alive job
--
-- Everything personal (plant names, notes, dates, photos, display names)
-- is encrypted on the phone before it is uploaded. The database only ever
-- stores scrambled text and scrambled files.
-- =====================================================================

-- ---------- Tables ----------

create table if not exists public.spaces (
  id              uuid primary key,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  kdf_salt        text not null,      -- salt for turning the passphrase into a key
  kdf_iterations  integer not null,   -- PBKDF2 rounds
  wrapped_key     text not null,      -- the space's data key, locked with the passphrase
  enc_meta        text not null       -- encrypted { name }
);

create table if not exists public.space_members (
  space_id    uuid not null references public.spaces(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  enc_profile text,                   -- encrypted { displayName }
  joined_at   timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.space_invites (
  code        text primary key,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '7 days')
);

create table if not exists public.plants (
  id          uuid primary key,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  data        text not null,          -- encrypted plant details
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.care_events (
  id          uuid primary key,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  plant_id    uuid not null references public.plants(id) on delete cascade,
  data        text not null,          -- encrypted { type, date }
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.photos (
  id          uuid primary key,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  plant_id    uuid not null references public.plants(id) on delete cascade,
  data        text not null,          -- encrypted { date, kind }
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists space_members_user_idx on public.space_members(user_id);
create index if not exists plants_space_idx       on public.plants(space_id);
create index if not exists care_events_space_idx  on public.care_events(space_id);
create index if not exists care_events_plant_idx  on public.care_events(plant_id);
create index if not exists photos_space_idx       on public.photos(space_id);
create index if not exists photos_plant_idx       on public.photos(plant_id);

-- Keep plants.updated_at current on every edit.
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists plants_touch on public.plants;
create trigger plants_touch before update on public.plants
  for each row execute function public.touch_updated_at();

-- ---------- Helper checks (used by the security rules) ----------

create or replace function public.is_space_member(s uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_members
    where space_id = s and user_id = auth.uid()
  );
$$;

create or replace function public.is_space_owner(s uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_members
    where space_id = s and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Reads the space id from a storage path like "<space-id>/<photo-id>_t".
-- Returns null for anything malformed, which then fails every check.
create or replace function public.space_from_path(p text)
returns uuid language plpgsql immutable
set search_path = public
as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- ---------- Row-level security ----------

alter table public.spaces        enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.plants        enable row level security;
alter table public.care_events   enable row level security;
alter table public.photos        enable row level security;

-- spaces: members can read; only the owner can change or delete.
-- New spaces are created through create_space() below.
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
  for select to authenticated using (public.is_space_member(id));

drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces
  for update to authenticated
  using (public.is_space_owner(id)) with check (public.is_space_owner(id));

drop policy if exists spaces_delete on public.spaces;
create policy spaces_delete on public.spaces
  for delete to authenticated using (public.is_space_owner(id));

-- space_members: members see each other; you can edit your own profile;
-- you can leave, and the owner can remove people.
drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members
  for select to authenticated using (public.is_space_member(space_id));

drop policy if exists members_update_self on public.space_members;
create policy members_update_self on public.space_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists members_delete on public.space_members;
create policy members_delete on public.space_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_space_owner(space_id));

-- space_invites: no direct access at all; only through the functions below.

-- plants, care events, photos: full access for members of that space.
drop policy if exists plants_all on public.plants;
create policy plants_all on public.plants
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

drop policy if exists care_events_all on public.care_events;
create policy care_events_all on public.care_events
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (
    public.is_space_member(space_id)
    and exists (select 1 from public.plants p
                where p.id = plant_id and p.space_id = care_events.space_id)
  );

drop policy if exists photos_all on public.photos;
create policy photos_all on public.photos
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (
    public.is_space_member(space_id)
    and exists (select 1 from public.plants p
                where p.id = plant_id and p.space_id = photos.space_id)
  );

-- ---------- Table permissions ----------
-- Signed-out visitors get nothing. Signed-in people get only what the
-- rules above allow. Members can edit only their own encrypted profile.

revoke all on public.spaces, public.space_members, public.space_invites,
              public.plants, public.care_events, public.photos
  from anon, authenticated;

grant select, delete on public.spaces to authenticated;
grant update (kdf_salt, kdf_iterations, wrapped_key, enc_meta) on public.spaces to authenticated;
grant select, delete on public.space_members to authenticated;
grant update (enc_profile) on public.space_members to authenticated;
grant select, insert, update, delete on public.plants, public.care_events, public.photos to authenticated;

-- ---------- Functions the app calls ----------

-- Create a space and make the caller its owner.
create or replace function public.create_space(
  p_id uuid,
  p_kdf_salt text,
  p_kdf_iterations integer,
  p_wrapped_key text,
  p_enc_meta text,
  p_enc_profile text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  insert into public.spaces (id, created_by, kdf_salt, kdf_iterations, wrapped_key, enc_meta)
  values (p_id, auth.uid(), p_kdf_salt, p_kdf_iterations, p_wrapped_key, p_enc_meta);
  insert into public.space_members (space_id, user_id, role, enc_profile)
  values (p_id, auth.uid(), 'owner', p_enc_profile);
  return p_id;
end;
$$;

-- Make a one-time invite code for a space (valid for 7 days).
create or replace function public.create_invite(p_space uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_space_member(p_space) then
    raise exception 'You are not a member of this space.';
  end if;
  delete from public.space_invites where expires_at < now();
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.space_invites (code, space_id, created_by)
  values (new_code, p_space, auth.uid());
  return new_code;
end;
$$;

-- Join a space with an invite code. The code is used up afterwards.
create or replace function public.join_space(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  target uuid;
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  select space_id into target from public.space_invites
  where code = clean and expires_at > now();
  if target is null then
    raise exception 'That invite code is not valid or has expired.';
  end if;
  insert into public.space_members (space_id, user_id, role)
  values (target, auth.uid(), 'member')
  on conflict (space_id, user_id) do nothing;
  delete from public.space_invites where code = clean;
  return target;
end;
$$;

-- Used by the daily keep-alive job so the free project never pauses.
create or replace function public.ping()
returns text language sql stable
set search_path = public
as $$
  select 'ok'::text;
$$;

revoke all on function public.is_space_member(uuid) from public, anon;
revoke all on function public.is_space_owner(uuid) from public, anon;
revoke all on function public.create_space(uuid, text, integer, text, text, text) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.join_space(text) from public, anon;
grant execute on function public.is_space_member(uuid) to authenticated;
grant execute on function public.is_space_owner(uuid) to authenticated;
grant execute on function public.create_space(uuid, text, integer, text, text, text) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_space(text) to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ---------- Photo storage ----------
-- Private bucket. Files are encrypted before upload. Paths look like
-- "<space-id>/<photo-id>_t" (thumbnail) and "<space-id>/<photo-id>_f" (full size).

insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

drop policy if exists plant_diary_photos_select on storage.objects;
create policy plant_diary_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_space_member(public.space_from_path(name)));

drop policy if exists plant_diary_photos_insert on storage.objects;
create policy plant_diary_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_space_member(public.space_from_path(name)));

drop policy if exists plant_diary_photos_update on storage.objects;
create policy plant_diary_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_space_member(public.space_from_path(name)))
  with check (bucket_id = 'photos' and public.is_space_member(public.space_from_path(name)));

drop policy if exists plant_diary_photos_delete on storage.objects;
create policy plant_diary_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_space_member(public.space_from_path(name)));

-- Done. You should see "Success. No rows returned".

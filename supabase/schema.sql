-- Manga-Regal – Supabase setup
-- In Supabase: SQL Editor -> New query -> gesamten Inhalt ausführen.

create extension if not exists pgcrypto;

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null,
  lang text not null default 'de' check (lang in ('de','en','ja')),
  released_count integer not null default 1 check (released_count >= 1),
  announced_count integer not null default 1 check (announced_count >= released_count),
  status text not null default 'laufend',
  note text not null default '',
  cover_path text,
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);

create table if not exists public.volumes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null,
  user_id uuid not null default auth.uid(),
  volume_number integer not null check (volume_number >= 1),
  label text,
  owned boolean not null default false,
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id,volume_number),
  foreign key(series_id,user_id) references public.series(id,user_id) on delete cascade
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists series_updated_at on public.series;
create trigger series_updated_at before update on public.series
for each row execute procedure public.set_updated_at();

drop trigger if exists volumes_updated_at on public.volumes;
create trigger volumes_updated_at before update on public.volumes
for each row execute procedure public.set_updated_at();

alter table public.series enable row level security;
alter table public.volumes enable row level security;

drop policy if exists "series_select_own" on public.series;
create policy "series_select_own" on public.series for select
using (user_id = auth.uid());

drop policy if exists "series_insert_own" on public.series;
create policy "series_insert_own" on public.series for insert
with check (user_id = auth.uid());

drop policy if exists "series_update_own" on public.series;
create policy "series_update_own" on public.series for update
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "series_delete_own" on public.series;
create policy "series_delete_own" on public.series for delete
using (user_id = auth.uid());

drop policy if exists "volumes_select_own" on public.volumes;
create policy "volumes_select_own" on public.volumes for select
using (user_id = auth.uid());

drop policy if exists "volumes_insert_own" on public.volumes;
create policy "volumes_insert_own" on public.volumes for insert
with check (user_id = auth.uid());

drop policy if exists "volumes_update_own" on public.volumes;
create policy "volumes_update_own" on public.volumes for update
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "volumes_delete_own" on public.volumes;
create policy "volumes_delete_own" on public.volumes for delete
using (user_id = auth.uid());

-- Privater Cover-Bucket
insert into storage.buckets (id,name,public)
values ('manga-covers','manga-covers',false)
on conflict (id) do update set public=false;

drop policy if exists "covers_read_own" on storage.objects;
create policy "covers_read_own" on storage.objects for select to authenticated
using (
  bucket_id='manga-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "covers_insert_own" on storage.objects;
create policy "covers_insert_own" on storage.objects for insert to authenticated
with check (
  bucket_id='manga-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "covers_update_own" on storage.objects;
create policy "covers_update_own" on storage.objects for update to authenticated
using (
  bucket_id='manga-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id='manga-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "covers_delete_own" on storage.objects;
create policy "covers_delete_own" on storage.objects for delete to authenticated
using (
  bucket_id='manga-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);

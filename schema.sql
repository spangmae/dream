-- Dream control-plane schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor after creating a new project.

create extension if not exists pgcrypto;

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  custom_id text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  client_id text,
  folder_name text not null default '',
  folder_key text not null default '',
  file_name text not null,
  file_path text,
  disk_path text not null,
  size_bytes bigint not null default 0,
  mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, folder_key, file_name)
);

create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  client_id text,
  folder_name text not null default '',
  folder_key text not null default '',
  file_name text not null,
  file_content text,
  disk_path text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, folder_key, file_name)
);

create index if not exists files_username_idx on public.files (username);
create index if not exists files_folder_idx on public.files (username, folder_key);
create index if not exists contents_username_idx on public.contents (username);
create index if not exists contents_folder_idx on public.contents (username, folder_key);
create index if not exists clients_custom_id_idx on public.clients (custom_id);

create or replace view public.client_overview as
select
  c.id,
  c.username,
  c.custom_id,
  c.last_seen_at,
  c.created_at,
  coalesce(f.file_count, 0)::bigint as file_count,
  coalesce(f.bytes, 0)::bigint as bytes,
  coalesce(ct.content_count, 0)::bigint as content_count
from public.clients c
left join (
  select username, count(*)::bigint as file_count, coalesce(sum(size_bytes), 0)::bigint as bytes
  from public.files
  group by username
) f on f.username = c.username
left join (
  select username, count(*)::bigint as content_count
  from public.contents
  group by username
) ct on ct.username = c.username;

create or replace function public.file_storage_bytes()
returns bigint
language sql
stable
as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.files;
$$;

alter table public.admins enable row level security;
alter table public.clients enable row level security;
alter table public.files enable row level security;
alter table public.contents enable row level security;

-- No anon policies: the Node server uses the service_role key, which bypasses RLS.

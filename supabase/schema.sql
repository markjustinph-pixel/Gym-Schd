create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  workout_plan jsonb,
  macro_goal jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id smallint primary key check (id = 1),
  announcement text not null default '' check (char_length(announcement) <= 500),
  maintenance_mode boolean not null default false,
  signups_enabled boolean not null default true,
  default_workout_plan jsonb
    check (default_workout_plan is null or jsonb_typeof(default_workout_plan) = 'object'),
  default_macro_goal jsonb
    check (default_macro_goal is null or jsonb_typeof(default_macro_goal) = 'object'),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.admin_user_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.admin_user_status enable row level security;

drop policy if exists "Anyone can read public app settings" on public.app_settings;
create policy "Anyone can read public app settings"
  on public.app_settings for select
  using (true);

drop policy if exists "Users can read their own account status" on public.admin_user_status;
create policy "Users can read their own account status"
  on public.admin_user_status for select
  using ((select auth.uid()) = user_id);

create or replace function public.user_can_access_app()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not coalesce(
      (select settings.maintenance_mode from public.app_settings as settings where settings.id = 1),
      false
    )
    and not coalesce(
      (select status.suspended
       from public.admin_user_status as status
       where status.user_id = auth.uid()),
      false
    );
$$;

grant select on public.app_settings to anon, authenticated;
grant select on public.admin_user_status to authenticated;
grant execute on function public.user_can_access_app() to anon, authenticated;
grant select, insert, update, delete on public.app_settings, public.admin_user_status to service_role;

create or replace function public.enforce_signup_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.app_settings as settings
    where settings.id = 1
      and (not settings.signups_enabled or settings.maintenance_mode)
  ) then
    raise exception 'New account registration is disabled by the administrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_settings on auth.users;
create trigger enforce_signup_settings
  before insert on auth.users
  for each row execute function public.enforce_signup_settings();

alter table public.user_settings enable row level security;

drop policy if exists "Users can read their own settings" on public.user_settings;
create policy "Users can read their own settings"
  on public.user_settings for select
  using ((select auth.uid()) = user_id and (select public.user_can_access_app()));

drop policy if exists "Users can create their own settings" on public.user_settings;
create policy "Users can create their own settings"
  on public.user_settings for insert
  with check ((select auth.uid()) = user_id and (select public.user_can_access_app()));

drop policy if exists "Users can update their own settings" on public.user_settings;
create policy "Users can update their own settings"
  on public.user_settings for update
  using ((select auth.uid()) = user_id and (select public.user_can_access_app()))
  with check ((select auth.uid()) = user_id and (select public.user_can_access_app()));

grant select, insert, update on public.user_settings to authenticated;

create table if not exists public.user_app_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  workout_progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(workout_progress) = 'object'),
  daily_tasks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(daily_tasks) = 'array'),
  macro_log jsonb not null default '{}'::jsonb
    check (jsonb_typeof(macro_log) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_app_data enable row level security;

drop policy if exists "Users can read their own app data" on public.user_app_data;
create policy "Users can read their own app data"
  on public.user_app_data for select
  using ((select auth.uid()) = user_id and (select public.user_can_access_app()));

drop policy if exists "Users can create their own app data" on public.user_app_data;
create policy "Users can create their own app data"
  on public.user_app_data for insert
  with check ((select auth.uid()) = user_id and (select public.user_can_access_app()));

drop policy if exists "Users can update their own app data" on public.user_app_data;
create policy "Users can update their own app data"
  on public.user_app_data for update
  using ((select auth.uid()) = user_id and (select public.user_can_access_app()))
  with check ((select auth.uid()) = user_id and (select public.user_can_access_app()));

grant select, insert, update on public.user_app_data to authenticated;
grant select, insert, update, delete on public.user_settings, public.user_app_data to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_app_data'
    ) then
    execute 'alter publication supabase_realtime add table public.user_app_data';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'app_settings'
    ) then
    execute 'alter publication supabase_realtime add table public.app_settings';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'admin_user_status'
    ) then
    execute 'alter publication supabase_realtime add table public.admin_user_status';
  end if;
end
$$;

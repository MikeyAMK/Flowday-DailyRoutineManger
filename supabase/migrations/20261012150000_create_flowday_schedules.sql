create table if not exists public.flowday_schedules (
  user_id uuid not null references auth.users (id) on delete cascade,
  schedule_date date not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, schedule_date),
  constraint flowday_schedules_items_array check (jsonb_typeof(items) = 'array')
);

alter table public.flowday_schedules enable row level security;

revoke all on table public.flowday_schedules from public, anon, authenticated;
grant select, insert, update on table public.flowday_schedules to authenticated;

drop policy if exists "Users can read their Flowday schedules" on public.flowday_schedules;
create policy "Users can read their Flowday schedules"
  on public.flowday_schedules
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "Users can create their Flowday schedules" on public.flowday_schedules;
create policy "Users can create their Flowday schedules"
  on public.flowday_schedules
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "Users can update their Flowday schedules" on public.flowday_schedules;
create policy "Users can update their Flowday schedules"
  on public.flowday_schedules
  for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

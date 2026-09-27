-- Vrompt full-stack Next.js + Supabase foundation.
-- This migration is intended for a dedicated Vrompt Supabase project.
-- It enables RLS on every public table, keeps billing/accounting server-only,
-- and exposes only the minimum browser-readable data.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique,
  role text not null default 'USER' check (role in ('USER','ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','DELETED')),
  account_type text not null default 'REAL' check (account_type in ('REAL','STARTER','OFFICIAL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '',
  send_on_enter boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('OPENAI','GOOGLE','ANTHROPIC','MISTRAL')),
  provider_model_id text not null,
  display_name text not null,
  description text not null default '',
  category text not null default 'general',
  capabilities text[] not null default array['text']::text[],
  capability_states jsonb not null default '{}'::jsonb,
  reasoning_levels text[] not null default array['low']::text[],
  default_reasoning_level text not null default 'low',
  enabled boolean not null default false,
  manual_available boolean not null default true,
  auto_available boolean not null default false,
  maintenance boolean not null default false,
  display_order integer not null default 0,
  quality_tier integer not null default 1 check (quality_tier between 1 and 4),
  routing_priority integer not null default 0,
  routing_cost_score numeric(12,6) not null default 1,
  input_price numeric(18,8) not null default 0,
  cached_input_price numeric(18,8) not null default 0,
  output_price numeric(18,8) not null default 0,
  cache_write_input_price numeric(18,8) not null default 0,
  image_max_cost_usd numeric(18,8),
  credit_cost integer not null default 1 check (credit_cost > 0),
  max_context integer not null,
  max_output integer not null,
  currency char(3) not null default 'USD',
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_model_id)
);

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  original_price integer not null default 0 check (original_price >= 0),
  currency char(3) not null default 'USD',
  billing_interval text not null default 'MONTH' check (billing_interval in ('DAY','WEEK','MONTH','YEAR','ONE_TIME')),
  interval_count integer not null default 1 check (interval_count > 0),
  monthly_credits integer not null default 0 check (monthly_credits >= 0),
  max_projects integer not null default 0 check (max_projects >= 0),
  max_workflows integer not null default 0 check (max_workflows >= 0),
  max_workflow_steps integer not null default 5 check (max_workflow_steps between 1 and 20),
  project_context_chars integer not null default 8000 check (project_context_chars >= 0),
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generation_policies (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  bucket text not null,
  model_id uuid references public.ai_models(id) on delete cascade,
  enabled boolean not null default true,
  daily_limit integer not null default 0 check (daily_limit >= 0),
  monthly_limit integer not null default 0 check (monthly_limit >= 0),
  max_input_chars integer not null default 4000 check (max_input_chars > 0),
  max_context integer not null default 8192 check (max_context > 0),
  max_output integer not null default 1024 check (max_output > 0),
  max_files integer not null default 0 check (max_files between 0 and 10),
  max_file_bytes integer not null default 5000000 check (max_file_bytes > 0),
  max_duration_seconds integer not null default 60 check (max_duration_seconds between 1 and 600),
  concurrency integer not null default 1 check (concurrency between 1 and 10),
  rate_per_minute integer not null default 3 check (rate_per_minute between 1 and 120),
  allowed_features text[] not null default array['chat']::text[],
  routing jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(plan_id, bucket)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  instructions text not null default '',
  context text not null default '',
  preferred_model_id uuid references public.ai_models(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null default '',
  status text not null default 'SUCCEEDED' check (status in ('RESERVED','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
  model_id uuid references public.ai_models(id) on delete set null,
  model_name text,
  routing_mode text,
  request_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null unique,
  kind text not null default 'upload' check (kind in ('upload','generated')),
  created_at timestamptz not null default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  request_id uuid not null unique,
  status text not null default 'RESERVED',
  completed_steps integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','PAST_DUE','UNPAID','CANCELLED','EXPIRED','REFUNDED')),
  provider text not null default 'PAYMONGO',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('PERCENTAGE','FIXED_AMOUNT')),
  value integer not null check (value > 0),
  max_discount_amount integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  max_redemptions integer,
  max_redemptions_per_user integer not null default 1,
  redemption_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id uuid references public.billing_plans(id) on delete restrict,
  discount_code_id uuid references public.discount_codes(id) on delete set null,
  provider text not null default 'PAYMONGO',
  status text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','CANCELLED','EXPIRED','REFUNDED','REQUIRES_ACTION')),
  amount integer not null check (amount >= 0),
  original_amount integer not null default 0,
  discount_amount integer not null default 0,
  currency char(3) not null,
  idempotency_key text not null unique,
  external_checkout_session_id text unique,
  external_payment_id text unique,
  failure_code text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  external_event_id text not null unique,
  event_type text not null,
  status text not null default 'RECEIVED',
  livemode boolean not null default false,
  payload_hash text not null,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  period text not null check (period in ('DAILY','MONTHLY')),
  period_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  extra integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(user_id, bucket, period, period_start)
);

create table if not exists public.quota_reservations (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  fingerprint text not null,
  credit_units integer not null default 0 check (credit_units >= 0),
  day_start timestamptz not null,
  month_start timestamptz not null,
  status text not null default 'RESERVED',
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  model_id uuid references public.ai_models(id) on delete set null,
  provider text not null,
  model_name text not null,
  currency char(3) not null default 'USD',
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  credit_units integer not null default 0,
  estimated_cost numeric(18,8) not null default 0,
  feature text not null default 'chat',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.economic_entries (
  id uuid primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('AI_COST_ADJUSTMENT','VARIABLE_COST','REVENUE_ADJUSTMENT')),
  amount numeric(18,8) not null,
  currency char(3) not null,
  request_id uuid,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects(user_id, archived, updated_at desc);
create index if not exists conversations_user_idx on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);
create index if not exists attachments_conversation_idx on public.attachments(conversation_id, created_at);
create index if not exists workflows_user_idx on public.workflows(user_id, updated_at desc);
create index if not exists workflow_runs_idx on public.workflow_runs(workflow_id, created_at desc);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id, status, current_period_end desc);
create index if not exists payments_user_idx on public.payments(user_id, status, created_at desc);
create index if not exists quota_user_idx on public.quota_reservations(user_id, status, created_at desc);
create index if not exists usage_records_created_idx on public.usage_records(created_at desc);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_preferences','site_settings','ai_models','billing_plans',
    'generation_policies','projects','conversations','saved_prompts','workflows',
    'subscriptions','usage_counters'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_name text;
begin
  base_name := regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9_-]', '', 'g');
  if char_length(base_name) < 2 then base_name := 'user'; end if;
  insert into public.profiles(id, email, username)
  values (
    new.id,
    coalesce(new.email, ''),
    left(lower(base_name), 24) || '-' || substring(new.id::text, 1, 12)
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.user_preferences(user_id, display_name, send_on_enter)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', base_name), 80),
    true
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Atomic generation reservation. Callable only with the server secret/service role.
create or replace function public.reserve_generation(
  p_request_id uuid,
  p_user_id uuid,
  p_bucket text,
  p_fingerprint text,
  p_credit_units integer,
  p_plan_credit_limit integer,
  p_daily_limit integer,
  p_monthly_limit integer,
  p_concurrency integer,
  p_rate_per_minute integer,
  p_ttl_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  m timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  c public.usage_counters%rowtype;
  active_count integer;
  recent_count integer;
  stale record;
begin
  if p_credit_units < 1 or p_concurrency < 1 or p_rate_per_minute < 1 then
    raise exception 'invalid_generation_limits';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists(select 1 from public.quota_reservations where id = p_request_id) then
    raise exception 'duplicate_request';
  end if;

  for stale in
    select * from public.quota_reservations
    where user_id = p_user_id and status = 'RESERVED' and expires_at < now()
    for update
  loop
    update public.usage_counters
      set reserved = greatest(0, reserved - stale.credit_units),
          used = used + stale.credit_units
      where user_id = p_user_id and bucket = 'CREDITS'
        and period = 'MONTHLY' and period_start = stale.month_start;
    update public.usage_counters
      set reserved = greatest(0, reserved - 1), used = used + 1
      where user_id = p_user_id and bucket = stale.bucket
        and ((period = 'DAILY' and period_start = stale.day_start)
          or (period = 'MONTHLY' and period_start = stale.month_start));
    update public.quota_reservations
      set status = 'INTERRUPTED', finalized_at = now()
      where id = stale.id;
  end loop;

  select count(*) into active_count
  from public.quota_reservations
  where user_id = p_user_id and status = 'RESERVED' and expires_at >= now();
  if active_count >= p_concurrency then raise exception 'concurrency_limit'; end if;

  select count(*) into recent_count
  from public.quota_reservations
  where user_id = p_user_id and created_at >= now() - interval '1 minute';
  if recent_count >= p_rate_per_minute then raise exception 'rate_limit'; end if;

  insert into public.usage_counters(user_id, bucket, period, period_start)
  values(p_user_id, 'CREDITS', 'MONTHLY', m)
  on conflict(user_id,bucket,period,period_start) do nothing;
  select * into c from public.usage_counters
  where user_id=p_user_id and bucket='CREDITS' and period='MONTHLY' and period_start=m
  for update;
  if c.used + c.reserved + p_credit_units > p_plan_credit_limit + c.extra then
    raise exception 'credit_limit';
  end if;
  update public.usage_counters set reserved = reserved + p_credit_units
  where id = c.id;

  insert into public.usage_counters(user_id, bucket, period, period_start)
  values(p_user_id, p_bucket, 'DAILY', d)
  on conflict(user_id,bucket,period,period_start) do nothing;
  select * into c from public.usage_counters
  where user_id=p_user_id and bucket=p_bucket and period='DAILY' and period_start=d
  for update;
  if c.used + c.reserved >= p_daily_limit + c.extra then raise exception 'daily_limit'; end if;
  update public.usage_counters set reserved = reserved + 1 where id=c.id;

  insert into public.usage_counters(user_id, bucket, period, period_start)
  values(p_user_id, p_bucket, 'MONTHLY', m)
  on conflict(user_id,bucket,period,period_start) do nothing;
  select * into c from public.usage_counters
  where user_id=p_user_id and bucket=p_bucket and period='MONTHLY' and period_start=m
  for update;
  if c.used + c.reserved >= p_monthly_limit + c.extra then raise exception 'monthly_limit'; end if;
  update public.usage_counters set reserved = reserved + 1 where id=c.id;

  insert into public.quota_reservations(
    id,user_id,bucket,fingerprint,credit_units,day_start,month_start,expires_at
  ) values(
    p_request_id,p_user_id,p_bucket,p_fingerprint,p_credit_units,d,m,
    now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 900))
  );

  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.finalize_generation(
  p_request_id uuid,
  p_status text,
  p_consume boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.quota_reservations%rowtype;
begin
  select * into r from public.quota_reservations where id=p_request_id for update;
  if r.id is null then raise exception 'reservation_not_found'; end if;
  if r.status <> 'RESERVED' then return jsonb_build_object('changed', false); end if;

  update public.quota_reservations
    set status=p_status, finalized_at=now()
    where id=p_request_id;

  update public.usage_counters
    set reserved=greatest(0,reserved-r.credit_units),
        used=used + case when p_consume then r.credit_units else 0 end
    where user_id=r.user_id and bucket='CREDITS' and period='MONTHLY' and period_start=r.month_start;

  update public.usage_counters
    set reserved=greatest(0,reserved-1),
        used=used + case when p_consume then 1 else 0 end
    where user_id=r.user_id and bucket=r.bucket
      and ((period='DAILY' and period_start=r.day_start)
        or (period='MONTHLY' and period_start=r.month_start));

  return jsonb_build_object('changed', true);
end;
$$;

revoke all on function public.reserve_generation(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.finalize_generation(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.reserve_generation(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.finalize_generation(uuid,text,boolean) to service_role;

-- Row Level Security: every public table is protected.
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.site_settings enable row level security;
alter table public.ai_models enable row level security;
alter table public.billing_plans enable row level security;
alter table public.generation_policies enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.saved_prompts enable row level security;
alter table public.attachments enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.discount_codes enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.usage_counters enable row level security;
alter table public.quota_reservations enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.economic_entries enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select on public.site_settings, public.ai_models, public.billing_plans to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update, delete on public.projects, public.conversations, public.messages, public.saved_prompts, public.attachments, public.workflows, public.workflow_runs to authenticated;

drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles for select to authenticated
using ((select auth.uid()) = id);
drop policy if exists preferences_own on public.user_preferences;
create policy preferences_own on public.user_preferences for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists public_settings_read on public.site_settings;
create policy public_settings_read on public.site_settings for select to anon, authenticated
using (is_public = true);

drop policy if exists public_models_read on public.ai_models;
create policy public_models_read on public.ai_models for select to anon, authenticated
using (enabled = true and maintenance = false and effective_from <= now()
  and (effective_until is null or effective_until > now()));

drop policy if exists public_plans_read on public.billing_plans;
create policy public_plans_read on public.billing_plans for select to anon, authenticated
using (is_active = true);

drop policy if exists projects_own on public.projects;
create policy projects_own on public.projects for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists conversations_own on public.conversations;
create policy conversations_own on public.conversations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists messages_own on public.messages;
create policy messages_own on public.messages for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists prompts_own on public.saved_prompts;
create policy prompts_own on public.saved_prompts for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists attachments_own on public.attachments;
create policy attachments_own on public.attachments for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists workflows_own on public.workflows;
create policy workflows_own on public.workflows for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists workflow_runs_own on public.workflow_runs;
create policy workflow_runs_own on public.workflow_runs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Private bucket; all reads/writes go through same-origin Next.js routes after ownership checks.
insert into storage.buckets(id, name, public, file_size_limit)
values ('vrompt-private', 'vrompt-private', false, 10000000)
on conflict (id) do update set public=false, file_size_limit=10000000;

-- Brand defaults.
insert into public.site_settings(key,value,is_public) values
('branding.siteName','"Vrompt"'::jsonb,true),
('branding.tagline','"One workspace. The right AI for every task."'::jsonb,true),
('content.announcement','""'::jsonb,true),
('registration.enabled','true'::jsonb,true),
('workspace.writePrompt','"Help me write and improve this."'::jsonb,true),
('workspace.learnPrompt','"Explain this clearly and help me understand it."'::jsonb,true),
('workspace.codePrompt','"Help me build, debug, or improve this code."'::jsonb,true)
on conflict (key) do nothing;

-- Stable plan IDs make policies deterministic across local and hosted Supabase.
insert into public.billing_plans(
 id,code,name,description,original_price,currency,billing_interval,monthly_credits,
 max_projects,max_workflows,max_workflow_steps,project_context_chars,is_active,display_order
) values
('10000000-0000-4000-8000-000000000001','FREE','Free','Try Auto chat with a protected monthly budget.',0,'USD','MONTH',30,0,0,5,4000,true,0),
('10000000-0000-4000-8000-000000000002','STARTER','Starter','Everyday AI with economical model choice and private files.',599,'USD','MONTH',100,5,0,5,8000,true,1),
('10000000-0000-4000-8000-000000000003','PRO','Pro','Projects, workflows, image generation and premium model access.',1199,'USD','MONTH',250,30,50,10,16000,true,2),
('10000000-0000-4000-8000-000000000004','MAX','Max','Higher limits for sustained AI work with the same cost guardrails.',2499,'USD','MONTH',600,100,150,10,32000,true,3)
on conflict (code) do nothing;

-- Prices are USD per million tokens. Premium Gemini is seeded at its announced
-- post-promotion rate so credit calculations remain conservative after 2026.
insert into public.ai_models(
 id,provider,provider_model_id,display_name,description,category,capabilities,
 enabled,manual_available,auto_available,quality_tier,routing_priority,routing_cost_score,
 input_price,cached_input_price,output_price,cache_write_input_price,image_max_cost_usd,
 credit_cost,max_context,max_output,display_order
) values
('20000000-0000-4000-8000-000000000001','OPENAI','gpt-4o-mini','GPT-4o mini','Fast, economical general-purpose model.','general',array['text','vision','files','coding'],true,true,true,2,30,.20,.15,.075,.60,0,null,1,128000,4096,0),
('20000000-0000-4000-8000-000000000002','GOOGLE','gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite','Efficient current-generation model for chat, vision and files.','general',array['text','vision','files','coding','long_context'],true,true,true,2,25,.28,.30,.03,2.50,0,null,1,1048576,8192,1),
('20000000-0000-4000-8000-000000000003','MISTRAL','mistral-small-latest','Mistral Small','Low-cost general-purpose chat and coding.','general',array['text','vision','coding'],true,true,true,2,20,.18,.15,.015,.60,0,null,1,128000,4096,2),
('20000000-0000-4000-8000-000000000004','ANTHROPIC','claude-haiku-4-5-20251001','Claude Haiku 4.5','Strong instruction following, writing and coding.','general',array['text','vision','files','coding','reasoning','prompt_caching'],true,true,false,3,15,.80,1,.10,5,1.25,null,1,200000,8192,3),
('20000000-0000-4000-8000-000000000005','GOOGLE','gemini-3.8-flash','Gemini 3.8 Flash','Premium current-generation reasoning, coding and multimodal model.','premium',array['text','vision','files','coding','reasoning','long_context'],true,true,false,4,10,1.20,1.50,.15,7.50,0,null,1,1048576,65536,4),
('20000000-0000-4000-8000-000000000006','GOOGLE','gemini-3.1-flash-lite-image','Gemini 3.1 Flash Lite Image','Efficient image generation and editing.','image',array['text','vision','image_generation'],true,true,false,3,5,2.0,.25,.025,1.50,0,.040,1,32768,4096,5)
on conflict (provider,provider_model_id) do nothing;

-- AUTO policies intentionally use cheap text models. Premium models remain manual
-- and automatically consume more credits from their bounded request cost.
insert into public.generation_policies(
 id,plan_id,bucket,model_id,daily_limit,monthly_limit,max_input_chars,max_context,max_output,
 max_files,max_file_bytes,max_duration_seconds,concurrency,rate_per_minute,allowed_features,routing
) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','AUTO',null,5,30,4000,8192,1024,0,1000000,45,1,3,array['chat'],
 '{"allowedModelIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000003"],"creditCost":1,"maxAttempts":2}'::jsonb),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','AUTO',null,15,100,8000,16384,2048,1,5000000,60,1,6,array['chat'],
 '{"allowedModelIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002","20000000-0000-4000-8000-000000000003"],"creditCost":1,"maxAttempts":2}'::jsonb),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','AUTO',null,50,250,12000,32768,4096,2,5000000,90,2,15,array['chat','image_generation'],
 '{"allowedModelIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002","20000000-0000-4000-8000-000000000003"],"creditCost":1,"imageModelId":"20000000-0000-4000-8000-000000000006","imageCreditCost":6,"maxAttempts":2}'::jsonb),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','AUTO',null,100,600,16000,32768,4096,4,10000000,120,3,30,array['chat','image_generation'],
 '{"allowedModelIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002","20000000-0000-4000-8000-000000000003"],"creditCost":1,"imageModelId":"20000000-0000-4000-8000-000000000006","imageCreditCost":6,"maxAttempts":2}'::jsonb)
on conflict(plan_id,bucket) do nothing;

-- Starter manual economical models.
insert into public.generation_policies(plan_id,bucket,model_id,daily_limit,monthly_limit,max_input_chars,max_context,max_output,max_files,max_file_bytes,max_duration_seconds,concurrency,rate_per_minute,allowed_features,routing)
select '10000000-0000-4000-8000-000000000002', id::text, id, 15,100,8000,16384,2048,1,5000000,60,1,6,array['chat'],'{}'::jsonb
from public.ai_models where id in (
 '20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002',
 '20000000-0000-4000-8000-000000000003'
) on conflict(plan_id,bucket) do nothing;

-- Pro/Max manual text models plus current image model.
insert into public.generation_policies(plan_id,bucket,model_id,daily_limit,monthly_limit,max_input_chars,max_context,max_output,max_files,max_file_bytes,max_duration_seconds,concurrency,rate_per_minute,allowed_features,routing)
select p.id, m.id::text, m.id,
 case when p.code='MAX' then 100 else 50 end,
 case when p.code='MAX' then 600 else 250 end,
 case when p.code='MAX' then 16000 else 12000 end,
 32768,4096,
 case when p.code='MAX' then 4 else 2 end,
 case when p.code='MAX' then 10000000 else 5000000 end,
 case when p.code='MAX' then 120 else 90 end,
 case when p.code='MAX' then 3 else 2 end,
 case when p.code='MAX' then 30 else 15 end,
 case when 'image_generation'=any(m.capabilities) then array['chat','image_generation'] else array['chat'] end,
 '{}'::jsonb
from public.billing_plans p cross join public.ai_models m
where p.code in ('PRO','MAX') and m.enabled
on conflict(plan_id,bucket) do nothing;

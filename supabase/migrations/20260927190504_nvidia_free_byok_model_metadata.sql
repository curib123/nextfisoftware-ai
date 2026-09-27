-- NVIDIA hosted model discovery, rich model metadata, and encrypted BYO provider keys.

alter table public.ai_models drop constraint if exists ai_models_provider_check;
alter table public.ai_models
  add constraint ai_models_provider_check
  check (provider in ('OPENAI','GOOGLE','ANTHROPIC','MISTRAL','NVIDIA'));

alter table public.ai_models
  add column if not exists best_for text[] not null default '{}'::text[],
  add column if not exists quick_facts jsonb not null default '{}'::jsonb,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists free_endpoint boolean not null default false,
  add column if not exists source text not null default 'MANUAL',
  add column if not exists health_status text not null default 'UNKNOWN',
  add column if not exists health_checked_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists health_failure_count integer not null default 0,
  add column if not exists health_message text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_models'::regclass
      and conname='ai_models_source_check'
  ) then
    alter table public.ai_models
      add constraint ai_models_source_check
      check (source in ('MANUAL','NVIDIA_DISCOVERED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_models'::regclass
      and conname='ai_models_health_status_check'
  ) then
    alter table public.ai_models
      add constraint ai_models_health_status_check
      check (
        health_status in (
          'UNKNOWN','HEALTHY','DEGRADED','UNHEALTHY','NOT_CONFIGURED'
        )
      );
  end if;
end $$;

create index if not exists ai_models_nvidia_health_idx
on public.ai_models(provider, free_endpoint, health_status, enabled, auto_available);

create table if not exists public.user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null
    check (provider in ('OPENAI','GOOGLE','ANTHROPIC','MISTRAL','NVIDIA')),
  encrypted_key text not null,
  key_iv text not null,
  key_tag text not null,
  key_hint text not null default '',
  enabled boolean not null default true,
  health_status text not null default 'UNKNOWN'
    check (
      health_status in (
        'UNKNOWN','HEALTHY','DEGRADED','UNHEALTHY','NOT_CONFIGURED'
      )
    ),
  health_checked_at timestamptz,
  health_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

alter table public.user_provider_keys enable row level security;
revoke all on public.user_provider_keys from anon, authenticated;

drop trigger if exists set_updated_at on public.user_provider_keys;
create trigger set_updated_at
before update on public.user_provider_keys
for each row execute function public.set_updated_at();

alter table public.usage_records
  add column if not exists credential_mode text not null default 'VROMPT';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.usage_records'::regclass
      and conname='usage_records_credential_mode_check'
  ) then
    alter table public.usage_records
      add constraint usage_records_credential_mode_check
      check (credential_mode in ('VROMPT','BYOK'));
  end if;
end $$;

update public.billing_plans
set description =
      'Free chat with Mistral fallback plus verified NVIDIA developer endpoints.',
    updated_at = now()
where code='FREE';

update public.ai_models
set best_for = array['Fast everyday chat','Light coding','Image understanding'],
    quick_facts = jsonb_build_object(
      'provider','OpenAI',
      'modelId',provider_model_id,
      'positioning','Fast economical general-purpose model'
    ),
    details = jsonb_build_object(
      'selection','Available according to your Vrompt plan or your connected OpenAI API key',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000001';

update public.ai_models
set best_for = array['Everyday chat','Long-context tasks','Files and vision'],
    quick_facts = jsonb_build_object(
      'provider','Google AI',
      'modelId',provider_model_id,
      'positioning','Efficient multimodal model'
    ),
    details = jsonb_build_object(
      'selection','Available according to your Vrompt plan or your connected Google AI API key',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000002';

update public.ai_models
set best_for = array['Free-plan chat','General writing','Coding help'],
    quick_facts = jsonb_build_object(
      'provider','Mistral',
      'modelId',provider_model_id,
      'positioning','Low-cost Free-plan fallback'
    ),
    details = jsonb_build_object(
      'selection','Used as the stable Free-plan fallback and available with a connected Mistral API key where allowed',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000003';

update public.ai_models
set best_for = array['Writing','Instruction following','Coding and reasoning'],
    quick_facts = jsonb_build_object(
      'provider','Anthropic',
      'modelId',provider_model_id,
      'positioning','Writing, coding and instruction following'
    ),
    details = jsonb_build_object(
      'selection','Available according to your Vrompt plan or your connected Anthropic API key',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000004';

update public.ai_models
set best_for = array['Reasoning','Coding','Multimodal tasks'],
    quick_facts = jsonb_build_object(
      'provider','Google AI',
      'modelId',provider_model_id,
      'positioning','Premium multimodal model'
    ),
    details = jsonb_build_object(
      'selection','Available according to your Vrompt plan or your connected Google AI API key',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000005';

update public.ai_models
set best_for = array['Image generation','Image editing','Visual creation'],
    quick_facts = jsonb_build_object(
      'provider','Google AI',
      'modelId',provider_model_id,
      'positioning','Image-focused model'
    ),
    details = jsonb_build_object(
      'selection','Available when your plan or connected Google AI API key permits image generation',
      'capabilities',capabilities
    )
where id='20000000-0000-4000-8000-000000000006';

create or replace function public.enforce_free_mistral_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
  allowed boolean;
begin
  if new.plan_id <> '10000000-0000-4000-8000-000000000001'::uuid then
    return new;
  end if;

  if new.bucket = 'AUTO' then
    if new.model_id is not null then
      raise exception 'free_auto_model_id_must_be_null';
    end if;

    for candidate in
      select jsonb_array_elements_text(
        coalesce(new.routing->'allowedModelIds', '[]'::jsonb)
      )
    loop
      allowed :=
        candidate = '20000000-0000-4000-8000-000000000003';

      if not allowed then
        begin
          select exists(
            select 1
            from public.ai_models m
            where m.id = candidate::uuid
              and m.provider = 'NVIDIA'
              and m.free_endpoint = true
          ) into allowed;
        exception when invalid_text_representation then
          allowed := false;
        end;
      end if;

      if not allowed then
        raise exception 'free_auto_model_not_allowed';
      end if;
    end loop;

    return new;
  end if;

  if new.model_id is null or new.bucket <> new.model_id::text then
    raise exception 'free_manual_policy_invalid';
  end if;

  select exists(
    select 1
    from public.ai_models m
    where m.id = new.model_id
      and m.provider = 'NVIDIA'
      and m.free_endpoint = true
  ) into allowed;

  if not allowed then
    raise exception 'free_manual_model_not_allowed';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_free_mistral_policy()
from public, anon, authenticated;

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
  d timestamptz :=
    date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  m timestamptz :=
    date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  c public.usage_counters%rowtype;
  active_count integer;
  recent_count integer;
  stale record;
begin
  if p_credit_units < 0 or p_concurrency < 1 or p_rate_per_minute < 1 then
    raise exception 'invalid_generation_limits';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists(
    select 1 from public.quota_reservations where id = p_request_id
  ) then
    raise exception 'duplicate_request';
  end if;

  for stale in
    select * from public.quota_reservations
    where user_id = p_user_id
      and status = 'RESERVED'
      and expires_at < now()
    for update
  loop
    if stale.credit_units > 0 then
      update public.usage_counters
      set reserved = greatest(0, reserved - stale.credit_units),
          used = used + stale.credit_units
      where user_id = p_user_id
        and bucket = 'CREDITS'
        and period = 'MONTHLY'
        and period_start = stale.month_start;
    end if;

    update public.usage_counters
    set reserved = greatest(0, reserved - 1),
        used = used + 1
    where user_id = p_user_id
      and bucket = stale.bucket
      and (
        (period = 'DAILY' and period_start = stale.day_start)
        or (period = 'MONTHLY' and period_start = stale.month_start)
      );

    update public.quota_reservations
    set status = 'INTERRUPTED',
        finalized_at = now()
    where id = stale.id;
  end loop;

  select count(*) into active_count
  from public.quota_reservations
  where user_id = p_user_id
    and status = 'RESERVED'
    and expires_at >= now();

  if active_count >= p_concurrency then
    raise exception 'concurrency_limit';
  end if;

  select count(*) into recent_count
  from public.quota_reservations
  where user_id = p_user_id
    and created_at >= now() - interval '1 minute';

  if recent_count >= p_rate_per_minute then
    raise exception 'rate_limit';
  end if;

  if p_credit_units > 0 then
    insert into public.usage_counters(user_id,bucket,period,period_start)
    values(p_user_id,'CREDITS','MONTHLY',m)
    on conflict(user_id,bucket,period,period_start) do nothing;

    select * into c
    from public.usage_counters
    where user_id=p_user_id
      and bucket='CREDITS'
      and period='MONTHLY'
      and period_start=m
    for update;

    if c.used + c.reserved + p_credit_units >
       p_plan_credit_limit + c.extra then
      raise exception 'credit_limit';
    end if;

    update public.usage_counters
    set reserved = reserved + p_credit_units
    where id = c.id;
  end if;

  insert into public.usage_counters(user_id,bucket,period,period_start)
  values(p_user_id,p_bucket,'DAILY',d)
  on conflict(user_id,bucket,period,period_start) do nothing;

  select * into c
  from public.usage_counters
  where user_id=p_user_id
    and bucket=p_bucket
    and period='DAILY'
    and period_start=d
  for update;

  if c.used + c.reserved >= p_daily_limit + c.extra then
    raise exception 'daily_limit';
  end if;

  update public.usage_counters
  set reserved = reserved + 1
  where id=c.id;

  insert into public.usage_counters(user_id,bucket,period,period_start)
  values(p_user_id,p_bucket,'MONTHLY',m)
  on conflict(user_id,bucket,period,period_start) do nothing;

  select * into c
  from public.usage_counters
  where user_id=p_user_id
    and bucket=p_bucket
    and period='MONTHLY'
    and period_start=m
  for update;

  if c.used + c.reserved >= p_monthly_limit + c.extra then
    raise exception 'monthly_limit';
  end if;

  update public.usage_counters
  set reserved = reserved + 1
  where id=c.id;

  insert into public.quota_reservations(
    id,user_id,bucket,fingerprint,credit_units,day_start,month_start,expires_at
  ) values(
    p_request_id,p_user_id,p_bucket,p_fingerprint,p_credit_units,d,m,
    now() + make_interval(
      secs => least(greatest(p_ttl_seconds,30),900)
    )
  );

  return jsonb_build_object('accepted',true);
end;
$$;

revoke all on function public.reserve_generation(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated;

grant execute on function public.reserve_generation(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer
) to service_role;

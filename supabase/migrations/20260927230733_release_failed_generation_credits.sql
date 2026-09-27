-- Failed, empty, timed-out, or interrupted generations must release credits.

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
  should_consume boolean;
begin
  select * into r
  from public.quota_reservations
  where id = p_request_id
  for update;

  if r.id is null then
    raise exception 'reservation_not_found';
  end if;

  if r.status <> 'RESERVED' then
    return jsonb_build_object('changed', false);
  end if;

  should_consume := p_consume and p_status = 'SUCCEEDED';

  update public.quota_reservations
  set status = p_status,
      finalized_at = now()
  where id = p_request_id;

  update public.usage_counters
  set reserved = greatest(0, reserved - r.credit_units),
      used = used + case when should_consume then r.credit_units else 0 end
  where user_id = r.user_id
    and bucket = 'CREDITS'
    and period = 'MONTHLY'
    and period_start = r.month_start;

  update public.usage_counters
  set reserved = greatest(0, reserved - 1),
      used = used + case when should_consume then 1 else 0 end
  where user_id = r.user_id
    and bucket = r.bucket
    and (
      (period = 'DAILY' and period_start = r.day_start)
      or (period = 'MONTHLY' and period_start = r.month_start)
    );

  return jsonb_build_object(
    'changed', true,
    'consumed', should_consume
  );
end;
$$;

revoke all on function public.finalize_generation(uuid,text,boolean)
from public, anon, authenticated;
grant execute on function public.finalize_generation(uuid,text,boolean)
to service_role;

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
      set reserved = greatest(0, reserved - stale.credit_units)
      where user_id = p_user_id
        and bucket = 'CREDITS'
        and period = 'MONTHLY'
        and period_start = stale.month_start;
    end if;

    update public.usage_counters
    set reserved = greatest(0, reserved - 1)
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
    where user_id = p_user_id
      and bucket = 'CREDITS'
      and period = 'MONTHLY'
      and period_start = m
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
  where user_id = p_user_id
    and bucket = p_bucket
    and period = 'DAILY'
    and period_start = d
  for update;

  if c.used + c.reserved >= p_daily_limit + c.extra then
    raise exception 'daily_limit';
  end if;

  update public.usage_counters
  set reserved = reserved + 1
  where id = c.id;

  insert into public.usage_counters(user_id,bucket,period,period_start)
  values(p_user_id,p_bucket,'MONTHLY',m)
  on conflict(user_id,bucket,period,period_start) do nothing;

  select * into c
  from public.usage_counters
  where user_id = p_user_id
    and bucket = p_bucket
    and period = 'MONTHLY'
    and period_start = m
  for update;

  if c.used + c.reserved >= p_monthly_limit + c.extra then
    raise exception 'monthly_limit';
  end if;

  update public.usage_counters
  set reserved = reserved + 1
  where id = c.id;

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

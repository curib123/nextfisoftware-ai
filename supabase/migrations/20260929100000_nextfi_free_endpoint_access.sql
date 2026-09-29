-- Nextfi Software Free endpoint access.
-- Review checklist:
-- 1. Replace the historical Mistral-only trigger with free_endpoint validation.
-- 2. Update the existing Free AUTO policy without deleting model records.
-- 3. Preserve already-deployed Mistral Free behavior explicitly.
-- 4. Leave paid plans and flagship policies unchanged.

update public.ai_models
set free_endpoint = true,
    updated_at = now()
where provider = 'MISTRAL'
  and provider_model_id = 'mistral-small-latest';

create or replace function public.enforce_free_endpoint_policy()
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
      allowed := false;
      begin
        select coalesce(m.free_endpoint, false)
        into allowed
        from public.ai_models m
        where m.id = candidate::uuid;
      exception when invalid_text_representation then
        allowed := false;
      end;

      if not allowed then
        raise exception 'free_auto_model_not_allowed';
      end if;
    end loop;

    return new;
  end if;

  if new.model_id is null or new.bucket <> new.model_id::text then
    raise exception 'free_manual_policy_invalid';
  end if;

  select coalesce(m.free_endpoint, false)
  into allowed
  from public.ai_models m
  where m.id = new.model_id;

  if not coalesce(allowed, false) then
    raise exception 'free_manual_model_not_allowed';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_free_endpoint_policy()
from public, anon, authenticated;

drop trigger if exists enforce_free_mistral_policy
on public.generation_policies;
drop trigger if exists enforce_free_endpoint_policy
on public.generation_policies;

create trigger enforce_free_endpoint_policy
before insert or update on public.generation_policies
for each row execute function public.enforce_free_endpoint_policy();

drop function if exists public.enforce_free_mistral_policy();

update public.billing_plans
set description =
      'Free access to verified public AI endpoints with best-fit Auto routing.',
    updated_at = now()
where code = 'FREE';

update public.generation_policies
set routing = jsonb_set(
      jsonb_set(
        coalesce(routing, '{}'::jsonb),
        '{freeEndpointPool}',
        'true'::jsonb,
        true
      ),
      '{allowedModelIds}',
      coalesce(
        (
          select jsonb_agg(m.id::text order by m.display_order)
          from public.ai_models m
          where m.free_endpoint = true
        ),
        '[]'::jsonb
      ),
      true
    ),
    updated_at = now()
where plan_id = '10000000-0000-4000-8000-000000000001'::uuid
  and bucket = 'AUTO';

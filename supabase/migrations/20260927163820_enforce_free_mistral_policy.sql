create or replace function public.enforce_free_mistral_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan_id = '10000000-0000-4000-8000-000000000001'::uuid then
    if new.bucket <> 'AUTO'
       or new.model_id is not null
       or coalesce(new.routing->'allowedModelIds', '[]'::jsonb)
          <> '["20000000-0000-4000-8000-000000000003"]'::jsonb then
      raise exception 'free_plan_mistral_only';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_free_mistral_policy() from public, anon, authenticated;

drop trigger if exists enforce_free_mistral_policy on public.generation_policies;
create trigger enforce_free_mistral_policy
before insert or update on public.generation_policies
for each row execute function public.enforce_free_mistral_policy();

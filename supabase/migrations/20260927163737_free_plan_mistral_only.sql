-- Free plan must use Mistral only.
update public.billing_plans
set description = 'Mistral-only AI chat with a protected monthly budget.',
    updated_at = now()
where code = 'FREE';

update public.generation_policies
set routing = jsonb_set(
      coalesce(routing, '{}'::jsonb),
      '{allowedModelIds}',
      '["20000000-0000-4000-8000-000000000003"]'::jsonb,
      true
    ),
    updated_at = now()
where plan_id = '10000000-0000-4000-8000-000000000001'
  and bucket = 'AUTO';

-- Defense in depth: Free should never have direct/manual model policies.
delete from public.generation_policies
where plan_id = '10000000-0000-4000-8000-000000000001'
  and bucket <> 'AUTO';

-- The paddle-webhook function could not reach any of the primitives it exists
-- to call. PostgREST exposes `public` alone, and plan_key_for_price,
-- apply_billing_event and apply_pack_event (20260917050000) live in `private`.
--
-- Wrappers, not a schema exposure, the way 20260914002500 published the worker
-- and callback primitives. These are `security definer` so the private twin
-- runs as its owner and needs no grant of its own; each is revoked from anon
-- and authenticated, and granted to service_role alone, which is the only
-- key the webhook function holds. A tenant key reaching one gets "permission
-- denied for function", asserted in supabase/tests/billing_surface.test.ts.
--
-- None of them takes the workspace as a right to write: the workspace in a
-- webhook is Paddle's custom_data, and apply_billing_event lands the event on
-- that workspace's billing root, or refuses the price it cannot map.

create function public.billing_plan_for_price(price_id text) returns text
language sql stable security definer set search_path='' as $$
  select private.plan_key_for_price(price_id)
$$;

-- `billing_interval` here is the handler's `interval` (paddle.ts); the SQL
-- parameter keeps the name apply_billing_event gave it, so the webhook maps
-- one name to the other and nothing else changes shape on the way in.
create function public.billing_apply_subscription(
  event_id text, event_type text, occurred_at timestamptz, w uuid, plan text, billing_interval text,
  period_start timestamptz, period_end timestamptz, status text, cancel_at_period_end boolean,
  provider_ref text, customer_ref text, payload jsonb) returns text
language sql security definer set search_path='' as $$
  select private.apply_billing_event(event_id, event_type, occurred_at, w, plan, billing_interval,
    period_start, period_end, status, cancel_at_period_end, provider_ref, customer_ref, payload)
$$;

create function public.billing_apply_pack(
  event_id text, occurred_at timestamptz, w uuid, kind text, units int, provider_ref text, payload jsonb) returns text
language sql security definer set search_path='' as $$
  select private.apply_pack_event(event_id, occurred_at, w, kind, units, provider_ref, payload)
$$;

-- An event no workspace or known price claims. Recorded so a person can look,
-- on no workspace, once: a replay finds the row and writes nothing. The same
-- event_id arriving later through the apply path reads 'duplicate', because
-- both paths share the one table keyed by event_id.
create function public.billing_record_unmapped(event_id text, event_type text, payload jsonb) returns void
language sql security definer set search_path='' as $$
  insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, outcome, payload)
  values (event_id, event_type, now(), null, 'unmapped', payload)
  on conflict (event_id) do nothing
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.billing_plan_for_price(text)',
    'public.billing_apply_subscription(text,text,timestamptz,uuid,text,text,timestamptz,timestamptz,text,boolean,text,text,jsonb)',
    'public.billing_apply_pack(text,timestamptz,uuid,text,int,text,jsonb)',
    'public.billing_record_unmapped(text,text,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Prices are public, like plan_catalogue (20260917040000): the pricing page
-- and the checkout read the packs signed out and signed in alike. One row per
-- addon, {key, kind, units, price_cents, provider_prices}, by key.
create function public.addon_catalogue() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.key, 'kind', a.kind, 'units', a.units,
    'price_cents', a.price_cents, 'provider_prices', a.provider_prices) order by a.key), '[]'::jsonb)
  from public.addon_prices a
$$;
revoke all on function public.addon_catalogue() from public;
grant execute on function public.addon_catalogue() to anon, authenticated;

-- The ROOT's Paddle customer, for the owner who wants Paddle's portal for the
-- subscription they pay. Named on any workspace in the root's family and
-- answered from the root, like usage_summary; an owner of the workspace named
-- or nobody. Null when the root has never been billed through Paddle.
create function public.billing_customer_ref(w uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then raise exception 'forbidden' using errcode='42501'; end if;
  return (select s.provider_customer_ref from public.subscriptions s
           where s.workspace_id = coalesce(private.billing_root(w), w));
end $$;
revoke all on function public.billing_customer_ref(uuid) from public, anon;
grant execute on function public.billing_customer_ref(uuid) to authenticated;

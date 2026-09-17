-- Checkout was opened by the browser with a customData it built itself
-- (apps/web/src/paddle.ts), and the webhook (private.apply_billing_event,
-- via public.billing_apply_subscription/billing_apply_pack) trusts
-- custom_data.workspace_id completely once an event names a known price. So
-- any signed-in caller who could reach the checkout button could name any
-- workspace's id in customData and have Paddle apply a plan, or record a
-- customer ref, against it. This is the one new check the fix relies on:
-- the transaction is now minted server-side, after asserting the caller
-- owns the workspace, and never from a browser's own word.
--
-- Mirrors billing_customer_ref (20260917051000) exactly: same has_role
-- check, same grant to authenticated alone. void rather than boolean because
-- the caller is paddle-checkout, which only needs "did this raise", not a
-- flag it would have to check anyway.
create function public.billing_assert_owner(w uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then raise exception 'forbidden' using errcode='42501'; end if;
end $$;
revoke all on function public.billing_assert_owner(uuid) from public, anon;
grant execute on function public.billing_assert_owner(uuid) to authenticated;

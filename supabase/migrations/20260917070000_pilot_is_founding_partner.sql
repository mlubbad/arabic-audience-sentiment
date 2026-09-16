-- The pilot plan is a hand-granted allowance for someone who came in early, before
-- paying. "تجريبي / Pilot" said how it was made, not what it is; the reader sees a
-- name, never the key. The key stays `pilot`: it is a foreign key from every early
-- subscription and an identifier in five applied migrations.
update public.plans
   set title_ar = 'شريك مؤسِّس', title_en = 'Founding Partner'
 where key = 'pilot';

-- The admin page names plans by title too, internal ones included. plan_catalogue()
-- hides internal plans from everyone; this reads all of them, and only an admin may.
create function public.admin_plan_catalogue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(private.plan_json(p) order by p.sort_order), '[]'::jsonb)
            from public.plans p);
end $$;
revoke all on function public.admin_plan_catalogue() from public, anon;
grant execute on function public.admin_plan_catalogue() to authenticated;

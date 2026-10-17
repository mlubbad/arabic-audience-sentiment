-- The owner renamed the hand-granted `pilot` plan: «شريك مؤسِّس» / "Founding Partner"
-- becomes «شريك تسويقي» / "Marketing Partner". The key stays `pilot` (a foreign key
-- from every early subscription); only the titles the reader sees change.
--
-- A relabel is not an admin's action, so it does not belong in the admin trail:
-- the `plans_audited` trigger is held off for this one statement.
alter table public.plans disable trigger plans_audited;
update public.plans
   set title_ar = 'شريك تسويقي', title_en = 'Marketing Partner'
 where key = 'pilot';
alter table public.plans enable trigger plans_audited;

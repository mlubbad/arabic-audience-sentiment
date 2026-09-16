-- The yearly price is the spec's monthly equivalent — 10 / 24 / 79 / 199 a month
-- (docs/pricing-v2-draft.md §2) — not a flat ten months. 20260917010000 wrote the
-- flat figure and had reached the live project before the number was checked, so
-- the correction is its own migration rather than an edit of an applied file.
update public.plans set price_yearly_cents = 28800  where key = 'creator_plus';
update public.plans set price_yearly_cents = 94800  where key = 'agency';
update public.plans set price_yearly_cents = 238800 where key = 'media';

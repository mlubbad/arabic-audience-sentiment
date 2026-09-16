-- The pilot channel spent its 5,000 analysis units in one night: 789 selected
-- videos, 5,002 reported comments, 4,999 stored and metered, the next batch
-- refused — the estimate and the meter agreeing to within three comments.
-- AJ360 carries 167,302 reported comments; 5,000 a month is 3% of it. The
-- pricing ladder's `pro` row is 25,000 (docs/pricing.md); the pilot takes that
-- figure while it remains the only plan the live project has. A data change,
-- shipped as a migration so the suite replays it and the number is on record.
update public.plans set analysis_units = 25000 where key = 'pilot';

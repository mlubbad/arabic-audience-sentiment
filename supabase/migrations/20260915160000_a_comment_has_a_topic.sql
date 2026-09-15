-- A comment has a topic. Until now the dashboard's Topics card said "not
-- available yet" and meant it: nothing in the schema could hold what a
-- comment is about. This adds that dimension beside sentiment, under the same
-- rules — a verdict is about one text (its hash) under one key, the first
-- success becomes the workspace's active classification, and a human
-- correction is append-only and names who made it.
--
-- Design: docs/superpowers/specs/2026-09-15-topic-classification-design.md

-- ---------------------------------------------------------------- taxonomy
create table public.workspace_topics (
  workspace_id uuid not null references public.workspaces(id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name_ar text not null check (length(name_ar) between 1 and 80),
  name_en text not null check (length(name_en) between 1 and 80),
  -- What the prompt tells the model. Part of the taxonomy on purpose: two
  -- workspaces with the same keys and different descriptions ask different
  -- questions.
  description text not null check (length(description) between 1 and 400),
  position int not null,
  retired_at timestamptz null,
  primary key (workspace_id, key)
);

alter table public.workspaces
  add column topic_taxonomy_version int not null default 1,
  -- Set by the first successful classification, cleared by a taxonomy edit.
  -- On the workspace rather than the channel because the taxonomy is.
  add column active_topic_key text null;

create function private.seed_default_topics(w uuid) returns void
language sql security definer set search_path='' as $$
  insert into public.workspace_topics(workspace_id, key, name_ar, name_en, description, position)
  values
    (w, 'question',   'استفسارات وأسئلة',           'Questions & inquiries',
        'Asks the creator or others something, or requests information.', 1),
    (w, 'religious',  'دعاء وذكر وتعبير ديني',      'Prayers & religious remarks',
        'Prayer, supplication, remembrance of God, religious phrasing as the main content.', 2),
    (w, 'praise',     'إشادة ودعم',                 'Praise & support',
        'Compliments, thanks, encouragement toward the creator or content.', 3),
    (w, 'criticism',  'نقد واعتراض',                'Criticism & objection',
        'Disagreement, complaint, or negative judgement of the content, creator or subject.', 4),
    (w, 'request',    'طلبات واقتراحات',            'Requests & suggestions',
        'Asks for future content, features, changes, or makes a suggestion.', 5),
    (w, 'discussion', 'نقاش وتحليل الموضوع',        'Discussion of the subject',
        'Substantive commentary on the topic of the video itself.', 6),
    (w, 'personal',   'تجارب وقصص شخصية',           'Personal stories & experiences',
        'Shares the commenter''s own situation or experience.', 7),
    (w, 'humour',     'مزاح ودعابة',                'Humour & banter',
        'Jokes, memes, playful remarks.', 8),
    (w, 'promotion',  'ترويج ومحتوى دعائي',         'Promotion & spam',
        'Advertising, self-promotion, links, repeated off-purpose content.', 9),
    (w, 'other',      'خارج الموضوع / أخرى',        'Off-topic / other',
        'Does not fit the above or is unrelated to the video.', 10)
  on conflict (workspace_id, key) do nothing;
$$;

create function private.seed_topics_for_new_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.seed_default_topics(new.id);
  return new;
end $$;
create trigger seed_topics after insert on public.workspaces
  for each row execute function private.seed_topics_for_new_workspace();

-- Every workspace that already exists gets the same ten.
do $$ declare w uuid; begin
  for w in select id from public.workspaces loop
    perform private.seed_default_topics(w);
  end loop;
end $$;

-- ------------------------------------------------------------- predictions
create table public.topic_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  comment_id uuid not null,
  -- The exact text judged. An edit changes the hash and this verdict becomes
  -- history rather than being applied to text no model saw.
  content_hash text not null,
  -- topics:v<taxonomy_version>+<model_id>+<prompt_version>. A taxonomy edit,
  -- a model change or a prompt change is a new key, never a silent relabel.
  classification_key text not null,
  status text not null check (status in ('succeeded','skipped','failed','unsupported')),
  topic_key text null,
  confidence numeric(4,3) null check (confidence is null or confidence between 0 and 1),
  model_id text not null,
  prompt_version text not null,
  error_code text null,
  predicted_at timestamptz not null default now(),
  check ((status = 'succeeded') = (topic_key is not null)),
  unique (workspace_id, comment_id, content_hash, classification_key),
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id),
  foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
);
create index topic_predictions_by_comment
  on public.topic_predictions(workspace_id, comment_id, content_hash, classification_key);

-- Adopted on first success only, as 20260914030000 does for sentiment: a
-- workspace with no active classification takes the one that just ran; one
-- that has must not have it swapped underneath it.
create function private.adopt_first_topic_classification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.workspaces w
     set active_topic_key = k.classification_key
    from (
      select n.workspace_id, min(n.classification_key) as classification_key
        from new_predictions n
       where n.status = 'succeeded'
       group by n.workspace_id
      having count(distinct n.classification_key) = 1
    ) k
   where w.id = k.workspace_id
     and w.active_topic_key is null;
  return null;
end $$;
revoke all on function private.adopt_first_topic_classification() from public, anon, authenticated;
create trigger adopt_first_topic_classification
  after insert on public.topic_predictions
  referencing new table as new_predictions
  for each statement execute function private.adopt_first_topic_classification();

-- ----------------------------------------------------------------- reviews
create table public.topic_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  comment_id uuid not null,
  content_hash text not null,
  topic_key text not null,
  reviewer_id uuid not null references auth.users(id),
  reason text not null check (length(trim(reason)) between 1 and 500),
  origin text not null default 'human' check (origin in ('human')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id),
  foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
);
create trigger topic_reviews_append_only before update or delete on public.topic_reviews
  for each row execute function private.reject_review_mutation();

-- Tenant read, no tenant write, service role everything — the catalogue
-- tables' pattern.
do $$ declare t text; begin
  foreach t in array array['workspace_topics','topic_predictions','topic_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_role(workspace_id))', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Reviews are written only through this, so the reviewer and the provenance
-- come from the session, as submit_comment_review does.
create function private.submit_topic_review_impl(w uuid, c uuid, seen_hash text, topic text, why text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; current_hash text; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.workspace_topics t
                  where t.workspace_id=w and t.key=topic and t.retired_at is null) then
    raise exception 'invalid_topic' using errcode='22023'; end if;
  if why is null or length(trim(why)) not between 1 and 500 then
    raise exception 'invalid_reason' using errcode='22023'; end if;
  select content_hash into current_hash from public.comments where workspace_id=w and id=c;
  if current_hash is null then raise exception 'invalid_comment' using errcode='23503'; end if;
  if current_hash is distinct from seen_hash then
    raise exception 'stale_comment_text' using errcode='40001'; end if;
  insert into public.topic_reviews(workspace_id,comment_id,content_hash,topic_key,reviewer_id,reason,origin)
  values (w, c, current_hash, topic, (select auth.uid()), trim(why), 'human') returning id into r;
  return r;
end $$;
create function public.submit_topic_review(w uuid, c uuid, seen_hash text, topic text, why text)
returns uuid language sql security invoker set search_path='' as $$
  select private.submit_topic_review_impl(w, c, seen_hash, topic, why) $$;

-- Replaces the active set. Rows absent from the payload are retired, not
-- deleted — predictions reference them. The version moves and the active key
-- is cleared, so every row is due again under the new taxonomy and nothing
-- classified under the old one is shown as if it were.
create function private.set_workspace_topics_impl(w uuid, topics jsonb) returns int
language plpgsql security definer set search_path='' as $$
declare v int; begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if topics is null or jsonb_typeof(topics) <> 'array' or jsonb_array_length(topics) = 0
     or jsonb_array_length(topics) > 50 then
    raise exception 'invalid_topics' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(topics) t
              where jsonb_typeof(t) <> 'object'
                 or coalesce(t->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$'
                 or length(coalesce(t->>'name_ar','')) not between 1 and 80
                 or length(coalesce(t->>'name_en','')) not between 1 and 80
                 or length(coalesce(t->>'description','')) not between 1 and 400) then
    raise exception 'invalid_topics' using errcode='22023'; end if;
  if (select count(distinct t->>'key') from jsonb_array_elements(topics) t)
     <> jsonb_array_length(topics) then
    raise exception 'invalid_topics' using errcode='22023'; end if;

  insert into public.workspace_topics(workspace_id, key, name_ar, name_en, description, position)
  select w, t->>'key', t->>'name_ar', t->>'name_en', t->>'description', ord
    from jsonb_array_elements(topics) with ordinality as x(t, ord)
  on conflict (workspace_id, key) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    description = excluded.description, position = excluded.position,
    retired_at = null;
  update public.workspace_topics set retired_at = now()
   where workspace_id = w and retired_at is null
     and key not in (select t->>'key' from jsonb_array_elements(topics) t);

  update public.workspaces
     set topic_taxonomy_version = topic_taxonomy_version + 1, active_topic_key = null
   where id = w returning topic_taxonomy_version into v;
  return v;
end $$;
create function public.set_workspace_topics(w uuid, topics jsonb) returns int
language sql security invoker set search_path='' as $$
  select private.set_workspace_topics_impl(w, topics) $$;

revoke all on function
  private.seed_default_topics(uuid), private.seed_topics_for_new_workspace(),
  private.submit_topic_review_impl(uuid,uuid,text,text,text), private.set_workspace_topics_impl(uuid,jsonb),
  public.submit_topic_review(uuid,uuid,text,text,text), public.set_workspace_topics(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function
  private.submit_topic_review_impl(uuid,uuid,text,text,text), private.set_workspace_topics_impl(uuid,jsonb),
  public.submit_topic_review(uuid,uuid,text,text,text), public.set_workspace_topics(uuid,jsonb)
  to authenticated;
grant execute on function
  private.seed_default_topics(uuid), private.seed_topics_for_new_workspace()
  to service_role;

-- ---------------------------------------------------------------- metering
alter table public.usage_events drop constraint usage_events_event_type_check;
alter table public.usage_events add constraint usage_events_event_type_check
  check (event_type in ('comment_analysis','historical_backfill','topic_classification'));
alter table public.plans add column topic_units integer not null default 0 check (topic_units >= 0);
update public.plans set topic_units = 5000 where key = 'pilot';

-- reserve_usage, rebuilt from the foundation with one change: a third kind
-- drawing on its own allowance.
create or replace function private.reserve_usage(w uuid,kind text,keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare sub record; allowance int; used int; covered text[]; fresh text[]; begin
 if kind not in ('comment_analysis','historical_backfill','topic_classification') then
   raise exception 'invalid_event_type' using errcode='22023'; end if;
 if coalesce(array_length(keys,1),0) > 500 then raise exception 'batch_too_large' using errcode='22023'; end if;
 select s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key
 where s.workspace_id=w for update of s;
 if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
 if sub.status<>'active' or now()<sub.period_start or now()>=sub.period_end then
 raise exception 'plan_inactive' using errcode='42501'; end if;
 allowance := case kind when 'comment_analysis' then sub.analysis_units
                        when 'historical_backfill' then sub.backfill_units
                        else sub.topic_units end;
 select coalesce(array_agg(u.event_key),'{}') into covered
 from public.usage_events u where u.workspace_id=w and u.event_key=any(keys);
 used := private.used_units(w,kind,sub.period_start);
 select coalesce(array_agg(distinct k),'{}') into fresh from unnest(keys) as k where not (k=any(covered));
 fresh := fresh[1:greatest(allowance-used,0)];
 insert into public.usage_events(workspace_id,period_start,event_key,event_type)
 select w,sub.period_start,k,kind from unnest(fresh) as k;
 return covered||fresh;
end $$;

-- usage_summary_impl, rebuilt from the foundation with one addition: the
-- third budget line.
create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 select s.plan_key,s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key where s.workspace_id=w;
 if not found then return null; end if;
 return jsonb_build_object(
 'plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',sub.analysis_units,private.used_units(w,'comment_analysis',sub.period_start)),
 private.budget_entry('historical_backfill',sub.backfill_units,private.used_units(w,'historical_backfill',sub.period_start)),
 private.budget_entry('topic_classification',sub.topic_units,private.used_units(w,'topic_classification',sub.period_start))));
end $$;

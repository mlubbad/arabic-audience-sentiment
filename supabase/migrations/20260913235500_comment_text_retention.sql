-- Comment text was stored forever, with nothing that could ever remove it.
--
-- YouTube's developer terms require API data to be refreshed or deleted within
-- 30 days. Derived and aggregated results may be kept; the raw comment text and
-- the commenter's identity may not. Until now the schema had no way to express
-- that difference, so every comment ever collected would have sat in the table
-- indefinitely — a compliance problem, and a personal-data problem for people
-- who never agreed to anything.
--
-- Done now because it is cheap now. Today it is three nullable columns and a
-- function; after a workspace holds real comments it is a migration over
-- customer data with a deletion deadline attached.
--
-- What survives a purge: the comment row, its content hash, its dates, whether
-- it was a reply, and the sentiment prediction about it. So every aggregate the
-- dashboard shows still computes, and a purged comment still counts. What goes:
-- the text and the author.
--
-- likes_value is kept and likes_raw is not. The verbatim string the source
-- displayed is content; the parsed number is a metric feeding an aggregate. If
-- a stricter reading is ever required, it is one more column in one function.

alter table public.comments
  alter column text_raw drop not null,
  alter column text_plain drop not null,
  add column content_purged_at timestamptz;

-- The marker and the text are two statements of one fact, so they cannot
-- disagree: a row either has its text or records that the text was removed.
alter table public.comments
  add constraint comments_purged_has_no_text
  check ((content_purged_at is null) = (text_raw is not null));

-- Refresh is the other half of the rule, and it must not depend on a writer
-- remembering it. Any write that brings text back clears the marker, so a
-- re-collected comment is simply no longer purged.
create function private.sync_purge_marker() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.text_raw is not null then new.content_purged_at := null; end if;
  return new;
end $$;
create trigger comments_purge_marker before insert or update on public.comments
  for each row execute function private.sync_purge_marker();

-- Finding what is due, without scanning the table.
create index comments_retention on public.comments(last_seen_at)
  where content_purged_at is null;

create function private.purge_comment_text(retain interval default interval '30 days')
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if retain < interval '0' then
    raise exception 'invalid_input' using errcode='22023'; end if;
  update public.comments set
    text_raw = null, text_plain = null,
    -- The author is personal data belonging to someone who is not the customer.
    author_name = null, author_channel_id = null,
    likes_raw = null,
    content_purged_at = now()
  where content_purged_at is null and last_seen_at < now() - retain;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function private.purge_comment_text(interval) from public, anon, authenticated;
grant execute on function private.purge_comment_text(interval) to service_role;

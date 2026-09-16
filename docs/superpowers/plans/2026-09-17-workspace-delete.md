# Workspace Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the platform owner "retiring" a workspace to themself, and give the operator — only the operator — a real, permanent workspace deletion on the admin page.

**Architecture:** One new migration adds a guard to `retire_workspace` (the owner is refused), a read RPC `admin_workspace_footprint` (row counts, so the dialog can say what it will destroy), and `delete_workspace` (admin-only, three refusals, then an explicit leaves-first delete through the FK graph, and an audit row on the admin's own home workspace). The account page stops offering retire to a platform admin by not passing `onRetire`. The admin page gains a third lever that opens a `ui/Dialog` requiring the workspace name typed back. Everything is server-gated first; the UI only mirrors it.

**Tech Stack:** Postgres (Supabase migration, PGlite for tests), React 19, `ui/Dialog` + `ui/Button` + `ui/Input` (previous phases), `toast()` from `ui/Toast`, Vitest + jsdom + Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-17-workspace-delete-design.md](../specs/2026-09-17-workspace-delete-design.md)

## Global Constraints

- The function is the gate; hiding a button is a courtesy. Every refusal in the spec is enforced in SQL and tested there, not only in the UI.
- Migrations are immutable once applied: this is a NEW file, `supabase/migrations/20260917100000_delete_workspace.sql`. `retire_workspace` is replaced with `create or replace` **built from its current body** (`20260917090000_rename_and_retire_a_workspace.sql:36-77`), never from an older draft — `docs/coordination/ACTIVE.md` records a `create or replace` that silently reverted a later change this way.
- The delete order is the FK graph read from the migrated schema (spec, "Approach"); every `delete` is scoped to the one workspace id; the whole function is one transaction.
- Every new user-facing string goes into BOTH `apps/web/src/strings/ar.ts` and `apps/web/src/strings/en.ts` in the same commit (`tsc` enforces the pair). No hard-coded sentence in a component.
- Any numeral rendered in the dialog gets `.ui-num`. No `letter-spacing` anywhere.
- `npm run check` must stay green (it runs the PGlite suite via `npm run test:db`); run `npm run test:db -- supabase/tests/workspace_lifecycle.test.ts` after every SQL change.
- This migration is NOT pushed to the live project by this plan. `supabase db push` is the operator's call, recorded when made (see `docs/coordination/ACTIVE.md`'s "The live Supabase project"). The last task says so in the records.
- This checkout has another concurrently-active session: stage by exact pathspec, never `git add -A`/`.`/`-a`; `git status` before and `git show --stat` after every commit.

---

## Task 1: The migration — guard retire, add the footprint read, add delete

**Files:**
- Create: `supabase/migrations/20260917100000_delete_workspace.sql`
- Test: `supabase/tests/workspace_lifecycle.test.ts` (append cases inside the existing `describe`)

**Interfaces:**
- Produces: `public.retire_workspace(w uuid)` — same signature and body, plus one refusal: `owner_cannot_retire` (errcode `55000`) when `auth.uid() = private.platform_owner()`.
- Produces: `public.admin_workspace_footprint(w uuid) returns jsonb` — `{ "channels": n, "videos": n, "comments": n, "predictions": n, "reviews": n, "members": n }` for the admin; `forbidden` otherwise. Task 3's dialog reads it.
- Produces: `public.delete_workspace(w uuid) returns void` — `forbidden` / `last_workspace` / `billing_root` / `paddle_subscription_active`, else deletes and returns. Task 3 calls it.

- [ ] **Step 1: Append the failing tests**

In `supabase/tests/workspace_lifecycle.test.ts`, inside `describe("workspace lifecycle", …)`, after the last existing `it(...)`, add:

```ts
  it("the platform owner cannot retire a workspace to themself", async () => {
    await as(ADMIN);
    await db.query("select create_workspace('owner spare')");
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='owner spare'",
      )
    ).rows[0].id;
    await as(ADMIN);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /owner_cannot_retire/,
    );
    await db.exec("reset role");
    // Nothing moved: still the admin's, still a member.
    const m = await db.query<{ user_id: string }>(
      "select user_id from memberships where workspace_id=$1",
      [w],
    );
    expect(m.rows).toEqual([{ user_id: ADMIN }]);
  });

  it("delete_workspace is the operator's door only", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await expect(db.query("select delete_workspace($1)", [w])).rejects.toThrow(
      /forbidden/,
    );
    await expect(
      db.query("select admin_workspace_footprint($1)", [w]),
    ).rejects.toThrow(/forbidden/);
  });

  it("delete_workspace refuses a billing root, an active Paddle subscription, and the admin's last workspace", async () => {
    // A billing root: 'client one' was retired earlier in this file and now
    // bills under the admin's home.
    const adminHome = await home(ADMIN);
    await as(ADMIN);
    await expect(
      db.query("select delete_workspace($1)", [adminHome]),
    ).rejects.toThrow(/billing_root|last_workspace/);
    await db.exec("reset role");

    // A workspace Paddle is billing.
    await as(OWNER);
    await db.query("select create_workspace('paid')");
    await db.exec("reset role");
    const paid = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='paid'",
      )
    ).rows[0].id;
    await db.query(
      "update subscriptions set provider='paddle', provider_ref='sub_1', status='active' where workspace_id=$1",
      [paid],
    );
    await as(ADMIN);
    await expect(db.query("select delete_workspace($1)", [paid])).rejects.toThrow(
      /paddle_subscription_active/,
    );
    await db.exec("reset role");
    const still = await db.query<{ n: string }>(
      "select count(*) n from workspaces where id=$1",
      [paid],
    );
    expect(still.rows[0].n).toBe("1");
  });

  it("delete_workspace removes every row of one workspace, no row of another, and records the act on the admin's home", async () => {
    // Build a full workspace: channel, grant, video, two comments, a run, a
    // prediction, a review, a job, a usage grant, a topic.
    await as(OWNER);
    await db.query("select create_workspace('doomed')");
    await db.query("select create_workspace('neighbour')");
    await db.exec("reset role");
    const id = async (name: string) =>
      (
        await db.query<{ id: string }>(
          "select id from workspaces where name=$1",
          [name],
        )
      ).rows[0].id;
    const d = await id("doomed");
    const n = await id("neighbour");
    for (const w of [d, n]) {
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,(select id from clients where workspace_id=$1),'UC${"d".repeat(22)}','connected')`,
        [w],
      );
      await db.query(
        `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
         values ($1,$1,$2,'\\x00','v1','{}','active')`,
        [w, OWNER],
      );
      await db.query(
        `insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'vvvvvvvvvvv','v')`,
        [w],
      );
      await db.query(
        `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
          content_hash,timestamp_precision,source,author_name,likes_raw,likes_value,published_at)
         values (gen_random_uuid(),$1,$1,'c1','نص','نص','h1','second',
                 'youtube_data_api_public','مؤلف','1',1,'2026-09-01T09:00:00Z')`,
        [w],
      );
      await db.query(
        `insert into analysis_runs(id,workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
         values ($1,$1,'m','rev','v1','{}','succeeded')`,
        [w],
      );
      await db.query(
        `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
         select $1, c.id, 'h1', $1, 'm@rev+v1+p', 'succeeded', 'positive', '{"positive":0.9}'
           from comments c where c.workspace_id=$1`,
        [w],
      );
      await db.query(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$1,'collect','k','queued')`,
        [w],
      );
      await db.query(
        `insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1,$2,'seeded','test','x')`,
        [w, OWNER],
      );
    }
    const tables = [
      "channels",
      "private.oauth_connections",
      "videos",
      "comments",
      "analysis_runs",
      "sentiment_predictions",
      "jobs",
      "audit_events",
      "memberships",
      "subscriptions",
      "clients",
      "workspaces",
    ];
    const count = async (t: string, w: string) =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*) n from ${t} where ${t === "workspaces" ? "id" : "workspace_id"}=$1`,
            [w],
          )
        ).rows[0].n,
      );
    const before = Object.fromEntries(
      await Promise.all(tables.map(async (t) => [t, await count(t, n)])),
    );
    expect(before.comments).toBe(1);

    await as(ADMIN);
    const fp = await db.query<{ admin_workspace_footprint: Record<string, number> }>(
      "select admin_workspace_footprint($1)",
      [d],
    );
    expect(fp.rows[0].admin_workspace_footprint).toEqual({
      channels: 1,
      videos: 1,
      comments: 1,
      predictions: 1,
      reviews: 0,
      members: 1,
    });
    await db.query("select delete_workspace($1)", [d]);
    await db.exec("reset role");

    for (const t of tables) expect(await count(t, d), t).toBe(0);
    for (const t of tables) expect(await count(t, n), t).toBe(before[t]);
    const adminHome = await home(ADMIN);
    const a = await db.query<{ action: string; target_id: string; actor_id: string }>(
      "select action,target_id,actor_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [adminHome],
    );
    expect(a.rows[0]).toEqual({
      action: "workspace_deleted",
      target_id: d,
      actor_id: ADMIN,
    });
  });
```

- [ ] **Step 2: Run the file to see the new cases fail**

Run: `npm run test:db -- supabase/tests/workspace_lifecycle.test.ts`
Expected: the existing cases pass; the four new ones FAIL — `function delete_workspace(uuid) does not exist`, `function admin_workspace_footprint(uuid) does not exist`, and the owner-retire case fails because retire currently succeeds.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260917100000_delete_workspace.sql`:

```sql
-- Retiring stays a handover; deleting is the operator's own door.
--
-- retire_workspace hands a workspace to the platform owner and keeps every
-- row. When the caller IS the platform owner that is a no-op dressed as a
-- transfer — the membership is deleted and re-inserted for the same person
-- and the page says it "moved to the operator". Refused now.
--
-- delete_workspace is the one real deletion, admin-only. It refuses a
-- workspace other workspaces bill under, one Paddle is still billing, and the
-- caller's own last workspace; then deletes leaves-first through the FK
-- graph (read from the migrated schema — nothing here is on delete cascade
-- except worker_seen, so every table is named), in one transaction, and
-- records the act on the admin's own home workspace, where it outlives the
-- rows it removed.

-- retire_workspace: the body below is 20260917090000's, with one refusal
-- added at the top. Replaced whole, from the current definition — a
-- create or replace built from an older draft silently drops later lines.
create or replace function public.retire_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid; keeper uuid; keeper_home uuid; ch record; begin
  me := auth.uid();
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  keeper := private.platform_owner();
  if keeper is null then raise exception 'no_platform_owner' using errcode='55000'; end if;
  -- The owner has nobody to hand a workspace to but themself.
  if me = keeper then raise exception 'owner_cannot_retire' using errcode='55000'; end if;
  -- A person always keeps one workspace to stand in; the product has no
  -- signed-in state without one.
  if (select count(*) from public.memberships m
       where m.user_id = me and m.role = 'workspace_owner') <= 1 then
    raise exception 'last_workspace' using errcode='55000'; end if;
  keeper_home := private.owner_plan_workspace(keeper);

  -- The grant leaves with the person who gave it; scheduled work stops.
  for ch in select id from public.channels where workspace_id = w loop
    update public.channels set status = 'disconnected' where id = ch.id;
    update private.oauth_connections set status = 'revoked' where channel_id = ch.id;
    update public.jobs set status = 'cancelled', error_code = 'disconnected'
     where channel_id = ch.id and status in ('queued','running');
  end loop;

  -- Membership moves whole: everyone out, the keeper in as owner.
  delete from public.memberships where workspace_id = w;
  insert into public.memberships(workspace_id, user_id, role) values (w, keeper, 'workspace_owner');

  -- Billing follows the keeper's root; the rows stay where they are.
  update public.subscriptions s
     set plan_key = k.plan_key, status = k.status, period_start = k.period_start,
         period_end = k.period_end, provider = k.provider, provider_ref = k.provider_ref,
         provider_customer_ref = k.provider_customer_ref, billing_interval = k.billing_interval,
         cancel_at_period_end = false, billing_workspace_id = keeper_home
    from public.subscriptions k
   where s.workspace_id = w and k.workspace_id = keeper_home;

  update public.workspaces
     set created_by = keeper, retired_from = me, retired_at = now()
   where id = w;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, me, 'workspace_retired', 'workspace', me::text);
end $$;

-- What a deletion would destroy, counted, so the dialog says "٤٢٠ تعليقًا"
-- and not "some data".
create function public.admin_workspace_footprint(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'channels',    (select count(*) from public.channels where workspace_id = w),
    'videos',      (select count(*) from public.videos where workspace_id = w),
    'comments',    (select count(*) from public.comments where workspace_id = w),
    'predictions', (select count(*) from public.sentiment_predictions where workspace_id = w)
                 + (select count(*) from public.topic_predictions where workspace_id = w),
    'reviews',     (select count(*) from public.comment_reviews where workspace_id = w)
                 + (select count(*) from public.topic_reviews where workspace_id = w),
    'members',     (select count(*) from public.memberships where workspace_id = w));
end $$;
revoke all on function public.admin_workspace_footprint(uuid) from public, anon;
grant execute on function public.admin_workspace_footprint(uuid) to authenticated;

create function public.delete_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid; my_home uuid; begin
  me := auth.uid();
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.workspaces where id = w) then
    raise exception 'not_found' using errcode='P0002'; end if;
  -- Three refusals before any row moves.
  if exists (select 1 from public.memberships m where m.workspace_id = w and m.user_id = me and m.role = 'workspace_owner')
     and (select count(*) from public.memberships m where m.user_id = me and m.role = 'workspace_owner') <= 1 then
    raise exception 'last_workspace' using errcode='55000'; end if;
  if exists (select 1 from public.subscriptions s where s.billing_workspace_id = w and s.workspace_id <> w) then
    raise exception 'billing_root' using errcode='55000'; end if;
  if exists (select 1 from public.subscriptions s where s.workspace_id = w and s.provider = 'paddle' and s.status = 'active') then
    raise exception 'paddle_subscription_active' using errcode='55000'; end if;

  -- Leaves first. The order is the FK graph of the migrated schema.
  delete from private.billing_events where workspace_id = w;
  delete from private.worker_credentials where workspace_id = w;
  delete from public.sentiment_predictions where workspace_id = w;
  delete from public.topic_predictions where workspace_id = w;
  delete from public.comment_reviews where workspace_id = w;
  delete from public.topic_reviews where workspace_id = w;
  delete from public.comment_annotations where workspace_id = w;
  delete from public.analysis_runs where workspace_id = w;
  delete from private.oauth_states where workspace_id = w;
  delete from private.oauth_connections where workspace_id = w;
  delete from private.job_batches where job_id in (select id from public.jobs where workspace_id = w);
  delete from public.jobs where workspace_id = w;
  delete from public.sync_runs where workspace_id = w;
  delete from public.video_selections where workspace_id = w;
  delete from public.comments where workspace_id = w;
  delete from public.videos where workspace_id = w;
  delete from public.channels where workspace_id = w;
  delete from public.clients where workspace_id = w;
  delete from public.imports where workspace_id = w;
  delete from public.workspace_topics where workspace_id = w;
  delete from public.usage_events where workspace_id = w;
  delete from public.usage_grants where workspace_id = w;
  delete from public.worker_seen where workspace_id = w;
  delete from public.memberships where workspace_id = w;
  delete from public.subscriptions where workspace_id = w;
  delete from public.audit_events where workspace_id = w;
  delete from public.workspaces where id = w;

  -- The act outlives the rows: recorded on the admin's own home.
  my_home := private.owner_plan_workspace(me);
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (my_home, me, 'workspace_deleted', 'workspace', w::text);
end $$;
revoke all on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;
```

Two things to verify while writing it, against the actual files, not this listing: (a) that the `retire_workspace` body you paste is byte-identical to `20260917090000_rename_and_retire_a_workspace.sql:38-77` apart from the one inserted refusal (diff them); (b) that every table named in the delete block exists in the migrated schema with a `workspace_id` column — the test's first run will tell you if one is misspelled.

- [ ] **Step 4: Run the file to see it pass**

Run: `npm run test:db -- supabase/tests/workspace_lifecycle.test.ts`
Expected: PASS, every case including the four new ones. If the "removes every row" case fails on a specific table with an FK error, that table is out of order — move its `delete` earlier (before whatever references it) and re-run; do not add `cascade`.

- [ ] **Step 5: Run the whole db suite**

Run: `npm run test:db`
Expected: PASS. `create or replace function retire_workspace` must not have changed any other test's expectation.

- [ ] **Step 6: Commit**

```bash
git status --short
git add supabase/migrations/20260917100000_delete_workspace.sql supabase/tests/workspace_lifecycle.test.ts
git commit -m "db: retire refuses the owner; delete_workspace is the operator's own door"
git show --stat HEAD
```

---

## Task 2: The account page stops offering retire to a platform admin

**Files:**
- Modify: `apps/web/src/Account.tsx` (read `useIsPlatformAdmin`; pass `onRetire` only to a non-admin)
- Modify: `apps/web/src/WorkspaceCard.tsx:264-300` (render no retire door when `onRetire` is absent)
- Test: `apps/web/src/Account.setup.test.ts` (one new case)

**Interfaces:**
- Consumes: `useIsPlatformAdmin(session)` from `./adminAccess` — returns a react-query result; `access.data === true` is the admin test `main.tsx` and `AdminPage.tsx` already use.
- Consumes: `WorkspaceCard`'s existing optional `onRetire?: (step: "ask" | "confirm" | "keep") => void`.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/Account.setup.test.ts`, next to the existing case `"offers to rename, and to retire — the retire door asks first and says what stays"`, add:

```ts
  it("offers no retire door at all when the caller may not retire", () => {
    const card = render({ onRetire: undefined });
    expect(card).not.toContain(`data-testid="retire-${W1}"`);
    expect(card).not.toContain(ar.retireWorkspace);
    // Rename is unaffected.
    expect(card).toContain(ar.renameWorkspace);
  });
```

(`render` is the file's existing helper; it spreads `over` onto the card's props, and the existing positive case passes an `onRetire`. If the helper supplies a default `onRetire`, passing `undefined` overrides it. Check `ar.renameWorkspace` is the rename door's key — if the file uses a different key for it, use that one.)

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- apps/web/src/Account.setup.test.ts`
Expected: the new case FAILS — the card renders the door regardless of `onRetire`.

- [ ] **Step 3: The card renders the door only when it has a handler**

In `apps/web/src/WorkspaceCard.tsx`, wrap the existing retire block. Change:

```tsx
      {confirmingRetire ? (
        <span
```

to:

```tsx
      {/* No handler, no door: the account page passes none to a platform
          admin, who has nobody to hand a workspace to but themself. The
          server refuses too (owner_cannot_retire); this is the courtesy. */}
      {!onRetire ? null : confirmingRetire ? (
        <span
```

and the block's closing — currently:

```tsx
          {S.retireWorkspace}
        </button>
      )}
      {feedback}
```

stays as it is: the added ternary's `null` branch ends at the same `)}`. Read the block after editing to confirm the three branches (`null`, confirm-group, ask-button) close correctly.

- [ ] **Step 4: The account page passes no handler to an admin**

In `apps/web/src/Account.tsx`, add the import beside the others:

```ts
import { useIsPlatformAdmin } from "./adminAccess";
```

In the component that renders `<WorkspaceCard`, where `session` is already in scope, add near the other hooks:

```ts
  // A platform admin has nobody to hand a workspace to but themself, so the
  // retire door is not offered; retire_workspace refuses them too.
  const access = useIsPlatformAdmin(session);
  const mayRetire = access.data !== true;
```

and change the card's prop from `onRetire={(step) => { … }}` to:

```tsx
                    onRetire={
                      mayRetire
                        ? (step) => {
                            /* existing body, unchanged */
                          }
                        : undefined
                    }
```

— i.e. wrap the existing arrow function in the ternary; do not alter its body. Read `Account.tsx` around line 437 and 508 first: `session` may be named differently there or come from a hook you must locate.

- [ ] **Step 5: Run the tests**

Run: `npm test -- apps/web/src/Account.setup.test.ts apps/web/src/Account.entry.test.ts`
Expected: PASS, including the new case.

- [ ] **Step 6: Typecheck, lint, format**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git status --short
git add apps/web/src/Account.tsx apps/web/src/WorkspaceCard.tsx apps/web/src/Account.setup.test.ts
git commit -m "account: a platform admin is not offered the retire door"
git show --stat HEAD
```

---

## Task 3: The admin page's delete lever and its dialog

**Files:**
- Create: `apps/web/src/DeleteWorkspaceDialog.tsx`
- Test: `apps/web/src/DeleteWorkspaceDialog.test.tsx`
- Modify: `apps/web/src/AdminPage.tsx` (a third `<th>`, a third `<td>` per row, wired to the dialog)
- Modify: `apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts` (new keys, both)
- Modify: `apps/web/src/adminWords.ts` (`adminErrorMessage` maps two new codes)

**Interfaces:**
- Consumes: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose` from `./ui/Dialog`; `Button` from `./ui/Button`; `Input` from `./ui/Input`; `toast` from `./ui/Toast`.
- Consumes: `supabase.rpc("admin_workspace_footprint", { w })` → `{ channels, videos, comments, predictions, reviews, members }`; `supabase.rpc("delete_workspace", { w })`.
- Produces: `DeleteWorkspaceDialog({ workspace: { id: string; name: string }, onDeleted: () => void })`.

- [ ] **Step 1: Add the strings, both languages**

In `apps/web/src/strings/ar.ts`, in the admin section (after `adminGrantPack`):

```ts
  adminDelete: "حذف نهائي",
  adminDeleteTitle: (name: string) => `حذف «${name}» نهائيًا`,
  adminDeleteLead:
    "هذا حذف حقيقي لا رجعة فيه: القناة وتعليقاتها وتصنيفاتها ومراجعاتها وسجلّها كلها تُمحى. لا يمكن استرجاعها.",
  adminDeleteFootprint: (n: {
    channels: number;
    videos: number;
    comments: number;
    predictions: number;
    reviews: number;
    members: number;
  }) =>
    `${n.channels} قناة · ${n.videos} فيديو · ${n.comments} تعليق · ${n.predictions} تصنيف · ${n.reviews} مراجعة · ${n.members} عضو`,
  adminDeleteFootprintReading: "جارٍ عدّ ما سيُحذف…",
  adminDeleteTypeName: (name: string) => `اكتب اسم المساحة «${name}» لتأكيد الحذف`,
  adminDeleteConfirm: "احذف نهائيًا",
  adminDeleteCancel: "إلغاء",
  adminDeleteClose: "إغلاق",
  adminDeleteDone: (name: string) => `حُذفت «${name}» نهائيًا.`,
  adminDeleteBillingRoot:
    "مساحات أخرى تُفوتر تحت هذه المساحة؛ لا يمكن حذفها ما دامت جذرًا للفوترة.",
  adminDeleteLast: "لا يمكن حذف آخر مساحة لك؛ أنشئ أخرى أولًا.",
```

In `apps/web/src/strings/en.ts`, the matching keys in the same position:

```ts
  adminDelete: "Delete permanently",
  adminDeleteTitle: (name: string) => `Delete “${name}” permanently`,
  adminDeleteLead:
    "This is a real deletion and cannot be undone: the channel, its comments, labels, reviews and history are all erased. Nothing can be recovered.",
  adminDeleteFootprint: (n: {
    channels: number;
    videos: number;
    comments: number;
    predictions: number;
    reviews: number;
    members: number;
  }) =>
    `${n.channels} channels · ${n.videos} videos · ${n.comments} comments · ${n.predictions} labels · ${n.reviews} reviews · ${n.members} members`,
  adminDeleteFootprintReading: "Counting what will be deleted…",
  adminDeleteTypeName: (name: string) => `Type the workspace name “${name}” to confirm`,
  adminDeleteConfirm: "Delete permanently",
  adminDeleteCancel: "Cancel",
  adminDeleteClose: "Close",
  adminDeleteDone: (name: string) => `“${name}” was permanently deleted.`,
  adminDeleteBillingRoot:
    "Other workspaces bill under this one; it cannot be deleted while it is a billing root.",
  adminDeleteLast: "Your last workspace cannot be deleted; create another first.",
```

Then in `apps/web/src/adminWords.ts`'s `adminErrorMessage`, after the `paddle_subscription_active` line, add:

```ts
  if (e.message === "billing_root") return S.adminDeleteBillingRoot;
  if (e.message === "last_workspace") return S.adminDeleteLast;
```

Run `npm run typecheck` — it fails if the two string files disagree on a key.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/DeleteWorkspaceDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "./strings/ar";

const shared = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: { w: string }) => Promise<{ data: unknown; error: { message: string } | null }>>(),
}));
vi.mock("./supabase", () => ({
  supabase: { rpc: (fn: string, args: { w: string }) => shared.rpc(fn, args) },
}));
vi.mock("./ui/Toast", () => ({ toast: vi.fn() }));

import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { toast } from "./ui/Toast";

const W = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const footprint = { channels: 1, videos: 3, comments: 420, predictions: 400, reviews: 2, members: 1 };

beforeEach(() => {
  shared.rpc.mockReset();
  shared.rpc.mockImplementation(async (fn) =>
    fn === "admin_workspace_footprint"
      ? { data: footprint, error: null }
      : { data: null, error: null },
  );
  vi.mocked(toast).mockReset();
});

const open = async () => {
  const onDeleted = vi.fn();
  render(<DeleteWorkspaceDialog workspace={{ id: W, name: "عميل للتسليم 1" }} onDeleted={onDeleted} />);
  await userEvent.click(screen.getByRole("button", { name: ar.adminDelete }));
  return onDeleted;
};

describe("DeleteWorkspaceDialog", () => {
  it("is closed until the lever is pressed, then names the workspace and counts what goes", async () => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    expect(await screen.findByRole("dialog", { name: ar.adminDeleteTitle("عميل للتسليم 1") })).toBeVisible();
    expect(await screen.findByText(ar.adminDeleteFootprint(footprint))).toBeVisible();
    expect(shared.rpc).toHaveBeenCalledWith("admin_workspace_footprint", { w: W });
  });

  it("confirm stays disabled until the name is typed back exactly", async () => {
    await open();
    await screen.findByRole("dialog");
    const confirm = screen.getByRole("button", { name: ar.adminDeleteConfirm });
    expect(confirm).toBeDisabled();
    const box = screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1"));
    await userEvent.type(box, "عميل للتسليم");
    expect(confirm).toBeDisabled();
    await userEvent.type(box, " 1");
    expect(confirm).toBeEnabled();
  });

  it("confirm calls delete_workspace, toasts, and reports back", async () => {
    const onDeleted = await open();
    await screen.findByRole("dialog");
    await userEvent.type(screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1")), "عميل للتسليم 1");
    await userEvent.click(screen.getByRole("button", { name: ar.adminDeleteConfirm }));
    await waitFor(() => expect(shared.rpc).toHaveBeenCalledWith("delete_workspace", { w: W }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: ar.adminDeleteDone("عميل للتسليم 1") });
  });

  it.each([
    ["billing_root", ar.adminDeleteBillingRoot],
    ["last_workspace", ar.adminDeleteLast],
    ["paddle_subscription_active", ar.adminPaddleActive],
  ])("a %s refusal is said in the dialog, and nothing is reported as deleted", async (code, sentence) => {
    shared.rpc.mockImplementation(async (fn) =>
      fn === "admin_workspace_footprint"
        ? { data: footprint, error: null }
        : { data: null, error: { message: code } },
    );
    const onDeleted = await open();
    await screen.findByRole("dialog");
    await userEvent.type(screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1")), "عميل للتسليم 1");
    await userEvent.click(screen.getByRole("button", { name: ar.adminDeleteConfirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/DeleteWorkspaceDialog.test.tsx`
Expected: FAIL — `Cannot find module './DeleteWorkspaceDialog'`.

- [ ] **Step 4: Implement the dialog**

Create `apps/web/src/DeleteWorkspaceDialog.tsx`:

```tsx
/**
 * The operator's delete. A real deletion, so the dialog says exactly what
 * goes — counted, from the server — and asks for the workspace's name typed
 * back before the confirm button will enable. The refusals are the
 * function's; this only says them.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useStrings } from "./strings";
import { adminErrorMessage } from "./adminWords";
import { Button } from "./ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/Dialog";
import { Input } from "./ui/Input";
import { toast } from "./ui/Toast";

interface Footprint {
  channels: number;
  videos: number;
  comments: number;
  predictions: number;
  reviews: number;
  members: number;
}

export function DeleteWorkspaceDialog({
  workspace,
  onDeleted,
}: {
  workspace: { id: string; name: string };
  onDeleted: () => void;
}) {
  const S = useStrings();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Counted when the dialog opens, not on mount: the admin table has a row
  // per workspace and this must not fire a query for each on page load.
  useEffect(() => {
    if (!open || !supabase) return;
    let live = true;
    setFootprint(null);
    void supabase
      .rpc("admin_workspace_footprint", { w: workspace.id })
      .then(({ data }) => {
        if (live && data) setFootprint(data as Footprint);
      });
    return () => {
      live = false;
    };
  }, [open, workspace.id]);

  const inputId = `delete-name-${workspace.id}`;
  const matches = typed.trim() === workspace.name.trim();

  function confirm() {
    if (!supabase || !matches) return;
    setBusy(true);
    setFailure(null);
    void supabase.rpc("delete_workspace", { w: workspace.id }).then(({ error }) => {
      setBusy(false);
      if (error) {
        setFailure(adminErrorMessage(error, S));
        return;
      }
      setOpen(false);
      toast({ title: S.adminDeleteDone(workspace.name) });
      onDeleted();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped("");
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {S.adminDelete}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={S.adminDeleteClose}>
        <DialogTitle>{S.adminDeleteTitle(workspace.name)}</DialogTitle>
        <DialogDescription>{S.adminDeleteLead}</DialogDescription>
        <p className="ui-num">
          {footprint
            ? S.adminDeleteFootprint(footprint)
            : S.adminDeleteFootprintReading}
        </p>
        <label htmlFor={inputId}>{S.adminDeleteTypeName(workspace.name)}</label>
        <Input
          id={inputId}
          value={typed}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
        {failure && <p role="alert">{failure}</p>}
        <div className="admin-delete-actions">
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {S.adminDeleteCancel}
            </Button>
          </DialogClose>
          <Button variant="danger" disabled={!matches || busy} onClick={confirm}>
            {S.adminDeleteConfirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Add to `apps/web/src/ui/ui.css` (append):

```css
.admin-delete-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-4);
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/DeleteWorkspaceDialog.test.tsx`
Expected: PASS, 6 tests (3 + the 3-row `it.each`).

- [ ] **Step 6: Wire it into the admin table**

In `apps/web/src/AdminPage.tsx`:

1. Import: `import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";`
2. In the `<thead>`, after `<th scope="col">{S.adminGrantPack}</th>`, add `<th scope="col">{S.adminDelete}</th>`.
3. In `WorkspaceRow`, after the pack form's closing `</td>`, add:

```tsx
      <td>
        <DeleteWorkspaceDialog
          workspace={{ id: w.id, name: row.name }}
          onDeleted={() =>
            void queryClient.invalidateQueries({ queryKey: ["admin"] })
          }
        />
      </td>
```

(`queryClient` and `row` are already in `WorkspaceRow`'s scope; `row.name` is the display name `adminRows` computed.)

- [ ] **Step 7: Typecheck, lint, format, and the existing admin test**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test -- apps/web/src/AdminPage.test.tsx apps/web/src/DeleteWorkspaceDialog.test.tsx`
Expected: all exit 0 / PASS.

- [ ] **Step 8: Look at it**

Start the dev server (`web-dev-5176`), open `/admin` signed out — it must still show the forbidden state with no console error (the lever only renders inside the admin table, which needs a session this checkout does not have; the six jsdom cases are the dialog's proof). Stop the server.

- [ ] **Step 9: Commit**

```bash
git status --short
git add apps/web/src/DeleteWorkspaceDialog.tsx apps/web/src/DeleteWorkspaceDialog.test.tsx apps/web/src/AdminPage.tsx apps/web/src/adminWords.ts apps/web/src/strings/ar.ts apps/web/src/strings/en.ts apps/web/src/ui/ui.css
git commit -m "admin: a delete lever with a typed-name dialog, the first real ui/Dialog"
git show --stat HEAD
```

---

## Task 4: Full check and the records

**Files:**
- Modify: `docs/progress.md` (append), `docs/verification.md` (append), `docs/decisions.md` (append), `docs/coordination/ACTIVE.md` (append to its "Pending" list)

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 2: Append the records**

Re-read each file's current tail immediately before editing (shared, append-only). Append dated entries:

- `docs/decisions.md`: retire refuses the platform owner; a real delete exists, admin-only, with its three refusals and why each; the deletion is recorded on the admin's home workspace because the deleted workspace's own audit rows go with it.
- `docs/progress.md`: what landed (the migration, the account-page gate, the admin dialog), naming the three commits, and that **the migration is not on the live project yet**.
- `docs/verification.md`: the `npm run check` result with counts; that the PGlite lifecycle suite covers every refusal and the full-deletion case; that no signed-in browser walk was possible in this checkout.
- `docs/coordination/ACTIVE.md`, under its "Pending, … the user's decisions" list: `supabase db push --linked` for `20260917100000_delete_workspace.sql`, so the operator sees it beside the other unpushed migrations.

- [ ] **Step 3: Commit the records on their own**

```bash
git status --short
git add docs/progress.md docs/verification.md docs/decisions.md docs/coordination/ACTIVE.md
git commit -m "docs: record the delete door and the retire guard, and that the migration awaits the push"
git show --stat HEAD
```

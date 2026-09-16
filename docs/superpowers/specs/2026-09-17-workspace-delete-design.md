# Retiring stays a handover; deleting is the operator's own door (design)

2026-09-17. Approved in conversation; this is the written form.

## What changes and why

The account page's «إنهاء المساحة» is not a deletion and was never meant to be
(`20260917090000_rename_and_retire_a_workspace.sql`'s header: "nothing collected is ever
dropped"). It hands the workspace to the platform owner and keeps every row. That is the
right default for a customer's workspace. But two things are wrong today:

1. **The platform owner can retire their own workspace to themselves.** `retire_workspace`
   only checks `workspace_owner` on the workspace; when the caller *is* `platform_owner()`,
   membership is deleted and re-inserted for the same person, and the page says «انتهت
   المساحة وانتقلت إلى مشغّل الخدمة» — a sentence that is false in that case. The button
   should not be offered where it cannot mean what it says.
2. **There is no way to actually delete a workspace.** Test workspaces, the "عميل للتسليم 1"
   the operator made to try the handover, a duplicate a customer created by mistake —
   these accumulate under the owner's root forever. The operator asked for a real delete,
   and only for the operator.

## Approach

**Retire (unchanged in shape, guarded):** `retire_workspace` refuses when the caller is
`private.platform_owner()` — `raise exception 'owner_cannot_retire'` — and the account page
does not render the retire door for a platform admin at all (`useIsPlatformAdmin`, the hook
the rail and the admin page already read). Server first, UI second: hiding the button is a
courtesy, the function is the gate, same as every other door in this product.

**Delete (new, admin-only, on the admin page):** `public.delete_workspace(w uuid)` —
`security definer`, `is_platform_admin()` or `forbidden`, and then three refusals before any
row moves:

- `last_workspace` if it is the caller's own last `workspace_owner` membership — the same
  rule retire already enforces; a signed-in person always has a workspace to stand in.
- `billing_root` if any *other* workspace's `subscriptions.billing_workspace_id` points at
  it — deleting a root would orphan every subscription billed under it.
- `paddle_subscription_active` if it is its own billing root (`billing_workspace_id is
  null`) and its own subscription has `provider = 'paddle'` and `status in ('active',
  'past_due')` — a client workspace copies its root's provider/status at creation and on
  every webhook (`create_workspace_impl`, `apply_billing_event`), so checking the row
  without the root guard would refuse every client of a Paddle-paying agency, not just the
  root Paddle actually bills. Cancel in Paddle first (the existing `set_workspace_plan`
  refusal uses the same code, and `adminErrorMessage` already maps it).

Then it deletes, leaves first, every row that references the workspace — the order below
is the real FK graph, read from the migrated schema with a probe, not reconstructed by
hand — and finally the workspace. Nothing is `on delete cascade` except `worker_seen`, so
every step is explicit. `private.billing_events` is the one exception to "deletes": its
`workspace_id` is set to `null` rather than the row being removed, so the webhook trail a
chargeback dispute needs survives the workspace it was about. `audit_events` for the
workspace go too (their FK is `not null` and there is no workspace left to hang them on);
the deletion itself is recorded as an `audit_events` row **on the admin's own home
workspace**, `action = 'workspace_deleted'`, `target_id = <deleted workspace id>` — so the
fact that it happened, who did it and when, survives the rows it removed.

```
private.billing_events (detached, workspace_id set to null — not deleted),
private.worker_credentials,
public.sentiment_predictions, public.analysis_runs,
private.oauth_states, private.oauth_connections,
private.job_batches, public.jobs, public.sync_runs, public.video_selections,
public.comment_annotations, public.comment_reviews,
public.topic_predictions, public.topic_reviews,
public.comments, public.videos, public.channels, public.clients,
public.imports, public.memberships, public.subscriptions,
public.usage_events, public.usage_grants, public.worker_seen, public.workspace_topics,
public.audit_events (this workspace's), public.workspaces
```

Every `delete` is `where workspace_id = w` (or the table's equivalent); the function runs
in one transaction, so a refusal or an FK surprise leaves nothing half-gone.

**The door:** on `AdminPage.tsx`'s workspace table, a third lever after "set plan" and
"grant pack": «حذف نهائي» / "Delete permanently". It opens a `ui/Dialog` (the primitive built
for exactly this — the first real `Dialog` consumer) that names the workspace, states what
will be destroyed (channel, comments, labels, history — counted, so the operator sees "٤٢٠
تعليقًا" not "some data"), and requires the workspace's name to be typed back before the
confirm button enables. `busy` while the RPC runs; on success the row leaves the table and
a page-level `toast` says «حُذفت المساحة نهائيًا»; on refusal, `adminErrorMessage` maps the
three codes to sentences (two new strings, both languages; `paddle_subscription_active`
already has one).

Rejected: a soft delete (`deleted_at`) — the operator asked for the rows to go, and a
tombstone is the "nothing is deleted" policy under a new name. Rejected: offering delete on
the account page to workspace owners — the request was explicit that this is the operator's
door only, and the privacy policy's "request deletion by email" path is what a customer has.

## Testing

- `supabase/tests/workspace_lifecycle.test.ts` (PGlite, the existing harness) gains: retire
  as the platform owner → `owner_cannot_retire`; delete as a non-admin → `forbidden`; delete
  a workspace that is another's billing root → `billing_root`, and every row still there;
  delete a workspace with an active Paddle subscription → `paddle_subscription_active`;
  delete a *client* of a Paddle-paying root → allowed (the root's own status is not the
  client's to be refused on), while the root itself is still refused; delete the admin's
  own last workspace → `last_workspace`; and the real case — a workspace
  with a channel, videos, comments, predictions, reviews, jobs, grants, a subscription —
  deleted, then `count(*)` is 0 in every table for that id, the audit row is on the admin's
  home, and every other workspace's rows are untouched (counted before and after).
- `AdminPage`: a jsdom test of the delete dialog in isolation (the way `AdminPage.test.tsx`
  tests the picker) — closed until the lever is pressed; confirm disabled until the typed
  name matches; the RPC called with the id on confirm; the three refusal sentences shown.
- Account page: `WorkspaceCard` renders no retire door when `isPlatformAdmin` is true
  (extend `Account.setup.test.ts`'s existing static render if it covers the card, else a
  small new case).

## Out of scope

A Paddle-side cancellation from this dialog (the operator cancels in Paddle, then deletes
here — one system of record per action). A customer-facing delete. Deleting a user account.

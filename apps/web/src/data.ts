import {
  CommentReviewInputSchema,
  FixtureSchema,
  applyReview,
  exportObjectPath,
  exportRows,
  snapshot,
  toCsv,
  type Comment,
  type CommentReviewInput,
  type Filters,
} from "@sentiment/contracts";
import { supabase } from "./supabase";
export const fixtureWorkspace = "00000000-0000-4000-8000-000000000001";

/**
 * Fixture mode has no server, so corrections are kept for this browser session
 * only and are never sent anywhere. They go through the same shared applyReview
 * rules that the server RPC mirrors, so the dashboard recomputes identically.
 */
const sessionReviews: { input: CommentReviewInput; at: string }[] = [];
export const reviewsArePersisted = supabase !== null;

function withSessionReviews(comments: Comment[]): Comment[] {
  return sessionReviews.reduce(
    (acc, r) => applyReview(acc, r.input, r.at),
    comments,
  );
}

async function readFixture(signal?: AbortSignal) {
  const response = await fetch("/fixtures/dashboard.json", { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  return FixtureSchema.parse(await response.json());
}

export async function loadSnapshot(filters: Filters, signal: AbortSignal) {
  const fixture = await readFixture(signal);
  const comments = withSessionReviews(fixture.comments);
  const build = (f: Filters, cursor_reset: boolean) => ({
    ...snapshot(comments, f, fixture.active_analysis_key),
    revision: fixture.revision,
    cursor_reset,
  });
  try {
    return build(filters, false);
  } catch (error) {
    if ((error as Error).message !== "invalid_cursor") throw error;
    // The row this cursor pointed at is no longer in the filtered set, so the
    // page it named cannot be rebuilt. Restart from page one and say so, rather
    // than showing an empty page or a page from a different result set.
    return build({ ...filters, cursor: undefined }, true);
  }
}

export async function submitReview(raw: CommentReviewInput) {
  const input = CommentReviewInputSchema.parse(raw);
  if (supabase) {
    // The RPC re-checks role, tenancy and the content hash server-side; this
    // call is a request, not the authority on whether it is allowed.
    const { error } = await supabase.rpc("submit_comment_review", {
      w: input.workspace_id,
      c: input.comment_id,
      seen_hash: input.content_hash,
      verdict: input.label,
      why: input.reason,
    });
    if (error) throw new Error(error.message);
    return;
  }
  // Validate against the current fixture so a verdict on changed text is
  // rejected here too, instead of failing later during a reload.
  const fixture = await readFixture();
  applyReview(
    withSessionReviews(fixture.comments),
    input,
    new Date().toISOString(),
  );
  sessionReviews.push({ input, at: new Date().toISOString() });
}

/**
 * Builds the export from the filters currently on screen, through the same
 * shared row selection the dashboard uses. In fixture mode the file is produced
 * in the browser; a real export is a background job writing to the private
 * bucket, which is why the name already carries the workspace prefix the
 * storage policy checks.
 */
export async function buildExport(filters: Filters) {
  const fixture = await readFixture();
  const rows = exportRows(
    withSessionReviews(fixture.comments),
    filters,
    fixture.active_analysis_key,
  );
  return {
    rows: rows.length,
    filename: exportObjectPath(filters.workspace_id, new Date())
      .split("/")
      .pop()!,
    csv: toCsv(rows),
  };
}

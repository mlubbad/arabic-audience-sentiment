import {
  CommentReviewInputSchema,
  FixtureSchema,
  LiveSnapshotSchema,
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
/**
 * Who a fixture-mode correction is attributed to. Deliberately not a UUID and
 * clearly synthetic: there is no authenticated user in fixture mode, and
 * pretending otherwise would be the dishonesty P1 removed. The live path takes
 * this from the session inside the RPC.
 */
export const fixtureReviewer = "مراجع محلي (جلسة اختبار)";

export const fixtureWorkspace = "00000000-0000-4000-8000-000000000001";

// A channel can have hundreds of videos; comparing all of them is neither
// usable nor cheap. The busiest few are compared and the rest declared.
const COMPARISON_LIMIT = 10;

export type DataMode = "sanitized_fixture" | "live";

/**
 * What the dashboard is actually serving, decided in one place.
 *
 * Two conditions, both required. A configured Supabase project enables product
 * Auth and workspace management; on its own it must never turn fixture rows
 * into live data, because a correction made against a fixture id and a fixture
 * workspace would then be addressed to a real server and reported as saved.
 * Going live is therefore an explicit choice as well as a configured one.
 *
 * The read and the write branch on this same value, so they cannot disagree
 * about which mode they are in.
 */
const liveRequested = import.meta.env.VITE_DASHBOARD_SOURCE === "live";
export const dataMode: DataMode =
  supabase && liveRequested ? "live" : "sanitized_fixture";

export const reviewsArePersisted = dataMode !== "sanitized_fixture";

// Fixture corrections are kept for this browser session only and are never sent
// anywhere. They go through the same shared applyReview rules the server RPC
// mirrors, so the dashboard recomputes identically either way.
const sessionReviews: { input: CommentReviewInput; at: string }[] = [];

function withSessionReviews(comments: Comment[]): Comment[] {
  return sessionReviews.reduce(
    (acc, r) => applyReview(acc, r.input, r.at, fixtureReviewer),
    comments,
  );
}

async function readFixture(signal?: AbortSignal) {
  const response = await fetch("/fixtures/dashboard.json", { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  return FixtureSchema.parse(await response.json());
}

/**
 * The live read. Parsed with the schema that shares its field definitions with
 * the fixture, so a server that answers with a different shape is refused here
 * rather than rendered as a half-populated dashboard.
 */
async function readLive(workspace: string) {
  const { data, error } = await supabase!.rpc("dashboard_snapshot", {
    w: workspace,
  });
  // The reason is not surfaced: a PostgREST error can carry the request URL.
  if (error) throw new Error("live_unavailable");
  return LiveSnapshotSchema.parse(data);
}

/**
 * One source, chosen once. Session corrections belong to fixture mode alone —
 * in live mode the server holds the review log, and replaying local edits over
 * it would show a correction that no longer exists on the server as if it did.
 */
async function readSource(workspace: string, signal?: AbortSignal) {
  if (dataMode === "live") return readLive(workspace);
  const fixture = await readFixture(signal);
  return { ...fixture, comments: withSessionReviews(fixture.comments) };
}

export async function loadSnapshot(filters: Filters, signal: AbortSignal) {
  const source = await readSource(filters.workspace_id, signal);
  const comments = source.comments;
  const build = (f: Filters, cursor_reset: boolean) => {
    const base = snapshot(comments, f, source.active_analysis_key);
    return {
      ...base,
      // The snapshot already aggregates every video; the app only decides how
      // many to show and says when it has truncated.
      comparison: base.videos.slice(0, COMPARISON_LIMIT),
      comparison_truncated: base.videos.length > COMPARISON_LIMIT,
      mode: dataMode,
      revision: source.revision,
      // Plan state travels with the snapshot, so the limit on screen always
      // belongs to the same read as the numbers beside it.
      plan: source.plan,
      sync: source.sync,
      cursor_reset,
    };
  };
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
  if (dataMode === "live") {
    // Addressed to the same source the rows came from. The server takes the
    // reviewer and the human provenance from the session and re-checks the
    // hash, so this sends a verdict and never an identity.
    const { error } = await supabase!.rpc("submit_comment_review", {
      w: input.workspace_id,
      c: input.comment_id,
      seen_hash: input.content_hash,
      verdict: input.label,
      why: input.reason,
    });
    if (error) throw new Error("review_rejected");
    return;
  }
  // A correction belongs to the fixture it was made against. Keyed on the data
  // mode, never on whether Auth happens to be configured.
  const fixture = await readFixture();
  // Validate against the current fixture so a verdict on changed text is
  // rejected here too, instead of failing later during a reload.
  applyReview(
    withSessionReviews(fixture.comments),
    input,
    new Date().toISOString(),
    fixtureReviewer,
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
  const source = await readSource(filters.workspace_id);
  const rows = exportRows(source.comments, filters, source.active_analysis_key);
  return {
    rows: rows.length,
    filename: exportObjectPath(filters.workspace_id, new Date())
      .split("/")
      .pop()!,
    csv: toCsv(rows),
  };
}

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
import { readSyncState } from "./syncHealth";

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
 * There is no live comment read path yet, so this is fixture and nothing can
 * change it. Configuring Supabase enables product Auth and workspace
 * management on the account screen; it does not turn fixture rows into live
 * data. In particular it must never redirect a correction made against a
 * fixture row at a live RPC, which would address a fixture id and a fixture
 * workspace to a real server and then report success.
 *
 * The live path arrives together with a live dashboard read, as one change, so
 * the read and write paths can never disagree about which mode they are in.
 */
export const dataMode: DataMode = "sanitized_fixture";

/**
 * Corrections are persisted only when the data itself is live. Derived from the
 * data mode rather than from whether Auth happens to be configured, so the UI
 * cannot claim a correction was saved while it is editing fixture rows.
 */
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
  const raw = await response.json();
  // FixtureSchema is not strict, so it strips keys it does not model. The sync
  // block is read from the raw payload until the shared contract carries it.
  return { ...FixtureSchema.parse(raw), sync: readSyncState(raw?.sync) };
}

export async function loadSnapshot(filters: Filters, signal: AbortSignal) {
  const fixture = await readFixture(signal);
  const comments = withSessionReviews(fixture.comments);
  // Per-video figures come from the same shared snapshot, run once per video
  // with that video pinned. Filter semantics are then identical by
  // construction rather than by a second implementation agreeing with the
  // first. The cursor is dropped because it names a row in the unpinned set.
  const compare = (f: Filters, videos: { id: string; total: number }[]) =>
    videos
      .slice()
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id, "en"))
      .slice(0, COMPARISON_LIMIT)
      .map((v) => {
        const per = snapshot(
          comments,
          { ...f, video_ids: [v.id], cursor: undefined, limit: 1 },
          fixture.active_analysis_key,
        );
        return {
          id: v.id,
          total: per.total,
          analysed: per.analysed,
          sentiments: per.sentiments,
          replies: per.replies,
        };
      });
  const build = (f: Filters, cursor_reset: boolean) => {
    const base = snapshot(comments, f, fixture.active_analysis_key);
    return {
      ...base,
      comparison: compare(f, base.videos),
      comparison_truncated: base.videos.length > COMPARISON_LIMIT,
      revision: fixture.revision,
      // Plan state travels with the snapshot, so the limit on screen always
      // belongs to the same read as the numbers beside it.
      plan: fixture.plan,
      sync: fixture.sync,
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
  // No live branch here on purpose. While the dashboard serves fixtures, a
  // correction belongs to the fixture it was made against, whatever Auth is
  // configured. Adding a server call keyed on Auth is the defect this prevents.
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

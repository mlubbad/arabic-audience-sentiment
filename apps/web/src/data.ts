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
export const fixtureWorkspace = "00000000-0000-4000-8000-000000000001";

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
    // Plan state travels with the snapshot, so the limit on screen always
    // belongs to the same read as the numbers beside it.
    plan: fixture.plan,
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

import {
  CommentReviewInputSchema,
  FixtureSchema,
  LiveSnapshotSchema,
  PlanCatalogueSchema,
  TopicReviewInputSchema,
  OpsSnapshotSchema,
  type OpsSnapshot,
  applyReview,
  applyTopicReview,
  exportObjectPath,
  exportRows,
  snapshot,
  toCsv,
  type Comment,
  type CommentReviewInput,
  type Filters,
  type TopicReviewInput,
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

/**
 * What `plan_catalogue()` answers, for a build with no server to ask: the six
 * non-internal rows of `supabase/migrations/20260917010000_plans_v2.sql`, in
 * their sort order, with the same numbers (the yearly figures as corrected in
 * 20260917052000, the workspace limit as the count of client workspaces from
 * 20260917060000: none for an individual plan). Parsed through the contract so a
 * row that the live function would refuse is refused here too. Kept here, not
 * in the dashboard fixture file — that file is one workspace's snapshot and
 * the catalogue is not the workspace's; the pricing page reads it signed out.
 */
const limits = (
  analysis_units: number,
  topic_units: number,
  insight_reports: number,
  channels: number,
  members: number,
  workspaces: number,
  live_interval_minutes: number,
) => ({
  analysis_units,
  topic_units,
  insight_reports,
  channels,
  members,
  workspaces,
  live_interval_minutes,
});
export const fixtureCatalogue = PlanCatalogueSchema.parse([
  {
    key: "free",
    segment: "individual",
    title_ar: "مجاني",
    title_en: "Free",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: true,
    provider_prices: {},
    limits: limits(100, 100, 1, 0, 1, 0, 0),
  },
  {
    key: "creator",
    segment: "individual",
    title_ar: "منشئ",
    title_en: "Creator",
    price_monthly_cents: 1200,
    price_yearly_cents: 12000,
    self_serve: true,
    provider_prices: {},
    limits: limits(10000, 4000, 10, 1, 1, 0, 1440),
  },
  {
    key: "creator_plus",
    segment: "individual",
    title_ar: "منشئ بلس",
    title_en: "Creator Plus",
    price_monthly_cents: 2900,
    price_yearly_cents: 28800,
    self_serve: true,
    provider_prices: {},
    limits: limits(30000, 12000, 50, 2, 2, 0, 720),
  },
  {
    key: "agency",
    segment: "business",
    title_ar: "وكالة",
    title_en: "Agency",
    price_monthly_cents: 9900,
    price_yearly_cents: 94800,
    self_serve: true,
    provider_prices: {},
    limits: limits(150000, 60000, 200, 10, 10, 5, 360),
  },
  {
    key: "media",
    segment: "business",
    title_ar: "ميديا",
    title_en: "Media",
    price_monthly_cents: 24900,
    price_yearly_cents: 238800,
    self_serve: false,
    provider_prices: {},
    limits: limits(500000, 200000, 600, 30, 25, 15, 120),
  },
  {
    key: "enterprise",
    segment: "business",
    title_ar: "مؤسسات",
    title_en: "Enterprise",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: false,
    provider_prices: {},
    limits: limits(1000000, 400000, 2000, 100, 100, 50, 60),
  },
]);

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
/**
 * The furthest this build is allowed to go. Configuration alone never makes a
 * read live — it only permits it.
 */
export const configuredMode: DataMode =
  supabase && liveRequested ? "live" : "sanitized_fixture";

/**
 * The mode one particular render is in.
 *
 * Previously a module constant, which forced the whole deployment to be either
 * a demo or a product: a signed-out visitor on a live build had nothing to
 * look at, and a signed-in owner on a demo build could never see their own
 * channel. Both audiences exist at the same URL, so the answer depends on who
 * is asking and cannot be decided at build time.
 *
 * Every caller now passes the mode it resolved, so a read and the correction
 * written against it are answered by the same source — the property the module
 * constant was protecting, kept without the constant.
 */
export function resolveMode(input: {
  signedIn: boolean;
  /** A workspace the caller is entitled to read, already resolved. */
  workspace: string | null;
}): DataMode {
  if (configuredMode !== "live") return "sanitized_fixture";
  // Both required. Signed in with no workspace has nothing live to show, and a
  // workspace id without a session is a claim rather than an entitlement.
  return input.signedIn && input.workspace ? "live" : "sanitized_fixture";
}

export const reviewsArePersisted = (mode: DataMode) =>
  mode !== "sanitized_fixture";

// Fixture corrections are kept for this browser session only and are never sent
// anywhere. They go through the same shared applyReview rules the server RPC
// mirrors, so the dashboard recomputes identically either way.
const sessionReviews: { input: CommentReviewInput; at: string }[] = [];
// The topic dimension keeps its own log, as the server does: a sentiment
// verdict and a topic verdict on the same comment are two corrections, and
// neither supersedes the other.
const sessionTopicReviews: { input: TopicReviewInput; at: string }[] = [];

function withSessionReviews(comments: Comment[]): Comment[] {
  const labelled = sessionReviews.reduce(
    (acc, r) => applyReview(acc, r.input, r.at, fixtureReviewer),
    comments,
  );
  return sessionTopicReviews.reduce(
    (acc, r) => applyTopicReview(acc, r.input, r.at, fixtureReviewer),
    labelled,
  );
}

async function readFixture(signal?: AbortSignal) {
  // The visitor's demo fixture by default; the e2e kernel when the browser
  // suite points this build at it (playwright.config.ts sets the env var).
  const response = await fetch(
    import.meta.env.VITE_FIXTURE_DASHBOARD ?? "/fixtures/dashboard.json",
    { signal },
  );
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
export async function loadSource(
  mode: DataMode,
  workspace: string,
  signal?: AbortSignal,
) {
  if (mode === "live") return readLive(workspace);
  const fixture = await readFixture(signal);
  return { ...fixture, comments: withSessionReviews(fixture.comments) };
}

/** Everything one read of the source answers, before any filter is applied. */
export type Source = Awaited<ReturnType<typeof loadSource>>;

/**
 * Reads lightweight operational status for a workspace: sync health, quota usage,
 * and comments stored per video.
 */
async function readOpsLive(workspace: string): Promise<OpsSnapshot> {
  const { data, error } = await supabase!.rpc("workspace_ops_snapshot", {
    w: workspace,
  });
  if (error) throw new Error("live_unavailable");
  return OpsSnapshotSchema.parse(data);
}

/**
 * Derives operational status from fixture data for offline/test mode.
 */
async function readOpsFixture(signal?: AbortSignal): Promise<OpsSnapshot> {
  const fixture = await readFixture(signal);
  const countsMap = new Map<string, number>();
  for (const c of fixture.comments) {
    countsMap.set(c.video_id, (countsMap.get(c.video_id) ?? 0) + 1);
  }
  const video_counts = Array.from(countsMap.entries()).map(([id, total]) => ({
    id,
    total,
  }));
  return OpsSnapshotSchema.parse({
    sync: fixture.sync,
    plan: fixture.plan,
    video_counts,
  });
}

/**
 * Loads lightweight operational state for the rail indicator and /sync page.
 */
export async function loadOpsSource(
  mode: DataMode,
  workspace: string,
  signal?: AbortSignal,
): Promise<OpsSnapshot> {
  if (mode === "live") return readOpsLive(workspace);
  return readOpsFixture(signal);
}

export type OpsSource = Awaited<ReturnType<typeof loadOpsSource>>;

/**
 * The whole of the dashboard, derived from one read. Pure, and deliberately
 * separate from the read above.
 *
 * Every filter on the dashboard is applied here, in the browser, to rows that
 * are already in memory — `dashboard_snapshot(w)` takes a workspace and
 * nothing else. Keeping the two in one function made that impossible to see,
 * and the page was written as though a filter change needed a new request: it
 * re-read the entire comment history on every one. On a 376-comment channel
 * that is 611KB per keystroke-and-apply, returning bytes identical to the ones
 * already on screen, and each attempt is an independent chance to fail at a
 * moment when nothing about the data has changed.
 *
 * The failure is not graceful, either. Every figure, every chart and the video
 * dropdown itself read from that one response, so a filter change that loses
 * its read does not narrow the report — it empties the page, and leaves the
 * filter bar claiming a video the now-empty dropdown no longer offers.
 */
export function deriveSnapshot(
  source: Source,
  mode: DataMode,
  filters: Filters,
) {
  const comments = source.comments;
  const build = (f: Filters, cursor_reset: boolean) => {
    const base = snapshot(
      comments,
      f,
      source.active_analysis_key,
      source.active_analysis_labels,
      source.active_topic_key,
    );
    return {
      ...base,
      // The snapshot already aggregates every video; the app only decides how
      // many to show and says when it has truncated.
      comparison: base.videos.slice(0, COMPARISON_LIMIT),
      comparison_truncated: base.videos.length > COMPARISON_LIMIT,
      mode,
      revision: source.revision,
      // Plan state travels with the snapshot, so the limit on screen always
      // belongs to the same read as the numbers beside it.
      plan: source.plan,
      sync: source.sync,
      // The taxonomy and the key the topic counts were taken under, so the
      // card names its buckets from the same read that counted them.
      topics: source.topics,
      active_topic_key: source.active_topic_key,
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

/** Read then derive, for callers that want one workspace's whole answer. */
export async function loadSnapshot(
  mode: DataMode,
  filters: Filters,
  signal: AbortSignal,
) {
  const source = await loadSource(mode, filters.workspace_id, signal);
  return deriveSnapshot(source, mode, filters);
}

export async function submitReview(mode: DataMode, raw: CommentReviewInput) {
  const input = CommentReviewInputSchema.parse(raw);
  if (mode === "live") {
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

export async function submitTopicReview(mode: DataMode, raw: TopicReviewInput) {
  const input = TopicReviewInputSchema.parse(raw);
  if (mode === "live") {
    // As submit_comment_review: a verdict and the hash it was formed against,
    // never an identity — the RPC takes the reviewer from the session.
    const { error } = await supabase!.rpc("submit_topic_review", {
      w: input.workspace_id,
      c: input.comment_id,
      seen_hash: input.content_hash,
      topic: input.topic_key,
      why: input.reason,
    });
    if (error) throw new Error("review_rejected");
    return;
  }
  const fixture = await readFixture();
  // Validated against the current fixture, so a stale hash is refused here
  // rather than on the next reload.
  applyTopicReview(
    withSessionReviews(fixture.comments),
    input,
    new Date().toISOString(),
    fixtureReviewer,
  );
  sessionTopicReviews.push({ input, at: new Date().toISOString() });
}

/**
 * Builds the export from the filters currently on screen, through the same
 * shared row selection the dashboard uses. In fixture mode the file is produced
 * in the browser; a real export is a background job writing to the private
 * bucket, which is why the name already carries the workspace prefix the
 * storage policy checks.
 */
export async function buildExport(mode: DataMode, filters: Filters) {
  const source = await loadSource(mode, filters.workspace_id);
  const rows = exportRows(
    source.comments,
    filters,
    source.active_analysis_key,
    source.active_topic_key,
  );
  return {
    rows: rows.length,
    filename: exportObjectPath(filters.workspace_id, new Date())
      .split("/")
      .pop()!,
    csv: toCsv(rows),
  };
}

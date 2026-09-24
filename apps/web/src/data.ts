import {
  CommentReviewInputSchema,
  FixtureSchema,
  LiveSnapshotSchema,
  PlanCatalogueSchema,
  TopicReviewInputSchema,
  OpsSnapshotSchema,
  DashboardAggregatesSchema,
  DashboardCommentsResponseSchema,
  type OpsSnapshot,
  type DashboardAggregates,
  type DashboardCommentsResponse,
  applyReview,
  applyTopicReview,
  exportRows,
  snapshot,
  toCsv,
  effectiveLabel,
  effectiveTopic,
  exportObjectPath,
  type Comment,
  type CommentReviewInput,
  type Filters,
  type TopicReviewInput,
  type LabelledComment,
  type Label,
  type SourcePlatform,
  type ContentKind,
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

export const adminFixtureCatalogue = PlanCatalogueSchema.parse([
  ...fixtureCatalogue,
  {
    key: "owner",
    segment: "internal",
    title_ar: "المالك",
    title_en: "Owner",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: false,
    provider_prices: {},
    allow_public_channels: true,
    limits: limits(-1, -1, 10000, -1, -1, -1, 0),
  },
  {
    key: "pilot",
    segment: "internal",
    title_ar: "شريك مؤسِّس",
    title_en: "Founding Partner",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: false,
    provider_prices: {},
    allow_public_channels: false,
    limits: limits(5000, 20000, 10, 3, 5, 1, 0),
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
 * Executes a Supabase RPC call with proactive session verification and automatic
 * refresh-and-retry on auth/permission errors (42501 / PGRST301 / expired token).
 */
async function callRpcWithAuthRetry<T>(
  rpcName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("live_unavailable");

  // Proactively check if the access token has expired or is expiring in < 15s.
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 15000) {
      await supabase.auth.refreshSession();
    }
  } catch {
    // Non-blocking; proceed to attempt RPC
  }

  let { data, error } = await supabase.rpc(rpcName, args);

  // If PostgREST returned forbidden or expired token, refresh session and retry once.
  if (
    error &&
    (error.code === "42501" ||
      error.code === "PGRST301" ||
      error.message?.includes("JWT") ||
      error.message?.includes("token") ||
      error.message?.includes("expired"))
  ) {
    try {
      const { data: refreshData, error: refreshError } =
        await supabase.auth.refreshSession();
      if (!refreshError && refreshData.session) {
        const retryResult = await supabase.rpc(rpcName, args);
        data = retryResult.data;
        error = retryResult.error;
      }
    } catch {
      // Continue to error handling
    }
  }

  if (error) {
    console.error(`[RPC ${rpcName}] error:`, error);
    throw new Error("live_unavailable");
  }

  return data as T;
}

/**
 * The live read. Parsed with the schema that shares its field definitions with
 * the fixture, so a server that answers with a different shape is refused here
 * rather than rendered as a half-populated dashboard.
 */
async function readLive(workspace: string) {
  const data = await callRpcWithAuthRetry<unknown>("dashboard_snapshot", {
    w: workspace,
  });
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

async function readOpsLive(workspace: string): Promise<OpsSnapshot> {
  const data = await callRpcWithAuthRetry<unknown>("workspace_ops_snapshot", {
    w: workspace,
  });
  return OpsSnapshotSchema.parse(data);
}

export const loadWorkspaceOps = readOpsLive;

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
      active_analysis_key: source.active_analysis_key,
      active_topic_key: source.active_topic_key,
      cursor_reset,
      kpis: {
        total_views: null,
        total_likes: null,
        total_comments: base.total,
        engagement_rate: null,
        net_sentiment:
          base.sentiments.positive + base.sentiments.negative > 0
            ? Math.round(
                ((base.sentiments.positive - base.sentiments.negative) /
                  (base.sentiments.positive + base.sentiments.negative)) *
                  1000,
              ) / 10
            : null,
      } as {
        total_views?: number | null;
        total_likes?: number | null;
        total_comments?: number | null;
        engagement_rate?: number | null;
        net_sentiment?: number | null;
      } | null,
      channel: {
        id: comments[0]?.channel_id ?? "ch_fixture",
        title: "قناة تجريبية",
        avatar_url: null,
        subscriber_count: null,
        view_count: null,
        video_count: null,
      } as {
        id?: string;
        title?: string | null;
        avatar_url?: string | null;
        subscriber_count?: number | null;
        view_count?: number | null;
        video_count?: number | null;
      } | null,
      people: Array.from(
        comments
          .filter((c) => !c.by_channel_owner && c.author_name)
          .reduce((acc, c) => {
            const author = c.author_name!;
            const existing = acc.get(author);
            if (!existing) {
              acc.set(author, {
                name: author,
                channel_id: c.author_channel_id,
                avatar_url: c.author_profile_image_url ?? null,
                channel_url: c.author_channel_url ?? null,
                comments_count: 1,
                likes_count: c.likes_value ?? 0,
              });
            } else {
              existing.comments_count++;
              existing.likes_count += c.likes_value ?? 0;
              if (!existing.avatar_url && c.author_profile_image_url) {
                existing.avatar_url = c.author_profile_image_url;
              }
            }
            return acc;
          }, new Map<string, { name: string; channel_id: string | null; avatar_url: string | null; channel_url: string | null; comments_count: number; likes_count: number }>())
          .values(),
      )
        .sort((a, b) => b.comments_count - a.comments_count)
        .slice(0, 10),
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
    // As submit_review_job in the worker, but through the authed RPC: a verdict
    // and the hash it was formed against, never an identity — the RPC takes
    // the reviewer from the session.
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

export interface RawCommentLike {
  id: string;
  workspace_id?: string;
  client_id?: string;
  channel_id?: string;
  video_id?: string | null;
  video_title?: string | null;
  platform?: SourcePlatform;
  video_kind?: ContentKind;
  author_channel_id?: string | null;
  author_profile_image_url?: string | null;
  author_channel_url?: string | null;
  reply_count?: number;
  updated_at?: string | null;
  by_channel_owner?: boolean;
  author_name?: string | null;
  text_raw?: string | null;
  content_hash?: string;
  likes_raw?: string | null;
  likes_value?: number | null;
  published_at?: string | null;
  published_time_raw?: string | null;
  timestamp_precision?: "second" | "minute" | "day" | "approximate" | "unknown";
  is_reply?: boolean;
  parent_comment_id?: string | null;
  parent_source?: "api" | "extractor" | "inferred_id" | "unknown";
  source?: string | null;
  field_provenance?: Record<string, unknown>;
  comment_type?: string | null;
  content_purged_at?: string | null;
  label?: string | null;
  topic?: string | null;
  model_name?: string | null;
  model_version?: string | null;
  prediction?: Comment["prediction"];
  topic_prediction?: Comment["topic_prediction"];
  reviews?: Comment["reviews"];
  topic_reviews?: Comment["topic_reviews"];
}

export function toLabelledComment(
  comment: RawCommentLike,
  activeKey: string,
  activeTopicKey: string,
): LabelledComment {
  const contentHash = comment.content_hash ?? comment.id;
  const validLabels: Label[] = ["positive", "negative", "neutral", "mixed"];
  const sentimentLabel: Label | null =
    comment.label && validLabels.includes(comment.label as Label)
      ? (comment.label as Label)
      : null;

  const pred =
    comment.prediction ??
    (sentimentLabel
      ? {
          status: "succeeded" as const,
          label: sentimentLabel,
          content_hash: contentHash,
          analysis_key: activeKey,
          model_id: comment.model_name ?? "server",
          revision: comment.model_version ?? "1.0",
          preprocessing_version: "1.0",
          predicted_at: comment.published_at ?? new Date().toISOString(),
          class_scores: { [sentimentLabel]: 1 },
        }
      : null);

  const topicPred =
    comment.topic_prediction ??
    (comment.topic
      ? {
          status: "succeeded" as const,
          topic_key: comment.topic,
          confidence: 1,
          content_hash: contentHash,
          classification_key: activeTopicKey,
          model_id: "server",
          prompt_version: "1.0",
          predicted_at: comment.published_at ?? new Date().toISOString(),
          error_code: null,
        }
      : null);

  const c: Comment = {
    id: comment.id,
    workspace_id: comment.workspace_id ?? "",
    client_id: comment.client_id ?? "",
    channel_id: comment.channel_id ?? "",
    video_id: comment.video_id ?? "",
    video_title: comment.video_title ?? null,
    platform: comment.platform ?? "youtube",
    video_kind: comment.video_kind ?? "video",
    author_channel_id: comment.author_channel_id ?? null,
    by_channel_owner: comment.by_channel_owner ?? false,
    author_name: comment.author_name ?? null,
    text_raw: comment.text_raw ?? null,
    content_hash: contentHash,
    likes_raw: comment.likes_raw ?? null,
    likes_value: comment.likes_value ?? null,
    published_at: comment.published_at ?? null,
    published_time_raw: comment.published_time_raw ?? null,
    timestamp_precision: comment.timestamp_precision ?? "unknown",
    is_reply: comment.is_reply ?? false,
    parent_comment_id: comment.parent_comment_id ?? null,
    parent_source: comment.parent_source ?? "unknown",
    source: comment.source ?? "youtube_data_api_public",
    field_provenance: comment.field_provenance ?? {},
    comment_type: comment.comment_type ?? null,
    content_purged_at: comment.content_purged_at ?? null,
    prediction: pred,
    reviews: comment.reviews ?? [],
    topic_prediction: topicPred,
    topic_reviews: comment.topic_reviews ?? [],
    author_profile_image_url: comment.author_profile_image_url ?? null,
    author_channel_url: comment.author_channel_url ?? null,
    reply_count: comment.reply_count ?? 0,
    updated_at: comment.updated_at ?? null,
  };
  return {
    ...c,
    ...effectiveLabel(c, activeKey),
    ...effectiveTopic(c, activeTopicKey),
  };
}

export function filtersToRpc(filters?: Partial<Filters>) {
  if (!filters) return {};
  const ranged = filters.date_mode !== "unknown";
  return {
    video:
      filters.video_ids && filters.video_ids.length > 0
        ? filters.video_ids[0]
        : undefined,
    video_kind: filters.video_kind ?? undefined,
    sentiment:
      filters.sentiments && filters.sentiments.length > 0
        ? filters.sentiments[0]
        : undefined,
    topic:
      filters.topics && filters.topics.length > 0
        ? filters.topics[0]
        : undefined,
    replies: filters.replies ?? "all",
    comment_type: filters.comment_type ?? undefined,
    review_status: filters.review_status ?? "all",
    from: ranged && filters.from ? filters.from : undefined,
    to: ranged && filters.to ? filters.to : undefined,
    q: filters.q ? filters.q.trim() : undefined,
  };
}

export async function loadDashboardAggregates(
  mode: DataMode,
  workspace: string,
  filters?: Partial<Filters>,
  signal?: AbortSignal,
): Promise<DashboardAggregates> {
  if (mode === "live") {
    const f = filtersToRpc(filters);
    const data = await callRpcWithAuthRetry<unknown>("dashboard_aggregates", {
      w: workspace,
      f,
    });
    return DashboardAggregatesSchema.parse(data);
  }

  const fixture = await readFixture(signal);
  const comments = withSessionReviews(fixture.comments);
  const fFull: Filters = {
    workspace_id: workspace,
    video_ids: filters?.video_ids ?? [],
    video_kind: filters?.video_kind,
    sentiments: filters?.sentiments ?? [],
    topics: filters?.topics ?? [],
    replies: filters?.replies ?? "all",
    comment_type: filters?.comment_type,
    review_status: filters?.review_status ?? "all",
    date_mode: filters?.date_mode ?? "all",
    from: filters?.from,
    to: filters?.to,
    q: filters?.q ?? "",
    limit: 100,
  };
  const snap = snapshot(
    comments,
    fFull,
    fixture.active_analysis_key,
    fixture.active_analysis_labels,
    fixture.active_topic_key,
  );

  return {
    workspace_total: snap.workspace_total,
    channel_own_comments: snap.channel_own_comments,
    total: snap.total,
    analysed: snap.analysed,
    unanalysed: snap.unanalysed,
    sentiments: snap.sentiments,
    kpis: snap.kpis ?? {
      total_views: null,
      total_likes: comments.reduce((sum, c) => sum + (c.likes_value ?? 0), 0),
      total_comments: snap.total,
      engagement_rate: null,
      net_sentiment:
        snap.sentiments.positive + snap.sentiments.negative > 0
          ? Math.round(
              ((snap.sentiments.positive - snap.sentiments.negative) /
                (snap.sentiments.positive + snap.sentiments.negative)) *
                1000,
            ) / 10
          : null,
    },
    channel: {
      id: fixture.comments[0]?.channel_id ?? "ch_fixture",
      title: "قناة تجريبية",
      avatar_url: null,
      subscriber_count: null,
      view_count: null,
      video_count: null,
    },
    measurable: Array.from(snap.measurable),
    negative_ranked: snap.negative_ranked,
    negative_unranked: snap.negative_unranked,
    timeline: Object.fromEntries(snap.timeline.map((t) => [t.date, t.total])),
    topic_counts: snap.topic_counts,
    platform_breakdown: snap.platform_breakdown,
    videos: snap.videos,
    hours: [],
    weekdays: [],
    weeks: [],
    people: Array.from(
      comments
        .filter((c) => !c.by_channel_owner && c.author_name)
        .reduce((acc, c) => {
          const author = c.author_name!;
          const existing = acc.get(author);
          if (!existing) {
            acc.set(author, {
              name: author,
              channel_id: c.author_channel_id,
              avatar_url: c.author_profile_image_url ?? null,
              channel_url: c.author_channel_url ?? null,
              comments_count: 1,
              likes_count: c.likes_value ?? 0,
            });
          } else {
            existing.comments_count++;
            existing.likes_count += c.likes_value ?? 0;
            if (!existing.avatar_url && c.author_profile_image_url) {
              existing.avatar_url = c.author_profile_image_url;
            }
          }
          return acc;
        }, new Map<string, { name: string; channel_id: string | null; avatar_url: string | null; channel_url: string | null; comments_count: number; likes_count: number }>())
        .values(),
    )
      .sort((a, b) => b.comments_count - a.comments_count)
      .slice(0, 10),
    most_engaged_negative: snap.most_engaged_negative.map((c) => ({
      id: c.id,
      video_id: c.video_id,
      video_title: c.video_title,
      text_raw: c.text_raw ?? "",
      author_name: c.author_name,
      author_profile_image_url: c.author_profile_image_url ?? null,
      published_at: c.published_at,
      likes_value: c.likes_value,
      label: c.label,
      topic: c.topic,
    })),
    comment_types: snap.comment_types,
    video_options: snap.video_options,
    topics: fixture.topics,
    active_analysis_key: fixture.active_analysis_key,
    active_topic_key: fixture.active_topic_key,
    revision: fixture.revision,
  };
}

export interface CommentsQueryParams {
  limit?: number;
  offset?: number;
  sort?: "published_desc" | "published_asc" | "likes_desc" | "likes_asc";
  card_tab?: "all" | "critical" | "recent" | "liked";
  q?: string;
  video?: string | null;
  video_kind?: string | null;
  sentiment?: string | null;
  topic?: string | null;
  replies?: string | null;
  comment_type?: string | null;
  review_status?: string | null;
  from?: string | null;
  to?: string | null;
}

export async function loadDashboardComments(
  mode: DataMode,
  workspace: string,
  params: CommentsQueryParams,
  signal?: AbortSignal,
): Promise<DashboardCommentsResponse> {
  if (mode === "live") {
    const data = await callRpcWithAuthRetry<unknown>("dashboard_comments", {
      w: workspace,
      f: params,
    });
    return DashboardCommentsResponseSchema.parse(data);
  }

  const fixture = await readFixture(signal);
  let rows = withSessionReviews(fixture.comments).filter(
    (c) => c.workspace_id === workspace && !c.by_channel_owner,
  );
  if (params.video) rows = rows.filter((c) => c.video_id === params.video);
  if (params.video_kind)
    rows = rows.filter((c) => c.video_kind === params.video_kind);
  if (params.q) {
    const qLower = params.q.toLowerCase();
    rows = rows.filter(
      (c) =>
        (c.text_raw && c.text_raw.toLowerCase().includes(qLower)) ||
        (c.author_name && c.author_name.toLowerCase().includes(qLower)),
    );
  }
  const labelled = rows.map((c) =>
    toLabelledComment(c, fixture.active_analysis_key, fixture.active_topic_key),
  );
  let filtered = labelled;
  if (params.sentiment) {
    filtered = filtered.filter((c) => c.label === params.sentiment);
  }
  if (params.topic) {
    filtered = filtered.filter(
      (c) => (c.topic ?? "__unclassified") === params.topic,
    );
  }
  if (params.comment_type) {
    filtered = filtered.filter((c) => c.comment_type === params.comment_type);
  }
  if (params.replies === "comments")
    filtered = filtered.filter((c) => !c.is_reply);
  if (params.replies === "replies")
    filtered = filtered.filter((c) => c.is_reply);
  if (params.review_status === "reviewed")
    filtered = filtered.filter((c) => c.reviewed);
  if (params.review_status === "unreviewed")
    filtered = filtered.filter((c) => !c.reviewed);

  if (params.card_tab === "critical") {
    filtered = filtered
      .filter((c) => c.label === "negative")
      .sort((a, b) => (b.likes_value ?? -1) - (a.likes_value ?? -1));
  } else if (params.card_tab === "recent" || params.sort === "published_desc") {
    filtered = filtered.sort((a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );
  } else if (params.card_tab === "liked" || params.sort === "likes_desc") {
    filtered = filtered.sort(
      (a, b) => (b.likes_value ?? -1) - (a.likes_value ?? -1),
    );
  }

  const offset = params.offset ?? 0;
  const limit = params.limit ?? 25;
  const slice = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < filtered.length;

  return {
    total: filtered.length,
    comments: slice,
    limit,
    offset,
    has_more: hasMore,
    next_cursor:
      hasMore && slice.length > 0 ? slice[slice.length - 1].id : null,
  };
}

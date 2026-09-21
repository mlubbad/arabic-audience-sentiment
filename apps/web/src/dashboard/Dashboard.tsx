import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import "../pages.css";
import {
  byHour,
  byWeek,
  byWeekday,
  commenters,
  hoursToBucketed,
  weekdaysToBucketed,
  weeksToBucketed,
  peopleToCommenters,
} from "../analytics";
import { pageSlice } from "../videoPaging";
import {
  type Filters,
  type Label,
  type LabelledComment,
} from "@sentiment/contracts";
import {
  buildExport,
  type DataMode,
  deriveSnapshot,
  fixtureWorkspace,
  loadSource,
  loadDashboardAggregates,
  loadDashboardComments,
  filtersToRpc,
  toLabelledComment,
  reviewsArePersisted,
  configuredMode,
  resolveMode,
  submitReview,
  submitTopicReview,
} from "../data";
import { failureCode } from "../failure";
import { useSession, useWorkspaces } from "../session";
import { useWorkspaceSelection } from "../workspaceSelection";
import { WorkspaceGate } from "../WorkspaceGate";
import { workspaceState, readableWorkspace } from "../workspace";
import { useLocale } from "../locale";
import { useStrings } from "../strings";
import { describeSource } from "../dataSource";
import { useChannelStatus } from "../channelStatus";
import { latestJobFromSync, setupProgress } from "../setup";
import { SetupPath } from "../SetupPath";
import { n } from "./format";
import { FilterBar } from "./FilterBar";
import { ActiveFilters } from "./ActiveFilters";
import { Hero } from "./Hero";
import { SectionNav, useActiveSection } from "./SectionNav";
import { Provenance } from "./Provenance";
import { Summary } from "./Summary";
import { Videos } from "./Videos";
import { Voice } from "./Voice";
import { Timing } from "./Timing";
import { People } from "./People";
import { Compare } from "./Compare";
import { Engaged } from "./Engaged";
import { Comments } from "./Comments";
import { ReviewDialog } from "./ReviewDialog";
import {
  EmptyState,
  Loading,
  LoadError,
  Updating,
} from "../pageStates/PageStates";
import {
  chipsFor,
  EMPTY_FILTERS,
  type Chip,
  type FilterValues,
} from "./filters";
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
);

/** Video cards per page of the videos section. The same size as the comments
 *  pager's default, so the two lists turn at the same rhythm. */
const VIDEOS_PER_PAGE = 25;

const defaults: Filters = { workspace_id: fixtureWorkspace };
export type Snapshot = ReturnType<typeof deriveSnapshot>;
export function Dashboard() {
  // Who is asking decides what this page is. A signed-in owner reads their own
  // channel; everyone else gets the sanitized demo at the same URL, clearly
  // labelled as one. Neither audience is served by a build-time flag.
  const { session, loading: sessionLoading } = useSession();
  const {
    workspaces,
    loading: workspacesLoading,
    failed: workspacesFailed,
  } = useWorkspaces(session);
  // One selection for the whole product. This was `useState(null)` here
  // and again in the other page; both routes are lazy, so the answer died
  // on every navigation and the question came back.
  const [chosen, setChosen] = useWorkspaceSelection(session?.user.id ?? null, {
    route: true,
  });
  const S = useStrings();
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  const live = readableWorkspace(place);
  const mode = resolveMode({ signedIn: !!session, workspace: live });
  // In fixture mode the id is the fixture's, never a real one left over from a
  // previous render: a correction addressed to the wrong pair is exactly what
  // the old build-time constant existed to prevent.
  const workspaceId = mode === "live" && live ? live : fixtureWorkspace;
  const userId = session?.user.id ?? "visitor";
  // A new identity remounts the whole report, including any open review dialog.
  // No comment or pending correction from a previous tenant survives the switch.
  return (
    <WorkspaceGate
      sessionLoading={sessionLoading}
      live={configuredMode === "live" && !!session}
      workspacesLoading={workspacesLoading}
      workspacesFailed={workspacesFailed}
      place={place}
      chosen={chosen}
      onChoose={setChosen}
      words={{
        eyebrow: S.gateOverviewEyebrow,
        chooseTitle: S.gateOverviewTitle,
        chooseLead: S.gateOverviewLead,
        chooseTestId: "ws-choose",
      }}
    >
      {/* Switching workspaces is the rail's, on every screen (RailState.tsx).
          The select that used to sit here was one of two — the operations
          page had its own — for one control. */}
      <DashboardBody
        key={`${userId}:${mode}:${workspaceId}`}
        userId={userId}
        mode={mode}
        workspaceId={workspaceId}
        workspaceName={place.kind === "ready" ? place.name : null}
      />
    </WorkspaceGate>
  );
}

function DashboardBody({
  userId,
  mode,
  workspaceId,
  workspaceName,
}: {
  userId: string;
  mode: DataMode;
  workspaceId: string;
  workspaceName: string | null;
}) {
  const S = useStrings();
  const lang = useLocale();
  const labels = S.labels;
  const [filters, setFilters] = useState<Filters>(defaults),
    [query, setQuery] = useState(""),
    [video, setVideo] = useState(""),
    [sentiment, setSentiment] = useState(""),
    [topic, setTopic] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [formError, setFormError] = useState("");
  const [replies, setReplies] = useState<"all" | "comments" | "replies">("all");
  const [dateMode, setDateMode] = useState<"all" | "known" | "unknown">("all");
  const [videoKind, setVideoKind] = useState("");
  const [platform, setPlatform] = useState("");
  const [commentType, setCommentType] = useState("");
  const [reviewStatus, setReviewStatus] = useState<
    "all" | "reviewed" | "unreviewed"
  >("all");
  // cursors[i] opens page i + 2, so the stack length is the current page index.
  // Applying, resetting or resizing clears it, because a cursor is only valid
  // for the filtered set it was produced from.
  const [cursors, setCursors] = useState<string[]>([]);
  const [limit, setLimit] = useState(25);
  const [cardTab, setCardTab] = useState<"liked" | "recent" | "critical">(
    "liked",
  );
  // The videos section's own page, 0-based. It is a slice of a list already
  // in memory, not a cursor, so it is not part of `page` below and does not
  // reach the read. Cleared with the cursors: a page into a filtered list is
  // only meaningful for the list it was turned in.
  const [videoPage, setVideoPage] = useState(0);
  const page = {
    ...filters,
    workspace_id: workspaceId,
    limit,
    cursor: cursors.at(-1),
  };
  // Keyed on exactly what the read depends on, and on nothing else.
  //
  // In fixture mode (and unit tests where shared cache provides the source),
  // loadSource provides the full fixture dataset. In live mode, read is disabled
  // in favour of decoupled RPC aggregations and paginated comment stream.
  const read = useQuery({
    queryKey: ["dashboard-source", userId, mode, workspaceId],
    queryFn: ({ signal }) => loadSource(mode, workspaceId, signal),
    enabled: mode !== "live",
  });

  const filterParamsKey = useMemo(
    () => JSON.stringify(filtersToRpc(page)),
    [page],
  );
  const aggregatesQuery = useQuery({
    queryKey: [
      "dashboard-aggregates",
      userId,
      mode,
      workspaceId,
      filterParamsKey,
    ],
    queryFn: ({ signal }) =>
      loadDashboardAggregates(mode, workspaceId, page, signal),
    enabled: mode === "live" && !read.data,
  });

  const pageOffset = cursors.length * limit;
  const commentsParamsKey = useMemo(
    () =>
      JSON.stringify({
        ...filtersToRpc(page),
        offset: pageOffset,
        limit,
      }),
    [page, pageOffset, limit],
  );
  const commentsQuery = useQuery({
    queryKey: [
      "dashboard-comments",
      userId,
      mode,
      workspaceId,
      commentsParamsKey,
    ],
    queryFn: ({ signal }) =>
      loadDashboardComments(
        mode,
        workspaceId,
        {
          ...filtersToRpc(page),
          offset: pageOffset,
          limit,
        },
        signal,
      ),
    enabled: mode === "live" && !read.data,
  });

  const cardsParamsKey = useMemo(
    () =>
      JSON.stringify({
        ...filtersToRpc(page),
        card_tab: cardTab,
        limit: 12,
      }),
    [page, cardTab],
  );
  const cardsQuery = useQuery({
    queryKey: ["dashboard-cards", userId, mode, workspaceId, cardsParamsKey],
    queryFn: ({ signal }) =>
      loadDashboardComments(
        mode,
        workspaceId,
        {
          ...filtersToRpc(page),
          card_tab: cardTab,
          limit: 12,
          offset: 0,
        },
        signal,
      ),
    enabled: mode === "live" && !read.data,
  });

  // For the empty state's setup path only; live only, and cheap.
  const channel = useChannelStatus(mode, workspaceId);
  // Filters are a pure function of a read, so they are computed rather than
  // fetched. Serialised, because `page` is a fresh object every render and
  // depending on its identity would recompute the whole snapshot each time.
  const pageKey = JSON.stringify(page);
  const derived = useMemo(() => {
    if (!read.data) return null;
    try {
      return {
        ok: true as const,
        value: deriveSnapshot(read.data, mode, page),
      };
    } catch (error) {
      // A derivation that throws is a bug in the filters, not a lost read, and
      // it must not take the page down with it: there is no error boundary
      // above this, so an uncaught throw here is a blank screen rather than a
      // notice with a way out.
      return { ok: false as const, error: error as Error };
    }
  }, [read.data, mode, pageKey]);

  const isLiveServer = mode === "live" && !read.data;

  const liveSnapshot = useMemo(() => {
    if (
      !isLiveServer ||
      !aggregatesQuery.data ||
      !aggregatesQuery.data.timeline
    )
      return null;
    const agg = aggregatesQuery.data;
    const commentsRes = commentsQuery.data;
    const commentsList = (commentsRes?.comments ?? []).map((c) =>
      toLabelledComment(
        c,
        agg.active_analysis_key ?? "",
        agg.active_topic_key ?? "",
      ),
    );
    const totalCount = agg.total;
    const offset = pageOffset;
    const hasMore = commentsRes
      ? commentsRes.has_more
      : offset + limit < totalCount;
    const nextCursor = hasMore
      ? (commentsRes?.next_cursor ?? String(cursors.length + 1))
      : null;

    const rawMeasurable = (agg.measurable ?? []) as Label[];
    // A model cannot measure a class it lacks (see migration 20260914120000).
    // If the active model does not support mixed (e.g. CAMeLBERT-DA is 3-class)
    // or if mixed is omitted from measurable, ensure mixed is not treated as measurable.
    const isThreeClass =
      Boolean(
        agg.active_analysis_key &&
          agg.active_analysis_key.toLowerCase().includes("camelbert"),
      ) || !rawMeasurable.includes("mixed");
    const measurableLabels = isThreeClass
      ? rawMeasurable.filter((l) => l !== "mixed")
      : rawMeasurable;

    return {
      workspace_total: agg.workspace_total,
      channel_own_comments: agg.channel_own_comments,
      total: agg.total,
      analysed: agg.analysed,
      unanalysed: agg.unanalysed,
      sentiments: agg.sentiments,
      measurable: new Set(measurableLabels),
      negative_ranked: agg.negative_ranked ?? 0,
      negative_unranked: agg.negative_unranked ?? 0,
      timeline: Object.entries(agg.timeline ?? {})
        .map(([date, total]) => ({ date, total }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      topic_counts: agg.topic_counts ?? {},
      platform_breakdown: agg.platform_breakdown ?? {},
      videos: agg.videos ?? [],
      hours: agg.hours ?? [],
      weekdays: agg.weekdays ?? [],
      weeks: agg.weeks ?? [],
      people: agg.people ?? [],
      most_engaged_negative: (agg.most_engaged_negative ?? []).map((c) =>
        toLabelledComment(
          c,
          agg.active_analysis_key ?? "",
          agg.active_topic_key ?? "",
        ),
      ),
      comment_types: agg.comment_types ?? [],
      video_options: agg.video_options ?? [],
      topics: agg.topics ?? [],
      active_analysis_key: agg.active_analysis_key ?? "",
      active_topic_key: agg.active_topic_key ?? "",
      revision: agg.revision ?? "",
      mode,
      plan: null,
      sync: null,
      comments: commentsList,
      filtered: commentsList,
      next_cursor: nextCursor,
      cursor_reset: false,
      replies: 0,
      unknown_dates: 0,
      unique_authors: 0,
      comparison: (agg.videos ?? []).slice(0, 10),
      comparison_truncated: (agg.videos ?? []).length > 10,
    } as Snapshot;
  }, [
    isLiveServer,
    aggregatesQuery.data,
    commentsQuery.data,
    mode,
    read.data,
    pageOffset,
    limit,
    cursors.length,
  ]);

  const result = {
    data: isLiveServer
      ? (liveSnapshot ?? undefined)
      : derived?.ok
        ? derived.value
        : undefined,
    isPending: isLiveServer ? aggregatesQuery.isPending : read.isPending,
    isFetching: isLiveServer
      ? aggregatesQuery.isFetching || commentsQuery.isFetching
      : read.isFetching,
    isError: isLiveServer
      ? aggregatesQuery.isError || commentsQuery.isError
      : read.isError || derived?.ok === false,
    refetch: () => {
      if (isLiveServer) {
        aggregatesQuery.refetch();
        commentsQuery.refetch();
        cardsQuery.refetch();
      } else {
        read.refetch();
      }
    },
    failure: isLiveServer
      ? aggregatesQuery.isError
        ? failureCode("read", aggregatesQuery.error)
        : commentsQuery.isError
          ? failureCode("read", commentsQuery.error)
          : null
      : read.isError
        ? failureCode("read", read.error)
        : derived?.ok === false
          ? failureCode("view", derived.error)
          : null,
  };
  // A topic is stored by key and shown by name, in the reader's language. The
  // key is the fallback so a retired or unknown key is still visible as itself
  // rather than as nothing.
  const topicName = (key: string) =>
    result.data?.topics?.find((t) => t.key === key)?.[
      lang === "ar" ? "name_ar" : "name_en"
    ] ?? key;
  // Sticky, because recovery re-requests page one and that response no longer
  // carries the reset flag. The user should still be told why the page moved.
  const [cursorNotice, setCursorNotice] = useState(false);
  const resetCursor = result.data?.cursor_reset === true && cursors.length > 0;
  useEffect(() => {
    // The data layer already fell back to page one; bring the stack with it.
    if (!resetCursor) return;
    setCursors([]);
    setCursorNotice(true);
  }, [resetCursor]);
  function goTo(next: string[]) {
    setCursorNotice(false);
    setCursors(next);
  }
  const client = useQueryClient();
  const [reviewing, setReviewing] = useState<LabelledComment | null>(null);
  const [verdict, setVerdict] = useState<Label>("neutral");
  // One form, two kinds of correction. The kind decides which select is
  // shown, which mutation the submit goes to, and which history leads.
  const [reviewKind, setReviewKind] = useState<"sentiment" | "topic">(
    "sentiment",
  );
  const [topicVerdict, setTopicVerdict] = useState("");
  // Which button asked, so `ReviewDialog`'s `onCloseAutoFocus` can hand focus
  // back to it — see that file's comment for why the focus call has to live
  // there rather than here.
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  function closeReview() {
    setReviewing(null);
  }
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: () =>
      submitReview(mode, {
        workspace_id: workspaceId,
        comment_id: reviewing!.id,
        content_hash: reviewing!.content_hash,
        label: verdict,
        reason,
      }),
    onSuccess: async () => {
      // Re-read through the same snapshot path so the corrected label, the
      // sentiment denominator and the review filter all move together. Keep
      // the form open until the refreshed read is ready: closing it first
      // allowed an immediate reopen to show the old review history.
      await Promise.all([
        client.invalidateQueries({ queryKey: ["dashboard-source"] }),
        client.invalidateQueries({ queryKey: ["dashboard-aggregates"] }),
        client.invalidateQueries({ queryKey: ["dashboard-comments"] }),
        client.invalidateQueries({ queryKey: ["dashboard-cards"] }),
      ]);
      closeReview();
      setReason("");
    },
  });
  const topicReview = useMutation({
    mutationFn: () =>
      submitTopicReview(mode, {
        workspace_id: workspaceId,
        comment_id: reviewing!.id,
        content_hash: reviewing!.content_hash,
        topic_key: topicVerdict,
        reason,
      }),
    onSuccess: async () => {
      // The same re-read as a sentiment correction, for the same reason: the
      // chip, the topic chart and the topic filter must move together.
      await Promise.all([
        client.invalidateQueries({ queryKey: ["dashboard-source"] }),
        client.invalidateQueries({ queryKey: ["dashboard-aggregates"] }),
        client.invalidateQueries({ queryKey: ["dashboard-comments"] }),
        client.invalidateQueries({ queryKey: ["dashboard-cards"] }),
      ]);
      closeReview();
      setReason("");
    },
  });
  const exporting = useMutation({
    mutationFn: () => buildExport(mode, page),
    onSuccess: ({ csv, filename }) => {
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  function startReview(c: LabelledComment, trigger: HTMLButtonElement) {
    reviewTriggerRef.current = trigger;
    review.reset();
    setReason("");
    setReviewKind("sentiment");
    setVerdict(c.label ?? "neutral");
    setReviewing(c);
  }
  function startTopicReview(c: LabelledComment, trigger: HTMLButtonElement) {
    reviewTriggerRef.current = trigger;
    topicReview.reset();
    setReason("");
    setReviewKind("topic");
    // Preselect the current topic, or the first live one when there is none:
    // a select with no value would submit an empty key and be refused.
    setTopicVerdict(
      c.topic ?? result.data?.topics.find((t) => !t.retired)?.key ?? "",
    );
    setReviewing(c);
  }
  /**
   * The filters, from the controls, in one place.
   *
   * There used to be two of these. The form built `video_ids`, which is the
   * field the contract defines; the video cards in the comparison section
   * built `video_id`, which is not a field at all. `FiltersSchema` is strict,
   * so clicking a video put an unrecognised key at the root of the filters and
   * the whole report vanished behind an error — while choosing the same video
   * from the dropdown two inches away worked perfectly.
   *
   * The card's own comment said it "goes through the same apply path". It did
   * not; it wrote its own object beside it. So there is one path now, and the
   * card passes what it changed rather than restating everything.
   */
  /**
   * `over` lets a caller that just changed a control pass what it changed,
   * rather than relying on the corresponding `useState` — the same reason
   * the video cards below pass `{ video: next }`: their own `setVideo` has
   * not landed yet when they call this, so reading `video` would apply the
   * previous selection. `ActiveFilters`' chip removal needs the same escape
   * for every other field, which is why every field the chips can clear
   * has one here now, not only `video`.
   */
  function filtersFrom(
    over: {
      video?: string;
      query?: string;
      sentiment?: string;
      topic?: string;
      videoKind?: string;
      platform?: string;
      replies?: "all" | "comments" | "replies";
      commentType?: string;
      reviewStatus?: "all" | "reviewed" | "unreviewed";
      dateMode?: "all" | "known" | "unknown";
      from?: string;
      to?: string;
    } = {},
  ): Filters {
    const chosenVideo = over.video ?? video;
    const chosenQuery = over.query ?? query;
    const chosenSentiment = over.sentiment ?? sentiment;
    const chosenTopic = over.topic ?? topic;
    const chosenVideoKind = over.videoKind ?? videoKind;
    const chosenPlatform = over.platform ?? platform;
    const chosenReplies = over.replies ?? replies;
    const chosenCommentType = over.commentType ?? commentType;
    const chosenReviewStatus = over.reviewStatus ?? reviewStatus;
    const chosenDateMode = over.dateMode ?? dateMode;
    const chosenFrom = over.from ?? from;
    const chosenTo = over.to ?? to;
    // A range describes known dates, so it is not sent when the user has asked
    // for the rows that have no date at all.
    const ranged = chosenDateMode !== "unknown";
    return {
      ...defaults,
      q: chosenQuery,
      video_ids: chosenVideo ? [chosenVideo] : [],
      video_kind: (chosenVideoKind || undefined) as Filters["video_kind"],
      platform: (chosenPlatform || undefined) as Filters["platform"],
      sentiments: chosenSentiment ? [chosenSentiment as Label] : [],
      topics: chosenTopic ? [chosenTopic] : [],
      replies: chosenReplies,
      date_mode: chosenDateMode,
      comment_type: chosenCommentType || undefined,
      review_status: chosenReviewStatus,
      from:
        ranged && chosenFrom
          ? new Date(chosenFrom + "T00:00:00+03:00").toISOString()
          : undefined,
      to:
        ranged && chosenTo
          ? new Date(chosenTo + "T00:00:00+03:00").toISOString()
          : undefined,
    };
  }
  /** Narrowing the report: validate, drop the paging, and set them. */
  function applyFilters(over: Parameters<typeof filtersFrom>[0] = {}) {
    const chosenDateMode = over.dateMode ?? dateMode;
    const chosenFrom = over.from ?? from;
    const chosenTo = over.to ?? to;
    if (
      chosenDateMode !== "unknown" &&
      chosenFrom &&
      chosenTo &&
      chosenFrom >= chosenTo
    ) {
      setFormError(S.dateOrderError);
      return;
    }
    setFormError("");
    setCursorNotice(false);
    setCursors([]);
    setVideoPage(0);
    setFilters(filtersFrom(over));
  }
  function reset() {
    setQuery("");
    setVideo("");
    setSentiment("");
    setTopic("");
    setFrom("");
    setTo("");
    setFormError("");
    setReplies("all");
    setDateMode("all");
    setVideoKind("");
    setPlatform("");
    setCommentType("");
    setReviewStatus("all");
    setCursorNotice(false);
    setCursors([]);
    setVideoPage(0);
    setLimit(25);
    setFilters(defaults);
  }
  // The bar's view over the twelve `useState`s above — a fresh object each
  // render, never itself stored. `onChange` writes patches back to whichever
  // state each key belongs to; `onLimitChange` goes through the same
  // cursor-clearing path the old per-page `<select>` did.
  const values: FilterValues = {
    query,
    video,
    sentiment,
    topic,
    videoKind,
    platform,
    replies,
    commentType,
    reviewStatus,
    dateMode,
    from,
    to,
    limit,
  };
  function onChange(p: Partial<FilterValues>) {
    if ("query" in p) setQuery(p.query!);
    if ("video" in p) setVideo(p.video!);
    if ("sentiment" in p) setSentiment(p.sentiment!);
    if ("topic" in p) setTopic(p.topic!);
    if ("videoKind" in p) setVideoKind(p.videoKind!);
    if ("platform" in p) setPlatform(p.platform!);
    if ("replies" in p) setReplies(p.replies!);
    if ("commentType" in p) setCommentType(p.commentType!);
    if ("reviewStatus" in p) setReviewStatus(p.reviewStatus!);
    if ("dateMode" in p) setDateMode(p.dateMode!);
    if ("from" in p) setFrom(p.from!);
    if ("to" in p) setTo(p.to!);
  }
  function onLimitChange(next: number) {
    goTo([]);
    setLimit(next);
  }
  /**
   * A chip is the applied state itself, not a draft of it — so clearing one
   * applies immediately, unlike the bar's own apply button. The cleared
   * value is passed to `applyFilters` as an override rather than relied on
   * from the state just set above: the same reason the video cards pass
   * `{ video: next }` (see `filtersFrom`'s comment) — the `setX` call has
   * not landed yet when `applyFilters` runs here.
   */
  function onClear(key: Chip["key"]) {
    switch (key) {
      case "query":
        setQuery(EMPTY_FILTERS.query);
        applyFilters({ query: EMPTY_FILTERS.query });
        break;
      case "video":
        setVideo(EMPTY_FILTERS.video);
        applyFilters({ video: EMPTY_FILTERS.video });
        break;
      case "sentiment":
        setSentiment(EMPTY_FILTERS.sentiment);
        applyFilters({ sentiment: EMPTY_FILTERS.sentiment });
        break;
      case "topic":
        setTopic(EMPTY_FILTERS.topic);
        applyFilters({ topic: EMPTY_FILTERS.topic });
        break;
      case "videoKind":
        setVideoKind(EMPTY_FILTERS.videoKind);
        applyFilters({ videoKind: EMPTY_FILTERS.videoKind });
        break;
      case "platform":
        setPlatform(EMPTY_FILTERS.platform);
        applyFilters({ platform: EMPTY_FILTERS.platform });
        break;
      case "commentType":
        setCommentType(EMPTY_FILTERS.commentType);
        applyFilters({ commentType: EMPTY_FILTERS.commentType });
        break;
      case "replies":
        setReplies(EMPTY_FILTERS.replies);
        applyFilters({ replies: EMPTY_FILTERS.replies });
        break;
      case "reviewStatus":
        setReviewStatus(EMPTY_FILTERS.reviewStatus);
        applyFilters({ reviewStatus: EMPTY_FILTERS.reviewStatus });
        break;
      case "dateMode":
        setDateMode(EMPTY_FILTERS.dateMode);
        applyFilters({ dateMode: EMPTY_FILTERS.dateMode });
        break;
      case "period":
        setFrom(EMPTY_FILTERS.from);
        setTo(EMPTY_FILTERS.to);
        applyFilters({ from: EMPTY_FILTERS.from, to: EMPTY_FILTERS.to });
        break;
    }
  }
  const chips = chipsFor(values, { S, labels, topicName });
  const s = result.data;

  useEffect(() => {
    if (sentiment && s?.measurable && !s.measurable.has(sentiment as Label)) {
      setSentiment(EMPTY_FILTERS.sentiment);
      applyFilters({ sentiment: EMPTY_FILTERS.sentiment });
    }
  }, [sentiment, s?.measurable]);

  // The pinned bar's height as `db-sticky-bar` measures it (FilterBar + SectionNav).
  // Zero until the first measurement lands.
  const [pinnedHeight, setPinnedHeight] = useState(0);
  const active = useActiveSection(!!s && s.total > 0, pinnedHeight);
  const stickyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stickyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      root.style.setProperty("--db-pinned-h", `${Math.round(h)}px`);
      setPinnedHeight(h);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--db-pinned-h");
    };
  }, []);
  // Aggregations for the charts, over every row the filters admit rather than
  // the page on screen. Memoised on the filtered array itself: it is a new
  // array only when the read or the filters actually changed.
  interface PrecomputedDashboardState {
    hours?: number[];
    weekdays?: number[];
    weeks?: Array<{ week: string; count: number }>;
    people?: Array<{
      name: string;
      channel_id: string | null;
      comments_count: number;
      likes_count: number;
    }>;
  }
  const rows = s?.filtered ?? [];
  const pre = s as (Snapshot & PrecomputedDashboardState) | undefined;
  const hours = useMemo(() => {
    if (pre?.hours && Array.isArray(pre.hours) && pre.hours.length === 24) {
      return hoursToBucketed(pre.hours);
    }
    return byHour(rows);
  }, [pre, rows]);

  const weekdays = useMemo(() => {
    if (
      pre?.weekdays &&
      Array.isArray(pre.weekdays) &&
      pre.weekdays.length === 7
    ) {
      return weekdaysToBucketed(pre.weekdays, S.weekdays);
    }
    return byWeekday(rows, S.weekdays);
  }, [pre, rows, S]);

  const weeks = useMemo(() => {
    if (pre?.weeks && Array.isArray(pre.weeks) && pre.weeks.length > 0) {
      return weeksToBucketed(pre.weeks);
    }
    return byWeek(rows);
  }, [pre, rows]);

  const [peopleBy, setPeopleBy] = useState<"comments" | "likes">("comments");
  const people = useMemo(() => {
    if (pre?.people && Array.isArray(pre.people) && pre.people.length > 0) {
      return peopleToCommenters(pre.people);
    }
    return commenters(rows, peopleBy);
  }, [pre, rows, peopleBy]);

  // The videos on screen: 25 of the filtered list, busiest first. The index
  // is clamped inside pageSlice, so a filter that shrinks the list under a
  // reader on page four shows the last page that still exists, not a blank.
  const videoSlice = pageSlice(s?.videos ?? [], videoPage, VIDEOS_PER_PAGE);
  function turnVideoPage(next: number) {
    setVideoPage(next);
    document
      .getElementById("rp-videos")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Selecting a video is a filter change like any other, so it goes through
  // the same apply path — which resets paging and builds the filters from
  // one definition rather than a second one here. Shared by `Videos`' cards
  // and `Compare`'s rows, which both offer the same "filter to this one"
  // action on the same underlying id.
  //
  // `next` is computed rather than relied upon from `video` after the
  // state setter: `setVideo` has not landed yet when `applyFilters` runs,
  // so reading `video` there would apply the previous selection.
  function pickVideo(id: string) {
    const next = video === id ? "" : id;
    setVideo(next);
    applyFilters({ video: next });
  }
  const cards = useMemo(() => {
    if (cardsQuery.data?.comments && cardsQuery.data.comments.length > 0) {
      return cardsQuery.data.comments.map((c) =>
        toLabelledComment(
          c,
          s?.active_analysis_key ?? "",
          s?.active_topic_key ?? "",
        ),
      );
    }
    const list = [...rows];
    if (cardTab === "critical")
      return list
        .filter((c) => c.label === "negative")
        .sort((a, b) => (b.likes_value ?? -1) - (a.likes_value ?? -1))
        .slice(0, 12);
    if (cardTab === "recent")
      return list
        .filter((c) => c.published_at)
        .sort((a, b) => (a.published_at! < b.published_at! ? 1 : -1))
        .slice(0, 12);
    // Unknown like counts sort last rather than as zero, so a comment whose
    // count could not be read is never presented as the least liked.
    return list
      .sort((a, b) => (b.likes_value ?? -1) - (a.likes_value ?? -1))
      .slice(0, 12);
  }, [
    cardsQuery.data,
    s?.active_analysis_key,
    s?.active_topic_key,
    rows,
    cardTab,
  ]);
  // Every sentence in the header comes from the values that decide behaviour,
  // so the label and the truth cannot drift apart.
  const source = describeSource({
    mode,
    workspaceId,
    workspaceName,
    persisted: reviewsArePersisted(mode),
    sync: s?.sync ?? null,
    total: s?.total ?? null,
    now: new Date(),
    S,
  });
  const span = s?.timeline ?? [];
  const range =
    span.length > 0
      ? `${span[0].date} — ${span[span.length - 1].date}`
      : S.noKnownDates;

  const effectiveLabels = useMemo(() => {
    if (!s?.measurable) return labels;
    const res: Partial<Record<Label, string>> = {};
    for (const [k, v] of Object.entries(labels) as [Label, string][]) {
      if (s.measurable.has(k)) {
        res[k] = v;
      }
    }
    return res as Record<Label, string>;
  }, [labels, s?.measurable]);

  return (
    <div className="db-page">
      <Hero
        s={s}
        S={S}
        workspaceName={workspaceName}
        range={range}
        labels={labels}
      />
      <div className="db-sticky-bar" ref={stickyRef}>
        <FilterBar
          values={values}
          onChange={onChange}
          onApply={applyFilters}
          onReset={reset}
          onLimitChange={onLimitChange}
          formError={formError}
          videoOptions={s?.video_options ?? []}
          topics={
            result.data?.active_topic_key ? (result.data?.topics ?? []) : null
          }
          commentTypes={result.data?.comment_types ?? []}
          S={S}
          lang={lang}
          labels={effectiveLabels}
          appliedCount={chips.length}
          chips={
            // Only while something is applied: the pinned pane pays for every
            // row, and the no-filter fallback (the source's scope sentence) is
            // already on the Provenance strip below.
            chips.length > 0 ? (
              <ActiveFilters
                chips={chips}
                onClear={onClear}
                onReset={reset}
                S={S}
              />
            ) : null
          }
        />
        {/* Two sections were missing from this list and two more were being
            offered on a page that had none: at zero rows every section below is
            unrendered, and the nav went on linking to six of them. A control
            that does nothing when pressed is worse than an absent one — the
            reader concludes the page is broken rather than empty. */}
        <SectionNav active={active} S={S} show={!!s && s.total > 0} />
      </div>
      <p className="db-note db-filterbar-note">{S.periodNote}</p>
      <Provenance source={source} />
      {result.isPending && <Loading S={S} />}
      {!result.isPending && result.isFetching && <Updating S={S} />}
      {result.isError && (
        <LoadError
          S={S}
          failure={result.failure}
          onRetry={() => void result.refetch()}
        />
      )}
      {s && (
        <>
          <Summary s={s} S={S} topicName={topicName} />
          {s.total === 0 ? (
            /* Two different zeros, and for years one message.
               A workspace whose collection has not run yet and a filter that
               excluded everything both land here, and the only useful advice
               is opposite. The page told both of them to change their filters
               — which is the one thing a new client, on their first screen,
               with no filters set, cannot do. It also offered to show them
               "بيانات الاختبار" on a page reading their real channel. */
            s.workspace_total === 0 ? (
              <EmptyState
                kind="workspace"
                S={S}
                // The path the reader is on, where the charts will be. This
                // is the first screen every new reader sees, and it used to
                // be an apology with two links. The steps are the account
                // page's, from the same function; the second is read from
                // the channel row, the third from the sync state the source
                // already carries.
                setup={
                  mode === "live" ? (
                    <SetupPath
                      steps={setupProgress(
                        {
                          channel: channel.data ?? null,
                          latestJob: latestJobFromSync(s.sync ?? null),
                        },
                        S,
                      )}
                      testId="empty-setup"
                    />
                  ) : null
                }
                links={[
                  { to: "/sync", label: S.emptyFollowCollection },
                  { to: "/account", label: S.emptyConnectOrSync },
                ]}
              />
            ) : (
              <EmptyState
                kind="filters"
                S={S}
                lead={S.emptyNoMatchLead(n(s.workspace_total))}
                onReset={reset}
              />
            )
          ) : (
            <>
              <Videos
                s={s}
                S={S}
                slice={videoSlice}
                video={video}
                onTurn={turnVideoPage}
                onPick={pickVideo}
              />
              <Voice s={s} S={S} labels={labels} topicName={topicName} />
              <Timing
                s={s}
                S={S}
                hours={hours}
                weekdays={weekdays}
                weeks={weeks}
              />
              <People S={S} people={people} by={peopleBy} onBy={setPeopleBy} />
              <Compare s={s} S={S} labels={labels} onPick={pickVideo} />
              <Engaged s={s} S={S} />
              <Comments
                s={s}
                S={S}
                lang={lang}
                labels={labels}
                cards={cards}
                cardTab={cardTab}
                onCardTab={setCardTab}
                cursors={cursors}
                onGo={goTo}
                isFetching={result.isFetching}
                cursorNotice={cursorNotice}
                exporting={exporting}
                onExport={() => exporting.mutate()}
                onReview={startReview}
                onTopicReview={startTopicReview}
                topicName={topicName}
              >
                <ReviewDialog
                  reviewing={reviewing}
                  kind={reviewKind}
                  verdict={verdict}
                  onVerdict={setVerdict}
                  topicVerdict={topicVerdict}
                  onTopicVerdict={setTopicVerdict}
                  reason={reason}
                  onReason={setReason}
                  topics={result.data?.topics ?? []}
                  topicName={topicName}
                  labels={labels}
                  S={S}
                  lang={lang}
                  persisted={reviewsArePersisted(mode)}
                  busy={
                    (reviewKind === "topic" ? topicReview : review).isPending
                  }
                  error={
                    (reviewKind === "topic" ? topicReview : review).error ??
                    null
                  }
                  onSubmit={() =>
                    (reviewKind === "topic" ? topicReview : review).mutate()
                  }
                  onClose={() => {
                    review.reset();
                    topicReview.reset();
                    closeReview();
                  }}
                  triggerRef={reviewTriggerRef}
                />
              </Comments>
            </>
          )}
          {/* Plan limits and worker health used to sit here, under the
              charts. They answer a different question for a different reader —
              and "no sync has run" qualifies every figure above it, so placing
              it below meant the caveat arrived after the numbers had been
              believed. Both now live on /sync, and what stays on this page is
              the provenance strip at the top, which precedes what it limits. */}
        </>
      )}
    </div>
  );
}

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
import "../report.css";
import "./dashboard.css";
import { byHour, byWeek, byWeekday, commenters } from "../analytics";
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
import { displayDate, commentText } from "../i18n";
import { useLocale } from "../locale";
import { useStrings } from "../strings";
import { reviewHistory } from "../reviewHistory";
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
import { EmptyState, Loading, LoadError, Updating } from "./PageStates";
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
  const [commentType, setCommentType] = useState("");
  const [reviewStatus, setReviewStatus] = useState<
    "all" | "reviewed" | "unreviewed"
  >("all");
  // cursors[i] opens page i + 2, so the stack length is the current page index.
  // Applying, resetting or resizing clears it, because a cursor is only valid
  // for the filtered set it was produced from.
  const [cursors, setCursors] = useState<string[]>([]);
  const [limit, setLimit] = useState(25);
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
  // `dashboard_snapshot(w)` takes a workspace. The filters below are applied
  // afterwards, here, to rows already in memory — so a filter cannot change
  // what this request returns. The key used to carry the whole filter object
  // anyway, which made every filter change a fresh 611KB read of the same
  // bytes, and every one of those an independent chance to fail while nothing
  // about the data had changed.
  //
  // The identity part is load-bearing and stays: user, mode and workspace are
  // in the key, so one tenant's rows can never be served from another's cache
  // entry. That was previously enforced by a placeholder callback comparing
  // old keys against new; it is now a property of the key itself, which cannot
  // be got wrong by a later edit to a callback.
  const read = useQuery({
    queryKey: ["dashboard-source", userId, mode, workspaceId],
    queryFn: ({ signal }) => loadSource(mode, workspaceId, signal),
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
    // `page` is deliberately absent: `pageKey` is its serialisation, and
    // listing the object as well would defeat the memo it was serialised for —
    // `page` is a fresh object on every render.
  }, [read.data, mode, pageKey]);
  const result = {
    data: derived?.ok ? derived.value : undefined,
    isPending: read.isPending,
    isFetching: read.isFetching,
    // A read that failed and a filter that cannot be applied are both "this
    // screen has no answer", and both are recovered from the same button.
    isError: read.isError || derived?.ok === false,
    refetch: read.refetch,
    // Which half failed, and how. Without this the notice is the same sentence
    // for a lost connection, a server that changed shape and a filter that
    // cannot be applied — three problems with three different answers, and the
    // reader is told to try again for all of them.
    failure: read.isError
      ? failureCode("read", read.error)
      : derived?.ok === false
        ? failureCode("view", derived.error)
        : null,
  };
  // A topic is stored by key and shown by name, in the reader's language. The
  // key is the fallback so a retired or unknown key is still visible as itself
  // rather than as nothing.
  const topicName = (key: string) =>
    result.data?.topics.find((t) => t.key === key)?.[
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
  const reviewFormRef = useRef<HTMLFormElement | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (reviewing) reviewFormRef.current?.focus();
  }, [reviewing]);
  function closeReview() {
    setReviewing(null);
    // Hand focus back to the row the reviewer came from.
    reviewTriggerRef.current?.focus();
  }
  // Escape closes it. The correction form takes focus and sits above the page
  // as an overlay, and an overlay that can only be left by finding its cancel
  // button is a trap for exactly the reader who cannot see where it is. The
  // listener lives with the form rather than on the page, so it exists only
  // while there is something to close.
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeReview();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Only `reviewing` belongs here: closeReview reads refs and setState, both
    // stable for the life of the component.
  }, [reviewing]);
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
      await client.invalidateQueries({ queryKey: ["dashboard-source"] });
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
      await client.invalidateQueries({ queryKey: ["dashboard-source"] });
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
  const active = useActiveSection(!!s && s.total > 0);
  // Aggregations for the charts, over every row the filters admit rather than
  // the page on screen. Memoised on the filtered array itself: it is a new
  // array only when the read or the filters actually changed.
  const rows = s?.filtered ?? [];
  const hours = useMemo(() => byHour(rows), [rows]);
  const weekdays = useMemo(() => byWeekday(rows, S.weekdays), [rows, S]);
  const weeks = useMemo(() => byWeek(rows), [rows]);
  const [peopleBy, setPeopleBy] = useState<"comments" | "likes">("comments");
  const people = useMemo(() => commenters(rows, peopleBy), [rows, peopleBy]);
  const [cardTab, setCardTab] = useState<"liked" | "recent" | "critical">(
    "liked",
  );
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
  }, [rows, cardTab]);
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
  return (
    <div className="rp-page db-page">
      <Hero
        s={s}
        S={S}
        workspaceName={workspaceName}
        range={range}
        labels={labels}
      />
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
        labels={labels}
        appliedCount={chips.length}
      />
      <ActiveFilters
        chips={chips}
        scope={source.scope}
        onClear={onClear}
        onReset={reset}
        S={S}
      />
      {/* Two sections were missing from this list and two more were being
          offered on a page that had none: at zero rows every section below is
          unrendered, and the nav went on linking to six of them. A control
          that does nothing when pressed is worse than an absent one — the
          reader concludes the page is broken rather than empty. */}
      <SectionNav active={active} S={S} show={!!s && s.total > 0} />
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
          <Summary s={s} S={S} />
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
                {reviewing && (
                  <form
                    className="review"
                    ref={reviewFormRef}
                    tabIndex={-1}
                    aria-label={
                      reviewKind === "topic"
                        ? S.reviewTopicTitle
                        : S.reviewFormLabel
                    }
                    onSubmit={(e) => {
                      e.preventDefault();
                      (reviewKind === "topic" ? topicReview : review).mutate();
                    }}
                  >
                    <h3>
                      {reviewKind === "topic"
                        ? S.reviewTopicTitle
                        : S.reviewTitle}
                    </h3>
                    <blockquote data-testid="review-text">
                      {commentText(reviewing, S)}
                    </blockquote>
                    <p className="muted">
                      {reviewKind === "topic"
                        ? S.reviewTopicCurrent(
                            reviewing.topic
                              ? topicName(reviewing.topic)
                              : S.topicNone,
                          )
                        : S.reviewCurrent(
                            reviewing.label
                              ? labels[reviewing.label]
                              : S.unanalysed,
                          )}
                    </p>
                    <div data-testid="review-history">
                      <h4>{S.reviewHistoryTitle}</h4>
                      {reviewing.reviews.length === 0 &&
                      reviewing.topic_reviews.length === 0 ? (
                        <p className="muted">{S.reviewHistoryEmpty}</p>
                      ) : (
                        <ol className="history">
                          {reviewHistory(reviewing).map(
                            ({ review: r, state }, i) => (
                              <li key={`${r.created_at}-${i}`}>
                                <strong>
                                  {S.reviewKindSentiment}: {labels[r.label]}
                                </strong>
                                <span>{displayDate(r.created_at, lang)}</span>
                                <span data-testid="review-by">
                                  {r.reviewer_id ?? S.reviewerUnknown}
                                </span>
                                <small data-state={state}>
                                  {S.reviewStateMessages[state]}
                                </small>
                                {r.reason && (
                                  <q data-testid="review-reason">{r.reason}</q>
                                )}
                              </li>
                            ),
                          )}
                          {/* The topic verdicts, under the same in-force rule.
                              reviewHistory reads only origin, hash and date,
                              so a topic review passes through it with its key
                              standing where a label would; the cast is inert. */}
                          {reviewHistory({
                            reviews: reviewing.topic_reviews.map((r) => ({
                              ...r,
                              label: r.topic_key as Label,
                            })),
                            content_hash: reviewing.content_hash,
                          }).map(({ review: r, state }, i) => (
                            <li key={`topic-${r.created_at}-${i}`}>
                              <strong>
                                {S.reviewKindTopic}: {topicName(r.label)}
                              </strong>
                              <span>{displayDate(r.created_at, lang)}</span>
                              <span data-testid="review-by">
                                {r.reviewer_id ?? S.reviewerUnknown}
                              </span>
                              <small data-state={state}>
                                {S.reviewStateMessages[state]}
                              </small>
                              {r.reason && (
                                <q data-testid="review-reason">{r.reason}</q>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                    {reviewKind === "topic" ? (
                      <label>
                        {S.correctTopicLabel}
                        <select
                          aria-label={S.correctTopicLabel}
                          value={topicVerdict}
                          onChange={(e) => setTopicVerdict(e.target.value)}
                        >
                          {(result.data?.topics ?? [])
                            .filter((t) => !t.retired)
                            .map((t) => (
                              <option key={t.key} value={t.key}>
                                {lang === "ar" ? t.name_ar : t.name_en}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        {S.correctLabel}
                        <select
                          aria-label={S.correctLabel}
                          value={verdict}
                          onChange={(e) => setVerdict(e.target.value as Label)}
                        >
                          {Object.entries(labels).map(([key, text]) => (
                            <option key={key} value={key}>
                              {text}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {S.correctionReason}
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        required
                      />
                    </label>
                    {(reviewKind === "topic" ? topicReview : review)
                      .isError && (
                      <p role="alert" data-testid="review-error">
                        {(reviewKind === "topic" ? topicReview : review).error
                          ?.message === "stale_comment_text"
                          ? S.reviewStale
                          : S.reviewSaveFailed}
                      </p>
                    )}
                    <div>
                      <button
                        type="submit"
                        disabled={
                          (reviewKind === "topic" ? topicReview : review)
                            .isPending
                        }
                      >
                        {S.saveCorrection}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          review.reset();
                          topicReview.reset();
                          closeReview();
                        }}
                      >
                        {S.cancel}
                      </button>
                    </div>
                    {!reviewsArePersisted(mode) && (
                      <p className="muted" data-testid="review-scope">
                        {S.reviewFixtureScope}
                      </p>
                    )}
                  </form>
                )}
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

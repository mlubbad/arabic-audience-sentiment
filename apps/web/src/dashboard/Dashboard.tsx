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
import { Bar, Doughnut, Line } from "react-chartjs-2";
import "../report.css";
import "./dashboard.css";
import { byHour, byWeek, byWeekday, commenters, plottable } from "../analytics";
import { pageSlice } from "../videoPaging";
import {
  UNCLASSIFIED,
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
import { videoLabel, displayDate, commentText } from "../i18n";
import { useLocale } from "../locale";
import { useStrings, type StringKey } from "../strings";
import { reviewHistory } from "../reviewHistory";
import { describeSource } from "../dataSource";
import { useChannelStatus } from "../channelStatus";
import { latestJobFromSync, setupProgress } from "../setup";
import { SetupPath } from "../SetupPath";
import {
  AXIS_TEXT,
  GRID_LINE,
  SENTIMENT,
  UNMEASURABLE,
  VOLUME,
  VOLUME_FILL,
} from "../chartTheme";
import { n } from "./format";
import { barOptions, doughnutOptions, lineOptions } from "./chartOptions";
import { FilterBar } from "./FilterBar";
import { ActiveFilters } from "./ActiveFilters";
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

/**
 * The numbers a canvas cannot say.
 *
 * Chart.js draws into a <canvas>, which is a picture: the three timing panels
 * are marked aria-hidden precisely because a screen reader announcing "canvas"
 * helps nobody. But that left a reader who cannot see the picture with the
 * caption and nothing else — the donut at least spells its four figures out in
 * its legend, while the busiest hour of this channel's day existed only as a
 * shape. This is the same data as text, folded away so it costs a sighted
 * reader one line and gives everyone else the panel.
 */
function ChartFigures({
  caption,
  unit,
  buckets,
}: {
  caption: string;
  unit: string;
  buckets: readonly { label: string; count: number }[];
}) {
  const S = useStrings();
  return (
    <details className="rp-figures">
      <summary>{S.figuresShow}</summary>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">{S.figuresComments}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              <td>{n(b.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Video cards per page of the videos section. The same size as the comments
 *  pager's default, so the two lists turn at the same rhythm. */
const VIDEOS_PER_PAGE = 25;

/** The report's sections, in the order the page lays them out. One list, so a
 *  section cannot be added to the page and forgotten in its index — which is
 *  how "مقارنة الفيديوهات" and "أكثر التعليقات السلبية تفاعلًا" came to exist
 *  on the page and nowhere in the navigation that claims to enumerate it. */
const SECTIONS = [
  { id: "rp-summary", label: "secSummary" },
  { id: "rp-videos", label: "secVideos" },
  { id: "rp-voice", label: "secVoice" },
  { id: "rp-timing", label: "secTiming" },
  { id: "rp-people", label: "secPeople" },
  { id: "rp-compare", label: "secCompare" },
  { id: "rp-engaged", label: "secEngaged" },
  { id: "rp-comments", label: "secComments" },
] as const satisfies readonly { id: string; label: StringKey }[];

/**
 * Which section the reader is in.
 *
 * Scroll position is the wrong question — a section can be short, or the page
 * can be scrolled to its end with three sections in view. The observer answers
 * the question actually being asked: of the sections currently on screen,
 * which starts highest. `enabled` exists because the sections do not render on
 * an empty page, and an observer watching for elements that will never appear
 * is a subscription with no subject.
 */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      setActive(null);
      return;
    }
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(s.id));
        // Only move the mark when something is in view. Clearing it between
        // two sections would make the index flicker on every scroll.
        if (first) setActive(first.id);
      },
      // The header is sticky, so a section is "reached" when its top passes
      // under it, not when it touches the viewport edge.
      { rootMargin: "-88px 0px -55% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled]);
  return active;
}

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
      {/* A page head, not a hero. Inside the shell this is styled flat, on
          the page's own ground: the dark gradient pane belongs to the landing
          page, where a reader is being sold something. The eyebrow names the
          page as the rail does and the workspace the figures belong to, the
          way the operations page's already did. */}
      <header className="rp-hero">
        <p className="rp-eyebrow">
          {S.dashEyebrow} · {workspaceName ?? S.dashDemoTag}
        </p>
        <h1>{S.dashTitle}</h1>
        {/* Before the read returns there is no count, and `?? 0` would have
            printed "قراءة 0 تعليقًا" over a page that is still loading —
            unknown rendered as a measurement of none. The banner says what it
            is doing instead, and the figures appear when they exist. */}
        {s ? (
          <>
            {/* What was read. The claim that used to follow — "كل رقم أدناه
                محسوب من الصفوف المحفوظة — لا تقدير ولا استقراء" — is a pitch
                about the method; the provenance strip below says what the
                data is, which is the checkable version of it. */}
            <p>{S.dashRead(n(s.total), s.videos.length)}</p>
            <div className="rp-pills">
              <span className="rp-pill">{range}</span>
              <span className="rp-pill">{S.pillComments(n(s.total))}</span>
              <span className="rp-pill">
                {S.pillAuthors(n(s.unique_authors))}
              </span>
            </div>
            {/* The answer, on the first screen.
                The page asks "ماذا يقول جمهورك؟" at the top and then made the
                reader scroll past ten filter controls and four panels to find
                out — the summary tiles counted comments, replies and authors,
                but not the one split the product exists to produce. It stays
                out of the pills above because those describe the extract
                (when, how many, from whom) and this is the finding.
                Denominator said out loud: the classified rows, not the total. */}
            {s.analysed > 0 && (
              <p className="rp-hero-split" data-testid="hero-split">
                <span>{S.splitOf(n(s.analysed))}</span>
                {(Object.keys(s.sentiments) as Label[])
                  .filter((k) => s.measurable.has(k))
                  .map((k) => (
                    <strong key={k}>
                      {labels[k]} {n(s.sentiments[k])}
                    </strong>
                  ))}
              </p>
            )}
          </>
        ) : (
          <p>{S.readingStored}</p>
        )}
      </header>
      {/* Two sections were missing from this list and two more were being
          offered on a page that had none: at zero rows every section below is
          unrendered, and the nav went on linking to six of them. A control
          that does nothing when pressed is worse than an absent one — the
          reader concludes the page is broken rather than empty. */}
      <nav className="rp-nav" aria-label={S.reportSectionsLabel}>
        {s && s.total > 0 && (
          <div className="rp-nav-links">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                // Where the reader is, not only where they can go. A sticky
                // index on a page this long that never says which of its eight
                // sections you are in is a table of contents with the bookmark
                // removed.
                aria-current={active === section.id ? "true" : undefined}
              >
                {S[section.label]}
              </a>
            ))}
          </div>
        )}
      </nav>
      <aside
        className={`rp-provenance${source.tone === "warning" ? " warn" : ""}`}
        data-testid="source"
        data-mode={source.mode}
      >
        <strong>{source.badge}</strong>
        <p data-testid="source-scope">{source.scope}</p>
        <p data-testid="source-coverage">{source.coverage}</p>
        <p data-testid="data-mode">{source.persistence}</p>
        {source.freshness && (
          <p data-testid="source-freshness">{source.freshness}</p>
        )}
      </aside>
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
      {result.isPending && (
        <div role="status" data-testid="loading" className="loading">
          {S.loadingComments}
        </div>
      )}
      {!result.isPending && result.isFetching && (
        <p role="status" data-testid="updating" className="updating">
          {S.updatingResults}
        </p>
      )}
      {result.isError && (
        <div role="alert" className="notice" data-testid="load-error">
          <p>
            {result.failure?.startsWith("view:")
              ? S.filtersFailed
              : S.loadFailed}
          </p>
          {/* Small, and last. It is for the person who has to fix it, not for
              the person reading the report — but it is on the screen, because
              the alternative is fetching the payload by hand to find out what
              a page in front of you already knows. */}
          <p className="muted" data-testid="failure-code">
            {S.failureCode} <code>{result.failure}</code>
          </p>
          <button onClick={() => void result.refetch()}>{S.retry}</button>
        </div>
      )}
      {s && (
        <>
          <section className="rp-section" id="rp-summary">
            <header>
              <h2>{S.secSummary}</h2>
              <p className="rp-sub">
                {S.summaryLead}
                {s.channel_own_comments > 0 && (
                  <>
                    {" "}
                    <span data-testid="owner-excluded">
                      {S.ownerExcluded(n(s.channel_own_comments))}
                    </span>
                  </>
                )}
              </p>
            </header>
            <div className="rp-grid rp-grid-5" aria-label={S.metricsLabel}>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">{S.metricComments}</span>
                <strong className="rp-metric-value" data-testid="total">
                  {n(s.total)}
                </strong>
                <span className="rp-metric-note">{S.metricCommentsNote}</span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">{S.metricAnalysed}</span>
                <strong className="rp-metric-value">{n(s.analysed)}</strong>
                <span className="rp-metric-note">{S.metricAnalysedNote}</span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">{S.metricUnanalysed}</span>
                <strong className="rp-metric-value">{n(s.unanalysed)}</strong>
                <span className="rp-metric-note">{S.metricUnanalysedNote}</span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">{S.metricReplies}</span>
                <strong className="rp-metric-value" data-testid="replies-count">
                  {n(s.replies)}
                </strong>
                <span className="rp-metric-note">{S.metricRepliesNote}</span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">{S.metricAuthors}</span>
                <strong className="rp-metric-value">
                  {n(s.unique_authors)}
                </strong>
                <span className="rp-metric-note">
                  {/* Counted by channel id. Rows whose author was purged are
                      not countable as people and are excluded rather than
                      guessed at. */}
                  {S.metricAuthorsNote}
                </span>
              </article>
            </div>
            <div
              className="rp-grid rp-grid-4"
              style={{ marginTop: "var(--space-4)" }}
            >
              {/* Named, not numbered. These four are independent readings —
                  how much was analysed, how much is audience-to-audience, how
                  concentrated the talk is, how much of it can be placed in
                  time — and numbering them 1 to 4 asserted an order that is
                  not there. A marker should say something true about what it
                  marks; "3" said only that it came after "2". */}
              <article className="rp-insight">
                <p className="rp-insight-tag">{S.insightAnalysis}</p>
                <p>
                  {s.total > 0
                    ? S.insightAnalysed(
                        Math.round((s.analysed / s.total) * 100),
                      )
                    : S.insightNoMatches}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">{S.insightReplies}</p>
                <p>
                  {s.total > 0
                    ? S.insightRepliesShare(
                        Math.round((s.replies / s.total) * 100),
                      )
                    : S.insightRepliesNone}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">{S.insightConcentration}</p>
                <p>
                  {s.videos.length > 0
                    ? S.insightTopVideo(
                        n(s.videos[0].total),
                        n(s.total),
                        Math.round((s.videos[0].total / s.total) * 100),
                      )
                    : S.insightNoVideo}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">{S.insightDates}</p>
                <p>
                  {s.unknown_dates > 0
                    ? S.insightUndated(n(s.unknown_dates))
                    : S.insightAllDated}
                </p>
              </article>
            </div>
          </section>
          {s.total === 0 ? (
            /* Two different zeros, and for years one message.
               A workspace whose collection has not run yet and a filter that
               excluded everything both land here, and the only useful advice
               is opposite. The page told both of them to change their filters
               — which is the one thing a new client, on their first screen,
               with no filters set, cannot do. It also offered to show them
               "بيانات الاختبار" on a page reading their real channel. */
            <section className="empty" data-testid="empty-state">
              {s.workspace_total === 0 ? (
                <>
                  <h2>{S.emptyNoCommentsTitle}</h2>
                  <p>{S.emptyNoCommentsLead}</p>
                  {/* The path the reader is on, where the charts will be.
                      This is the first screen every new reader sees, and it
                      used to be an apology with two links. The steps are the
                      account page's, from the same function; the second is
                      read from the channel row, the third from the sync
                      state the source already carries. */}
                  {mode === "live" && (
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
                  )}
                  <div className="empty-actions">
                    <a href="/sync">{S.emptyFollowCollection}</a>
                    <a href="/account">{S.emptyConnectOrSync}</a>
                  </div>
                </>
              ) : (
                <>
                  <h2>{S.emptyNoMatchTitle}</h2>
                  <p>{S.emptyNoMatchLead(n(s.workspace_total))}</p>
                  <div className="empty-actions">
                    {/* Not "إعادة ضبط الفلاتر", which is what the button in
                        the filter bar says. Two controls with one name are one
                        name too few — and from an empty page the useful
                        promise is the result, not the mechanism. */}
                    <button type="button" onClick={reset}>
                      {S.showAllComments}
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : (
            <>
              <section className="rp-section" id="rp-videos">
                <header>
                  <h2>{S.secVideos}</h2>
                  <p className="rp-sub">{S.videosLead}</p>
                </header>
                <ul className="rp-videos">
                  {videoSlice.items.map((v) => {
                    const known =
                      v.sentiments.positive +
                      v.sentiments.negative +
                      v.sentiments.neutral +
                      v.sentiments.mixed;
                    const pct = (x: number) =>
                      v.total ? (x / v.total) * 100 : 0;
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          className="rp-video"
                          aria-pressed={video === v.id}
                          data-testid={`rp-video-${v.id}`}
                          onClick={() => {
                            // Selecting a video is a filter change like any
                            // other, so it goes through the same apply path —
                            // which resets paging and builds the filters from
                            // one definition rather than a second one here.
                            //
                            // `next` is passed rather than relied upon from
                            // state: setVideo has not landed yet when this
                            // runs, so reading `video` would apply the
                            // previous selection.
                            const next = video === v.id ? "" : v.id;
                            setVideo(next);
                            applyFilters({ video: next });
                          }}
                        >
                          <span>
                            <span className="rp-video-title">
                              {videoLabel(v.id, v.title, S)}
                            </span>
                            <span className="rp-video-meta">
                              <span>{S.countComments(n(v.total))}</span>
                              <span>{S.countReplies(n(v.replies))}</span>
                              <span>{S.countAnalysed(n(v.analysed))}</span>
                            </span>
                            {/* Only the segments that hold something. The 2px
                                gap that keeps two touching fills apart would
                                otherwise be drawn around segments of width
                                zero, printing a sliver of "a few" where the
                                count is none. The unanalysed remainder is a
                                segment like any other and is drawn, not
                                omitted: a bar that filled to 100% from four
                                labels would claim every comment was read. */}
                            <span className="rp-bar" aria-hidden="true">
                              {(
                                [
                                  ["pos", v.sentiments.positive],
                                  ["neg", v.sentiments.negative],
                                  ["neu", v.sentiments.neutral],
                                  ["mix", v.sentiments.mixed],
                                  ["un", v.total - known],
                                ] as const
                              )
                                .filter(([, count]) => count > 0)
                                .map(([cls, count]) => (
                                  <span
                                    key={cls}
                                    className={cls}
                                    style={{ width: `${pct(count)}%` }}
                                  />
                                ))}
                            </span>
                          </span>
                          <span className="rp-video-figure">
                            <strong>{n(v.total)}</strong>
                            <span>{S.unitComments}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* Only when there is a second page. A pager reading "1 of 1"
                    under five cards is furniture; under 194 it is the way in.
                    Moving a page scrolls the section's head back into view:
                    the reader pressed a button at the foot of the old page and
                    would otherwise be left looking at the foot of the new one. */}
                {videoSlice.pages > 1 && (
                  <nav className="pager" aria-label={S.videosPagerLabel}>
                    <button
                      type="button"
                      disabled={videoSlice.page === 0}
                      onClick={() => turnVideoPage(videoSlice.page - 1)}
                    >
                      {S.previousPage}
                    </button>
                    <p data-testid="video-page-state" aria-live="polite">
                      {S.videosPageState(
                        videoSlice.page + 1,
                        videoSlice.pages,
                        videoSlice.from,
                        videoSlice.to,
                        s.videos.length,
                      )}
                    </p>
                    <button
                      type="button"
                      disabled={videoSlice.page >= videoSlice.pages - 1}
                      onClick={() => turnVideoPage(videoSlice.page + 1)}
                    >
                      {S.nextPage}
                    </button>
                  </nav>
                )}
              </section>
              <section className="rp-section" id="rp-voice">
                <header>
                  <h2>{S.secVoice}</h2>
                  <p className="rp-sub">{S.voiceLead(n(s.analysed))}</p>
                </header>
                <div className="rp-grid rp-grid-2">
                  <article className="rp-card">
                    <h3>{S.sentimentsTitle}</h3>
                    {s.analysed > 0 ? (
                      <>
                        <div className="rp-chart-donut" aria-hidden="true">
                          <Doughnut
                            data={{
                              labels: Object.values(labels),
                              datasets: [
                                {
                                  data: Object.values(s.sentiments),
                                  // One scale, shared with the chips and the
                                  // bars. Keyed by label so the four colours
                                  // cannot drift out of step with the four
                                  // counts beside them. Labels accompany every
                                  // slice; colour is never the only carrier.
                                  backgroundColor: (
                                    Object.keys(s.sentiments) as Label[]
                                  ).map((k) =>
                                    s.measurable.has(k)
                                      ? SENTIMENT[k]
                                      : UNMEASURABLE,
                                  ),
                                  // White, the card's own colour: the gap is
                                  // what keeps two touching slices two.
                                  borderColor: "#ffffff",
                                  borderWidth: 2,
                                },
                              ],
                            }}
                            options={doughnutOptions}
                          />
                        </div>
                        <ul className="rp-legend">
                          {Object.entries(s.sentiments).map(([key, v]) => {
                            // A class the analysis cannot express is reported
                            // as unavailable, never as zero. On this channel
                            // about one comment in twenty is genuinely mixed,
                            // and the active model has no such class — so the
                            // zero was not uninformative, it was wrong.
                            const measurable = s.measurable.has(key);
                            return (
                              <li key={key}>
                                <span>
                                  <span
                                    className="rp-swatch"
                                    style={{
                                      background: measurable
                                        ? `var(--sentiment-${key})`
                                        : "var(--border-2)",
                                    }}
                                    aria-hidden="true"
                                  />
                                  {measurable ? (
                                    S.legendMeasured(
                                      labels[key as Label],
                                      n(v),
                                      s.analysed
                                        ? Math.round((v / s.analysed) * 100)
                                        : 0,
                                    )
                                  ) : (
                                    <span data-testid={`unmeasurable-${key}`}>
                                      {S.legendUnmeasured(labels[key as Label])}
                                    </span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    ) : (
                      <p className="rp-missing">
                        <strong>{S.noLabelsStrong}</strong>
                        {S.noLabelsLead}
                      </p>
                    )}
                  </article>
                  <article className="rp-card" data-testid="topics-card">
                    <h3>{S.topicsTitle}</h3>
                    {/* Real verdicts only: the buckets are the taxonomy the
                        workspace chose, counted under its active topic model,
                        and a human correction wins over the model's verdict
                        by the same rule the sentiment chart uses. Until a
                        model has run there is nothing to draw, and the card
                        says so rather than clustering by keyword and calling
                        that analysis. */}
                    {!s.active_topic_key ? (
                      <p className="rp-missing">
                        <strong>{S.topicsNotRunStrong}</strong>
                        {S.topicsNotRunLead}
                      </p>
                    ) : (
                      (() => {
                        const buckets = s.topics
                          .filter((t) => !t.retired)
                          .map((t) => ({
                            key: t.key,
                            label: lang === "ar" ? t.name_ar : t.name_en,
                            count: s.topic_counts[t.key] ?? 0,
                          }))
                          .filter((b) => b.count > 0)
                          .sort(
                            (a, b) =>
                              b.count - a.count ||
                              a.key.localeCompare(b.key, "en"),
                          );
                        const unclassified = s.topic_counts[UNCLASSIFIED] ?? 0;
                        return (
                          <>
                            {buckets.length > 0 && (
                              <div
                                className="rp-chart rp-chart-topics"
                                aria-hidden="true"
                              >
                                <Bar
                                  data={{
                                    labels: buckets.map((b) => b.label),
                                    datasets: [
                                      {
                                        data: buckets.map((b) => b.count),
                                        backgroundColor: VOLUME,
                                        borderRadius: 4,
                                      },
                                    ],
                                  }}
                                  options={{
                                    ...barOptions,
                                    indexAxis: "y" as const,
                                    // Horizontal, so the count axis is x: the
                                    // shared options pin whole numbers on y,
                                    // and a third of a comment is not a tick.
                                    scales: {
                                      x: {
                                        beginAtZero: true,
                                        ticks: {
                                          color: AXIS_TEXT,
                                          precision: 0,
                                        },
                                        grid: { color: GRID_LINE },
                                      },
                                      y: {
                                        ticks: { color: AXIS_TEXT },
                                        grid: { display: false },
                                      },
                                    },
                                  }}
                                />
                              </div>
                            )}
                            <ChartFigures
                              caption={S.topicsCaption}
                              unit={S.topicsUnit}
                              buckets={buckets}
                            />
                            {/* Not a bucket: an unclassified comment has no
                                topic, and drawing it as one would make the
                                gap look like a theme. */}
                            {unclassified > 0 && (
                              <p
                                className="rp-metric-note"
                                data-testid="topics-unclassified"
                              >
                                {S.topicsUnclassified(n(unclassified))}
                              </p>
                            )}
                          </>
                        );
                      })()
                    )}
                  </article>
                </div>
                {/* Three figures, and the section's own prose says one of
                    them is the one to act on — "وهي التي تستحق قراءة نصّها".
                    They were three identical filled indigo blocks with a glow,
                    each shouting equally, directly under a donut that had just
                    said the same numbers in the sentiment colours. Emphasis
                    spent three times is emphasis spent nowhere; and one fact
                    wearing two colour languages eight pixels apart is the
                    reader's problem, not the palette's. The lead figure is
                    lead-sized, the other two recede, and each number wears the
                    colour its slice wears above. */}
                <div
                  className="rp-grid rp-grid-3 rp-figures-row"
                  style={{ marginTop: "var(--space-4)" }}
                >
                  <article className="rp-figure" data-tone="negative">
                    <strong>{n(s.sentiments.negative)}</strong>
                    <p>{S.figureNegative}</p>
                  </article>
                  <article className="rp-figure" data-tone="positive">
                    <strong>{n(s.sentiments.positive)}</strong>
                    <p>{S.figurePositive}</p>
                  </article>
                  <article className="rp-figure" data-tone="none">
                    <strong>{n(s.unanalysed)}</strong>
                    <p>{S.figureUnanalysed}</p>
                  </article>
                </div>
              </section>
              <section className="rp-section" id="rp-timing">
                <header>
                  <h2>{S.timingTitle}</h2>
                  <p className="rp-sub">{S.timingLead}</p>
                </header>
                <article className="rp-card">
                  <h3>{S.weeklyTitle}</h3>
                  {!plottable(weeks, 3) ? (
                    <p className="rp-missing" data-testid="weeks-unplottable">
                      <strong>{S.weeklyTooFewStrong}</strong>
                      {S.weeklyTooFewLead}
                    </p>
                  ) : (
                    <div className="rp-chart rp-chart-tall" aria-hidden="true">
                      <Line
                        data={{
                          labels: weeks.buckets.map((b) => b.label),
                          datasets: [
                            {
                              data: weeks.buckets.map((b) => b.count),
                              borderColor: VOLUME,
                              backgroundColor: VOLUME_FILL,
                              fill: true,
                              tension: 0.3,
                              pointRadius: 0,
                            },
                          ],
                        }}
                        options={lineOptions}
                      />
                    </div>
                  )}
                  {plottable(weeks, 3) && (
                    <ChartFigures
                      caption={S.weeklyCaption}
                      unit={S.weeklyUnit}
                      buckets={weeks.buckets}
                    />
                  )}
                  <p className="rp-metric-note">
                    {weeks.unplaceable > 0
                      ? S.weeklyUnplaceable(n(weeks.unplaceable))
                      : S.weeklyAllPlaced}
                  </p>
                </article>
                <div
                  className="rp-grid rp-grid-2"
                  style={{ marginTop: "var(--space-4)" }}
                >
                  <article className="rp-card">
                    <h3>{S.hourlyTitle}</h3>
                    {!plottable(hours) ? (
                      <p className="rp-missing">
                        <strong>{S.distributionTooFewStrong}</strong>
                        {S.hourlyTooFewLead}
                      </p>
                    ) : (
                      <div className="rp-chart" aria-hidden="true">
                        <Bar
                          data={{
                            labels: hours.buckets.map((b) => b.label),
                            datasets: [
                              {
                                data: hours.buckets.map((b) => b.count),
                                backgroundColor: VOLUME,
                                borderRadius: 4,
                              },
                            ],
                          }}
                          options={barOptions}
                        />
                      </div>
                    )}
                    {plottable(hours) && (
                      <ChartFigures
                        caption={S.hourlyCaption}
                        unit={S.hourlyUnit}
                        buckets={hours.buckets}
                      />
                    )}
                    <p className="rp-metric-note" data-testid="hours-excluded">
                      {hours.unplaceable > 0
                        ? S.hourlyUnplaceable(n(hours.unplaceable))
                        : S.hourlyAllPlaced}
                    </p>
                  </article>
                  <article className="rp-card">
                    <h3>{S.weekdayTitle}</h3>
                    {!plottable(weekdays) ? (
                      <p className="rp-missing">
                        <strong>{S.distributionTooFewStrong}</strong>
                        {S.weekdayTooFewLead}
                      </p>
                    ) : (
                      <div className="rp-chart" aria-hidden="true">
                        <Bar
                          data={{
                            labels: weekdays.buckets.map((b) => b.label),
                            datasets: [
                              {
                                data: weekdays.buckets.map((b) => b.count),
                                backgroundColor: VOLUME,
                                borderRadius: 4,
                              },
                            ],
                          }}
                          options={barOptions}
                        />
                      </div>
                    )}
                    {plottable(weekdays) && (
                      <ChartFigures
                        caption={S.weekdayCaption}
                        unit={S.weekdayUnit}
                        buckets={weekdays.buckets}
                      />
                    )}
                    <p className="rp-metric-note">{S.weekdayNote}</p>
                    <p className="rp-metric-note">
                      {S.undatedLabel}{" "}
                      <span data-testid="unknown-dates">{s.unknown_dates}</span>
                    </p>
                  </article>
                </div>
              </section>
              <section className="rp-section" id="rp-people">
                <header>
                  <h2>{S.secPeople}</h2>
                  <p className="rp-sub">{S.peopleLead}</p>
                </header>
                <article className="rp-card">
                  <div className="rp-tabs" style={{ marginBottom: "16px" }}>
                    <button
                      type="button"
                      className="rp-tab"
                      aria-pressed={peopleBy === "comments"}
                      onClick={() => setPeopleBy("comments")}
                    >
                      {S.mostActive}
                    </button>
                    <button
                      type="button"
                      className="rp-tab"
                      aria-pressed={peopleBy === "likes"}
                      onClick={() => setPeopleBy("likes")}
                    >
                      {S.mostInfluential}
                    </button>
                  </div>
                  {people.ranked.length === 0 ? (
                    <p className="rp-missing">
                      <strong>{S.noCommenterStrong}</strong>
                      {S.noCommenterLead}
                    </p>
                  ) : (
                    <ol className="rp-people">
                      {people.ranked.slice(0, 20).map((c, i) => (
                        <li
                          key={c.key}
                          className="rp-person"
                          data-testid={`rp-person-${i}`}
                        >
                          <span className="rp-rank">{i + 1}</span>
                          <span className="rp-person-name">{c.name}</span>
                          <span className="rp-person-n">
                            {S.countComments(n(c.comments))}
                          </span>
                          <span className="rp-person-likes">
                            {/* Unknown stays unknown: a source that showed no
                                count is not a source that showed zero. */}
                            {c.likes === null
                              ? S.likesUnknown
                              : S.countLikes(n(c.likes))}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {people.anonymous > 0 && (
                    <p className="rp-metric-note" data-testid="rp-anonymous">
                      {S.anonymousNote(n(people.anonymous))}
                    </p>
                  )}
                </article>
              </section>
              <section
                className="rp-section"
                id="rp-compare"
                aria-labelledby="comparison-heading"
              >
                <header>
                  <h2 id="comparison-heading">{S.compareTitle}</h2>
                </header>
                <p className="muted" data-testid="comparison-scope">
                  {S.compareScope}
                </p>
                {s.comparison_truncated && (
                  <p className="muted">{S.compareTruncated}</p>
                )}
                <div className="table-wrap">
                  <table>
                    <caption>{S.compareCaption}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{S.colVideo}</th>
                        <th scope="col">{S.colComments}</th>
                        <th scope="col">{S.colReplies}</th>
                        <th scope="col">{S.colAnalysed}</th>
                        <th scope="col">{S.colDistribution}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.comparison.map((v) => (
                        <tr key={v.id} data-testid={`compare-${v.id}`}>
                          <td>{videoLabel(v.id, v.title, S)}</td>
                          <td>{v.total}</td>
                          <td>{v.replies}</td>
                          <td>{v.analysed}</td>
                          <td>
                            {v.analysed === 0 ? (
                              <small>{S.noAnalysedInFilters}</small>
                            ) : (
                              <>
                                {/* A comparison table whose comparison column
                                    is a run-on sentence compares nothing: the
                                    reader parses four numbers per row and holds
                                    them against four more. The bar is read
                                    across rows at a glance; the list under it
                                    keeps the exact figures, because a bar is an
                                    impression and this page promises counts. */}
                                <span
                                  className="rp-bar rp-bar-inline"
                                  aria-hidden="true"
                                >
                                  {(
                                    Object.entries(v.sentiments) as [
                                      Label,
                                      number,
                                    ][]
                                  )
                                    .filter(([, count]) => count > 0)
                                    .map(([k, count]) => (
                                      <span
                                        key={k}
                                        style={{
                                          width: `${(count / v.analysed) * 100}%`,
                                          background: SENTIMENT[k],
                                        }}
                                      />
                                    ))}
                                </span>
                                <ul className="share">
                                  {Object.entries(v.sentiments).map(
                                    ([k, n]) => (
                                      <li key={k}>
                                        {S.shareItem(
                                          labels[k as Label],
                                          n,
                                          Math.round((n / v.analysed) * 100),
                                        )}
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section
                className="rp-section"
                id="rp-engaged"
                aria-labelledby="engaged-heading"
                data-testid="engaged-panel"
              >
                <header>
                  <h2 id="engaged-heading">{S.engagedTitle}</h2>
                </header>
                <p className="muted">{S.engagedLead}</p>
                {s.most_engaged_negative.length === 0 ? (
                  <p data-testid="engaged-empty">{S.engagedEmpty}</p>
                ) : (
                  /* A heading promising a ranking, over a run of sentences
                     that began with a number. Ranked things want a rank: the
                     count is the mark, the text is the row, and the bar under
                     each is that row's share of the top one — which is the
                     only reason to order them in the first place. */
                  <ol className="engaged">
                    {s.most_engaged_negative.map((c) => {
                      const top = s.most_engaged_negative[0].likes_value ?? 0;
                      const likes = c.likes_value ?? 0;
                      return (
                        <li key={c.id} data-testid={`engaged-${c.id}`}>
                          <span className="engaged-count">
                            <strong>{c.likes_raw ?? c.likes_value}</strong>
                            <span>{S.unitLikes}</span>
                          </span>
                          <span className="engaged-body">
                            <span className="engaged-text">
                              {commentText(c, S)}
                            </span>
                            {c.reviewed && <small>{S.humanReview}</small>}
                            <span
                              className="engaged-bar"
                              aria-hidden="true"
                              style={{
                                // Relative to the most-liked row, not to the
                                // page: these five are the top of a longer
                                // list, and a bar drawn against a total the
                                // reader cannot see measures nothing.
                                inlineSize: `${top > 0 ? Math.max((likes / top) * 100, 2) : 0}%`,
                              }}
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {s.negative_ranked > s.most_engaged_negative.length && (
                  <p className="muted" data-testid="engaged-truncated">
                    {S.engagedTruncated(
                      s.most_engaged_negative.length,
                      s.negative_ranked,
                    )}
                  </p>
                )}
                {s.negative_unranked > 0 && (
                  <p className="muted" data-testid="engaged-unranked">
                    {S.engagedUnranked(s.negative_unranked)}
                  </p>
                )}
              </section>
              <section
                className="rp-section"
                id="rp-comments"
                data-testid="comments-table"
              >
                <header>
                  <h2>{S.secComments}</h2>
                  <p className="rp-sub">{S.commentsLead}</p>
                </header>
                <div className="rp-tabs" style={{ marginBottom: "16px" }}>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "liked"}
                    onClick={() => setCardTab("liked")}
                  >
                    {S.tabMostLiked}
                  </button>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "recent"}
                    onClick={() => setCardTab("recent")}
                  >
                    {S.tabNewest}
                  </button>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "critical"}
                    onClick={() => setCardTab("critical")}
                  >
                    {S.tabCritical}
                  </button>
                </div>
                <ul className="rp-comments" data-testid="rp-cards">
                  {cards.map((c) => (
                    <li key={c.id} className="rp-comment">
                      <div className="rp-comment-head">
                        <span className="rp-comment-who">
                          {/* A purged author is named as purged, not left
                              blank and not replaced with a plausible name. */}
                          {c.author_name ?? S.purgedAuthor}
                        </span>
                        <span
                          className="rp-chip"
                          data-label={c.label ?? "none"}
                        >
                          {c.label ? labels[c.label] : S.noLabel}
                          {c.label &&
                            !c.reviewed &&
                            typeof c.prediction?.class_scores?.[c.label] ===
                              "number" && (
                              <span className="rp-chip-score">
                                {Math.round(
                                  (c.prediction.class_scores[c.label] ?? 0) *
                                    100,
                                )}
                                {lang === "ar" ? "٪" : "%"}
                              </span>
                            )}
                        </span>
                      </div>
                      <p className="rp-comment-text">{commentText(c, S)}</p>
                      <div className="rp-comment-foot">
                        <span>{displayDate(c.published_at, lang)}</span>
                        <span>
                          {/* Unknown likes are said to be unknown. Rendering a
                              zero here would be a number we invented. */}
                          {c.likes_value === null
                            ? S.likesUnknown
                            : S.countLikes(n(c.likes_value))}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {cursorNotice && (
                  <p
                    role="status"
                    data-testid="cursor-notice"
                    className="muted"
                  >
                    {S.cursorReset}
                  </p>
                )}
                {/* Above the table, not under it.
                    It exports the whole filtered set, not the page on screen —
                    so it belongs with the thing it describes, before a reader
                    has scrolled twenty-five rows past the point where knowing
                    that would have helped. A control that only appears once
                    you have finished reading is one you find after you needed
                    it. */}
                <div className="export">
                  <button
                    type="button"
                    onClick={() => exporting.mutate()}
                    disabled={exporting.isPending}
                  >
                    {S.exportCsv}
                  </button>
                  <p className="muted">{S.exportNote(s.total)}</p>
                  {exporting.isError && (
                    <p role="alert" data-testid="export-error">
                      {S.exportFailed}
                    </p>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <caption>{S.commentsCaption}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{S.colAuthor}</th>
                        <th scope="col">{S.colComment}</th>
                        <th scope="col">{S.colSentiment}</th>
                        <th scope="col">{S.colDate}</th>
                        <th scope="col">{S.colCorrection}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.comments.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.author_name ?? S.purgedAuthor}
                            {c.is_reply && <small>{S.replyTag}</small>}
                          </td>
                          <td>{commentText(c, S)}</td>
                          <td>
                            {/* The cards a hundred pixels above wear a chip for
                                this. Printing it as bare text here made one
                                attribute look like two and left the column
                                impossible to scan. */}
                            <span
                              className="rp-chip"
                              data-label={c.label ?? "none"}
                            >
                              {c.label ? labels[c.label] : S.unanalysedOrOld}
                              {c.label &&
                                !c.reviewed &&
                                typeof c.prediction?.class_scores?.[c.label] ===
                                  "number" && (
                                  <span className="rp-chip-score">
                                    {Math.round(
                                      (c.prediction.class_scores[c.label] ??
                                        0) * 100,
                                    )}
                                    {lang === "ar" ? "٪" : "%"}
                                  </span>
                                )}
                            </span>

                            {c.reviewed && <small>{S.humanReview}</small>}
                            {/* The topic beside the sentiment, once a model
                                has run. "No topic" is said in words so an
                                empty cell is not mistaken for an unclassified
                                one: the two mean different things. */}
                            {s.active_topic_key && (
                              <span
                                className="rp-chip rp-chip-topic"
                                data-topic={c.topic ?? "none"}
                                data-testid="topic-chip"
                              >
                                {c.topic ? topicName(c.topic) : S.topicNone}
                                {c.topic_reviewed && (
                                  <small>{S.topicReviewed}</small>
                                )}
                              </span>
                            )}
                          </td>
                          <td>{displayDate(c.published_at, lang)}</td>
                          <td>
                            <button
                              type="button"
                              onClick={(e) => startReview(c, e.currentTarget)}
                              aria-label={S.correctLabelFor(
                                c.author_name ?? S.purgedAuthor,
                              )}
                            >
                              {S.correct}
                            </button>
                            {s.active_topic_key && (
                              <button
                                type="button"
                                onClick={(e) =>
                                  startTopicReview(c, e.currentTarget)
                                }
                                aria-label={S.correctTopicFor(
                                  c.author_name ?? S.purgedAuthor,
                                )}
                              >
                                {S.correctTopic}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                <nav className="pager" aria-label={S.pagerLabel}>
                  <button
                    type="button"
                    disabled={cursors.length === 0 || result.isFetching}
                    onClick={() => goTo(cursors.slice(0, -1))}
                  >
                    {S.previousPage}
                  </button>
                  <p data-testid="page-state" aria-live="polite">
                    {S.pageState(
                      cursors.length + 1,
                      s.comments.length,
                      s.total,
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={!s.next_cursor || result.isFetching}
                    onClick={() =>
                      s.next_cursor && goTo([...cursors, s.next_cursor])
                    }
                  >
                    {S.nextPage}
                  </button>
                </nav>
              </section>
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

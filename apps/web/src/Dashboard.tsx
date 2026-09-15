import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import "./report.css";
import { byHour, byWeek, byWeekday, commenters, plottable } from "./analytics";
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
} from "./data";
import { failureCode } from "./failure";
import { useSession, useWorkspaces } from "./session";
import { useWorkspaceSelection } from "./workspaceSelection";
import { WorkspaceGate } from "./WorkspaceGate";
import { workspaceState, readableWorkspace } from "./workspace";
import { videoLabel, displayDate, commentText } from "./i18n";
import { useLocale } from "./locale";
import { useStrings, type StringKey } from "./strings";
import { reviewHistory } from "./reviewHistory";
import { describeSource } from "./dataSource";
import {
  AXIS_TEXT,
  GRID_LINE,
  SENTIMENT,
  UNMEASURABLE,
  VOLUME,
  VOLUME_FILL,
} from "./chartTheme";
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

/** Numerals pinned: "ar" renders different digits per browser ICU build. */
const n = (v: number) => v.toLocaleString("en-US");

/* Chart defaults shared by the three timing panels, so they read as one
   family rather than three charts that happen to sit together. */
const axisText = AXIS_TEXT;
const gridLine = GRID_LINE;
const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: axisText }, grid: { display: false } },
    y: {
      beginAtZero: true,
      ticks: { color: axisText, precision: 0 },
      grid: { color: gridLine },
    },
  },
} as const;
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
    [sentiment, setSentiment] = useState("");
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
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 760px)");
    const onResize = () => setFiltersOpen(!mobile.matches);
    mobile.addEventListener("change", onResize);
    return () => mobile.removeEventListener("change", onResize);
  }, []);
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
    setVerdict(c.label ?? "neutral");
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
  function filtersFrom(over: { video?: string } = {}): Filters {
    const chosenVideo = over.video ?? video;
    // A range describes known dates, so it is not sent when the user has asked
    // for the rows that have no date at all.
    const ranged = dateMode !== "unknown";
    return {
      ...defaults,
      q: query,
      video_ids: chosenVideo ? [chosenVideo] : [],
      video_kind: (videoKind || undefined) as Filters["video_kind"],
      sentiments: sentiment ? [sentiment as Label] : [],
      replies,
      date_mode: dateMode,
      comment_type: commentType || undefined,
      review_status: reviewStatus,
      from:
        ranged && from
          ? new Date(from + "T00:00:00+03:00").toISOString()
          : undefined,
      to:
        ranged && to
          ? new Date(to + "T00:00:00+03:00").toISOString()
          : undefined,
    };
  }
  /** Narrowing the report: validate, drop the paging, and set them. */
  function applyFilters(over: { video?: string } = {}) {
    if (dateMode !== "unknown" && from && to && from >= to) {
      setFormError(S.dateOrderError);
      return;
    }
    setFormError("");
    setCursorNotice(false);
    setCursors([]);
    setFilters(filtersFrom(over));
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    applyFilters();
  }
  function reset() {
    setQuery("");
    setVideo("");
    setSentiment("");
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
    setLimit(25);
    setFilters(defaults);
  }
  // Which filters are actually narrowing the answer. Ten controls can be set
  // without the reader remembering they set them — and every figure on the
  // page is quietly conditional on them. Naming them is the difference
  // between a filtered report and a wrong one.
  const activeFilters = [
    query && S.chipSearch(query),
    video && S.chipVideo,
    sentiment && S.chipSentiment(labels[sentiment as Label] ?? sentiment),
    videoKind && S.chipVideoKind,
    commentType && S.chipCommentType,
    replies !== "all" &&
      (replies === "replies" ? S.chipRepliesOnly : S.chipCommentsOnly),
    reviewStatus !== "all" &&
      (reviewStatus === "reviewed" ? S.chipReviewedOnly : S.chipUnreviewedOnly),
    dateMode !== "all" &&
      (dateMode === "known" ? S.chipDatedOnly : S.chipUndatedOnly),
    (from || to) && S.chipPeriod,
  ].filter(Boolean) as string[];
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
    <div className="rp-page">
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
        {/* What the numbers below are conditional on, carried by the one bar
            that stays on screen. A reader who scrolled past the filter panel
            an hour ago has no other way to know the report is narrowed — and
            a narrowed report read as a whole one is not a smaller answer, it
            is a wrong one. */}
        {activeFilters.length > 0 ? (
          <p
            className="rp-scope rp-scope-filtered"
            data-testid="active-filters"
          >
            <span>{S.filteredLabel}</span>
            {activeFilters.map((f) => (
              <span key={f} className="rp-scope-chip">
                {f}
              </span>
            ))}
            <button type="button" onClick={reset}>
              {S.showAll}
            </button>
          </p>
        ) : (
          <span className="rp-scope">{source.scope}</span>
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
      <button
        className="rp-filter-toggle"
        type="button"
        aria-expanded={filtersOpen}
        aria-controls="report-filters"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {filtersOpen ? S.hideFilters : S.showFilters}
        <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
      </button>
      <form
        id="report-filters"
        aria-label={S.filtersLabel}
        hidden={!filtersOpen}
        onSubmit={apply}
        className="filters rp-card rp-filters"
      >
        <label>
          {S.searchLabel}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          {S.videoLabelText}
          <select
            aria-label={S.videoLabelText}
            value={video}
            onChange={(e) => setVideo(e.target.value)}
          >
            <option value="">{S.allVideos}</option>
            {/* Built from the videos actually in the current read. These were
                hard-coded to the two fixture ids, so a live account was
                offered a choice between two videos it does not have and none
                of the ones it does. */}
            {(s?.video_options ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {videoLabel(v.id, v.title, S)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {S.sentimentLabel}
          <select
            aria-label={S.sentimentLabel}
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value)}
          >
            <option value="">{S.allSentiments}</option>
            {Object.entries(labels).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          {S.videoKindLabel}
          <select
            aria-label={S.videoKindLabel}
            value={videoKind}
            onChange={(e) => setVideoKind(e.target.value)}
          >
            <option value="">{S.allKinds}</option>
            <option value="video">{S.kindVideo}</option>
            <option value="short">{S.kindShort}</option>
            <option value="stream">{S.kindStream}</option>
          </select>
        </label>
        <label>
          {S.participationLabel}
          <select
            aria-label={S.participationLabel}
            value={replies}
            onChange={(e) =>
              setReplies(e.target.value as "all" | "comments" | "replies")
            }
          >
            <option value="all">{S.commentsAndReplies}</option>
            <option value="comments">{S.originalOnly}</option>
            <option value="replies">{S.repliesOnly}</option>
          </select>
        </label>
        {/* Only when the data has types to offer. Comment types come from
            annotations, and nothing in the collection path writes them yet, so
            in live mode this was a control whose only option was "all" —
            something to operate that could not change the answer. */}
        {(result.data?.comment_types ?? []).length > 0 && (
          <label>
            {S.commentTypeLabel}
            <select
              aria-label={S.commentTypeLabel}
              value={commentType}
              onChange={(e) => setCommentType(e.target.value)}
            >
              <option value="">{S.allKinds}</option>
              {(result.data?.comment_types ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {S.reviewStatusLabel}
          <select
            aria-label={S.reviewStatusLabel}
            value={reviewStatus}
            onChange={(e) =>
              setReviewStatus(
                e.target.value as "all" | "reviewed" | "unreviewed",
              )
            }
          >
            <option value="all">{S.all}</option>
            <option value="reviewed">{S.reviewedByHuman}</option>
            <option value="unreviewed">{S.unreviewed}</option>
          </select>
        </label>
        <label>
          {S.dateLabel}
          <select
            aria-label={S.dateLabel}
            value={dateMode}
            onChange={(e) =>
              setDateMode(e.target.value as "all" | "known" | "unknown")
            }
          >
            <option value="all">{S.allDates}</option>
            <option value="known">{S.knownDates}</option>
            <option value="unknown">{S.unknownDates}</option>
          </select>
        </label>
        <label>
          {S.fromDate}
          <input
            type="date"
            value={from}
            disabled={dateMode === "unknown"}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {S.toDate}
          <input
            type="date"
            value={to}
            disabled={dateMode === "unknown"}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          {S.perPageLabel}
          <select
            aria-label={S.perPageLabel}
            value={limit}
            onChange={(e) => {
              goTo([]);
              setLimit(Number(e.target.value));
            }}
          >
            {[5, 10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="submit">{S.applyFilters}</button>
          <button type="button" onClick={reset}>
            {S.resetFilters}
          </button>
        </div>
      </form>
      <p className="muted">{S.periodNote}</p>
      {formError && <p role="alert">{formError}</p>}
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
                  {s.videos.map((v) => {
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
                            options={{
                              animation: false,
                              maintainAspectRatio: false,
                              cutout: "62%",
                              plugins: { legend: { display: false } },
                            }}
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
                  <article className="rp-card">
                    <h3>{S.topicsTitle}</h3>
                    {/* The reference groups comments into themes with a
                        language model. We have not built that layer, and
                        clustering by keyword would produce topic names nobody
                        chose and a chart that looks like analysis. */}
                    <p className="rp-missing">
                      <strong>{S.topicsUnavailableStrong}</strong>
                      {S.topicsUnavailableLead}
                    </p>
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
                        options={{ ...barOptions, animation: false }}
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
                          options={{ ...barOptions, animation: false }}
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
                          options={{ ...barOptions, animation: false }}
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
                    aria-label={S.reviewFormLabel}
                    onSubmit={(e) => {
                      e.preventDefault();
                      review.mutate();
                    }}
                  >
                    <h3>{S.reviewTitle}</h3>
                    <blockquote data-testid="review-text">
                      {commentText(reviewing, S)}
                    </blockquote>
                    <p className="muted">
                      {S.reviewCurrent(
                        reviewing.label
                          ? labels[reviewing.label]
                          : S.unanalysed,
                      )}
                    </p>
                    <div data-testid="review-history">
                      <h4>{S.reviewHistoryTitle}</h4>
                      {reviewing.reviews.length === 0 ? (
                        <p className="muted">{S.reviewHistoryEmpty}</p>
                      ) : (
                        <ol className="history">
                          {reviewHistory(reviewing).map(
                            ({ review: r, state }, i) => (
                              <li key={`${r.created_at}-${i}`}>
                                <strong>{labels[r.label]}</strong>
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
                        </ol>
                      )}
                    </div>
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
                    <label>
                      {S.correctionReason}
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        required
                      />
                    </label>
                    {review.isError && (
                      <p role="alert" data-testid="review-error">
                        {review.error.message === "stale_comment_text"
                          ? S.reviewStale
                          : S.reviewSaveFailed}
                      </p>
                    )}
                    <div>
                      <button type="submit" disabled={review.isPending}>
                        {S.saveCorrection}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          review.reset();
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

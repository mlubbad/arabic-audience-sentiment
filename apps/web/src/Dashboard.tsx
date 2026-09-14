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
  fixtureWorkspace,
  loadSnapshot,
  reviewsArePersisted,
  configuredMode,
  resolveMode,
  submitReview,
} from "./data";
import { useSession, useWorkspaces } from "./session";
import { workspaceState, readableWorkspace } from "./workspace";
import {
  labels,
  reviewStateMessages,
  videoLabel,
  displayDate,
  commentText,
  PURGED_AUTHOR,
} from "./i18n";
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
  return (
    <details className="rp-figures">
      <summary>عرض الأرقام</summary>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">تعليقات</th>
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
  const [chosen, setChosen] = useState<string | null>(null);
  if (sessionLoading)
    return (
      <div role="status" className="loading">
        جارٍ تحديد حسابك…
      </div>
    );
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  if (configuredMode === "live" && session) {
    if (workspacesLoading)
      return (
        <div role="status" className="loading">
          جارٍ تحميل مساحات العمل…
        </div>
      );
    if (workspacesFailed)
      return (
        <div role="alert" className="notice">
          تعذّرت قراءة مساحات عملك. حدّث الصفحة لإعادة المحاولة.
        </div>
      );
    if (place.kind === "no_workspaces")
      return (
        <div className="notice">
          <h1>لا توجد مساحة عمل لهذا الحساب بعد.</h1>
          <a href="/account">أنشئ مساحة عمل من صفحة الحساب</a>
        </div>
      );
    if (place.kind === "choose")
      return (
        <div className="notice" data-testid="ws-choose">
          <h1>اختر مساحة العمل التي تريد قراءة بياناتها</h1>
          <label>
            مساحة العمل
            <select
              value={chosen ?? ""}
              onChange={(e) => setChosen(e.target.value || null)}
            >
              <option value="">— اختر —</option>
              {place.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
  }
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
    <>
      {place.kind === "ready" && place.options.length > 1 && (
        <div className="notice">
          <label>
            مساحة العمل
            <select
              aria-label="تغيير مساحة العمل"
              value={place.id}
              onChange={(e) => setChosen(e.target.value)}
            >
              {place.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <DashboardBody
        key={`${userId}:${mode}:${workspaceId}`}
        userId={userId}
        mode={mode}
        workspaceId={workspaceId}
        workspaceName={place.kind === "ready" ? place.name : null}
      />
    </>
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
  const result = useQuery({
    // The mode is part of the key: the same filters mean different rows in
    // each, and a cached demo page must never be served as somebody's channel.
    queryKey: ["dashboard", userId, mode, page],
    queryFn: ({ signal }) => loadSnapshot(mode, page, signal),
    // Keep the current screen while the next one loads: the spec asks for a full
    // loading state only before there is anything to show, and a refresh
    // indicator afterwards. React Query still keys results by filter, so a late
    // response lands in its own cache entry and never repaints a newer screen.
    placeholderData: (previous, previousQuery) => {
      const oldKey = previousQuery?.queryKey;
      if (!Array.isArray(oldKey)) return undefined;
      const oldPage = oldKey[3] as Filters | undefined;
      return oldKey[1] === userId &&
        oldKey[2] === mode &&
        oldPage?.workspace_id === workspaceId
        ? previous
        : undefined;
    },
  });
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
      await client.invalidateQueries({ queryKey: ["dashboard"] });
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
  function apply(e: FormEvent) {
    e.preventDefault();
    if (dateMode !== "unknown" && from && to && from >= to) {
      setFormError("يجب أن يسبق تاريخ البداية تاريخ النهاية");
      return;
    }
    setFormError("");
    setCursorNotice(false);
    setCursors([]);
    // A range describes known dates, so it is not sent when the user has asked
    // for the rows that have no date at all.
    const ranged = dateMode !== "unknown";
    setFilters({
      ...defaults,
      q: query,
      video_ids: video ? [video] : [],
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
    });
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
  const s = result.data;
  // Aggregations for the charts, over every row the filters admit rather than
  // the page on screen. Memoised on the filtered array itself: it is a new
  // array only when the read or the filters actually changed.
  const rows = s?.filtered ?? [];
  const hours = useMemo(() => byHour(rows), [rows]);
  const weekdays = useMemo(() => byWeekday(rows), [rows]);
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
  });
  const span = s?.timeline ?? [];
  const range =
    span.length > 0
      ? `${span[0].date} — ${span[span.length - 1].date}`
      : "لا توجد تواريخ معروفة";
  return (
    <div className="rp-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">تقرير تحليلي · قناة يوتيوب</p>
        <h1>ماذا يقول جمهورك — وأين يقوله؟</h1>
        {/* Before the read returns there is no count, and `?? 0` would have
            printed "قراءة 0 تعليقًا" over a page that is still loading —
            unknown rendered as a measurement of none. The banner says what it
            is doing instead, and the figures appear when they exist. */}
        {s ? (
          <>
            <p>
              قراءة {n(s.total)} تعليقًا عبر {s.videos.length} فيديو، مع من
              قالها ومتى. كل رقم أدناه محسوب من الصفوف المحفوظة — لا تقدير ولا
              استقراء.
            </p>
            <div className="rp-pills">
              <span className="rp-pill">{range}</span>
              <span className="rp-pill">{n(s.total)} تعليقًا</span>
              <span className="rp-pill">
                {n(s.unique_authors)} معلّقًا معروفًا
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
                <span>من {n(s.analysed)} تعليقًا مصنَّفًا:</span>
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
          <p>جارٍ قراءة التعليقات المحفوظة…</p>
        )}
      </header>
      <nav className="rp-nav" aria-label="أقسام التقرير">
        <div className="rp-nav-links">
          <a href="#rp-summary">الملخص</a>
          <a href="#rp-videos">الفيديوهات</a>
          <a href="#rp-voice">صوت الجمهور</a>
          <a href="#rp-timing">التوقيت</a>
          <a href="#rp-people">المعلّقون</a>
          <a href="#rp-comments">التعليقات</a>
        </div>
        <span className="rp-scope">{source.scope}</span>
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
        {filtersOpen ? "إخفاء الفلاتر" : "إظهار الفلاتر"}
        <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
      </button>
      <form
        id="report-filters"
        aria-label="فلاتر التقرير"
        hidden={!filtersOpen}
        onSubmit={apply}
        className="filters rp-card rp-filters"
      >
        <label>
          البحث في التعليقات والمؤلفين
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          الفيديو
          <select
            aria-label="الفيديو"
            value={video}
            onChange={(e) => setVideo(e.target.value)}
          >
            <option value="">كل الفيديوهات</option>
            {/* Built from the videos actually in the current read. These were
                hard-coded to the two fixture ids, so a live account was
                offered a choice between two videos it does not have and none
                of the ones it does. */}
            {(s?.video_options ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {videoLabel(v.id, v.title)}
              </option>
            ))}
          </select>
        </label>
        <label>
          المشاعر
          <select
            aria-label="المشاعر"
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value)}
          >
            <option value="">كل المشاعر</option>
            {Object.entries(labels).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          نوع الفيديو
          <select
            aria-label="نوع الفيديو"
            value={videoKind}
            onChange={(e) => setVideoKind(e.target.value)}
          >
            <option value="">كل الأنواع</option>
            <option value="video">فيديو</option>
            <option value="short">شورت</option>
            <option value="stream">بث</option>
          </select>
        </label>
        <label>
          نوع المشاركة
          <select
            aria-label="نوع المشاركة"
            value={replies}
            onChange={(e) =>
              setReplies(e.target.value as "all" | "comments" | "replies")
            }
          >
            <option value="all">تعليقات وردود</option>
            <option value="comments">تعليقات أصلية فقط</option>
            <option value="replies">ردود فقط</option>
          </select>
        </label>
        {/* Only when the data has types to offer. Comment types come from
            annotations, and nothing in the collection path writes them yet, so
            in live mode this was a control whose only option was "all" —
            something to operate that could not change the answer. */}
        {(result.data?.comment_types ?? []).length > 0 && (
          <label>
            نوع التعليق
            <select
              aria-label="نوع التعليق"
              value={commentType}
              onChange={(e) => setCommentType(e.target.value)}
            >
              <option value="">كل الأنواع</option>
              {(result.data?.comment_types ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          حالة المراجعة
          <select
            aria-label="حالة المراجعة"
            value={reviewStatus}
            onChange={(e) =>
              setReviewStatus(
                e.target.value as "all" | "reviewed" | "unreviewed",
              )
            }
          >
            <option value="all">الكل</option>
            <option value="reviewed">مراجَعة بشريًا</option>
            <option value="unreviewed">دون مراجعة</option>
          </select>
        </label>
        <label>
          التاريخ
          <select
            aria-label="التاريخ"
            value={dateMode}
            onChange={(e) =>
              setDateMode(e.target.value as "all" | "known" | "unknown")
            }
          >
            <option value="all">كل التواريخ</option>
            <option value="known">التواريخ المعروفة</option>
            <option value="unknown">بلا تاريخ معروف</option>
          </select>
        </label>
        <label>
          من تاريخ
          <input
            type="date"
            value={from}
            disabled={dateMode === "unknown"}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          إلى تاريخ (غير شامل)
          <input
            type="date"
            value={to}
            disabled={dateMode === "unknown"}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          عدد التعليقات في الصفحة
          <select
            aria-label="عدد التعليقات في الصفحة"
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
          <button type="submit">تطبيق الفلاتر</button>
          <button type="button" onClick={reset}>
            إعادة ضبط الفلاتر
          </button>
        </div>
      </form>
      <p className="muted">
        الفترة حسب تاريخ نشر التعليق بتوقيت إسطنبول. التواريخ غير المعروفة تظهر
        عند عرض كل الفترات.
      </p>
      {formError && <p role="alert">{formError}</p>}
      {result.isPending && (
        <div role="status" data-testid="loading" className="loading">
          جارٍ تحميل التعليقات…
        </div>
      )}
      {!result.isPending && result.isFetching && (
        <p role="status" data-testid="updating" className="updating">
          جارٍ تحديث النتائج…
        </p>
      )}
      {result.isError && (
        <div role="alert" className="notice">
          <p>تعذر تحميل البيانات. حاول مرة أخرى.</p>
          <button onClick={() => void result.refetch()}>إعادة المحاولة</button>
        </div>
      )}
      {s && (
        <>
          <section className="rp-section" id="rp-summary">
            <header>
              <h2>الملخص</h2>
              <p className="rp-sub">
                الأرقام أدناه تتبع الفلاتر المطبَّقة أعلاه.
                {s.channel_own_comments > 0 && (
                  <>
                    {" "}
                    <span data-testid="owner-excluded">
                      وتستبعد {n(s.channel_own_comments)} ردًّا من القناة نفسها:
                      ردُّ القناة على متابعيها ليس رأي جمهورها، ولا يدخل في أي
                      مقام هنا. لذلك يقل الإجمالي عمّا يظهر على يوتيوب بهذا
                      العدد.
                    </span>
                  </>
                )}
              </p>
            </header>
            <div className="rp-grid rp-grid-5" aria-label="المؤشرات">
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">التعليقات والردود</span>
                <strong className="rp-metric-value" data-testid="total">
                  {n(s.total)}
                </strong>
                <span className="rp-metric-note">كل ما تطابق مع الفلاتر.</span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">المحلَّلة</span>
                <strong className="rp-metric-value">{n(s.analysed)}</strong>
                <span className="rp-metric-note">
                  تحمل تصنيفًا صالحًا للتحليل الحالي.
                </span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">
                  غير المحلَّلة أو القديمة
                </span>
                <strong className="rp-metric-value">{n(s.unanalysed)}</strong>
                <span className="rp-metric-note">
                  محفوظة، ولا تدخل في نسب المشاعر.
                </span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">الردود</span>
                <strong className="rp-metric-value" data-testid="replies-count">
                  {n(s.replies)}
                </strong>
                <span className="rp-metric-note">
                  ردود على تعليقات، لا تعليقات أصلية.
                </span>
              </article>
              <article className="rp-card rp-metric">
                <span className="rp-metric-label">معلّقون معروفون</span>
                <strong className="rp-metric-value">
                  {n(s.unique_authors)}
                </strong>
                <span className="rp-metric-note">
                  {/* Counted by channel id. Rows whose author was purged are
                      not countable as people and are excluded rather than
                      guessed at. */}
                  محسوبون بمعرّف القناة، لا بالاسم المعروض.
                </span>
              </article>
            </div>
            <div
              className="rp-grid rp-grid-4"
              style={{ marginTop: "var(--space-4)" }}
            >
              <article className="rp-insight">
                <p className="rp-insight-tag">استنتاج 1</p>
                <p>
                  {s.total > 0
                    ? `حُلِّل ${Math.round((s.analysed / s.total) * 100)}٪ من التعليقات المطابقة. الباقي محفوظ بلا تصنيف، ولا يدخل في أي نسبة مشاعر.`
                    : "لا توجد تعليقات مطابقة، فلا نسبة تحليل يمكن ذكرها."}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">استنتاج 2</p>
                <p>
                  {s.total > 0
                    ? `${Math.round((s.replies / s.total) * 100)}٪ منها ردود — أي حوار بين المشاهدين أنفسهم لا خطاب موجَّه إلى القناة.`
                    : "لا بيانات كافية لقياس نسبة الردود."}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">استنتاج 3</p>
                <p>
                  {s.videos.length > 0
                    ? `أنشط فيديو جمع ${n(s.videos[0].total)} تعليقًا من أصل ${n(s.total)} — أي ${Math.round((s.videos[0].total / s.total) * 100)}٪ من الحديث كله.`
                    : "لا فيديو ضمن الفلاتر الحالية."}
                </p>
              </article>
              <article className="rp-insight">
                <p className="rp-insight-tag">استنتاج 4</p>
                <p>
                  {s.unknown_dates > 0
                    ? `${n(s.unknown_dates)} تعليقًا بلا تاريخ معروف. لا تظهر في رسوم التوقيت، ولم تُوضع في خانة افتراضية.`
                    : "كل التعليقات المطابقة تحمل تاريخًا معروفًا."}
                </p>
              </article>
            </div>
          </section>
          {s.total === 0 ? (
            <section className="empty">
              <h2>لا توجد تعليقات مطابقة</h2>
              <p>غيّر الفلاتر أو أعد ضبطها لعرض بيانات الاختبار.</p>
            </section>
          ) : (
            <>
              <section className="rp-section" id="rp-videos">
                <header>
                  <h2>الفيديوهات</h2>
                  <p className="rp-sub">
                    اضغط أي فيديو لتصفية اللوحة كاملة عليه. الأرقام مشتقة من
                    التعليقات المحفوظة، لا من مؤشرات يوتيوب للفيديو.
                  </p>
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
                            // other, so it goes through the same apply path
                            // and resets paging rather than leaving a cursor
                            // pointing into the previous result set.
                            const next = video === v.id ? "" : v.id;
                            setVideo(next);
                            goTo([]);
                            setFilters((f) => ({
                              ...f,
                              video_id: next || undefined,
                            }));
                          }}
                        >
                          <span>
                            <span className="rp-video-title">
                              {videoLabel(v.id, v.title)}
                            </span>
                            <span className="rp-video-meta">
                              <span>{n(v.total)} تعليقًا</span>
                              <span>{n(v.replies)} ردًّا</span>
                              <span>{n(v.analysed)} محلَّلًا</span>
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
                            <span>تعليقًا</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section className="rp-section" id="rp-voice">
                <header>
                  <h2>صوت الجمهور</h2>
                  <p className="rp-sub">
                    المقام: {n(s.analysed)} تعليقًا ذا تصنيف صالح — لا العدد
                    الكلي. المشاعر المختلطة فئة مستقلة، لا وسط بين طرفين.
                  </p>
                </header>
                <div className="rp-grid rp-grid-2">
                  <article className="rp-card">
                    <h3>المشاعر</h3>
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
                                    <>
                                      {labels[key as Label]}: {n(v)} (
                                      {s.analysed
                                        ? Math.round((v / s.analysed) * 100)
                                        : 0}
                                      ٪)
                                    </>
                                  ) : (
                                    <span data-testid={`unmeasurable-${key}`}>
                                      {labels[key as Label]}: لا يقيسه النموذج
                                      الحالي
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
                        <strong>لا يوجد تصنيف بعد</strong>
                        التعليقات محفوظة ولم يُشغَّل عليها نموذج تصنيف، فلا توجد
                        نسبة مشاعر تُعرض. هذا غياب تحليل، لا حياد جمهور.
                      </p>
                    )}
                  </article>
                  <article className="rp-card">
                    <h3>الموضوعات</h3>
                    {/* The reference groups comments into themes with a
                        language model. We have not built that layer, and
                        clustering by keyword would produce topic names nobody
                        chose and a chart that looks like analysis. */}
                    <p className="rp-missing">
                      <strong>غير متاح بعد</strong>
                      تصنيف التعليقات إلى موضوعات يحتاج طبقة نموذج لغوي لم تُبنَ
                      بعد. لن يُعرض هنا رسم مشتق من كلمات مفتاحية ويُقدَّم كأنه
                      تحليل موضوعي.
                    </p>
                  </article>
                </div>
                <div
                  className="rp-grid rp-grid-3"
                  style={{ marginTop: "var(--space-4)" }}
                >
                  <article className="rp-deep">
                    <strong>{n(s.sentiments.positive)}</strong>
                    <p>تعليقًا إيجابيًا ضمن المحلَّل.</p>
                  </article>
                  <article className="rp-deep">
                    <strong>{n(s.sentiments.negative)}</strong>
                    <p>
                      تعليقًا سلبيًا — وهي التي تستحق قراءة نصّها لا نسبتها.
                    </p>
                  </article>
                  <article className="rp-deep">
                    <strong>{n(s.unanalysed)}</strong>
                    <p>بلا تصنيف بعد، ولا تدخل في أي نسبة أعلاه.</p>
                  </article>
                </div>
              </section>
              <section className="rp-section" id="rp-timing">
                <header>
                  <h2>توقيت التفاعل</h2>
                  <p className="rp-sub">
                    متى يصل التعليق. تعليق بتوقيت تقريبي («منذ ٣ أشهر») لا يمكن
                    وضعه في ساعة، فيُستبعد ويُذكر عدده بدل أن يُسنَد إلى منتصف
                    الليل.
                  </p>
                </header>
                <article className="rp-card">
                  <h3>التعليقات أسبوعيًا</h3>
                  {!plottable(weeks, 3) ? (
                    <p className="rp-missing" data-testid="weeks-unplottable">
                      <strong>لا يكفي لرسم اتجاه</strong>
                      التعليقات المطابقة تقع في أقل من ثلاثة أسابيع. رسم خط
                      عبرها كان سيبدو قياسًا لاتجاه، ولا يوجد اتجاه بعد.
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
                      caption="التعليقات المطابقة، حسب الأسبوع"
                      unit="الأسبوع"
                      buckets={weeks.buckets}
                    />
                  )}
                  <p className="rp-metric-note">
                    {weeks.unplaceable > 0
                      ? `${n(weeks.unplaceable)} تعليقًا بلا تاريخ صالح لم يدخل هذا الرسم.`
                      : "كل التعليقات المطابقة دخلت هذا الرسم."}
                  </p>
                </article>
                <div
                  className="rp-grid rp-grid-2"
                  style={{ marginTop: "var(--space-4)" }}
                >
                  <article className="rp-card">
                    <h3>حسب ساعة اليوم</h3>
                    {!plottable(hours) ? (
                      <p className="rp-missing">
                        <strong>لا يكفي لرسم توزيع</strong>
                        ساعة واحدة أو أقل تحمل تعليقًا. أعمدة فارغة عبر اليوم
                        كانت ستقول إننا قِسنا فوجدنا سكونًا.
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
                        caption="التعليقات المطابقة، حسب ساعة اليوم"
                        unit="الساعة"
                        buckets={hours.buckets}
                      />
                    )}
                    <p className="rp-metric-note" data-testid="hours-excluded">
                      {hours.unplaceable > 0
                        ? `${n(hours.unplaceable)} تعليقًا بتوقيت أخشن من الساعة، مستبعَد من هذا الرسم.`
                        : "كل التعليقات المطابقة قابلة للوضع في ساعة."}
                    </p>
                  </article>
                  <article className="rp-card">
                    <h3>حسب يوم الأسبوع</h3>
                    {!plottable(weekdays) ? (
                      <p className="rp-missing">
                        <strong>لا يكفي لرسم توزيع</strong>
                        يوم واحد أو أقل يحمل تعليقًا ضمن الفلاتر الحالية.
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
                        caption="التعليقات المطابقة، حسب يوم الأسبوع"
                        unit="اليوم"
                        buckets={weekdays.buckets}
                      />
                    )}
                    <p className="rp-metric-note">اليوم بتوقيت متصفحك.</p>
                    <p className="rp-metric-note">
                      تعليقات بلا تاريخ:{" "}
                      <span data-testid="unknown-dates">{s.unknown_dates}</span>
                    </p>
                  </article>
                </div>
              </section>
              <section className="rp-section" id="rp-people">
                <header>
                  <h2>المعلّقون</h2>
                  <p className="rp-sub">
                    من يتحدّث، ومن يجد صدى. الهوية بمعرّف القناة لا بالاسم
                    المعروض: شخصان قد يتشابه اسمهما، ودمجهما يخترع معلّقًا لا
                    وجود له.
                  </p>
                </header>
                <article className="rp-card">
                  <div className="rp-tabs" style={{ marginBottom: "16px" }}>
                    <button
                      type="button"
                      className="rp-tab"
                      aria-pressed={peopleBy === "comments"}
                      onClick={() => setPeopleBy("comments")}
                    >
                      الأكثر نشاطًا
                    </button>
                    <button
                      type="button"
                      className="rp-tab"
                      aria-pressed={peopleBy === "likes"}
                      onClick={() => setPeopleBy("likes")}
                    >
                      الأكثر تأثيرًا
                    </button>
                  </div>
                  {people.ranked.length === 0 ? (
                    <p className="rp-missing">
                      <strong>لا يوجد معلّق يمكن عدّه</strong>
                      لا تحمل الصفوف المطابقة اسم كاتب — إمّا لعدم وجود تعليقات،
                      أو لأن الأسماء حُذفت تحت قاعدة الاحتفاظ.
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
                            {n(c.comments)} تعليقًا
                          </span>
                          <span className="rp-person-likes">
                            {/* Unknown stays unknown: a source that showed no
                                count is not a source that showed zero. */}
                            {c.likes === null
                              ? "إعجابات غير معروفة"
                              : `${n(c.likes)} إعجابًا`}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {people.anonymous > 0 && (
                    <p className="rp-metric-note" data-testid="rp-anonymous">
                      {n(people.anonymous)} تعليقًا كاتبها محذوف تحت قاعدة
                      الاحتفاظ. لم يُدمج في معلّق واحد، ولا يظهر في الترتيب.
                    </p>
                  )}
                </article>
              </section>
              <section
                className="rp-section"
                aria-labelledby="comparison-heading"
              >
                <header>
                  <h2 id="comparison-heading">مقارنة الفيديوهات</h2>
                </header>
                <p className="muted" data-testid="comparison-scope">
                  أرقام مشتقة من التعليقات ضمن الفلاتر الحالية فقط. ليست مؤشرات
                  الفيديو الكلية: لتلك نطاق وتاريخ رصد مستقلان.
                </p>
                {s.comparison_truncated && (
                  <p className="muted">
                    تُقارَن الفيديوهات الأكثر تعليقًا فقط؛ بقية الفيديوهات ضمن
                    الفلاتر غير معروضة هنا.
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <caption>مقارنة الفيديوهات ضمن الفلاتر</caption>
                    <thead>
                      <tr>
                        <th scope="col">الفيديو</th>
                        <th scope="col">التعليقات</th>
                        <th scope="col">الردود</th>
                        <th scope="col">المحللة</th>
                        <th scope="col">التوزيع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.comparison.map((v) => (
                        <tr key={v.id} data-testid={`compare-${v.id}`}>
                          <td>{videoLabel(v.id, v.title)}</td>
                          <td>{v.total}</td>
                          <td>{v.replies}</td>
                          <td>{v.analysed}</td>
                          <td>
                            {v.analysed === 0 ? (
                              <small>لا توجد تعليقات محللة ضمن الفلاتر</small>
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
                                        {labels[k as Label]} {n} (
                                        {Math.round((n / v.analysed) * 100)}٪)
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
                aria-labelledby="engaged-heading"
                data-testid="engaged-panel"
              >
                <header>
                  <h2 id="engaged-heading">أكثر التعليقات السلبية تفاعلًا</h2>
                </header>
                <p className="muted">
                  ترتيب حسب الإعجابات ضمن الفلاتر الحالية. الإعجابات لا تُرجِّح
                  التصنيف، وقلب صاحب القناة ليس مشاعر إيجابية.
                </p>
                {s.most_engaged_negative.length === 0 ? (
                  <p data-testid="engaged-empty">
                    لا توجد تعليقات سلبية بإعجابات معروفة ضمن الفلاتر.
                  </p>
                ) : (
                  <ol className="engaged">
                    {s.most_engaged_negative.map((c) => (
                      <li key={c.id} data-testid={`engaged-${c.id}`}>
                        <strong>{c.likes_raw ?? c.likes_value}</strong> إعجابًا
                        — {commentText(c)}
                        {c.reviewed && <small>مراجعة بشرية</small>}
                      </li>
                    ))}
                  </ol>
                )}
                {s.negative_ranked > s.most_engaged_negative.length && (
                  <p className="muted" data-testid="engaged-truncated">
                    تُعرض {s.most_engaged_negative.length} من{" "}
                    {s.negative_ranked} تعليقًا سلبيًا لها عدد إعجابات معروف.
                  </p>
                )}
                {s.negative_unranked > 0 && (
                  <p className="muted" data-testid="engaged-unranked">
                    {s.negative_unranked} تعليقًا سلبيًا بلا عدد إعجابات معروف،
                    فلم تدخل الترتيب. عدد غير معروف ليس صفرًا.
                  </p>
                )}
              </section>
              <section
                className="rp-section"
                id="rp-comments"
                data-testid="comments-table"
              >
                <header>
                  <h2>التعليقات</h2>
                  <p className="rp-sub">
                    اضغط أي بطاقة لقراءة التعليق كاملًا، والجدول تحتها هو مكان
                    التصحيح والتصدير والتنقّل بين الصفحات.
                  </p>
                </header>
                <div className="rp-tabs" style={{ marginBottom: "16px" }}>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "liked"}
                    onClick={() => setCardTab("liked")}
                  >
                    الأكثر إعجابًا
                  </button>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "recent"}
                    onClick={() => setCardTab("recent")}
                  >
                    الأحدث
                  </button>
                  <button
                    type="button"
                    className="rp-tab"
                    aria-pressed={cardTab === "critical"}
                    onClick={() => setCardTab("critical")}
                  >
                    النقدية
                  </button>
                </div>
                <ul className="rp-comments" data-testid="rp-cards">
                  {cards.map((c) => (
                    <li key={c.id} className="rp-comment">
                      <div className="rp-comment-head">
                        <span className="rp-comment-who">
                          {/* A purged author is named as purged, not left
                              blank and not replaced with a plausible name. */}
                          {c.author_name ?? PURGED_AUTHOR}
                        </span>
                        <span
                          className="rp-chip"
                          data-label={c.label ?? "none"}
                        >
                          {c.label ? labels[c.label] : "بلا تصنيف"}
                        </span>
                      </div>
                      <p className="rp-comment-text">{commentText(c)}</p>
                      <div className="rp-comment-foot">
                        <span>{displayDate(c.published_at)}</span>
                        <span>
                          {/* Unknown likes are said to be unknown. Rendering a
                              zero here would be a number we invented. */}
                          {c.likes_value === null
                            ? "إعجابات غير معروفة"
                            : `${n(c.likes_value)} إعجابًا`}
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
                    تغيّرت النتائج فأُعيد العرض من الصفحة الأولى.
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <caption>التعليقات ضمن الفلاتر</caption>
                    <thead>
                      <tr>
                        <th scope="col">المؤلف</th>
                        <th scope="col">التعليق</th>
                        <th scope="col">المشاعر</th>
                        <th scope="col">التاريخ</th>
                        <th scope="col">التصحيح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.comments.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.author_name ?? PURGED_AUTHOR}
                            {c.is_reply && <small>رد</small>}
                          </td>
                          <td>{commentText(c)}</td>
                          <td>
                            {/* The cards a hundred pixels above wear a chip for
                                this. Printing it as bare text here made one
                                attribute look like two and left the column
                                impossible to scan. */}
                            <span
                              className="rp-chip"
                              data-label={c.label ?? "none"}
                            >
                              {c.label ? labels[c.label] : "غير محلل / قديم"}
                            </span>
                            {c.reviewed && <small>مراجعة بشرية</small>}
                          </td>
                          <td>{displayDate(c.published_at)}</td>
                          <td>
                            <button
                              type="button"
                              onClick={(e) => startReview(c, e.currentTarget)}
                              aria-label={`تصحيح تصنيف تعليق ${c.author_name}`}
                            >
                              تصحيح
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
                    aria-label="تصحيح التصنيف"
                    onSubmit={(e) => {
                      e.preventDefault();
                      review.mutate();
                    }}
                  >
                    <h3>تصحيح تصنيف تعليق</h3>
                    <blockquote data-testid="review-text">
                      {commentText(reviewing)}
                    </blockquote>
                    <p className="muted">
                      التصنيف الحالي:{" "}
                      {reviewing.label ? labels[reviewing.label] : "غير محلل"}.
                      التصحيح البشري يلغي تنبؤ النموذج لهذا النص، ويسقط تلقائيًا
                      إذا تغيّر نص التعليق لاحقًا.
                    </p>
                    <div data-testid="review-history">
                      <h4>سجل المراجعات</h4>
                      {reviewing.reviews.length === 0 ? (
                        <p className="muted">
                          لا توجد مراجعات سابقة لهذا التعليق.
                        </p>
                      ) : (
                        <ol className="history">
                          {reviewHistory(reviewing).map(
                            ({ review: r, state }, i) => (
                              <li key={`${r.created_at}-${i}`}>
                                <strong>{labels[r.label]}</strong>
                                <span>{displayDate(r.created_at)}</span>
                                <span data-testid="review-by">
                                  {r.reviewer_id ?? "مراجع غير معروف"}
                                </span>
                                <small data-state={state}>
                                  {reviewStateMessages[state]}
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
                      التصنيف الصحيح
                      <select
                        aria-label="التصنيف الصحيح"
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
                      سبب التصحيح
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
                          ? "تغيّر نص التعليق بعد فتح هذه الشاشة. أعد قراءته ثم صحّح التصنيف."
                          : "تعذر حفظ التصحيح. حاول مرة أخرى."}
                      </p>
                    )}
                    <div>
                      <button type="submit" disabled={review.isPending}>
                        حفظ التصحيح
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          review.reset();
                          closeReview();
                        }}
                      >
                        إلغاء
                      </button>
                    </div>
                    {!reviewsArePersisted(mode) && (
                      <p className="muted" data-testid="review-scope">
                        وضع البيانات الاصطناعية: يُحفظ التصحيح في هذه الجلسة فقط
                        ولا يُرسل إلى أي خادم.
                      </p>
                    )}
                  </form>
                )}
                <div className="export">
                  <button
                    type="button"
                    onClick={() => exporting.mutate()}
                    disabled={exporting.isPending}
                  >
                    تصدير CSV
                  </button>
                  <p className="muted">
                    يصدّر كل التعليقات المطابقة للفلاتر الحالية ({s.total}) وليس
                    الصفحة المعروضة فقط. تُعطَّل صيغ الجداول في الملف دون تغيير
                    النص المخزن.
                  </p>
                  {exporting.isError && (
                    <p role="alert" data-testid="export-error">
                      تعذر إنشاء ملف التصدير. حاول مرة أخرى.
                    </p>
                  )}
                </div>
                <nav className="pager" aria-label="تصفح التعليقات">
                  <button
                    type="button"
                    disabled={cursors.length === 0 || result.isFetching}
                    onClick={() => goTo(cursors.slice(0, -1))}
                  >
                    الصفحة السابقة
                  </button>
                  <p data-testid="page-state" aria-live="polite">
                    الصفحة {cursors.length + 1} — عرض {s.comments.length} من{" "}
                    {s.total} تعليقًا ضمن الفلاتر
                  </p>
                  <button
                    type="button"
                    disabled={!s.next_cursor || result.isFetching}
                    onClick={() =>
                      s.next_cursor && goTo([...cursors, s.next_cursor])
                    }
                  >
                    الصفحة التالية
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

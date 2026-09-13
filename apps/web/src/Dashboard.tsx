import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import {
  budgetState,
  type Filters,
  type Label,
  type LabelledComment,
} from "@sentiment/contracts";
import {
  buildExport,
  fixtureWorkspace,
  loadSnapshot,
  reviewsArePersisted,
  dataMode,
  submitReview,
} from "./data";
import {
  labels,
  budgetNames,
  budgetMessages,
  reviewStateMessages,
  videoLabel,
  syncMessages,
  syncErrorMessages,
  displayDate,
  commentText,
  PURGED_AUTHOR,
} from "./i18n";
import { reviewHistory } from "./reviewHistory";
import { describeSource } from "./dataSource";
import { syncHealth } from "./syncHealth";
ChartJS.register(ArcElement, Tooltip, Legend);
const defaults: Filters = { workspace_id: fixtureWorkspace };
export function Dashboard() {
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
  const page = { ...filters, limit, cursor: cursors.at(-1) };
  const result = useQuery({
    queryKey: ["fixture-dashboard", page],
    queryFn: ({ signal }) => loadSnapshot(page, signal),
    // Keep the current screen while the next one loads: the spec asks for a full
    // loading state only before there is anything to show, and a refresh
    // indicator afterwards. React Query still keys results by filter, so a late
    // response lands in its own cache entry and never repaints a newer screen.
    placeholderData: (previous) => previous,
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
      submitReview({
        workspace_id: filters.workspace_id,
        comment_id: reviewing!.id,
        content_hash: reviewing!.content_hash,
        label: verdict,
        reason,
      }),
    onSuccess: async () => {
      closeReview();
      setReason("");
      // Re-read through the same snapshot path so the corrected label, the
      // sentiment denominator and the review filter all move together.
      await client.invalidateQueries({ queryKey: ["fixture-dashboard"] });
    },
  });
  const exporting = useMutation({
    mutationFn: () => buildExport(page),
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
  // Every sentence in the header comes from the values that decide behaviour,
  // so the label and the truth cannot drift apart.
  const source = describeSource({
    mode: dataMode,
    workspaceId: filters.workspace_id,
    persisted: reviewsArePersisted,
    sync: s?.sync ?? null,
    total: s?.total ?? null,
    now: new Date(),
  });
  return (
    <>
      <h1>لوحة مشاعر الجمهور</h1>
      <aside
        className={source.tone === "warning" ? "notice" : "notice source-live"}
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
      <form onSubmit={apply} className="filters">
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
            <option value="video-1">فيديو اصطناعي ١</option>
            <option value="video-2">فيديو اصطناعي ٢</option>
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
          <section className="metrics" aria-label="المؤشرات">
            <article>
              <h2>التعليقات والردود</h2>
              <strong data-testid="total">{s.total}</strong>
            </article>
            <article>
              <h2>المحللة</h2>
              <strong>{s.analysed}</strong>
            </article>
            <article>
              <h2>غير المحللة أو القديمة</h2>
              <strong>{s.unanalysed}</strong>
            </article>
            <article>
              <h2>الردود</h2>
              <strong data-testid="replies-count">{s.replies}</strong>
            </article>
          </section>
          {s.total === 0 ? (
            <section className="empty">
              <h2>لا توجد تعليقات مطابقة</h2>
              <p>غيّر الفلاتر أو أعد ضبطها لعرض بيانات الاختبار.</p>
            </section>
          ) : (
            <>
              <section className="split">
                <article>
                  <h2>توزيع المشاعر</h2>
                  <p>
                    المقام: {s.analysed} تعليقًا ذا تصنيف صالح. المشاعر المختلطة
                    مستقلة.
                  </p>
                  {s.analysed > 0 && (
                    <div className="chart" aria-hidden="true">
                      <Doughnut
                        data={{
                          labels: Object.values(labels),
                          datasets: [
                            {
                              data: Object.values(s.sentiments),
                              backgroundColor: [
                                "#237a57",
                                "#bc4040",
                                "#697786",
                                "#ad792b",
                              ],
                              borderWidth: 2,
                            },
                          ],
                        }}
                        options={{
                          animation: false,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                        }}
                      />
                    </div>
                  )}
                  <ul>
                    {Object.entries(s.sentiments).map(([key, n]) => (
                      <li key={key}>
                        {labels[key as Label]}: {n} (
                        {s.analysed ? Math.round((n / s.analysed) * 100) : 0}٪)
                      </li>
                    ))}
                  </ul>
                </article>
                <article>
                  <h2>الفيديوهات ضمن الفلاتر</h2>
                  <ul>
                    {s.videos.map((v) => (
                      <li key={v.id}>
                        {videoLabel(v.id)}: {v.total}
                      </li>
                    ))}
                  </ul>
                  <h2>التواريخ المتاحة</h2>
                  <ul>
                    {s.timeline.map((t) => (
                      <li key={t.date}>
                        {t.date === "unknown" ? "غير معروف" : t.date}: {t.total}
                      </li>
                    ))}
                  </ul>
                  <p>معرّفات المؤلفين المتاحة: {s.unique_authors}</p>
                  <p>
                    تعليقات بلا تاريخ:{" "}
                    <span data-testid="unknown-dates">{s.unknown_dates}</span>
                  </p>
                </article>
              </section>
              <section aria-labelledby="comparison-heading">
                <h2 id="comparison-heading">مقارنة الفيديوهات</h2>
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
                  <table aria-label="مقارنة الفيديوهات ضمن الفلاتر">
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
                          <td>{videoLabel(v.id)}</td>
                          <td>{v.total}</td>
                          <td>{v.replies}</td>
                          <td>{v.analysed}</td>
                          <td>
                            {v.analysed === 0 ? (
                              <small>لا توجد تعليقات محللة ضمن الفلاتر</small>
                            ) : (
                              <ul className="share">
                                {Object.entries(v.sentiments).map(([k, n]) => (
                                  <li key={k}>
                                    {labels[k as Label]} {n} (
                                    {Math.round((n / v.analysed) * 100)}٪)
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section
                aria-labelledby="engaged-heading"
                data-testid="engaged-panel"
              >
                <h2 id="engaged-heading">أكثر التعليقات السلبية تفاعلًا</h2>
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
              <section data-testid="comments-table">
                <h2>التعليقات</h2>
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
                  <table aria-label="التعليقات ضمن الفلاتر">
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
                            {c.label ? labels[c.label] : "غير محلل / قديم"}
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
                    {!reviewsArePersisted && (
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
          <section aria-labelledby="plan-heading" data-testid="plan-panel">
            <h2 id="plan-heading">حدود الخطة</h2>
            {s.plan === null ? (
              <p data-testid="plan-none">
                لا توجد خطة مفعّلة لمساحة العمل هذه. يفعّل المشغّل الخطة يدويًا
                في هذه المرحلة، ولا يعني ذلك نفاد الحد.
              </p>
            ) : (
              <>
                <p className="muted">
                  الخطة {s.plan.plan_key} — الفترة من{" "}
                  {displayDate(s.plan.period_start)} حتى{" "}
                  {displayDate(s.plan.period_end)} بتوقيت UTC.
                </p>
                <ul className="budgets">
                  {s.plan.budgets.map((b) => {
                    const state = budgetState(b);
                    const share = b.allowance
                      ? Math.min(Math.round((b.used / b.allowance) * 100), 100)
                      : 100;
                    return (
                      <li
                        key={b.event_type}
                        data-testid={`budget-${b.event_type}`}
                      >
                        <strong>{budgetNames[b.event_type]}</strong>
                        <span>
                          {b.used} من {b.allowance} — يتبقى {b.remaining}
                        </span>
                        <progress
                          max={b.allowance || 1}
                          value={b.used}
                          aria-hidden="true"
                        />
                        <small data-state={state}>
                          {share}٪ — {budgetMessages[state]}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          {(() => {
            const health = syncHealth(s.sync, new Date());
            const run = s.sync?.last_run ?? null;
            return (
              <section
                className="notice"
                aria-labelledby="sync-heading"
                data-testid="sync-panel"
              >
                <h2 id="sync-heading">صحة المزامنة</h2>
                <p data-testid="sync-state" data-severity={health.severity}>
                  <strong>{syncMessages[health.key]}</strong>
                </p>
                {health.errorCode && (
                  <p data-testid="sync-error">
                    {syncErrorMessages[health.errorCode] ??
                      "تعذّرت المزامنة لسبب غير مصنَّف"}{" "}
                    (<code>{health.errorCode}</code>)
                  </p>
                )}
                {health.queued > 0 && (
                  <p data-testid="sync-queued">مهام منتظرة: {health.queued}</p>
                )}
                <p data-testid="sync-worker">
                  العامل:{" "}
                  {s.sync?.worker.connected
                    ? `متصل، آخر نبضة ${displayDate(s.sync.worker.last_heartbeat_at)}`
                    : "غير متصل. لا يعمل جهاز مطوّر مغلق على مدار الساعة، ولا تُحدَّث البيانات حتى يعود."}
                </p>
                {run ? (
                  <p data-testid="sync-last-run">
                    آخر تشغيل: {displayDate(run.started_at)} — المصدر{" "}
                    {run.source} — فيديوهات {run.coverage.videos_seen}، تعليقات{" "}
                    {run.coverage.comments_collected}.{" "}
                    {run.coverage.complete
                      ? "اكتمل اجتياز المصدر."
                      : "لم يُثبت اجتياز المصدر بالكامل."}
                  </p>
                ) : (
                  <p data-testid="sync-last-run">لا يوجد تشغيل سابق مسجَّل.</p>
                )}
              </section>
            );
          })()}
        </>
      )}
    </>
  );
}

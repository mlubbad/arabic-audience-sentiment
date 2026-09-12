import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { type Filters, type Label } from "@sentiment/contracts";
import {
  buildExport,
  fixtureWorkspace,
  loadSnapshot,
  reviewsArePersisted,
  submitReview,
} from "./data";
import { labels, displayDate } from "./i18n";
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
  const [reviewing, setReviewing] = useState<{
    id: string;
    hash: string;
    text: string;
    label: Label | null;
  } | null>(null);
  const [verdict, setVerdict] = useState<Label>("neutral");
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: () =>
      submitReview({
        workspace_id: filters.workspace_id,
        comment_id: reviewing!.id,
        content_hash: reviewing!.hash,
        label: verdict,
        reason,
      }),
    onSuccess: async () => {
      setReviewing(null);
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
  function startReview(c: {
    id: string;
    content_hash: string;
    text_raw: string;
    label: Label | null;
  }) {
    review.reset();
    setReason("");
    setVerdict(c.label ?? "neutral");
    setReviewing({
      id: c.id,
      hash: c.content_hash,
      text: c.text_raw,
      label: c.label,
    });
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    if (from && to && from >= to) {
      setFormError("يجب أن يسبق تاريخ البداية تاريخ النهاية");
      return;
    }
    setFormError("");
    setCursorNotice(false);
    setCursors([]);
    setFilters({
      ...defaults,
      q: query,
      video_ids: video ? [video] : [],
      sentiments: sentiment ? [sentiment as Label] : [],
      from: from ? new Date(from + "T00:00:00+03:00").toISOString() : undefined,
      to: to ? new Date(to + "T00:00:00+03:00").toISOString() : undefined,
    });
  }
  function reset() {
    setQuery("");
    setVideo("");
    setSentiment("");
    setFrom("");
    setTo("");
    setFormError("");
    setCursorNotice(false);
    setCursors([]);
    setLimit(25);
    setFilters(defaults);
  }
  const s = result.data;
  return (
    <>
      <h1>لوحة مشاعر الجمهور</h1>
      <aside className="notice">
        <strong>بيانات اصطناعية للاختبار فقط</strong>
        <p>
          لا توجد قناة متصلة أو نتائج نموذج حي. هذا هيكل وظيفي مؤقت بانتظار
          ملفات التصميم الأصلية.
        </p>
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
          <select value={video} onChange={(e) => setVideo(e.target.value)}>
            <option value="">كل الفيديوهات</option>
            <option value="video-1">فيديو اصطناعي ١</option>
            <option value="video-2">فيديو اصطناعي ٢</option>
          </select>
        </label>
        <label>
          المشاعر
          <select
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
          من تاريخ
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          إلى تاريخ (غير شامل)
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          عدد التعليقات في الصفحة
          <select
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
              <strong>{s.replies}</strong>
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
                    <div className="chart">
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
                        {v.id === "video-1"
                          ? "فيديو اصطناعي ١"
                          : "فيديو اصطناعي ٢"}
                        : {v.total}
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
                  <p>تعليقات بلا تاريخ: {s.unknown_dates}</p>
                </article>
              </section>
              <section>
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
                  <table>
                    <thead>
                      <tr>
                        <th>المؤلف</th>
                        <th>التعليق</th>
                        <th>المشاعر</th>
                        <th>التاريخ</th>
                        <th>التصحيح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.comments.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.author_name}
                            {c.is_reply && <small>رد</small>}
                          </td>
                          <td>{c.text_raw}</td>
                          <td>
                            {c.label ? labels[c.label] : "غير محلل / قديم"}
                            {c.reviewed && <small>مراجعة بشرية</small>}
                          </td>
                          <td>{displayDate(c.published_at)}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => startReview(c)}
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
                    aria-label="تصحيح التصنيف"
                    onSubmit={(e) => {
                      e.preventDefault();
                      review.mutate();
                    }}
                  >
                    <h3>تصحيح تصنيف تعليق</h3>
                    <blockquote data-testid="review-text">
                      {reviewing.text}
                    </blockquote>
                    <p className="muted">
                      التصنيف الحالي:{" "}
                      {reviewing.label ? labels[reviewing.label] : "غير محلل"}.
                      التصحيح البشري يلغي تنبؤ النموذج لهذا النص، ويسقط تلقائيًا
                      إذا تغيّر نص التعليق لاحقًا.
                    </p>
                    <label>
                      التصنيف الصحيح
                      <select
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
                          setReviewing(null);
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
          <section className="notice">
            <h2>حالة الاتصال والجمع</h2>
            <p>
              لا يوجد عامل متصل. لم تُنفذ مزامنة حية. مصدر هذه الشاشة: ملفات
              اختبار محلية.
            </p>
          </section>
        </>
      )}
    </>
  );
}

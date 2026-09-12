import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { type Filters, type Label } from "@sentiment/contracts";
import { fixtureWorkspace, loadSnapshot } from "./data";
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
  const result = useQuery({
    queryKey: ["fixture-dashboard", filters],
    queryFn: ({ signal }) => loadSnapshot(filters, signal),
  });
  function apply(e: FormEvent) {
    e.preventDefault();
    if (from && to && from >= to) {
      setFormError("يجب أن يسبق تاريخ البداية تاريخ النهاية");
      return;
    }
    setFormError("");
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
        <div role="status" className="loading">
          جارٍ تحميل التعليقات…
        </div>
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
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>المؤلف</th>
                        <th>التعليق</th>
                        <th>المشاعر</th>
                        <th>التاريخ</th>
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
                          </td>
                          <td>{displayDate(c.published_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.next_cursor && (
                  <button
                    onClick={() =>
                      setFilters({ ...filters, cursor: s.next_cursor! })
                    }
                  >
                    الصفحة التالية
                  </button>
                )}
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

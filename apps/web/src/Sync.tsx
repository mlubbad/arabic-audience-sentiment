/**
 * Operations: is collection running, what has it done, and what does it cost.
 *
 * These panels used to sit at the bottom of the analytics dashboard, below the
 * charts. That was the wrong place for a specific reason: "no sync has run"
 * qualifies every figure above it, and a caveat printed *after* the numbers
 * arrives once the reader has already believed them. A warning belongs before
 * what it limits, and the dashboard answers a different question — what the
 * audience said — for a reader who is not asking whether the machine is up.
 *
 * It reads the same snapshot the dashboard reads, through the same mode
 * decision, so the demo has an operations page too and the two can never
 * disagree about what the sync state is.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { budgetState } from "@sentiment/contracts";
import {
  configuredMode,
  fixtureWorkspace,
  loadSnapshot,
  resolveMode,
} from "./data";
import { supabase } from "./supabase";
import { useSession, useWorkspaces } from "./session";
import { workspaceState, readableWorkspace } from "./workspace";
import { syncHealth } from "./syncHealth";
import {
  budgetMessages,
  budgetNames,
  displayDate,
  syncErrorMessages,
  syncMessages,
} from "./i18n";
import { describeJob, type JobEntry, type JobRow } from "./jobFeed";
import "./report.css";

export function Sync() {
  const { session, loading: sessionLoading } = useSession();
  const { workspaces, failed: workspacesFailed } = useWorkspaces(session);
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: null,
  });
  const live = readableWorkspace(place);
  const mode = resolveMode({ signedIn: !!session, workspace: live });
  const workspaceId = mode === "live" && live ? live : fixtureWorkspace;

  const snapshot = useQuery({
    queryKey: ["sync-snapshot", mode, workspaceId],
    queryFn: ({ signal }) =>
      loadSnapshot(mode, { workspace_id: workspaceId }, signal),
    enabled: !sessionLoading,
  });

  // The attempt log is a live-only thing: the fixture has no job table, and
  // inventing one would put a plausible history on screen for a demo.
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobsFailed, setJobsFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!supabase || mode !== "live") {
      setJobs(null);
      return;
    }
    const db = supabase;
    let active = true;
    void db
      .from("jobs")
      .select("id,status,attempt,error_code,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        setJobsFailed(!!error);
        setJobs(error ? [] : ((data ?? []) as JobRow[]));
      });
    return () => {
      active = false;
    };
  }, [mode, workspaceId, tick]);

  const s = snapshot.data;
  const health = syncHealth(s?.sync ?? null, new Date());
  const run = s?.sync?.last_run ?? null;
  const connected = !!s?.sync?.worker.connected;
  const entries: JobEntry[] = (jobs ?? []).map((j) =>
    describeJob(j, { workerConnected: connected }),
  );

  return (
    <div className="rp-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">التشغيل</p>
        <h1>حالة الجمع والتحليل</h1>
        <p>
          هل يعمل الجمع، وماذا فعل، وكم استهلك. الأرقام هنا عن الآلة لا عن
          الجمهور — تحليل ما قاله الجمهور في لوحة البيانات.
        </p>
      </header>

      {workspacesFailed && (
        <div className="notice" data-severity="critical">
          <p>
            تعذّرت قراءة قائمة مساحات عملك. ما يظهر أدناه من العرض التجريبي —
            وهذا ليس معناه أنك بلا مساحات.
          </p>
        </div>
      )}

      {snapshot.isPending ? (
        <p role="status">جارٍ قراءة حالة التشغيل…</p>
      ) : snapshot.isError ? (
        <div role="alert" className="notice">
          <p>تعذّرت قراءة حالة التشغيل.</p>
          <button type="button" onClick={() => void snapshot.refetch()}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          <section
            className="rp-section"
            aria-labelledby="sync-heading"
            data-testid="sync-panel"
          >
            <header>
              <h2 id="sync-heading">صحة المزامنة</h2>
            </header>
            <article className="rp-card">
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
                {s?.sync?.worker.connected
                  ? `متصل، آخر نبضة ${displayDate(s.sync.worker.last_heartbeat_at)}`
                  : "غير متصل. لا يعمل جهاز مطوّر مغلق على مدار الساعة، ولا تُحدَّث البيانات حتى يعود."}
              </p>
              {run ? (
                <p data-testid="sync-last-run">
                  آخر تشغيل: {displayDate(run.started_at)} — المصدر {run.source}{" "}
                  — فيديوهات {run.coverage.videos_seen}، تعليقات{" "}
                  {run.coverage.comments_collected}.{" "}
                  {run.coverage.complete
                    ? "اكتمل اجتياز المصدر."
                    : "لم يُثبت اجتياز المصدر بالكامل."}
                </p>
              ) : (
                <p data-testid="sync-last-run">لا يوجد تشغيل سابق مسجَّل.</p>
              )}
            </article>
          </section>

          <section
            className="rp-section"
            aria-labelledby="plan-heading"
            data-testid="plan-panel"
          >
            <header>
              <h2 id="plan-heading">حدود الخطة</h2>
            </header>
            {s?.plan == null ? (
              <p className="rp-missing" data-testid="plan-none">
                <strong>لا توجد خطة مفعّلة لمساحة العمل هذه</strong>
                يفعّل المشغّل الخطة يدويًا في هذه المرحلة، ولا يعني ذلك نفاد
                الحد.
              </p>
            ) : (
              <article className="rp-card">
                <p className="rp-sub">
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
              </article>
            )}
          </section>

          <section className="rp-section" id="rp-attempts">
            <header>
              <h2>سجل المحاولات</h2>
              <p className="rp-sub">
                كل محاولة جمع بترتيب زمني عكسي، ومعها سبب ما حدث.
              </p>
            </header>
            {mode !== "live" ? (
              <p className="rp-missing">
                <strong>العرض التجريبي لا يحمل سجل مهام</strong>
                المهام تخص حسابًا حقيقيًا وقناة مرتبطة. لن يُعرض هنا سجل مُختلق
                ليبدو المكان ممتلئًا.
              </p>
            ) : jobsFailed ? (
              <p className="rp-missing" data-testid="jobs-failed">
                <strong>تعذّرت قراءة سجل المهام</strong>
                هذا ليس معناه أنه فارغ.
              </p>
            ) : entries.length === 0 ? (
              <p className="rp-missing">
                <strong>لا توجد محاولات بعد</strong>
                اطلب مزامنة من صفحة الحساب.
              </p>
            ) : (
              <ul className="history" data-testid="attempts">
                {entries.map((e) => (
                  <li key={e.id} data-severity={e.severity}>
                    <strong>{e.headline}</strong>
                    <span>{e.detail}</span>
                    <small>
                      {displayDate(e.createdAt)}
                      {e.attempt > 0 ? ` · المحاولة ${e.attempt}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            {mode === "live" && (
              <button type="button" onClick={() => setTick((t) => t + 1)}>
                تحديث
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export default Sync;

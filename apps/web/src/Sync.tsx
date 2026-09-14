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
import {
  workspaceState,
  readableWorkspace,
  type WorkspaceOption,
} from "./workspace";
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
  const {
    workspaces,
    loading: workspacesLoading,
    failed: workspacesFailed,
  } = useWorkspaces(session);
  const [chosen, setChosen] = useState<string | null>(null);
  if (sessionLoading)
    return (
      <div className="app-state" role="status">
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
        <div className="app-state" role="status">
          جارٍ تحميل مساحات العمل…
        </div>
      );
    if (workspacesFailed)
      return (
        <div className="app-state" role="alert">
          <h1>تعذّرت قراءة مساحات عملك.</h1>
          <p>
            حدّث الصفحة لإعادة المحاولة؛ لا يمكن عرض بيانات تجربة بدل بيانات
            حسابك.
          </p>
        </div>
      );
    if (place.kind === "no_workspaces")
      return (
        <div className="app-state">
          <h1>لا توجد مساحة عمل لهذا الحساب بعد.</h1>
          <a href="/account">أنشئ مساحة عمل من صفحة الحساب</a>
        </div>
      );
    if (place.kind === "choose")
      return (
        <div className="app-state" data-testid="sync-ws-choose">
          <span className="app-state-symbol" aria-hidden="true">
            ↗
          </span>
          <p className="app-eyebrow">حالة الجمع</p>
          <h1>أي مساحة عمل تريد متابعة تشغيلها؟</h1>
          <p>لكل مساحة حالة جمع وحدود خطة وسجل محاولات مستقل.</p>
          <label className="sync-choice">
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
  const workspaceId = mode === "live" && live ? live : fixtureWorkspace;
  const userId = session?.user.id ?? "visitor";
  return (
    <SyncBody
      key={`${userId}:${mode}:${workspaceId}`}
      userId={userId}
      mode={mode}
      workspaceId={workspaceId}
      workspaceName={place.kind === "ready" ? place.name : null}
      options={place.kind === "ready" ? place.options : []}
      onChoose={setChosen}
    />
  );
}

function SyncBody({
  userId,
  mode,
  workspaceId,
  workspaceName,
  options,
  onChoose,
}: {
  userId: string;
  mode: "live" | "sanitized_fixture";
  workspaceId: string;
  workspaceName: string | null;
  options: WorkspaceOption[];
  onChoose: (id: string) => void;
}) {
  const snapshot = useQuery({
    queryKey: ["sync-snapshot", userId, mode, workspaceId],
    queryFn: ({ signal }) =>
      loadSnapshot(mode, { workspace_id: workspaceId }, signal),
  });

  // The attempt log is a live-only thing: the fixture has no job table, and
  // inventing one would put a plausible history on screen for a demo.
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobsFailed, setJobsFailed] = useState(false);
  // The channel, read here for one reason: this page is where a reader learns
  // that nothing has collected, and the only button that starts a collection
  // was on the account page. Being told "لم تُنفَّذ أي مزامنة" by a screen
  // that cannot start one leaves the reader to guess where the remedy lives.
  const [channelId, setChannelId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  // Both are refused by the database for a job in the wrong state or another
  // tenant's workspace; the buttons only avoid offering what will be refused.
  const act = (kind: "cancel_job" | "retry_job", id: string) => {
    if (!supabase) return;
    setActing(id);
    setActionMessage("");
    void supabase.rpc(kind, { w: workspaceId, j: id }).then(({ error }) => {
      setActing(null);
      setActionMessage(
        error
          ? kind === "cancel_job"
            ? "تعذّر سحب المهمة — قد يكون عامل قد بدأها بالفعل."
            : "تعذّرت إعادة المحاولة."
          : kind === "cancel_job"
            ? "سُحبت المهمة من الطابور."
            : "أُضيفت محاولة جديدة، تستأنف من حيث توقّفت السابقة.",
      );
      setTick((t) => t + 1);
      void snapshot.refetch();
    });
  };
  const requestSync = () => {
    if (!supabase || !channelId) return;
    setActing("enqueue");
    setActionMessage("");
    void supabase
      .rpc("enqueue_sync", {
        w: workspaceId,
        c: channelId,
        // Not a timestamp. The database holds one outstanding collection per
        // channel and answers a repeat with the job already waiting; a key
        // that changes on every click asks it for a new one each time.
        k: `sync-page-${workspaceId}`,
      })
      .then(({ error }) => {
        setActing(null);
        // Never "أُضيفت": a second click is answered with the first job, and
        // claiming a new one was queued would be false on every click but one.
        setActionMessage(
          error
            ? "تعذّر تسجيل طلب المزامنة."
            : "طلب المزامنة قائم. لكل قناة طلب واحد في كل مرة، ويبدأ حين يعمل عامل الجمع.",
        );
        setTick((t) => t + 1);
        void snapshot.refetch();
      });
  };
  useEffect(() => {
    if (!supabase || mode !== "live") {
      setJobs(null);
      setChannelId(null);
      return;
    }
    const db = supabase;
    let active = true;
    void db
      .from("connection_status")
      .select("channel_id,status")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        if (!active) return;
        const connectedChannel = (data ?? []).find(
          (c) => c.status === "connected",
        );
        setChannelId(connectedChannel?.channel_id ?? null);
      });
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
        <p className="rp-eyebrow">
          التشغيل {workspaceName ? `· ${workspaceName}` : "· معاينة تجريبية"}
        </p>
        <h1>حالة الجمع والتحليل</h1>
        <p>
          تابع نشاط الجمع، وحدود الخطة، والمحاولات من مكان واحد. ما تراه هنا يصف
          تشغيل الخدمة؛ تعليقات الجمهور وتفسيرها في لوحة البيانات.
        </p>
      </header>
      {mode === "live" ? (
        <div className="sync-workspace">
          <p>
            بيانات التشغيل لمساحة <strong>{workspaceName}</strong>
          </p>
          {options.length > 1 && (
            <label>
              مساحة العمل
              <select
                aria-label="تغيير مساحة العمل"
                value={workspaceId}
                onChange={(e) => onChoose(e.target.value)}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <p className="sync-demo">
          بيانات تشغيل اصطناعية للتجربة، غير مرتبطة بقناة حقيقية.
        </p>
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
          <div className="sync-grid">
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
                    : "غير متصل الآن. لن تُحدَّث البيانات تلقائيًا حتى يعود عامل الجمع."}
                </p>
                {/* The remedy, beside the diagnosis. Offered only when it can
                    work: without a connected channel the server refuses, and a
                    button that always fails is worse than no button — so that
                    case says where to go instead. */}
                {mode === "live" && (
                  <div className="sync-actions">
                    {channelId ? (
                      <button
                        type="button"
                        data-testid="sync-request"
                        disabled={acting === "enqueue"}
                        onClick={requestSync}
                      >
                        {acting === "enqueue" ? "جارٍ الطلب…" : "طلب مزامنة"}
                      </button>
                    ) : (
                      <p className="muted" data-testid="sync-no-channel">
                        لا توجد قناة مرتبطة بمساحة العمل هذه.{" "}
                        <a href="/account">اربط قناة من صفحة الحساب</a> ليبدأ
                        الجمع.
                      </p>
                    )}
                  </div>
                )}
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
                        ? Math.min(
                            Math.round((b.used / b.allowance) * 100),
                            100,
                          )
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
          </div>

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
            ) : jobs === null ? (
              <p role="status">جارٍ قراءة سجل المحاولات…</p>
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
                    {e.cancellable && (
                      <button
                        type="button"
                        className="rp-tab"
                        disabled={acting === e.id}
                        data-testid={`cancel-${e.id}`}
                        onClick={() => act("cancel_job", e.id)}
                      >
                        سحب من الطابور
                      </button>
                    )}
                    {e.retryable && (
                      <button
                        type="button"
                        className="rp-tab"
                        disabled={acting === e.id}
                        data-testid={`retry-${e.id}`}
                        onClick={() => act("retry_job", e.id)}
                      >
                        إعادة المحاولة
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {actionMessage && (
              <p role="status" data-testid="job-action">
                {actionMessage}
              </p>
            )}
            {mode === "live" && (
              <button
                type="button"
                onClick={() => {
                  setTick((t) => t + 1);
                  void snapshot.refetch();
                }}
              >
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

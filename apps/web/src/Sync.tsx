/**
 * A real, detailed view of what collection has actually done.
 *
 * The account page can say "queued". That is not enough to act on: a job sits
 * queued identically whether a worker is about to take it or no worker exists
 * at all, and a job that ended without collecting anything can have ended that
 * way for reasons the operator can fix and reasons they cannot. This page shows
 * each attempt, in order, with the reason attached.
 *
 * It reads the tenant's own rows through RLS — no service key, no privileged
 * view — so what it shows is exactly what that account is entitled to see.
 */
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { describeJob, type JobRow, type JobEntry } from "./jobFeed";

type Workspace = { id: string; name: string };
type Snapshot = {
  sync?: {
    worker?: { connected?: boolean; last_heartbeat_at?: string | null };
    queued_jobs?: number;
  };
};

const when = (iso: string) =>
  // Pinned locale: "ar" renders different digits depending on which ICU data
  // the browser shipped, so the same row would read differently per machine.
  new Date(iso).toLocaleString("en-US", { hour12: false });

export function Sync() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [worker, setWorker] = useState<{
    connected: boolean;
    lastHeartbeat: string | null;
  } | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setLoading(false);
      return;
    }
    let active = true;
    // Narrowed once, here: the async callback below runs after this effect
    // returns, where the module-level null check no longer narrows it.
    const db = supabase;
    setLoading(true);
    void db
      .from("workspaces")
      .select("id,name")
      .then(async ({ data: ws, error: wErr }) => {
        if (!active) return;
        if (wErr) {
          setError("تعذر تحميل مساحات العمل.");
          setLoading(false);
          return;
        }
        const list = ws ?? [];
        setWorkspaces(list);
        const first = list[0];
        if (!first) {
          setLoading(false);
          return;
        }
        const [j, snap, c] = await Promise.all([
          db
            .from("jobs")
            .select("id,status,attempt,error_code,created_at")
            .eq("workspace_id", first.id)
            .order("created_at", { ascending: false })
            .limit(50),
          db.rpc("dashboard_snapshot", { w: first.id }),
          db
            .from("comments")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", first.id),
        ]);
        if (!active) return;
        if (j.error) setError("تعذر قراءة سجل المهام.");
        setJobs((j.data ?? []) as JobRow[]);
        const s = (snap.data as Snapshot | null)?.sync;
        setWorker(
          s?.worker
            ? {
                connected: !!s.worker.connected,
                lastHeartbeat: s.worker.last_heartbeat_at ?? null,
              }
            : null,
        );
        // A failed count is left unknown rather than shown as zero: "no
        // comments" and "we could not ask" are different answers.
        setCommentCount(c.error ? null : (c.count ?? null));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, tick]);

  if (!supabase)
    return (
      <>
        <h1>حالة المزامنة</h1>
        <div className="notice">
          <p>إعداد Supabase غير متوفر في هذه النسخة.</p>
        </div>
      </>
    );
  if (loading) return <p role="status">جارٍ قراءة حالة المزامنة…</p>;
  if (!session)
    return (
      <>
        <h1>حالة المزامنة</h1>
        <div className="notice">
          <p>سجّل الدخول لعرض حالة المزامنة لمساحة عملك.</p>
        </div>
      </>
    );
  if (workspaces.length === 0)
    return (
      <>
        <h1>حالة المزامنة</h1>
        <div className="notice">
          <p>لا توجد مساحة عمل بعد.</p>
        </div>
      </>
    );

  const connected = !!worker?.connected;
  const entries: JobEntry[] = jobs.map((j) =>
    describeJob(j, { workerConnected: connected }),
  );
  const queued = jobs.filter((j) => j.status === "queued").length;

  return (
    <>
      <h1>حالة المزامنة</h1>
      <p className="muted">
        كل محاولة جمع لمساحة «{workspaces[0].name}»، بترتيب زمني عكسي، ومعها سبب
        ما حدث.
      </p>
      {error && (
        <div className="notice" data-severity="critical">
          <p>{error}</p>
        </div>
      )}

      <section className="metrics">
        <article data-severity={connected ? "ok" : "critical"}>
          <h2>عامل الجمع</h2>
          <strong>{connected ? "يعمل" : "متوقف"}</strong>
          <small>
            {connected
              ? "هناك مهمة محجوزة ونشطة الآن."
              : "لا توجد حجوزات نشطة. المهام المنتظرة لن تبدأ حتى يعمل عامل."}
          </small>
        </article>
        <article data-severity={queued > 0 && !connected ? "critical" : "ok"}>
          <h2>في الطابور</h2>
          <strong>{queued}</strong>
          <small>
            {/* The rule made explicit, because the button now returns the
                existing job instead of adding another. */}
            طلب واحد لكل قناة في كل مرة؛ الطلب المكرر يُعاد إليه الطلب القائم.
          </small>
        </article>
        <article>
          <h2>تعليقات محفوظة</h2>
          <strong>{commentCount === null ? "غير معروف" : commentCount}</strong>
          <small>
            {commentCount === null
              ? "تعذّرت قراءة العدد — وهذا ليس صفرًا."
              : "مجموع ما وصل فعلًا إلى قاعدة البيانات."}
          </small>
        </article>
        <article>
          <h2>محاولات مسجّلة</h2>
          <strong>{jobs.length}</strong>
          <small>آخر ٥٠ محاولة.</small>
        </article>
      </section>

      <section>
        <h2>سجل المحاولات</h2>
        {entries.length === 0 ? (
          <div className="empty">
            <p>لا توجد محاولات بعد. اطلب مزامنة من صفحة الحساب.</p>
          </div>
        ) : (
          <ul className="history">
            {entries.map((e) => (
              <li key={e.id} data-severity={e.severity}>
                <strong>{e.headline}</strong>
                <span>{e.detail}</span>
                <small>
                  {when(e.createdAt)}
                  {e.attempt > 0 ? ` · المحاولة ${e.attempt}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={() => setTick((t) => t + 1)}>
        تحديث
      </button>
    </>
  );
}
export default Sync;

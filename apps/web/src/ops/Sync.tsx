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
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  configuredMode,
  fixtureWorkspace,
  loadOpsSource,
  resolveMode,
} from "../data";
import { supabase } from "../supabase";
import { useSession, useWorkspaces } from "../session";
import { useWorkspaceSelection } from "../workspaceSelection";
import { WorkspaceGate } from "../WorkspaceGate";
import { workspaceState, readableWorkspace } from "../workspace";
import { syncHealth } from "../syncHealth";
import { useLocale } from "../locale";
import { useStrings } from "../strings";
import { describeJob, type JobEntry, type JobRow } from "../jobFeed";
import { failureCode } from "../failure";
import { Badge } from "../ui/Badge";
import { EmptyState, Loading, LoadError } from "../pageStates/PageStates";
import { Catalogue } from "./Catalogue";
import { SyncHealth } from "./SyncHealth";
import { PlanBudgets } from "./PlanBudgets";
import { Attempts } from "./Attempts";
import "../pages.css";
import "./ops.css";

export function Sync() {
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
  // An explicit way in to the demo of this page. Not a workaround for the line
  // below: the fixture operations page is the only surface on which the
  // product's hardest guarantees can be exercised without a live account —
  // that a stalled queue does not read as a healthy last run, that a partial
  // collection is not presented as a complete one, that a malformed sync block
  // reads as unknown rather than fine. Ten browser tests live on it.
  //
  // So the page stays available and stops being what a stranger is handed.
  const wantsDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");

  // A visitor who has not signed in has no collection to be the health of.
  //
  // This page used to render the fixture's operating state to them, which is a
  // worker that is not connected and a plan at 74% — so the first thing a
  // stranger saw of the product was a red line saying nothing had run and an
  // amber one saying a limit was near, about a machine that is not theirs and
  // is not in trouble. Two of the three panels then said, in effect, that they
  // were empty because this is a demo.
  //
  // The dashboard is a different case and keeps its demo: a sanitized report
  // shows what the product produces, and that is the thing worth showing. An
  // operations page answers a question only an owner has.
  //
  // The same card the dashboard shows for a workspace with nothing in it,
  // with this page's own name over it. The page keeps its name whether you
  // are signed in or not: the first draft of this state led with a sentence
  // about the page instead — "هذه الصفحة تتبع تشغيل قناتك" — and a browser
  // test caught it: a reader who arrives from a menu item called «التشغيل»
  // should land on a heading that agrees with the thing they clicked.
  const signedOut = !session && !wantsDemo && (
    <EmptyState
      kind="workspace"
      S={S}
      testId="sync-signed-out"
      className="db-empty--page"
      eyebrow={S.opsEyebrow}
      title={S.opsTitle}
      heading="h1"
      lead={S.opsSignedOutLead}
      links={[
        { to: "/account", label: S.opsSignInOrJoin },
        { to: "/sync?demo=1", label: S.opsSeeDemo },
      ]}
    />
  );
  const live = readableWorkspace(place);
  const mode = resolveMode({ signedIn: !!session, workspace: live });
  const workspaceId = mode === "live" && live ? live : fixtureWorkspace;
  const userId = session?.user.id ?? "visitor";
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
        eyebrow: S.gateOperationsEyebrow,
        chooseTitle: S.gateOperationsTitle,
        chooseLead: S.gateOperationsLead,
        chooseTestId: "sync-ws-choose",
      }}
    >
      {signedOut || (
        <SyncBody
          key={`${userId}:${mode}:${workspaceId}`}
          userId={userId}
          mode={mode}
          workspaceId={workspaceId}
          workspaceName={place.kind === "ready" ? place.name : null}
        />
      )}
    </WorkspaceGate>
  );
}

function SyncBody({
  userId,
  mode,
  workspaceId,
  workspaceName,
}: {
  userId: string;
  mode: "live" | "sanitized_fixture";
  workspaceId: string;
  workspaceName: string | null;
}) {
  const S = useStrings();
  const lang = useLocale();
  // The operations page reads the lightweight ops snapshot: worker health,
  // sync state, quota usage and comment counts per video. Shared with the
  // rail indicator under the "ops-source" key.
  const snapshot = useQuery({
    queryKey: ["ops-source", userId, mode, workspaceId],
    queryFn: ({ signal }) => loadOpsSource(mode, workspaceId, signal),
  });

  // The attempt log is a live-only thing: the fixture has no job table, and
  // inventing one would put a plausible history on screen for a demo.
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobsFailed, setJobsFailed] = useState(false);
  // The channel, read here for one reason: this page is where a reader learns
  // that nothing has collected, and without a connected channel nothing can
  // start one. Being told "لم تُنفَّذ أي مزامنة" by a screen that cannot say
  // where the remedy lives leaves the reader to guess; the health card names
  // the account page in that case.
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
            ? S.opsCancelFailed
            : S.opsRetryFailed
          : kind === "cancel_job"
            ? S.opsCancelled
            : S.opsRetried,
      );
      setTick((t) => t + 1);
      void snapshot.refetch();
    });
  };
  // Re-read the live-only rows and the snapshot together, after an action.
  const refresh = () => {
    setTick((t) => t + 1);
    void snapshot.refetch();
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
          (c) => c.status === "connected" || c.status === "public_unverified",
        );
        setChannelId(connectedChannel?.channel_id ?? null);
      });
    void db
      .from("jobs")
      .select("id,type,status,attempt,error_code,created_at")
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

  const sync = snapshot.data?.sync ?? null;
  const plan = snapshot.data?.plan ?? null;
  // What is stored per video, for the catalogue's price. Counted on the server
  // inside `workspace_ops_snapshot` without loading comment rows.
  const stored = useMemo(
    () => snapshot.data?.video_counts ?? [],
    [snapshot.data],
  );
  const health = syncHealth(sync, new Date());
  const run = sync?.last_run ?? null;
  const connected = !!sync?.worker.connected;

  // Adaptive polling: when work is in progress or waiting in the queue, poll
  // every 4 seconds so the operator sees progress live without manual refreshing.
  // When the queue is quiet and nothing is running, no interval is set.
  const hasActiveWork = useMemo(() => {
    if (mode !== "live") return false;
    if ((sync?.queued_jobs ?? 0) > 0) return true;
    if (sync?.last_run?.status === "running") return true;
    return (jobs ?? []).some(
      (j) => j.status === "queued" || j.status === "running",
    );
  }, [mode, sync?.queued_jobs, sync?.last_run?.status, jobs]);

  useEffect(() => {
    if (!hasActiveWork) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      void snapshot.refetch();
    }, 4000);
    return () => clearInterval(interval);
  }, [hasActiveWork, snapshot]);

  const entries: JobEntry[] = (jobs ?? []).map((j) =>
    describeJob(j, { workerConnected: connected }, S),
  );

  return (
    <div className="db-page">
      {/* The dashboard's head, in the dashboard's markup (`Hero.tsx` takes
          a snapshot and a range and is not reusable for three elements).
          The eyebrow names the page as the rail does and the workspace the
          figures belong to; the demo wears the same word the dashboard's
          does, «مثال توضيحي», so the two pages call one thing by one name. */}
      <header className="db-hero">
        <Badge tone="neutral">
          {S.opsEyebrow} · {workspaceName ?? S.dashDemoTag}
        </Badge>
        <h1>{S.opsTitle}</h1>
        {/* The one sentence that orients — this page against the other one.
            "تابع … من مكان واحد" was a pitch and is gone. */}
        <p>{S.opsLead}</p>
      </header>
      {/* The workspace's name is in the head above and in the rail; the
          switch that used to sit here lives in the rail now (RailState.tsx),
          one control for every screen instead of one per page. */}
      {/* Where this screen's figures come from, on the strip the dashboard
          prints its provenance on: in the demo, a fixture, and the sentence
          says so before the panels below can be read as a machine's state. */}
      {mode !== "live" && (
        <div role="note" className="db-provenance" data-testid="ops-demo-note">
          <Badge tone="neutral">
            <strong>{S.dashDemoTag}</strong>
          </Badge>
          <p>{S.opsDemoNote}</p>
        </div>
      )}

      {snapshot.isPending ? (
        <Loading S={S} label={S.opsReading} shape="ops" />
      ) : snapshot.isError ? (
        <LoadError
          S={S}
          message={S.opsReadFailed}
          failure={failureCode("read", snapshot.error)}
          onRetry={() => void snapshot.refetch()}
        />
      ) : (
        <>
          {/* The action first, the diagnosis after it: what the channel has
              and what is chosen, then whether collection is running and what
              it costs. The catalogue reads the plan's remaining figure from
              the same snapshot the plan panel prints, so its estimate and the
              meter below it can never disagree. */}
          <Catalogue
            mode={mode}
            workspaceId={workspaceId}
            plan={plan}
            stored={stored}
            jobs={jobs}
            workerConnected={connected}
            onChanged={refresh}
          />
          {/* Health and allowance are parallel questions: side by side on
              the dashboard's two-column grid, one under the other on a
              phone. */}
          <div className="db-grid db-grid--2">
            <SyncHealth
              sync={sync}
              health={health}
              run={run}
              mode={mode}
              channelId={channelId}
              lang={lang}
              S={S}
            />
            <PlanBudgets plan={plan} lang={lang} S={S} />
          </div>
          <Attempts
            mode={mode}
            jobsFailed={jobsFailed}
            jobs={jobs}
            entries={entries}
            lang={lang}
            acting={acting}
            actionMessage={actionMessage}
            act={act}
            refresh={refresh}
            S={S}
          />
        </>
      )}
    </div>
  );
}
export default Sync;

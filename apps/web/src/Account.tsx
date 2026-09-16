import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from "./authMessages";
import { beginConnect, connectErrorMessage } from "./connect";
import { useStrings } from "./strings";
import { providers, type ProviderId } from "./authProviders";
import { setupSteps } from "./setup";
import { WorkspaceCard, type ChannelRow, type JobRow } from "./WorkspaceCard";
import { PlanPanel } from "./PlanPanel";
import { useIsPlatformAdmin } from "./adminAccess";
import "./report.css";

/**
 * Where a message belongs. Feedback used to be one string for the whole page,
 * rendered once near the top: press a button inside a workspace card and a
 * sentence changed somewhere else, above the list, out of the eye's path. A
 * reader with two workspaces could not tell which one "طلب المزامنة قائم" was
 * about. So every message and every "working…" carries the place that caused
 * it, and is rendered there.
 */
type Scope = "page" | "auth" | "create" | `ws:${string}`;
type Note = { at: Scope; text: string };

export function Account() {
  const S = useStrings();
  const [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState<Scope | null>(supabase ? "page" : null),
    [note, setNote] = useState<Note | null>(null);
  const pending = busy !== null;
  const say = (at: Scope, text: string) => setNote({ at, text });
  /** What a place has to say for itself: its own note, or that it is working.
   *  A function, not a nested component: a component declared inside a render
   *  is a new type every render and remounts its subtree each time. */
  function feedback(at: Scope) {
    if (busy === at)
      return (
        <p className="account-feedback" role="status">
          {S.working}
        </p>
      );
    if (note?.at === at)
      return (
        <p className="account-feedback notice" role="status">
          {note.text}
        </p>
      );
    return null;
  }
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  // Which of the two screens is showing. A query string so the header's
  // "تسجيل الدخول" and a "create an account" link can each land on the right
  // one, and so a reader can send someone the signup screen directly.
  const [joining, setJoining] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("signup"),
  );
  const authProviders = providers(import.meta.env.VITE_AUTH_PROVIDERS, S);
  // A platform admin has nobody to hand a workspace to but themself, so the
  // retire door is not offered; retire_workspace refuses them too.
  const access = useIsPlatformAdmin(session);
  const mayRetire = access.data !== true;

  /**
   * Hand off to a provider.
   *
   * Only ever called for a door the configuration says is open — the closed
   * ones are disabled — but it checks again rather than trusting the caller,
   * because the cost of being wrong is the reader losing their session to an
   * error page from a third party.
   */
  function startProvider(id: ProviderId) {
    const open = authProviders.find((p) => p.id === id && !p.closedReason);
    if (!open || !supabase) return;
    if (id === "sso") {
      // Not an OAuth provider: SAML takes a domain and resolves the tenant
      // from it, so it needs its own screen before it can be called at all.
      say("auth", S.ssoNeedsDomain);
      return;
    }
    setBusy("auth");
    setNote(null);
    void supabase.auth
      .signInWithOAuth({
        provider: id,
        // Back to the account page, which is where the session is resolved
        // and where the next step — creating a workspace — lives.
        options: { redirectTo: `${window.location.origin}/account` },
      })
      .then(({ error }) => {
        if (!error) return; // the browser is leaving; nothing to report
        setBusy(null);
        say("auth", S.providerStartFailed);
      });
  }
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [loadedWorkspaceUserId, setLoadedWorkspaceUserId] = useState<
    string | null
  >(null);
  // A workspace cannot be connected without the client it owns, so the two are
  // read together rather than the button discovering the gap on click.
  const [clients, setClients] = useState<
    { id: string; workspace_id: string }[]
  >([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  // The newest job per workspace is enough to place it on the three steps.
  // Row-level security scopes the table to this account's workspaces.
  const [jobs, setJobs] = useState<JobRow[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        setBusy(null);
        if (error) say("page", S.sessionReadFailed);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  // Bumped after an action that changed the rows — a rename, a disconnect, a
  // hand-over — so the one loader below reads them again rather than each
  // action patching state by hand.
  const [reloads, setReloads] = useState(0);
  // Which card holds an open question or form. One at a time: the page has
  // one reader, and two open confirmations would be two ways to press wrong.
  const [asking, setAsking] = useState<{
    ws: string;
    what: "connect" | "disconnect" | "rename" | "retire";
  } | null>(null);
  useEffect(() => {
    if (!supabase || !session) {
      setWorkspaces([]);
      setLoadedWorkspaceUserId(null);
      return;
    }
    let active = true;
    void Promise.all([
      supabase.from("workspaces").select("id,name"),
      supabase.from("clients").select("id,workspace_id"),
      // Every column the view exposes, rather than a list. `title` arrives
      // with migration 20260915080000, and a build that names it against a
      // database that does not have it yet gets an error and an empty list —
      // every card reading "no channel" until the migration lands. The view
      // is the safety boundary here, not the column list.
      supabase.from("connection_status").select("*"),
      supabase
        .from("jobs")
        .select("workspace_id,status,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]).then(([w, c, ch, j]) => {
      if (!active) return;
      setLoadedWorkspaceUserId(session.user.id);
      if (w.error) say("page", S.workspacesLoadFailed);
      else setWorkspaces(w.data ?? []);
      setClients(c.data ?? []);
      setChannels(ch.data ?? []);
      setJobs(j.data ?? []);
    });
    return () => {
      active = false;
    };
  }, [session, reloads]);
  if (!supabase)
    return (
      <div className="rp-page account-page">
        <header className="rp-hero">
          <p className="rp-eyebrow">{S.accountEyebrow}</p>
          <h1>{S.accountTitle}</h1>
          <p>{S.accountLead}</p>
        </header>
        <div className="account-entry">
          <div className="app-state">
            <span className="app-state-symbol" aria-hidden="true">
              ◌
            </span>
            <h2>{S.accountUnavailableTitle}</h2>
            <p>{S.accountUnavailableLead}</p>
          </div>
          <div className="account-story">
            <h2>{S.accountTryDashboardTitle}</h2>
            <p>{S.accountTryDashboardLead}</p>
            <a href="/dashboard">{S.openDashboard}</a>
          </div>
        </div>
      </div>
    );
  const client = supabase;
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("auth");
    setNote(null);
    try {
      const action: AuthAction =
        (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
        "signup"
          ? "signup"
          : "signin";
      const { data, error } =
        action === "signup"
          ? await client.auth.signUp({ email, password })
          : await client.auth.signInWithPassword({ email, password });
      say(
        "auth",
        error
          ? authErrorMessage(error, S)
          : authSuccessMessage(action, !!data.session, S),
      );
    } catch {
      say("auth", S.serviceUnreachable);
    } finally {
      setBusy(null);
    }
  }
  async function createWorkspace(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setNote(null);
    try {
      const { error } = await client.rpc("create_workspace", {
        workspace_name: name,
      });
      if (error) {
        say("create", S.createWorkspaceFailed);
        return;
      }
      const { data, error: loadError } = await client
        .from("workspaces")
        .select("id,name");
      if (loadError) say("create", S.createWorkspaceListFailed);
      else {
        setWorkspaces(data ?? []);
        setName("");
        say("create", S.createWorkspaceDone);
      }
    } catch {
      say("create", S.serviceUnreachable);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rp-page account-page">
      {/* A page head, not a hero. This used to open with a pitch — "أنشئ
          مساحة لعملك، ثم اربط قناتك بإذنك…" — on a dark gradient pane, inside
          the tool, to a reader who had already bought the argument by
          signing in. The head now says what the page holds. */}
      <header className="rp-hero">
        <p className="rp-eyebrow">{S.accountEyebrow}</p>
        <h1>{S.accountTitle}</h1>
        <p>{S.accountLead}</p>
      </header>
      {feedback("page")}
      {!session ? (
        <div className="account-entry">
          {/* Two screens, not one form with two submits.
              Logging in and creating an account are different intentions with
              different stakes, and a single form that did both put them on
              adjacent buttons — so the way to a new account and the way back
              into an existing one were one mis-click apart. */}
          <form className="rp-card auth-card" onSubmit={auth}>
            <h2>{joining ? S.authJoinTitle : S.authReturnTitle}</h2>
            <p>{joining ? S.authJoinLead : S.authReturnLead}</p>
            <label>
              {S.emailLabel}
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {S.passwordLabel}
              <input
                type="password"
                autoComplete={joining ? "new-password" : "current-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {feedback("auth")}
            <button
              name="action"
              value={joining ? "signup" : "signin"}
              disabled={pending}
            >
              {joining ? S.createAccount : S.signIn}
            </button>

            <p className="auth-or">
              <span>{joining ? S.orJoinWith : S.orSignInWith}</span>
            </p>
            {/* Every door is shown, and the closed ones say they are closed.
                Hiding them would leave a reader who came expecting Google
                wondering whether they misremembered; offering them live would
                spend their one moment of intent on an error. */}
            <ul className="auth-providers">
              {authProviders.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-provider={p.id}
                    disabled={!!p.closedReason || pending}
                    aria-describedby={
                      p.closedReason ? `why-${p.id}` : undefined
                    }
                    onClick={() => startProvider(p.id)}
                  >
                    {p.label}
                  </button>
                  {p.closedReason && (
                    <small id={`why-${p.id}`}>{p.closedReason}</small>
                  )}
                </li>
              ))}
            </ul>

            <p className="auth-switch">
              {joining ? S.haveAccount : S.noAccount}{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  setJoining(!joining);
                  setNote(null);
                }}
              >
                {joining ? S.signIn : S.joinLink}
              </button>
            </p>
          </form>
          <aside className="account-story">
            <p className="app-eyebrow">{S.howToStartEyebrow}</p>
            <h2>{S.howToStartTitle}</h2>
            <p>{S.howToStartLead}</p>
            {/* The same three sentences the owner sees with a state on each,
                once signed in. Written once in `setup.ts`. */}
            <ol className="account-steps">
              {setupSteps.map((step) => (
                <li key={step.key}>{S[step.title]}</li>
              ))}
            </ol>

            {/* The reassurance panel, and the reason it says none of the
                things a panel like this usually says.

                The reference it is modelled on reads "Trusted by 200,000+
                companies in 120 countries" over five customer logos. We have
                no customers, so that line and those logos would be an
                invention — and on a product whose whole argument is that it
                reports what it measured, a fabricated number on the way in
                would undo the argument before the reader reaches the data.

                So the panel carries what is true and checkable instead. Each
                line is a property of the build, not a claim about a market,
                and each one is asserted by a test in this repository. */}
            <section className="account-trust" data-testid="account-trust">
              <h3>{S.trustTitle}</h3>
              <ul>
                <li>
                  <strong>{S.trustIsolationStrong}</strong>
                  {S.trustIsolation}
                </li>
                <li>
                  <strong>{S.trustCountedStrong}</strong>
                  {S.trustCounted}
                </li>
                <li>
                  <strong>{S.trustMeasuredStrong}</strong>
                  {S.trustMeasured}
                </li>
                <li>
                  <strong>{S.trustReviewStrong}</strong>
                  {S.trustReview}
                </li>
              </ul>
              <p className="account-trust-note">{S.trustNote}</p>
            </section>
          </aside>
        </div>
      ) : (
        <>
          {/* Signing out moved to the header, where it is reachable from every
              route rather than only from this one. Leaving it here as well
              would put two controls with one name on the same screen — which
              is one name too few, and which a strict locator reads as an
              ambiguity rather than a convenience. */}
          <div className="account-toolbar">
            <p>{S.insideAccount}</p>
          </div>
          {/* The plan before the workspaces: what the chosen workspace may
              do, and the doors to change it. It reads the same session and
              list this page already holds. */}
          <PlanPanel
            session={session}
            workspaces={workspaces}
            loading={loadedWorkspaceUserId !== session.user.id}
          />
          <section className="rp-section">
            <header>
              <h2>{S.workspacesTitle}</h2>
              <p className="rp-sub">{S.workspacesLead}</p>
            </header>
          </section>
          {loadedWorkspaceUserId !== session.user.id ? (
            <div className="app-state" role="status">
              {S.gateLoadingWorkspaces}
            </div>
          ) : workspaces.length === 0 ? (
            <p className="rp-missing">
              <strong>{S.noWorkspaceStrong}</strong>
              {S.noWorkspaceLead}
            </p>
          ) : (
            <ul className="workspace-list">
              {workspaces.map((w) => {
                const workspaceClient = clients.find(
                  (c) => c.workspace_id === w.id,
                );
                const scope: Scope = `ws:${w.id}`;
                return (
                  <WorkspaceCard
                    key={w.id}
                    workspace={w}
                    hasClient={!!workspaceClient}
                    channel={
                      channels.find((c) => c.workspace_id === w.id) ?? null
                    }
                    // Newest first from the query, so the first match is the latest.
                    latestJob={
                      jobs.find((j) => j.workspace_id === w.id) ?? null
                    }
                    pending={pending}
                    feedback={feedback(scope)}
                    confirmingDisconnect={
                      asking?.ws === w.id && asking.what === "disconnect"
                    }
                    onDisconnect={(step) => {
                      const channel = channels.find(
                        (c) => c.workspace_id === w.id,
                      );
                      if (step !== "confirm") {
                        setAsking(
                          step === "ask"
                            ? { ws: w.id, what: "disconnect" }
                            : null,
                        );
                        return;
                      }
                      if (!channel) return;
                      setBusy(scope);
                      setNote(null);
                      void client
                        .rpc("oauth_disconnect", {
                          w: w.id,
                          channel: channel.channel_id,
                        })
                        .then(({ error }) => {
                          setBusy(null);
                          setAsking(null);
                          say(
                            scope,
                            error ? S.disconnectFailed : S.disconnectDone,
                          );
                          if (!error) setReloads((n) => n + 1);
                        });
                    }}
                    renaming={asking?.ws === w.id && asking.what === "rename"}
                    onRename={(step, name) => {
                      if (step !== "save") {
                        setAsking(
                          step === "open" ? { ws: w.id, what: "rename" } : null,
                        );
                        return;
                      }
                      setBusy(scope);
                      setNote(null);
                      void client
                        .rpc("rename_workspace", {
                          w: w.id,
                          new_name: name ?? "",
                        })
                        .then(({ error }) => {
                          setBusy(null);
                          setAsking(null);
                          say(scope, error ? S.renameFailed : S.renameDone);
                          if (!error) setReloads((n) => n + 1);
                        });
                    }}
                    confirmingRetire={
                      asking?.ws === w.id && asking.what === "retire"
                    }
                    onRetire={
                      mayRetire
                        ? (step) => {
                            if (step !== "confirm") {
                              setAsking(
                                step === "ask"
                                  ? { ws: w.id, what: "retire" }
                                  : null,
                              );
                              return;
                            }
                            setBusy(scope);
                            setNote(null);
                            void client
                              .rpc("retire_workspace", { w: w.id })
                              .then(({ error }) => {
                                setBusy(null);
                                setAsking(null);
                                if (error) {
                                  say(
                                    scope,
                                    /last_workspace/.test(error.message)
                                      ? S.retireLast
                                      : S.retireFailed,
                                  );
                                  return;
                                }
                                // The workspace is no longer the reader's; the list
                                // reloads without it, so the sentence goes to the page.
                                say("page", S.retireDone);
                                setReloads((n) => n + 1);
                              });
                          }
                        : undefined
                    }
                    confirmingConnect={
                      asking?.ws === w.id && asking.what === "connect"
                    }
                    onConnect={(step) => {
                      // The redirect goes to Google, which shows its own two
                      // warnings while this application is pending Google's
                      // review — the question here says so before the reader
                      // ever leaves this page, rather than after they land on
                      // an alarming screen with no context.
                      if (step !== "continue") {
                        setAsking(
                          step === "ask" ? { ws: w.id, what: "connect" } : null,
                        );
                        return;
                      }
                      if (!workspaceClient) return;
                      setBusy(scope);
                      setNote(null);
                      setAsking(null);
                      void beginConnect(w.id, workspaceClient.id).then(
                        (out) => {
                          setBusy(null);
                          if (out.kind === "error")
                            say(scope, connectErrorMessage(out.code, S));
                          // Google's consent screen is a full navigation, not a
                          // popup: a popup here is blocked as often as not.
                          else window.location.assign(out.url);
                        },
                      );
                    }}
                  />
                );
              })}
            </ul>
          )}
          <section className="account-create">
            <form className="rp-card" onSubmit={createWorkspace}>
              <h2>{S.anotherWorkspaceTitle}</h2>
              <p>{S.anotherWorkspaceLead}</p>
              <label>
                {S.workspaceNameLabel}
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {feedback("create")}
              <button disabled={pending}>{S.createWorkspace}</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import {
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from "./authMessages";
import { beginConnect, connectErrorMessage } from "./connect";
import { useStrings } from "./strings";
import { providers, type ProviderId } from "./authProviders";
import {
  WorkspaceCard,
  type ChannelRow,
  type JobRow,
} from "./account/WorkspaceCard";
import { PlanPanel } from "./account/PlanPanel";
import { AuthEntry } from "./account/AuthEntry";
import { Unavailable } from "./account/Unavailable";
import { CreateWorkspace } from "./account/CreateWorkspace";
import { useIsPlatformAdmin } from "./adminAccess";
import "./account.css";

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
  // True once `getSession()` below has answered, at least once. Before that,
  // `!session` is indistinguishable from "signed out" — it is also true for
  // the instant before a signed-in visitor's session comes back — and gating
  // One Tap on it alone let a signed-in reader's first paint fire the prompt
  // and its fetch, then cancel it a moment later. `false` while `!supabase`
  // is moot: the gate below already requires `supabase` to be present.
  const [sessionRead, setSessionRead] = useState(!supabase);
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
  const [name, setName] = useState("");
  const authProviders = providers(import.meta.env.VITE_AUTH_PROVIDERS, S);
  // Google One Tap's gate and handler. The hook itself mounts inside
  // `AuthEntry`, which only renders signed out; `enabled` still carries the
  // whole gate — no client, an existing session, or (ANDed there) the door
  // not open all mean "do not prompt". `sessionRead` keeps a signed-in
  // reader's first paint, before `getSession()` answers, from prompting.
  const oneTap = {
    enabled: !!supabase && sessionRead && !session,
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    onCredential: async (token: string, nonce: string) => {
      const { error } = await supabase!.auth.signInWithIdToken({
        provider: "google",
        token,
        nonce,
      });
      // A resolved session is picked up by the `onAuthStateChange` listener
      // below, the same way the OAuth door's redirect is — nothing else to
      // do here on success.
      if (error) say("auth", S.providerStartFailed);
    },
  };
  // A platform admin has nobody to hand a workspace to but themself, so the
  // retire door is not offered; retire_workspace refuses them too.
  const access = useIsPlatformAdmin(session);
  // While the query is pending, access.data is still its initial undefined —
  // `!== true` reads that as "not an admin" and the retire door would flash
  // for an admin reader before the answer comes back.
  const mayRetire = !access.isPending && access.data !== true;

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
        setSessionRead(true);
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
  const queryClient = useQueryClient();
  // The rail's switch and the dashboard read the list through
  // `useWorkspaces`, under this key; a bump here without an invalidation
  // there would rename a card and leave the switch on the old name.
  const workspacesChanged = () => {
    setReloads((n) => n + 1);
    void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };
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
        <Unavailable />
      </div>
    );
  const client = supabase;
  async function auth(
    action: AuthAction,
    creds: { email: string; password: string },
  ) {
    setBusy("auth");
    setNote(null);
    try {
      const { data, error } =
        action === "signup"
          ? await client.auth.signUp(creds)
          : await client.auth.signInWithPassword(creds);
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
        void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
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
        <AuthEntry
          providers={authProviders}
          busy={pending}
          feedback={feedback("auth")}
          oneTap={oneTap}
          onAuth={auth}
          onProvider={startProvider}
          onSwitch={() => setNote(null)}
        />
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
                          if (!error) workspacesChanged();
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
                                workspacesChanged();
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
            <CreateWorkspace
              name={name}
              setName={setName}
              pending={pending}
              feedback={feedback("create")}
              onSubmit={createWorkspace}
            />
          </section>
        </>
      )}
    </div>
  );
}

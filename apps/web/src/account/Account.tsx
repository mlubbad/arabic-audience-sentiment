/**
 * The account page: the way in, the plan, the workspaces, the create form.
 *
 * Three bodies under one head. `?demo=1` replays the signed-in page over
 * `fixtures/account.json` through `reduceAccountDemo` and asks nothing of a
 * server — the same door `/sync?demo=1` and `/admin?demo=1` open — and it
 * wins over "no Supabase client": the build the browser suite runs has no
 * client, and the demo is how that suite reaches the signed-in page at all.
 * Without a client and without `?demo=1` the page says it is unavailable;
 * with one it resolves the session and shows `AuthEntry` or the account.
 *
 * Each body is its own component so every hook runs unconditionally: the
 * demo's fixture query lives only in `DemoAccount`, the session listener and
 * the four reads only in `LiveAccount`, and `Account` itself decides which
 * one mounts from two values that never change within a page load.
 */
import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import {
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from "../authMessages";
import { beginConnect, connectErrorMessage } from "../connect";
import { useStrings } from "../strings";
import { providers, type ProviderId } from "../authProviders";
import { failureCode } from "../failure";
import { WorkspaceCard, type ChannelRow, type JobRow } from "./WorkspaceCard";
import { PlanPanel, DemoPlanPanel } from "./PlanPanel";
import { AuthEntry } from "./AuthEntry";
import { Unavailable } from "./Unavailable";
import { CreateWorkspace } from "./CreateWorkspace";
import {
  loadAccountDemo,
  reduceAccountDemo,
  type AccountDemo,
  type AccountDemoAction,
} from "./accountDemo";
import { useIsPlatformAdmin } from "../adminAccess";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Loading, LoadError } from "../pageStates/PageStates";
import "../pages.css";
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
type Workspace = { id: string; name: string };
/** Which card holds an open question or form. One at a time: the page has
 *  one reader, and two open confirmations would be two ways to press wrong. */
type Asking = {
  ws: string;
  what: "connect" | "disconnect" | "rename" | "retire";
} | null;

/** The page's notes and its "working…" — one place per message, shared by
 *  the live body and the demo body so both print through the same line. */
function useFeedback(initialBusy: Scope | null) {
  const S = useStrings();
  const [busy, setBusy] = useState<Scope | null>(initialBusy),
    [note, setNote] = useState<Note | null>(null);
  const say = (at: Scope, text: string) => setNote({ at, text });
  /** What a place has to say for itself: its own note, or that it is working.
   *  A function, not a nested component: a component declared inside a render
   *  is a new type every render and remounts its subtree each time. */
  function feedback(at: Scope) {
    if (busy === at)
      return (
        <p className="db-feedback" role="status">
          {S.working}
        </p>
      );
    if (note?.at === at)
      return (
        <p className="db-feedback db-feedback--note" role="status">
          {note.text}
        </p>
      );
    return null;
  }
  return { busy, setBusy, setNote, say, feedback, pending: busy !== null };
}

/** The page head — the same three elements `ops/Sync.tsx` and
 *  `admin/AdminPage.tsx` open with, in the same markup: a `Badge` eyebrow
 *  (the demo wears «مثال توضيحي» after it, as the other two demos do), the
 *  title, one orienting sentence. A page head, not a hero: this used to
 *  open with a pitch on a dark gradient pane, inside the tool, to a reader
 *  who had already bought the argument by signing in. */
function Head({ demo }: { demo: boolean }) {
  const S = useStrings();
  return (
    <header className="db-hero">
      <Badge tone="neutral">
        {demo ? `${S.accountEyebrow} · ${S.dashDemoTag}` : S.accountEyebrow}
      </Badge>
      <h1>{S.accountTitle}</h1>
      <p>{demo ? S.accountDemoLead : S.accountLead}</p>
    </header>
  );
}

/** The workspaces section both signed-in bodies share: its head, then the
 *  loading line, the empty card, or the list. `card` draws one workspace —
 *  the live body with its RPC handlers, the demo body with the reducer. */
function Workspaces({
  loading,
  workspaces,
  card,
}: {
  loading: boolean;
  workspaces: Workspace[];
  card: (w: Workspace) => ReactNode;
}) {
  const S = useStrings();
  return (
    <section className="db-section">
      <header>
        <h2>{S.workspacesTitle}</h2>
        <p className="db-lead">{S.workspacesLead}</p>
      </header>
      {loading ? (
        <p className="db-muted" role="status">
          {S.gateLoadingWorkspaces}
        </p>
      ) : workspaces.length === 0 ? (
        <Card className="db-empty" data-testid="account-no-workspace">
          <h2>{S.noWorkspaceStrong}</h2>
          <p className="db-lead">{S.noWorkspaceLead}</p>
        </Card>
      ) : (
        <ul className="db-ws-list" role="list">
          {workspaces.map(card)}
        </ul>
      )}
    </section>
  );
}

export function Account() {
  // An explicit way in to the demo of this page — the same test `ops/Sync.tsx`
  // makes for `/sync?demo=1`. Checked before the client: the demo is the one
  // way to the signed-in page on a build without one.
  const wantsDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  if (wantsDemo) return <DemoAccount />;
  if (!supabase)
    return (
      <div className="db-page">
        <Head demo={false} />
        <Unavailable />
      </div>
    );
  return <LiveAccount client={supabase} />;
}

/** The page over a session: the way in while there is none, then the plan,
 *  the workspaces and the create form. Every handler here calls the RPC it
 *  always called. */
function LiveAccount({ client }: { client: NonNullable<typeof supabase> }) {
  const S = useStrings();
  const [session, setSession] = useState<Session | null>(null);
  const { setBusy, setNote, say, feedback, pending } = useFeedback("page");
  // True once `getSession()` below has answered, at least once. Before that,
  // `!session` is indistinguishable from "signed out" — it is also true for
  // the instant before a signed-in visitor's session comes back — and gating
  // One Tap on it alone let a signed-in reader's first paint fire the prompt
  // and its fetch, then cancel it a moment later.
  const [sessionRead, setSessionRead] = useState(false);
  const [name, setName] = useState("");
  const authProviders = providers(import.meta.env.VITE_AUTH_PROVIDERS, S);
  // Google One Tap's gate and handler. The hook itself mounts inside
  // `AuthEntry`, which only renders signed out; `enabled` still carries the
  // whole gate — an existing session, or (ANDed there) the door not open
  // both mean "do not prompt". `sessionRead` keeps a signed-in reader's
  // first paint, before `getSession()` answers, from prompting.
  const oneTap = {
    enabled: sessionRead && !session,
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    onCredential: async (token: string, nonce: string) => {
      const { error } = await client.auth.signInWithIdToken({
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
    if (!open) return;
    if (id === "sso") {
      // Not an OAuth provider: SAML takes a domain and resolves the tenant
      // from it, so it needs its own screen before it can be called at all.
      say("auth", S.ssoNeedsDomain);
      return;
    }
    setBusy("auth");
    setNote(null);
    void client.auth
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
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
    let active = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        setBusy(null);
        setSessionRead(true);
        if (error) say("page", S.sessionReadFailed);
      }
    });
    const { data } = client.auth.onAuthStateChange((_event, s) => {
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
  const [asking, setAsking] = useState<Asking>(null);
  useEffect(() => {
    if (!session) {
      setWorkspaces([]);
      setLoadedWorkspaceUserId(null);
      return;
    }
    let active = true;
    void Promise.all([
      client.from("workspaces").select("id,name"),
      client.from("clients").select("id,workspace_id"),
      // Every column the view exposes, rather than a list. `title` arrives
      // with migration 20260915080000, and a build that names it against a
      // database that does not have it yet gets an error and an empty list —
      // every card reading "no channel" until the migration lands. The view
      // is the safety boundary here, not the column list.
      client.from("connection_status").select("*"),
      client
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
    <div className="db-page">
      <Head demo={false} />
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
          <aside className="db-provenance">
            <p>{S.insideAccount}</p>
          </aside>
          {/* The plan before the workspaces: what the chosen workspace may
              do, and the doors to change it. It reads the same session and
              list this page already holds. */}
          <PlanPanel
            session={session}
            workspaces={workspaces}
            loading={loadedWorkspaceUserId !== session.user.id}
          />
          <Workspaces
            loading={loadedWorkspaceUserId !== session.user.id}
            workspaces={workspaces}
            card={(w) => {
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
                  latestJob={jobs.find((j) => j.workspace_id === w.id) ?? null}
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
                    void beginConnect(w.id, workspaceClient.id).then((out) => {
                      setBusy(null);
                      if (out.kind === "error")
                        say(scope, connectErrorMessage(out.code, S));
                      // Google's consent screen is a full navigation, not a
                      // popup: a popup here is blocked as often as not.
                      else window.location.assign(out.url);
                    });
                  }}
                />
              );
            }}
          />
          <CreateWorkspace
            name={name}
            setName={setName}
            pending={pending}
            feedback={feedback("create")}
            onSubmit={createWorkspace}
          />
        </>
      )}
    </div>
  );
}

/** The demo's way in: the fixture is read through react-query under its own
 *  key, and the signed-in body mounts once it has answered, holding the rows
 *  from then on. A fixture that fails to load or to parse is the page's
 *  load-error card, with a retry — never a half-rendered account. */
function DemoAccount() {
  const S = useStrings();
  const fixture = useQuery({
    queryKey: ["account", "demo"],
    queryFn: ({ signal }) => loadAccountDemo(signal),
    enabled: true,
  });
  return (
    <div className="db-page">
      <Head demo />
      {fixture.isPending ? (
        <Loading S={S} label={S.gateLoadingWorkspaces} shape="ops" />
      ) : fixture.isError ? (
        <LoadError
          S={S}
          failure={failureCode("read", fixture.error)}
          onRetry={() => void fixture.refetch()}
        />
      ) : (
        <DemoBody initial={fixture.data} />
      )}
    </div>
  );
}

/** The signed-in page over the fixture. Every door presses the same handler
 *  shape the live body has, routed to `reduceAccountDemo` instead of an RPC;
 *  a refusal thrown by the reducer carries the code the RPC would, and is
 *  mapped to the same sentence. Nothing here is asynchronous, so nothing is
 *  ever "working…" — the note lands on the next render. */
function DemoBody({ initial }: { initial: AccountDemo }) {
  const S = useStrings();
  const [state, setState] = useState<AccountDemo>(initial);
  const { setNote, say, feedback, pending } = useFeedback(null);
  const [name, setName] = useState("");
  const [asking, setAsking] = useState<Asking>(null);
  /** One action over the current rows; `onRefused` maps the reducer's
   *  refusal to the sentence the live page would print for the RPC's. */
  function act(
    action: AccountDemoAction,
    onDone: () => void,
    onRefused: (message: string) => void,
  ) {
    setNote(null);
    try {
      setState(reduceAccountDemo(state, action));
      onDone();
    } catch (e) {
      onRefused(String((e as { message?: unknown })?.message ?? ""));
    }
    setAsking(null);
  }
  const first = state.workspaces[0];
  return (
    <>
      {feedback("page")}
      <aside className="db-provenance" data-testid="account-demo-note">
        <Badge tone="neutral">
          <strong>{S.dashDemoTag}</strong>
        </Badge>
        <p>{S.insideAccount}</p>
      </aside>
      {/* The first workspace stands in for the reader's choice: the demo
          bypasses `useWorkspaceSelection` and the plan read alike. */}
      <DemoPlanPanel
        demo={{
          usage: first ? (state.usage[first.id] ?? null) : null,
          place: first
            ? {
                kind: "ready",
                id: first.id,
                name: first.name,
                options: state.workspaces,
              }
            : { kind: "no_workspaces" },
        }}
      />
      <Workspaces
        loading={false}
        workspaces={state.workspaces}
        card={(w) => {
          const scope: Scope = `ws:${w.id}`;
          const hasClient = state.clients.some((c) => c.workspace_id === w.id);
          return (
            <WorkspaceCard
              key={w.id}
              workspace={w}
              hasClient={hasClient}
              channel={
                state.channels.find((c) => c.workspace_id === w.id) ?? null
              }
              latestJob={
                state.jobs.find((j) => j.workspace_id === w.id) ?? null
              }
              pending={pending}
              feedback={feedback(scope)}
              confirmingDisconnect={
                asking?.ws === w.id && asking.what === "disconnect"
              }
              onDisconnect={(step) => {
                if (step !== "confirm") {
                  setAsking(
                    step === "ask" ? { ws: w.id, what: "disconnect" } : null,
                  );
                  return;
                }
                act(
                  { type: "disconnect", w: w.id },
                  () => say(scope, S.disconnectDone),
                  () => say(scope, S.disconnectFailed),
                );
              }}
              renaming={asking?.ws === w.id && asking.what === "rename"}
              onRename={(step, name) => {
                if (step !== "save") {
                  setAsking(
                    step === "open" ? { ws: w.id, what: "rename" } : null,
                  );
                  return;
                }
                act(
                  { type: "rename", w: w.id, name: name ?? "" },
                  () => say(scope, S.renameDone),
                  () => say(scope, S.renameFailed),
                );
              }}
              confirmingRetire={asking?.ws === w.id && asking.what === "retire"}
              onRetire={(step) => {
                if (step !== "confirm") {
                  setAsking(
                    step === "ask" ? { ws: w.id, what: "retire" } : null,
                  );
                  return;
                }
                act(
                  { type: "retire", w: w.id },
                  // The workspace leaves the list, so the sentence goes to
                  // the page — as it does when the RPC hands one over.
                  () => say("page", S.retireDone),
                  (message) =>
                    say(
                      scope,
                      /last_workspace/.test(message)
                        ? S.retireLast
                        : S.retireFailed,
                    ),
                );
              }}
              confirmingConnect={
                asking?.ws === w.id && asking.what === "connect"
              }
              onConnect={(step) => {
                if (step !== "continue") {
                  setAsking(
                    step === "ask" ? { ws: w.id, what: "connect" } : null,
                  );
                  return;
                }
                // Google's consent screen is a full navigation the demo
                // cannot make; the card says so where the redirect would
                // have started, and the question closes.
                act(
                  { type: "connect", w: w.id },
                  () => say(scope, S.demoExternalNote),
                  () => say(scope, S.demoExternalNote),
                );
              }}
            />
          );
        }}
      />
      <CreateWorkspace
        name={name}
        setName={setName}
        pending={pending}
        feedback={feedback("create")}
        onSubmit={(e) => {
          e.preventDefault();
          act(
            { type: "create", name },
            () => {
              setName("");
              say("create", S.createWorkspaceDone);
            },
            () => say("create", S.createWorkspaceFailed),
          );
        }}
      />
    </>
  );
}

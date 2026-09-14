import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from "./authMessages";
import { beginConnect } from "./connect";
import { providers, type ProviderId } from "./authProviders";
import "./report.css";
export function Account() {
  const [session, setSession] = useState<Session | null>(null),
    [pending, setPending] = useState(!!supabase),
    [message, setMessage] = useState("");
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
  const authProviders = providers(import.meta.env.VITE_AUTH_PROVIDERS);

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
      setMessage(
        "الدخول الموحَّد يحتاج نطاق مؤسستك — لم تُبنَ هذه الشاشة بعد.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    void supabase.auth
      .signInWithOAuth({
        provider: id,
        // Back to the account page, which is where the session is resolved
        // and where the next step — creating a workspace — lives.
        options: { redirectTo: `${window.location.origin}/account` },
      })
      .then(({ error }) => {
        if (!error) return; // the browser is leaving; nothing to report
        setPending(false);
        setMessage("تعذّر بدء الدخول عبر هذا المزوّد.");
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
  const [channels, setChannels] = useState<
    {
      workspace_id: string;
      channel_id: string;
      status: string;
      external_channel_id: string;
    }[]
  >([]);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        setPending(false);
        if (error) setMessage("تعذر قراءة جلسة الحساب");
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
      supabase
        .from("connection_status")
        .select("workspace_id,channel_id,status,external_channel_id"),
    ]).then(([w, c, ch]) => {
      if (!active) return;
      setLoadedWorkspaceUserId(session.user.id);
      if (w.error) setMessage("تعذر تحميل مساحات العمل");
      else setWorkspaces(w.data ?? []);
      setClients(c.data ?? []);
      setChannels(ch.data ?? []);
    });
    return () => {
      active = false;
    };
  }, [session]);
  if (!supabase)
    return (
      <div className="rp-page account-page">
        <header className="rp-hero">
          <p className="rp-eyebrow">الحساب</p>
          <h1>الحساب ومساحات العمل</h1>
          <p>مساحة خاصة لقناتك، من الربط إلى قراءة التعليقات.</p>
        </header>
        <div className="account-entry">
          <div className="app-state">
            <span className="app-state-symbol" aria-hidden="true">
              ◌
            </span>
            <h2>تسجيل الدخول غير متاح في هذه المعاينة</h2>
            <p>
              يلزم عنوان مشروع تطوير ومفتاح نشر عام لتفعيل الحساب. لا تُستخدم
              بيانات الاختبار كجلسة دخول.
            </p>
          </div>
          <div className="account-story">
            <h2>ابدأ من تجربة اللوحة</h2>
            <p>يمكنك استكشاف الواجهة ببيانات اصطناعية واضحة المصدر.</p>
            <a href="/dashboard">فتح لوحة البيانات</a>
          </div>
        </div>
      </div>
    );
  const client = supabase;
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage("");
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
      setMessage(
        error
          ? authErrorMessage(error)
          : authSuccessMessage(action, !!data.session),
      );
    } catch {
      setMessage("تعذر الاتصال بالخدمة. حاول مجدداً.");
    } finally {
      setPending(false);
    }
  }
  async function createWorkspace(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const { error } = await client.rpc("create_workspace", {
        workspace_name: name,
      });
      if (error) {
        setMessage("تعذر إنشاء مساحة العمل");
        return;
      }
      const { data, error: loadError } = await client
        .from("workspaces")
        .select("id,name");
      if (loadError) setMessage("تم الإنشاء وتعذر تحديث القائمة");
      else {
        setWorkspaces(data ?? []);
        setName("");
        setMessage("تم إنشاء مساحة العمل");
      }
    } catch {
      setMessage("تعذر الاتصال بالخدمة");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rp-page account-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">الحساب</p>
        <h1>الحساب ومساحات العمل</h1>
        <p>
          أنشئ مساحة لعملك، ثم اربط قناتك بإذنك. يمكنك العودة إلى بياناتك
          ومراجعة حالة الجمع من مكان واحد.
        </p>
      </header>
      {pending && <p role="status">جارٍ تنفيذ الطلب…</p>}
      {message && (
        <div className="notice" role="status">
          <p>{message}</p>
        </div>
      )}
      {!session ? (
        <div className="account-entry">
          {/* Two screens, not one form with two submits.
              Logging in and creating an account are different intentions with
              different stakes, and a single form that did both put them on
              adjacent buttons — so the way to a new account and the way back
              into an existing one were one mis-click apart. */}
          <form className="rp-card auth-card" onSubmit={auth}>
            <h2>{joining ? "أنشئ حسابك" : "مرحبًا بعودتك"}</h2>
            <p>
              {joining
                ? "معاينة خاصة — الحساب يفتح مساحة عمل واحدة تخصّك."
                : "ادخل إلى مساحة عملك وقنواتك وتقاريرك."}
            </p>
            <label>
              البريد الإلكتروني
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              كلمة المرور
              <input
                type="password"
                autoComplete={joining ? "new-password" : "current-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              name="action"
              value={joining ? "signup" : "signin"}
              disabled={pending}
            >
              {joining ? "إنشاء حساب جديد" : "تسجيل الدخول"}
            </button>

            <p className="auth-or">
              <span>{joining ? "أو أنشئ حسابًا بـ" : "أو ادخل بـ"}</span>
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
              {joining ? "لديك حساب بالفعل؟" : "لا تملك حسابًا؟"}{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  setJoining(!joining);
                  setMessage("");
                }}
              >
                {joining ? "تسجيل الدخول" : "أنشئ حسابًا"}
              </button>
            </p>
          </form>
          <aside className="account-story">
            <p className="app-eyebrow">كيف تبدأ؟</p>
            <h2>من قناتك إلى قراءة أوضح.</h2>
            <p>ثلاث خطوات تفصل حسابك عن لوحة تعبّر عما جُمع فعلًا.</p>
            <ol className="account-steps">
              <li>أنشئ حسابك ومساحة العمل الخاصة بك.</li>
              <li>اربط قناة يوتيوب بعد موافقتك على الإذن.</li>
              <li>اطلب الجمع، ثم تابع حالته ونتائجه في اللوحة.</li>
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
              <h3>ما يضمنه هذا البناء</h3>
              <ul>
                <li>
                  <strong>مساحتك لا تُقرأ من مساحة أخرى.</strong> العزل مفروض في
                  قاعدة البيانات نفسها، ومُختبَر بطلبات مباشرة لا بإخفاء أزرار.
                </li>
                <li>
                  <strong>الأرقام معدودة لا مقدَّرة.</strong> كل رقم محسوب من
                  الصفوف المحفوظة؛ وما لا يُعرف يُقال «غير معروف» ولا يُحسب
                  صفرًا.
                </li>
                <li>
                  <strong>النموذج مُقاس لا مُدّعى.</strong> قِيست ستة مصنّفات
                  عربية على مجموعة موسومة يدويًا، ونتائجها منشورة في المستودع —
                  بما فيها أن أيًّا منها لم يتجاوز بوّابة الدقّة.
                </li>
                <li>
                  <strong>تصحيحك يعلو على النموذج.</strong> المراجعة البشرية
                  تُلغي تنبؤ النموذج لذلك النص، وتُحفظ باسم صاحبها وسببها.
                </li>
              </ul>
              <p className="account-trust-note">
                معاينة خاصة. لا نعرض عدد عملاء ولا شعارات: لا يوجد ما نعدّه بعد،
                ورقمٌ مُختلَق على الباب يُفسد ما تقوله اللوحة خلفه.
              </p>
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
            <p>أنت داخل حسابك. اختر مساحة العمل التي تريد إدارتها.</p>
          </div>
          <section className="rp-section">
            <header>
              <h2>مساحات العمل</h2>
              <p className="rp-sub">
                كل مساحة عمل تملك قناتها وبياناتها وحدودها. لا تُعرض بيانات
                مساحة داخل أخرى.
              </p>
            </header>
          </section>
          {loadedWorkspaceUserId !== session.user.id ? (
            <div className="app-state" role="status">
              جارٍ تحميل مساحات العمل…
            </div>
          ) : workspaces.length === 0 ? (
            <p className="rp-missing">
              <strong>لا توجد مساحة عمل متاحة</strong>
              أنشئ واحدة أدناه لتبدأ.
            </p>
          ) : (
            <ul className="workspace-list">
              {workspaces.map((w) => {
                const workspaceClient = clients.find(
                  (c) => c.workspace_id === w.id,
                );
                const channel = channels.find((c) => c.workspace_id === w.id);
                return (
                  <li key={w.id}>
                    <strong>{w.name}</strong>
                    {channel ? (
                      <span data-testid={`channel-${w.id}`}>
                        {channel.status === "connected"
                          ? `قناة مرتبطة: ${channel.external_channel_id}`
                          : `القناة تحتاج إعادة ربط (${channel.status})`}
                      </span>
                    ) : (
                      <span>لا توجد قناة مرتبطة بعد</span>
                    )}
                    {/* Shown only when it can actually work: without a client
                        the server would refuse, and a button that always fails
                        is worse than no button. */}
                    {/* Connected: the next thing to do is collect. enqueue_sync
                        creates the job; a worker picks it up. Both halves are
                        said plainly below, because a queued job with no worker
                        looks identical to nothing happening. */}
                    {channel?.status === "connected" && (
                      <button
                        type="button"
                        disabled={pending}
                        data-testid={`sync-${w.id}`}
                        onClick={() => {
                          setPending(true);
                          setMessage("");
                          void client
                            .rpc("enqueue_sync", {
                              w: w.id,
                              c: channel.channel_id,
                              k: `manual-${Date.now()}`,
                            })
                            .then(({ error }) => {
                              setPending(false);
                              // Deliberately not "أُضيفت": the server answers a
                              // repeat request with the job already waiting, so
                              // claiming a new one was added would be a lie on
                              // every click after the first.
                              setMessage(
                                error
                                  ? "تعذر تسجيل طلب المزامنة."
                                  : "طلب المزامنة قائم. لكل قناة طلب واحد في كل مرة، ولن يبدأ حتى يعمل عامل الجمع — التفاصيل في صفحة «حالة المزامنة».",
                              );
                            });
                        }}
                      >
                        طلب مزامنة
                      </button>
                    )}
                    {workspaceClient && channel?.status !== "connected" && (
                      <button
                        type="button"
                        disabled={pending}
                        data-testid={`connect-${w.id}`}
                        onClick={() => {
                          setPending(true);
                          setMessage("");
                          void beginConnect(w.id, workspaceClient.id).then(
                            (out) => {
                              setPending(false);
                              if (out.kind === "error") setMessage(out.message);
                              // Google's consent screen is a full navigation, not
                              // a popup: a popup here is blocked as often as not.
                              else window.location.assign(out.url);
                            },
                          );
                        }}
                      >
                        ربط قناة يوتيوب
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <section className="account-create">
            <form className="rp-card" onSubmit={createWorkspace}>
              <h2>مساحة أخرى لعميل أو قناة</h2>
              <p>يبقى لكل مساحة جمهورها وبياناتها وصلاحياتها المستقلة.</p>
              <label>
                اسم مساحة العمل
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button disabled={pending}>إنشاء مساحة عمل</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

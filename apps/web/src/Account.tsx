import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from "./authMessages";
import { beginConnect } from "./connect";
import "./report.css";
export function Account() {
  const [session, setSession] = useState<Session | null>(null),
    [pending, setPending] = useState(!!supabase),
    [message, setMessage] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
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
      <>
        <header className="rp-hero">
          <p className="rp-eyebrow">الحساب</p>
          <h1>الحساب ومساحات العمل</h1>
        </header>
        <div className="notice">
          <h2>إعداد Supabase غير متوفر</h2>
          <p>
            يلزم عنوان مشروع تطوير ومفتاح نشر عام لتفعيل الحساب. لا تُستخدم
            بيانات الاختبار كجلسة دخول.
          </p>
        </div>
      </>
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
    <div className="rp-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">الحساب</p>
        <h1>الحساب ومساحات العمل</h1>
        <p>
          حسابك في الخدمة مستقل عن قناتك. ربط القناة خطوة منفصلة تمنح الأداة إذن
          قراءة تعليقاتك، ويمكن سحبها في أي وقت.
        </p>
      </header>
      {pending && <p role="status">جارٍ تنفيذ الطلب…</p>}
      {message && (
        <div className="notice" role="status">
          <p>{message}</p>
        </div>
      )}
      {!session ? (
        <form className="rp-card" onSubmit={auth}>
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
              autoComplete="current-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button name="action" value="signin" disabled={pending}>
            تسجيل الدخول
          </button>
          <button name="action" value="signup" disabled={pending}>
            إنشاء حساب
          </button>
        </form>
      ) : (
        <>
          <button
            disabled={pending}
            onClick={() => {
              void client.auth.signOut().then(({ error }) => {
                if (error) setMessage("تعذر تسجيل الخروج");
              });
            }}
          >
            تسجيل الخروج
          </button>
          <section className="rp-section">
            <header>
              <h2>مساحات العمل</h2>
              <p className="rp-sub">
                كل مساحة عمل تملك قناتها وبياناتها وحدودها. لا تُعرض بيانات
                مساحة داخل أخرى.
              </p>
            </header>
          </section>
          {workspaces.length === 0 ? (
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
          <form className="rp-card" onSubmit={createWorkspace}>
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
        </>
      )}
    </div>
  );
}

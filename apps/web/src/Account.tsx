import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
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
    void supabase
      .from("workspaces")
      .select("id,name")
      .then(({ data, error }) => {
        if (active) {
          if (error) setMessage("تعذر تحميل مساحات العمل");
          else setWorkspaces(data ?? []);
        }
      });
    return () => {
      active = false;
    };
  }, [session]);
  if (!supabase)
    return (
      <>
        <h1>الحساب ومساحات العمل</h1>
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
      const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
        "value",
      );
      const { error } =
        action === "signup"
          ? await client.auth.signUp({ email, password })
          : await client.auth.signInWithPassword({ email, password });
      setMessage(
        error
          ? "تعذر إتمام الطلب. تحقق من البيانات وإعدادات الحساب."
          : action === "signup"
            ? "تحقق من بريدك لتأكيد الحساب."
            : "تم تسجيل الدخول.",
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
    <>
      <h1>الحساب ومساحات العمل</h1>
      <p>
        تسجيل حساب المنتج مستقل عن ربط يوتيوب. الربط غير متاح في هذا الإصدار.
      </p>
      {pending && <p role="status">جارٍ تنفيذ الطلب…</p>}
      {message && <p role="status">{message}</p>}
      {!session ? (
        <form onSubmit={auth}>
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
          <h2>مساحات العمل</h2>
          {workspaces.length === 0 ? (
            <p>لا توجد مساحة عمل متاحة</p>
          ) : (
            <ul>
              {workspaces.map((w) => (
                <li key={w.id}>{w.name}</li>
              ))}
            </ul>
          )}
          <form onSubmit={createWorkspace}>
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
    </>
  );
}

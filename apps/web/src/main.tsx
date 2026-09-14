import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Outlet,
  useLocation,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./style.css";
import "./app.css";
import { Landing } from "./Landing";
import { BrandMark } from "./BrandMark";
import { useSession } from "./session";
import { supabase } from "./supabase";
const Dashboard = lazy(() =>
  import("./Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Connected = lazy(() =>
  import("./Connected").then((m) => ({ default: m.Connected })),
);
const Sync = lazy(() => import("./Sync").then((m) => ({ default: m.Sync })));
const Account = lazy(() =>
  import("./Account").then((m) => ({ default: m.Account })),
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
/**
 * Whether you are signed in, and the one control that changes it.
 *
 * This belongs in the chrome, not on a page. Signing out lived in the body of
 * the account page, which meant leaving required first navigating to a
 * settings screen — and signing in was reachable only by guessing that the
 * item called "الحساب ومساحات العمل" was also the front door. Session state is
 * true of every route, so it is shown on every route.
 *
 * It takes the slot a decorative line was using ("فهم أوضح لكل تعليق"), which
 * is the trade this header needed: the tagline is on the landing page, where
 * someone is still deciding, and by the time a reader is inside the product
 * they have decided.
 */
function SessionControl() {
  const { session, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nothing at all until it is known. A "sign in" that flips to "sign out" a
  // moment later reads as the page changing its mind about who you are.
  if (loading) return null;
  if (!session)
    return (
      <Link className="app-session app-session-in" to="/account">
        تسجيل الدخول
      </Link>
    );
  return (
    <div className="app-session">
      <span className="app-session-who" title={session.user.email ?? undefined}>
        {session.user.email ?? "حسابك"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!supabase) return;
          setBusy(true);
          setFailed(false);
          void supabase.auth.signOut().then(({ error }) => {
            setBusy(false);
            // Said, not swallowed: a sign-out that quietly failed leaves the
            // reader believing they have left a shared screen.
            if (error) setFailed(true);
          });
        }}
      >
        {busy ? "جارٍ الخروج…" : "تسجيل الخروج"}
      </button>
      {failed && (
        <span role="alert" className="app-session-error">
          تعذّر تسجيل الخروج
        </span>
      )}
    </div>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    const titles: Record<string, string> = {
      "/dashboard": "لوحة البيانات",
      "/account": "الحساب ومساحات العمل",
      "/sync": "حالة المزامنة",
      "/connected": "نتيجة ربط القناة",
    };
    document.title = `${titles[pathname] ?? "صفحة غير موجودة"} — مشاعر الجمهور`;
    setMenuOpen(false);
  }, [pathname]);
  return (
    <div className="app-shell" dir="rtl">
      <a className="skip app-skip" href="#content">
        انتقل إلى المحتوى
      </a>
      <div className="app-announcement">
        <span>صوت جمهورك، بوضوح أكبر</span>
        <span>معاينة خاصة · نسخة تجريبية</span>
      </div>
      <header className="app-header">
        <div className="app-header-inner">
          <Link
            className="app-brand"
            to="/"
            aria-label="مشاعر الجمهور — الرئيسية"
          >
            <BrandMark />
            <span>
              مشاعر الجمهور<span className="app-brand-dot">.</span>
            </span>
          </Link>
          <button
            className="app-menu"
            type="button"
            aria-label="قائمة التطبيق"
            aria-expanded={menuOpen}
            aria-controls="app-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "إغلاق ×" : "القائمة ☰"}
          </button>
          <nav
            id="app-navigation"
            className={menuOpen ? "app-nav is-open" : "app-nav"}
            aria-label="التنقل الرئيسي"
          >
            <NavLink to="/" onClick={() => setMenuOpen(false)}>
              الرئيسية
            </NavLink>
            <NavLink to="/dashboard" onClick={() => setMenuOpen(false)}>
              لوحة البيانات
            </NavLink>
            <NavLink to="/sync" onClick={() => setMenuOpen(false)}>
              حالة المزامنة
            </NavLink>
            <NavLink to="/account" onClick={() => setMenuOpen(false)}>
              الحساب ومساحات العمل
            </NavLink>
          </nav>
          <SessionControl />
        </div>
      </header>
      <main id="content" className="app-main">
        <Suspense
          fallback={
            <div className="app-state" role="status">
              <span className="app-state-symbol" aria-hidden="true">
                ◌
              </span>
              <p>جارٍ فتح الصفحة…</p>
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <footer className="app-footer">
        <div>
          <Link to="/">مشاعر الجمهور.</Link>
          <span>من التعليق إلى صورة أوضح.</span>
        </div>
        <p>معاينة خاصة · بعض الصفحات تستخدم بيانات اصطناعية موضّحة بوضوح.</p>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="app-state app-not-found">
      <span className="app-state-symbol" aria-hidden="true">
        ؟
      </span>
      <p className="app-eyebrow">هذه الصفحة غير متاحة</p>
      <h1>لم نجد الصفحة التي تبحث عنها.</h1>
      <p>يمكنك العودة إلى اللوحة أو استكشاف الخدمة من الصفحة الرئيسية.</p>
      <div className="app-state-actions">
        <Link to="/dashboard">فتح لوحة البيانات</Link>
        <Link to="/">العودة للرئيسية</Link>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/account" element={<Account />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/connected" element={<Connected />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

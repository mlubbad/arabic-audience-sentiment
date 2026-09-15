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

function NavIcon({ to }: { to: string }) {
  if (to === "/dashboard") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    );
  }
  if (to === "/sync") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 21h5v-5" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** The product's parts, in one list.
 *  The page title, the rail and the document title all read from it, so a
 *  destination cannot exist in the navigation and nowhere else, or the
 *  reverse — which is how "مقارنة الفيديوهات" came to be a section of the
 *  report that its own index did not list. */
const DESTINATIONS = [
  { to: "/dashboard", label: "نظرة عامة", title: "نظرة عامة" },
  { to: "/sync", label: "التشغيل", title: "حالة المزامنة" },
  {
    to: "/account",
    label: "المصادر والحساب",
    title: "الحساب ومساحات العمل",
  },
] as const;

/** Loaded only once there is a session to have a plan for: the card reads the
 *  contracts and the data module, which a visitor on the landing page has no
 *  use for and would otherwise carry in the main bundle. */
const PlanCard = lazy(() =>
  import("./PlanCard").then((m) => ({ default: m.PlanCard })),
);

function RailPlan() {
  const { session } = useSession();
  if (!session) return null;
  return (
    <Suspense fallback={null}>
      <PlanCard />
    </Suspense>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    const found = DESTINATIONS.find((d) => d.to === pathname);
    const title =
      found?.title ??
      (pathname === "/connected" ? "نتيجة ربط القناة" : "صفحة غير موجودة");
    document.title = `${title} — مشاعر الجمهور`;
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
      {/* A rail, not a bar.
          Four links across the top said "this is a page with some links on
          it"; a standing rail says "this is a product, and these are its
          parts". It also gives the two things a top bar had nowhere to put:
          which workspace you are in, and what your plan has left — both true
          on every screen and previously buried inside one page each. */}
      <button
        className="app-menu"
        type="button"
        aria-label="قائمة التطبيق"
        aria-expanded={menuOpen}
        aria-controls="app-rail"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? "إغلاق ×" : "القائمة ☰"}
      </button>
      <aside
        id="app-rail"
        className={menuOpen ? "app-rail is-open" : "app-rail"}
      >
        <Link
          className="app-brand"
          to="/"
          aria-label="مشاعر الجمهور — الرئيسية"
        >
          <BrandMark />
          <span>
            <b>
              مشاعر الجمهور<span className="app-brand-dot">.</span>
            </b>
            <small>من سكاي ديفيلوب</small>
          </span>
        </Link>

        <nav className="app-nav" aria-label="التنقل الرئيسي">
          {/* A heading for the group, not decoration: the rail carries three
              kinds of thing — where you are, what your plan has left, and who
              you are — and unlabelled they read as one undifferentiated list. */}
          <p className="app-rail-caption">التنقّل</p>
          {DESTINATIONS.map((d) => (
            <NavLink key={d.to} to={d.to} onClick={() => setMenuOpen(false)}>
              <span className="app-nav-mark" aria-hidden="true">
                <NavIcon to={d.to} />
              </span>
              {d.label}
            </NavLink>
          ))}
        </nav>

        <div className="app-rail-foot">
          <RailPlan />
          <SessionControl />
        </div>
      </aside>
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

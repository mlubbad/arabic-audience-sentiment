import React, {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
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
import { DirectionProvider } from "@radix-ui/react-direction";
import "./style.css";
import "./app.css";
import "./locale.css";
import "./ui/ui.css";
import { Landing } from "./Landing";
import { BrandMark } from "./BrandMark";
import { useSession } from "./session";
import { useIsPlatformAdmin } from "./adminAccess";
import { supabase } from "./supabase";
import { ToastHost } from "./ui/Toast";
import { carriedSearch } from "./workspaceUrl";
import {
  applyToDocument,
  currentLocale,
  DEFAULT_LOCALE,
  direction,
  useLocale,
} from "./locale";
import { loadStrings, useStrings, type StringKey } from "./strings";
import { LanguageSwitch } from "./LanguageSwitch";
import { LegalLinks } from "./LegalLinks";
import { LEGAL_PATHS } from "./legal/types";
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
// `PricingPage`, not `Pricing`: `pricing.ts` (the words) already exists, and
// on a case-insensitive filesystem `./Pricing` resolves to it.
const Pricing = lazy(() =>
  import("./PricingPage").then((m) => ({ default: m.Pricing })),
);
// `AdminPage`, not `Admin`, for the same reason: `adminWords.ts` is beside it.
const AdminPage = lazy(() =>
  import("./AdminPage").then((m) => ({ default: m.AdminPage })),
);
// The legal documents share one page; the address decides which. The
// documents themselves load with it, not with the shell.
const LegalPage = lazy(() =>
  import("./LegalPage").then((m) => ({ default: m.LegalPage })),
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
  const S = useStrings();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nothing at all until it is known. A "sign in" that flips to "sign out" a
  // moment later reads as the page changing its mind about who you are.
  if (loading) return null;
  if (!session)
    return (
      <Link className="app-session app-session-in" to="/account">
        {S.signIn}
      </Link>
    );
  return (
    <div className="app-session">
      <span className="app-session-who" title={session.user.email ?? undefined}>
        {session.user.email ?? S.yourAccount}
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
        {busy ? S.signingOut : S.signOut}
      </button>
      {failed && (
        <span role="alert" className="app-session-error">
          {S.signOutFailed}
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
  if (to === "/admin") {
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
        <circle cx="8" cy="15" r="4" />
        <path d="M10.85 12.15 19 4" />
        <path d="M18 5l2 2" />
        <path d="M15 8l2 2" />
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
  // `scoped`: the page shows one workspace, so a link to it from the rail
  // carries the current `?ws=` and the address stays the one to copy on the
  // way across. The account page lists every workspace and reads no such
  // parameter; stamping one on it would be a claim the page does not make.
  // `label` and `title` are keys into the strings, so the rail and the
  // document title change language with everything else.
  {
    to: "/dashboard",
    label: "navOverview",
    title: "titleOverview",
    scoped: true,
  },
  {
    to: "/sync",
    label: "navOperations",
    title: "titleOperations",
    scoped: true,
  },
  {
    to: "/account",
    label: "navAccount",
    title: "titleAccount",
    scoped: false,
  },
  // `admin`: listed only for a platform admin, which `is_platform_admin()`
  // decides on the server. The page itself refuses everyone else, so the
  // link's absence is a courtesy, not the gate.
  {
    to: "/admin",
    label: "navAdmin",
    title: "adminTitle",
    scoped: false,
    admin: true,
  },
] as const satisfies readonly {
  to: string;
  label: StringKey;
  title: StringKey;
  scoped: boolean;
  admin?: boolean;
}[];

/** Loaded only once there is a session to have a plan for: the card reads the
 *  contracts and the data module, which a visitor on the landing page has no
 *  use for and would otherwise carry in the main bundle. */
const PlanCard = lazy(() =>
  import("./PlanCard").then((m) => ({ default: m.PlanCard })),
);

const WorkspaceSwitch = lazy(() =>
  import("./RailState").then((m) => ({ default: m.WorkspaceSwitch })),
);
const CollectionState = lazy(() =>
  import("./RailState").then((m) => ({ default: m.CollectionState })),
);

/** The rail's state, for a signed-in reader only. */
function RailState({ part }: { part: "workspace" | "collection" | "plan" }) {
  const { session } = useSession();
  if (!session) return null;
  const Part =
    part === "workspace"
      ? WorkspaceSwitch
      : part === "collection"
        ? CollectionState
        : PlanCard;
  return (
    <Suspense fallback={null}>
      <Part />
    </Suspense>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  const carried = carriedSearch(search);
  const locale = useLocale();
  const S = useStrings();
  // Signed out, nothing is asked; signed in, one query the admin page shares.
  const { session } = useSession();
  const access = useIsPlatformAdmin(session);
  const destinations = DESTINATIONS.filter(
    (d) => !("admin" in d) || access.data === true,
  );
  // The language lands on <html> before paint, where CSS `:lang()` and the
  // bidi algorithm read it. The shell is the only surface that speaks two
  // languages: the landing page is Arabic and stays so, which is why leaving
  // the shell puts the document back the way index.html declared it.
  useLayoutEffect(() => {
    applyToDocument(locale);
    return () => applyToDocument(DEFAULT_LOCALE);
  }, [locale]);
  useEffect(() => {
    const found = DESTINATIONS.find((d) => d.to === pathname);
    const title = found
      ? S[found.title]
      : pathname === "/connected"
        ? S.titleConnected
        : S.titleNotFound;
    document.title = `${title} — ${S.brand}`;
    setMenuOpen(false);
  }, [pathname, S]);
  return (
    <div className="app-shell" dir={direction(locale)}>
      <a className="skip app-skip" href="#content">
        {S.skipToContent}
      </a>
      {/* The switch lives in the announcement bar, not the rail foot where it
          was first put. Measured: the rail is a sticky 100vh plane under a
          34px bar, so at the top of the page its foot is 34px below the fold
          and a control there is the first thing clipped. The bar is on every
          screen size, above the fold, and on a phone needs no menu opened. */}
      <div className="app-announcement">
        <span>{S.announcementLead}</span>
        <span>{S.announcementTag}</span>
        <LanguageSwitch />
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
        aria-label={S.menuLabel}
        aria-expanded={menuOpen}
        aria-controls="app-rail"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? S.menuClose : S.menuOpen}
      </button>
      <aside
        id="app-rail"
        className={menuOpen ? "app-rail is-open" : "app-rail"}
      >
        <Link className="app-brand" to="/" aria-label={S.brandHomeLabel}>
          <BrandMark />
          <span>
            <b>
              {S.brand}
              <span className="app-brand-dot">.</span>
            </b>
            <small>{S.brandOwner}</small>
          </span>
        </Link>

        <RailState part="workspace" />

        <nav className="app-nav" aria-label={S.navLabel}>
          {/* A heading for the group, not decoration: the rail carries three
              kinds of thing — where you are, what your plan has left, and who
              you are — and unlabelled they read as one undifferentiated list. */}
          <p className="app-rail-caption">{S.navCaption}</p>
          {destinations.map((d) => (
            <NavLink
              key={d.to}
              to={{ pathname: d.to, search: d.scoped ? carried : "" }}
              onClick={() => setMenuOpen(false)}
            >
              <span className="app-nav-mark" aria-hidden="true">
                <NavIcon to={d.to} />
              </span>
              {S[d.label]}
            </NavLink>
          ))}
        </nav>

        <div className="app-rail-foot">
          <RailState part="collection" />
          <RailState part="plan" />
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
              <p>{S.pageOpening}</p>
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <footer className="app-footer">
        <div>
          <Link to="/">{S.brand}.</Link>
          <span>{S.footerTagline}</span>
        </div>
        <p>{S.footerNote}</p>
        <LegalLinks className="app-legal" />
      </footer>
    </div>
  );
}

function NotFound() {
  const S = useStrings();
  const locale = useLocale();
  return (
    <div className="app-state app-not-found">
      <span className="app-state-symbol" aria-hidden="true">
        {locale === "ar" ? "؟" : "?"}
      </span>
      <p className="app-eyebrow">{S.notFoundEyebrow}</p>
      <h1>{S.notFoundTitle}</h1>
      <p>{S.notFoundLead}</p>
      <div className="app-state-actions">
        <Link to="/dashboard">{S.openDashboard}</Link>
        <Link to="/">{S.backHome}</Link>
      </div>
    </div>
  );
}
/** Establishes Radix's Direction context for the whole app — every route, not just the signed-in
 *  shell — so a component from ui/ used on a signed-out page (the landing page, /pricing, a legal
 *  document) still reads the right RTL/LTR direction. AppLayout's own `dir` attribute on `.app-shell`
 *  is a separate, DOM-level signal for the browser's bidi algorithm and CSS `:lang()`/`:dir()`; this is
 *  the React-context-only signal Radix's own primitives read internally. */
function DirectionRoot({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  return (
    <DirectionProvider dir={direction(locale)}>{children}</DirectionProvider>
  );
}

// The stored language's strings are in hand before the first render: a reader
// who chose English does not see Arabic for a frame while it loads.
void loadStrings(currentLocale()).then(() =>
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={client}>
        <DirectionRoot>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              {/* Beside the landing, not inside the shell: read signed out. */}
              <Route
                path="/pricing"
                element={
                  <Suspense fallback={null}>
                    <Pricing />
                  </Suspense>
                }
              />
              {/* Read signed out too — by the reader deciding, and by the
                  reviewer at Google or Paddle following the footer link. */}
              <Route
                path={LEGAL_PATHS.privacy}
                element={
                  <Suspense fallback={null}>
                    <LegalPage doc="privacy" />
                  </Suspense>
                }
              />
              <Route
                path={LEGAL_PATHS.terms}
                element={
                  <Suspense fallback={null}>
                    <LegalPage doc="terms" />
                  </Suspense>
                }
              />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/account" element={<Account />} />
                <Route path="/sync" element={<Sync />} />
                <Route path="/connected" element={<Connected />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <ToastHost />
        </DirectionRoot>
      </QueryClientProvider>
    </React.StrictMode>,
  ),
);

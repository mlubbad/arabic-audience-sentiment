import React, {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Outlet,
  useLocation,
  Navigate,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectionProvider } from "@radix-ui/react-direction";
import "./style.css";
import "./app.css";
import "./locale.css";
import "./ui/ui.css";
import { Landing } from "./landing/Landing";
// The pricing and legal pages are `lazy()` below, but their stylesheets are
// not: a prerendered public page arrives with its markup in place and links
// only the entry's CSS, so a rule that travels with the lazy chunk reaches
// the reader after the page has already painted without it — `/pricing`
// and the legal documents painted as the landing's type and reflowed once
// the low-priority bundle hydrated. Imported here, they are in the entry's
// CSS; `scripts/prerender.mjs` checks that they stayed there. They must
// come AFTER the landing's import: `public.css` carries the shared chrome
// these two override at equal specificity, and later wins.
import "./pricing.css";
import "./legal.css";
import { BrandMark } from "./BrandMark";
import { useSession, useWorkspaces } from "./session";
import {
  audienceVisible,
  useAudienceAvailability,
} from "./audience/useAudience";
import { useIsPlatformAdmin } from "./adminAccess";
import { shouldRetryDashboardQuery } from "./queryRetry";
import { ToastHost } from "./ui/Toast";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { carriedSearch } from "./workspaceUrl";
import {
  applyToDocument,
  currentLocale,
  DEFAULT_LOCALE,
  direction,
  setLocale,
  useLocale,
} from "./locale";
import { loadStrings, useStrings, type StringKey } from "./strings";
import { LanguageSwitch } from "./LanguageSwitch";
import { LegalLinks } from "./LegalLinks";
import { publicPath, resolvePublicPath } from "./publicPaths";
import { publicRoutes } from "./publicRoutes";
import { SessionControl } from "./SessionControl";
import { AdminInspectionBanner } from "./AdminInspectionBanner";
import { AdminTrail } from "./AdminTrail";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { ImpersonationProvider, useImpersonation } from "./impersonation";
import { TourProvider } from "./tour/TourProvider";
import { TourEntry } from "./tour/TourEntry";
import { RESET_PATH, useRecoveryLanding } from "./account/recoveryLanding";
const Dashboard = lazy(() =>
  import("./dashboard/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const CompetitorsPage = lazy(() =>
  import("./competitors/CompetitorsPage").then((m) => ({
    default: m.CompetitorsPage,
  })),
);
const AudiencePage = lazy(() =>
  import("./audience/AudiencePage").then((m) => ({ default: m.AudiencePage })),
);
const Connected = lazy(() =>
  import("./Connected").then((m) => ({ default: m.Connected })),
);
const Sync = lazy(() =>
  import("./ops/Sync").then((m) => ({ default: m.Sync })),
);
const Account = lazy(() =>
  import("./account/Account").then((m) => ({ default: m.Account })),
);
const ResetPassword = lazy(() =>
  import("./account/ResetPassword").then((m) => ({
    default: m.ResetPassword,
  })),
);
// `PricingPage`, not `Pricing`: `pricing.ts` (the words) already exists, and
// on a case-insensitive filesystem `./Pricing` resolves to it.
const Pricing = lazy(() =>
  import("./PricingPage").then((m) => ({ default: m.Pricing })),
);
// `AdminPage`, not `Admin`, for the same reason: `adminWords.ts` is beside it.
const AdminPage = lazy(() =>
  import("./admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
// The observability pages the roadmap's phase one adds: read-only screens
// beside the operator's workspace table, one room in the rail's map.
// The owner console's home: the whole platform in one read (phase 1).
const AdminHome = lazy(() =>
  import("./admin/AdminHomePage").then((m) => ({ default: m.AdminHomePage })),
);
const AdminUsers = lazy(() =>
  import("./admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminChannels = lazy(() =>
  import("./admin/AdminChannelsPage").then((m) => ({
    default: m.AdminChannelsPage,
  })),
);
const AdminCompare = lazy(() =>
  import("./admin/AdminComparePage").then((m) => ({
    default: m.AdminComparePage,
  })),
);
const AdminSystem = lazy(() =>
  import("./admin/AdminSystemPage").then((m) => ({
    default: m.AdminSystemPage,
  })),
);
const AdminPlans = lazy(() =>
  import("./admin/AdminPlansPage").then((m) => ({ default: m.AdminPlansPage })),
);
const AdminOps = lazy(() =>
  import("./admin/AdminOpsPage").then((m) => ({ default: m.AdminOpsPage })),
);
const AdminServices = lazy(() =>
  import("./admin/AdminServicesPage").then((m) => ({
    default: m.AdminServicesPage,
  })),
);
const AdminAudit = lazy(() =>
  import("./admin/AdminAuditPage").then((m) => ({ default: m.AdminAuditPage })),
);
const AdminImport = lazy(() =>
  import("./admin/AdminImportPage").then((m) => ({
    default: m.AdminImportPage,
  })),
);
// The legal documents share one page; the address decides which. The
// documents themselves load with it, not with the shell.
const LegalPage = lazy(() =>
  import("./LegalPage").then((m) => ({ default: m.LegalPage })),
);
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => shouldRetryDashboardQuery(n, e, 1),
      refetchOnWindowFocus: false,
    },
  },
});

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
    to: "/competitors",
    label: "navCompetitors",
    title: "titleCompetitors",
    scoped: true,
  },
  {
    to: "/audience",
    label: "navAudience",
    title: "titleAudience",
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
  const railRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  // On a phone the rail opens as a sheet. Put the keyboard in it when it
  // opens — its first link — so it is a sheet the keyboard can use; on a
  // wide viewport the toggle is display:none and this never fires.
  useEffect(() => {
    if (menuOpen)
      railRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [menuOpen]);
  const { pathname, search } = useLocation();
  useRecoveryLanding(pathname);
  const carried = carriedSearch(search);
  // Inside the owner console the rail's workspace, collection and plan are
  // one customer's, and the console's numbers are the platform's: shown
  // there, they asked "whose workspace? whose plan?" (owner console review,
  // 2026-10-13, finding 14). The tour is the customer's tour.
  const inConsole = pathname === "/admin" || pathname.startsWith("/admin/");
  // The same test `ops/Sync.tsx` and `account/Account.tsx` make: the demo
  // is a signed-in shell for the tour's purposes.
  const wantsDemo = new URLSearchParams(search).has("demo");
  const locale = useLocale();
  const S = useStrings();
  // Signed out, nothing is asked; signed in, one query the admin page shares.
  const { session } = useSession();
  const { workspaces } = useWorkspaces(session);
  const audienceAvailability = useAudienceAvailability(
    session
      ? (new URLSearchParams(search).get("ws") ?? workspaces[0]?.id ?? null)
      : null,
  );
  const { isImpersonating } = useImpersonation();
  const access = useIsPlatformAdmin(session);
  const destinations = DESTINATIONS.filter(
    (d) =>
      (!("admin" in d) || (access.data === true && !isImpersonating)) &&
      (d.to !== "/audience" || audienceVisible(audienceAvailability.data)),
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
    <TourProvider session={session} wantsDemo={wantsDemo}>
      <div className="app-shell" dir={direction(locale)}>
        {/* The product is never indexed, whatever the public pages say. The
            static HTML the shell boots from (`app.html`) carries the same
            directive; this is the one that reaches a crawler running React. */}
        <meta name="robots" content="noindex, nofollow" />
        <a className="skip app-skip" href="#content">
          {S.skipToContent}
        </a>
        {/* The switch lives in the announcement bar, not the rail foot where it
            was first put. Measured: the rail is a sticky 100vh plane under a
            34px bar, so at the top of the page its foot is 34px below the fold
            and a control there is the first thing clipped. The bar is on every
            screen size, above the fold, and on a phone needs no menu opened. */}
        <div
          className="app-announcement"
          role="region"
          aria-label={S.announcementLabel}
        >
          <span>{S.announcementLead}</span>
          <LanguageSwitch />
        </div>
        <AdminInspectionBanner />
        <AdminTrail />
        <ImpersonationBanner />
        {/* A rail, not a bar.
            Four links across the top said "this is a page with some links on
            it"; a standing rail says "this is a product, and these are its
            parts". It also gives the two things a top bar had nowhere to put:
            which workspace you are in, and what your plan has left — both true
            on every screen and previously buried inside one page each. */}
        <button
          className="app-menu"
          type="button"
          ref={menuRef}
          data-tour="rail-menu"
          aria-label={S.menuLabel}
          aria-expanded={menuOpen}
          aria-controls="app-rail"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? S.menuClose : S.menuOpen}
        </button>
        <aside
          id="app-rail"
          ref={railRef}
          aria-label={S.railLabel}
          className={menuOpen ? "app-rail is-open" : "app-rail"}
          onKeyDown={(e) => {
            // A popup opened from the rail (the session menu, the workspace
            // listbox) handles its own Escape: Radix dismisses it and marks
            // the event defaultPrevented on a document-capture listener, and
            // the synthetic event still bubbles here through the React tree
            // even though the popup is portaled to <body>. One Escape must
            // close one layer, not both.
            if (e.key === "Escape" && menuOpen && !e.defaultPrevented) {
              setMenuOpen(false);
              menuRef.current?.focus();
            }
          }}
        >
          <Link
            className="app-brand"
            to={publicPath("home", locale)}
            aria-label={S.brandHomeLabel}
          >
            <BrandMark />
            <span>
              <b>
                {S.brand}
                <span className="app-brand-dot">.</span>
              </b>
              <small>{S.brandOwner}</small>
            </span>
          </Link>

          {inConsole ? (
            <p className="app-rail-console" data-testid="rail-console-note">
              {S.railConsoleNote}
            </p>
          ) : (
            <RailState part="workspace" />
          )}

          <nav className="app-nav" aria-label={S.navLabel} data-tour="rail">
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
            {!inConsole && (
              <>
                <RailState part="collection" />
                <RailState part="plan" />
              </>
            )}
            {/* The tour's way back in, above the session: a reader who has
                met it once finds it here on every page — a signed-in one,
                or the demo's; signed out, the tour's pages refuse the
                walk, and a door onto six skipped steps would only write
                "seen" on a browser that never saw it. */}
            {(session || wantsDemo) && !inConsole && (
              <TourEntry onActivate={() => setMenuOpen(false)} />
            )}
            <SessionControl />
          </div>
        </aside>
        <main id="content" className="app-main">
          <ErrorBoundary>
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
          </ErrorBoundary>
        </main>
        <footer className="app-footer">
          <div>
            <Link to={publicPath("home", locale)}>{S.brand}.</Link>
            <span>{S.footerTagline}</span>
          </div>
          <p>{S.footerNote}</p>
          <LegalLinks className="app-legal" />
        </footer>
      </div>
    </TourProvider>
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
        <Link to={publicPath("home", locale)}>{S.backHome}</Link>
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

function OpsRedirect() {
  const location = useLocation();
  return <Navigate to={`/sync${location.search}${location.hash}`} replace />;
}

/** Everything under the router, for either way of mounting it. */
const app = (
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <DirectionRoot>
        <BrowserRouter>
          <ImpersonationProvider>
            <ErrorBoundary>
              <Routes>
                {/* The public pages, beside the landing and not inside the
                    shell: read signed out, in the language their address names,
                    and served prerendered — see publicPaths.ts. The pricing and
                    legal pages load on demand. */}
                {publicRoutes({ Landing, Pricing, LegalPage }, (element) => (
                  <Suspense fallback={null}>{element}</Suspense>
                ))}
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/competitors" element={<CompetitorsPage />} />
                  <Route path="/audience" element={<AudiencePage />} />
                  <Route path="/account" element={<Account />} />
                  <Route path={RESET_PATH} element={<ResetPassword />} />
                  <Route path="/sync" element={<Sync />} />
                  <Route path="/ops" element={<OpsRedirect />} />
                  <Route path="/connected" element={<Connected />} />
                  <Route path="/admin" element={<AdminHome />} />
                  <Route path="/admin/workspaces" element={<AdminPage />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/channels" element={<AdminChannels />} />
                  <Route path="/admin/compare" element={<AdminCompare />} />
                  <Route path="/admin/system" element={<AdminSystem />} />
                  <Route path="/admin/plans" element={<AdminPlans />} />
                  <Route path="/admin/ops" element={<AdminOps />} />
                  <Route path="/admin/services" element={<AdminServices />} />
                  <Route path="/admin/audit" element={<AdminAudit />} />
                  <Route path="/admin/import" element={<AdminImport />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </ErrorBoundary>
          </ImpersonationProvider>
        </BrowserRouter>
        <ToastHost />
      </DirectionRoot>
    </QueryClientProvider>
  </React.StrictMode>
);

// A public address names its own language, and that language is the one
// the reader is about to read — so it becomes the stored preference before
// the first render, and the product opens in it afterwards. Anywhere else
// the stored preference stands. Either way the strings are in hand before
// the first render: a reader who chose English does not see Arabic for a
// frame while it loads.
const hit = resolvePublicPath(window.location.pathname);
const initial = hit ? hit.locale : currentLocale();
void loadStrings(initial).then(() => {
  if (hit) setLocale(hit.locale);
  const root = document.getElementById("root")!;
  // A prerendered public page arrives with its markup in place and is
  // hydrated; the shell's fallback document (`app.html`) arrives empty and
  // is rendered from nothing. Same tree either way.
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
});
